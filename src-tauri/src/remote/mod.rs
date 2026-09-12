pub mod bridge;
pub mod qr;
pub mod relay;
pub mod server;
pub mod session_crypto;
pub mod settings;
mod tls;
pub mod token;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use if_addrs::IfAddr;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::sync::{watch, Mutex};

use crate::config::{CredentialStore, RELAY_CREDENTIAL_TARGET, REMOTE_ACCESS_CREDENTIAL_TARGET};
use crate::database::WorkspaceDatabase;
use crate::remote::relay::{LinkRequest, RelayEndpoint, RelayLink, RelayStatus};
use crate::remote::server::{ConnectionCommand, ServerContext};
use crate::remote::settings::RemoteAccessSettings;
use crate::remote::token::RemoteAuth;

pub use bridge::{
    broadcast_event, RemoteEventHub, EVENT_AGENT_EVENTS, EVENT_TERMINAL_EXIT,
    EVENT_TERMINAL_OUTPUT, EVENT_TERMINAL_RESIZED, EVENT_WORKSPACE_CHANGED,
    EVENT_WORKSPACE_DELETED,
};
pub use qr::QrCodeImage;
pub use relay::RelayEnrollRequest;

/// How long open connections may finish their close handshake before the listener is torn down.
const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
/// Upper bound on waiting for the serving task, so a stuck connection cannot hang a settings save.
const SHUTDOWN_WAIT: Duration = Duration::from_secs(5);

/// Always in a certificate's SAN list, and never a useful name for a device on a relay.
pub(crate) const LOCALHOST_NAME: &str = "localhost";
/// What a device is called on the relay when this machine does not report a name of its own.
const FALLBACK_DEVICE_NAME: &str = "Termexo 桌面端";

const RELAY_NOT_ENROLLED: &str = "尚未接入中继，请先使用接入码或账号密码接入。";

/// One local IPv4 address the workbench can be reached at.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessAddress {
    pub address: String,
    pub interface_name: String,
    pub loopback: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessStatus {
    pub settings: RemoteAccessSettings,
    pub running: bool,
    /// Why the last start attempt failed, in Chinese, for the settings panel.
    pub error: Option<String>,
    pub addresses: Vec<RemoteAccessAddress>,
    /// Empty until a token has been generated. This is the one credential the UI may show.
    pub token: String,
    pub connected_clients: u32,
    /// The relay tunnel, which is independent of the LAN listener above.
    pub relay: RelayStatus,
}

/// Every local IPv4 address, loopback included, so the panel can group them itself.
pub fn local_addresses() -> Vec<RemoteAccessAddress> {
    let interfaces = match if_addrs::get_if_addrs() {
        Ok(interfaces) => interfaces,
        Err(error) => {
            tracing::warn!(%error, "无法枚举本机网络地址");
            return Vec::new();
        }
    };
    interfaces
        .into_iter()
        .filter_map(|interface| {
            let loopback = interface.is_loopback();
            match interface.addr {
                // IPv6 link-local addresses need a zone index that a QR code cannot carry, so the
                // panel only offers IPv4.
                IfAddr::V4(address) => Some(RemoteAccessAddress {
                    address: address.ip.to_string(),
                    interface_name: interface.name,
                    loopback,
                }),
                IfAddr::V6(_) => None,
            }
        })
        .collect()
}

/// This machine's own name, lowercased, or `None` when the environment does not report one.
///
/// It names the certificate's subject and, on a relay, this device — both want the name a person
/// would recognize in a list, and neither is served by "localhost".
pub(crate) fn machine_name() -> Option<String> {
    let raw = if cfg!(windows) {
        std::env::var("COMPUTERNAME")
    } else {
        std::env::var("HOSTNAME")
    };
    raw.ok()
        .map(|name| name.trim().to_ascii_lowercase())
        .filter(|name| !name.is_empty() && name != LOCALHOST_NAME)
}

struct RunningServer {
    handle: axum_server::Handle<SocketAddr>,
    commands: watch::Sender<ConnectionCommand>,
    task: tauri::async_runtime::JoinHandle<()>,
}

struct ManagerState {
    settings: RemoteAccessSettings,
    last_error: Option<String>,
    running: Option<RunningServer>,
}

/// Owns the remote access settings, the access token, the embedded server's lifecycle and the
/// relay tunnel.
pub struct RemoteAccessManager {
    app: AppHandle,
    hub: Arc<RemoteEventHub>,
    auth: Arc<RemoteAuth>,
    relay: RelayLink,
    state: Mutex<ManagerState>,
}

impl RemoteAccessManager {
    /// Built behind an `Arc` because the relay link calls back into the manager when the relay
    /// revokes this device, and the credential and the settings are the manager's to forget.
    pub fn new(app: AppHandle, hub: Arc<RemoteEventHub>) -> Arc<Self> {
        let stored_settings = settings::load(&app.state::<WorkspaceDatabase>());
        let stored_token = app
            .state::<CredentialStore>()
            .get_optional(REMOTE_ACCESS_CREDENTIAL_TARGET)
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "无法读取远程访问令牌");
                None
            })
            .unwrap_or_default();

        let manager = Arc::new(Self {
            app,
            hub,
            auth: Arc::new(RemoteAuth::new(stored_token)),
            relay: RelayLink::new(),
            state: Mutex::new(ManagerState {
                settings: stored_settings,
                last_error: None,
                running: None,
            }),
        });

        let owner = Arc::downgrade(&manager);
        manager.relay.on_revoked(Arc::new(move |reason: String| {
            let Some(manager) = owner.upgrade() else {
                return;
            };
            tauri::async_runtime::spawn(async move { manager.forget_relay_device(&reason).await });
        }));
        manager
    }

    /// Starts whichever ways in the stored settings ask for, recording failures rather than
    /// keeping the app from starting.
    pub async fn start_if_enabled(&self) {
        let mut state = self.state.lock().await;
        if state.settings.enabled {
            if let Err(error) = self.ensure_running(&mut state).await {
                tracing::warn!(%error, "远程访问服务启动失败");
            }
        }
        self.apply_relay(&state).await;
    }

    pub async fn status(&self) -> RemoteAccessStatus {
        let state = self.state.lock().await;
        self.snapshot(&state)
    }

    /// Persists new settings, then restarts only what the change actually touched.
    pub async fn update_settings(
        &self,
        settings: RemoteAccessSettings,
    ) -> Result<RemoteAccessStatus, String> {
        let settings = settings.normalized()?;

        let mut state = self.state.lock().await;
        let restart_listener = listener_changed(&state.settings, &settings);
        self.persist_settings(&settings)?;
        state.settings = settings;

        if restart_listener {
            Self::shutdown(&mut state).await;
        }
        let start_result = if state.settings.enabled {
            self.ensure_running(&mut state).await
        } else {
            state.last_error = None;
            Ok(())
        };

        // A failed start is reported through the status snapshot rather than as a command error,
        // because the settings themselves were saved and the panel has to show both facts.
        if let Err(error) = start_result {
            tracing::warn!(%error, "远程访问服务启动失败");
        }
        self.apply_relay(&state).await;
        Ok(self.snapshot(&state))
    }

    /// Issues a new token and forces every connected client, LAN or tunnel, back through
    /// authentication.
    pub async fn regenerate_token(&self) -> Result<RemoteAccessStatus, String> {
        let token = token::generate_token()?;
        self.persist_token(&token)?;
        self.auth.replace_token(token);

        let state = self.state.lock().await;
        if let Some(running) = &state.running {
            let _ = running.commands.send(ConnectionCommand::Reauthenticate);
        }
        self.relay.reauthenticate();
        Ok(self.snapshot(&state))
    }

    /// Trades an enrollment code or an account password for a device credential, then brings the
    /// tunnel up. Nothing is persisted until the relay has accepted the device.
    pub async fn enroll_relay_device(
        &self,
        request: RelayEnrollRequest,
    ) -> Result<RemoteAccessStatus, String> {
        let relay_settings = request.relay_settings().normalized()?;
        let endpoint = RelayEndpoint::new(&relay_settings);
        let device_name = request.device_name(&default_device_name());
        let response = relay::enroll(&endpoint, &request.into_body(device_name.clone())).await?;

        // The credential is stored first: a saved setting that points at a credential which was
        // never written would leave the link unable to start and the panel unable to explain why.
        self.app
            .state::<CredentialStore>()
            .set(RELAY_CREDENTIAL_TARGET, &response.credential)
            .map_err(|error| format!("无法保存中继设备凭据：{error}"))?;

        let mut state = self.state.lock().await;
        let settings = RemoteAccessSettings {
            relay: relay_settings,
            ..state.settings.clone()
        };
        self.persist_settings(&settings)?;
        settings::store_relay_device_name(&self.app.state::<WorkspaceDatabase>(), &device_name)?;
        state.settings = settings;

        tracing::info!(
            relay = %endpoint.authority(),
            device_id = %response.device_id,
            "已接入中继"
        );
        // A re-enrollment after a revocation targets the very same relay, so the previous link has
        // to go before the new credential can be presented.
        self.relay.stop().await;
        self.apply_relay(&state).await;
        Ok(self.snapshot(&state))
    }

    /// Leaves the relay: the tunnel closes, the credential is forgotten and the setting goes off.
    pub async fn disconnect_relay(&self) -> Result<RemoteAccessStatus, String> {
        self.relay.stop().await;
        self.app
            .state::<CredentialStore>()
            .delete(RELAY_CREDENTIAL_TARGET);

        let mut state = self.state.lock().await;
        let mut settings = state.settings.clone();
        settings.relay.enabled = false;
        self.persist_settings(&settings)?;
        state.settings = settings;
        Ok(self.snapshot(&state))
    }

    /// Applies the relay's revocation: the credential is worthless, and the setting must not bring
    /// the link back on the next start. The address is kept so the panel can still say which relay
    /// withdrew the access.
    async fn forget_relay_device(&self, reason: &str) {
        tracing::warn!(%reason, "中继已撤销本设备，正在清除设备凭据");
        self.app
            .state::<CredentialStore>()
            .delete(RELAY_CREDENTIAL_TARGET);

        let mut state = self.state.lock().await;
        if !state.settings.relay.enabled {
            return;
        }
        state.settings.relay.enabled = false;
        if let Err(error) = self.persist_settings(&state.settings) {
            tracing::warn!(%error, "无法保存中继撤销后的设置");
        }
    }

    /// Brings the relay link in line with the settings.
    async fn apply_relay(&self, state: &ManagerState) {
        if !state.settings.relay.enabled {
            self.relay.stop().await;
            return;
        }
        if let Err(error) = self.start_relay(&state.settings).await {
            tracing::warn!(%error, "中继隧道无法启动");
            self.relay.report_unavailable(error).await;
        }
    }

    async fn start_relay(&self, settings: &RemoteAccessSettings) -> Result<(), String> {
        self.ensure_token()?;
        let credential = self
            .app
            .state::<CredentialStore>()
            .get_optional(RELAY_CREDENTIAL_TARGET)
            .map_err(|error| format!("无法读取中继设备凭据：{error}"))?
            .ok_or_else(|| RELAY_NOT_ENROLLED.to_string())?;

        let context = self.build_context(settings, self.relay.commands(), true);
        self.relay
            .start(LinkRequest {
                endpoint: RelayEndpoint::new(&settings.relay),
                credential,
                device_name: self.relay_device_name(),
                version: context.version.clone(),
                router: server::router(context),
            })
            .await;
        Ok(())
    }

    /// The name this device announces to the relay: the one chosen at enrollment, or the machine's.
    fn relay_device_name(&self) -> String {
        settings::load_relay_device_name(&self.app.state::<WorkspaceDatabase>())
            .unwrap_or_else(default_device_name)
    }

    async fn ensure_running(&self, state: &mut ManagerState) -> Result<(), String> {
        if state.running.is_some() {
            return Ok(());
        }
        let settings = state.settings.clone();
        match self.launch(&settings).await {
            Ok(running) => {
                state.running = Some(running);
                state.last_error = None;
                Ok(())
            }
            Err(error) => {
                state.last_error = Some(error.clone());
                Err(error)
            }
        }
    }

    async fn launch(&self, settings: &RemoteAccessSettings) -> Result<RunningServer, String> {
        self.ensure_token()?;
        let address = settings.socket_address()?;

        // Binding synchronously first turns "port already in use" into an immediate, reportable
        // error instead of a task that dies in the background.
        let listener = std::net::TcpListener::bind(address)
            .map_err(|error| format!("无法监听 {address}：{error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("无法配置监听套接字：{error}"))?;

        let (commands, command_receiver) = watch::channel(ConnectionCommand::Run);
        let context = self.build_context(settings, command_receiver, false);
        let service = server::router(context).into_make_service_with_connect_info::<SocketAddr>();
        let handle = axum_server::Handle::<SocketAddr>::new();

        let task = if settings.tls {
            let app_data_dir = self
                .app
                .path()
                .app_data_dir()
                .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
            let host_addresses: Vec<String> = local_addresses()
                .into_iter()
                .map(|entry| entry.address)
                .collect();
            let tls_config = tls::load_or_create_config(&app_data_dir, &host_addresses).await?;
            let server = axum_server::tls_rustls::from_tcp_rustls(listener, tls_config)
                .map_err(|error| format!("无法启动 HTTPS 服务：{error}"))?
                .handle(handle.clone());
            tauri::async_runtime::spawn(
                async move { report_serve_result(server.serve(service).await) },
            )
        } else {
            let server = axum_server::from_tcp(listener)
                .map_err(|error| format!("无法启动 HTTP 服务：{error}"))?
                .handle(handle.clone());
            tauri::async_runtime::spawn(
                async move { report_serve_result(server.serve(service).await) },
            )
        };

        tracing::info!(%address, tls = settings.tls, "远程访问服务已启动");
        Ok(RunningServer {
            handle,
            commands,
            task,
        })
    }

    /// Builds the state one router shares across its connections.
    ///
    /// The LAN listener and the tunnel each get their own: they answer with the same handlers but
    /// disagree about the route a request arrived on, and their sessions are closed independently.
    fn build_context(
        &self,
        settings: &RemoteAccessSettings,
        commands: watch::Receiver<ConnectionCommand>,
        via_relay: bool,
    ) -> Arc<ServerContext> {
        Arc::new(ServerContext {
            app: self.app.clone(),
            hub: self.hub.clone(),
            auth: self.auth.clone(),
            commands,
            secure: settings.tls,
            port: settings.port,
            version: self.app.package_info().version.to_string(),
            via_relay,
        })
    }

    /// Stops the server and waits for the listener to be released.
    ///
    /// Awaiting the serving task matters because the very next thing a settings change does is
    /// bind the same port again.
    async fn shutdown(state: &mut ManagerState) {
        let Some(running) = state.running.take() else {
            return;
        };
        let _ = running.commands.send(ConnectionCommand::Stop);
        running
            .handle
            .graceful_shutdown(Some(GRACEFUL_SHUTDOWN_TIMEOUT));
        if tokio::time::timeout(SHUTDOWN_WAIT, running.task)
            .await
            .is_err()
        {
            tracing::warn!("远程访问服务未在超时前停止");
        }
    }

    /// Generates the access token the first time either way in is switched on.
    fn ensure_token(&self) -> Result<(), String> {
        if !self.auth.token().is_empty() {
            return Ok(());
        }
        let token = token::generate_token()?;
        self.persist_token(&token)?;
        self.auth.replace_token(token);
        Ok(())
    }

    fn persist_token(&self, token: &str) -> Result<(), String> {
        self.app
            .state::<CredentialStore>()
            .set(REMOTE_ACCESS_CREDENTIAL_TARGET, token)
            .map_err(|error| format!("无法保存访问令牌：{error}"))
    }

    fn persist_settings(&self, settings: &RemoteAccessSettings) -> Result<(), String> {
        settings::store(&self.app.state::<WorkspaceDatabase>(), settings)
    }

    fn snapshot(&self, state: &ManagerState) -> RemoteAccessStatus {
        RemoteAccessStatus {
            settings: state.settings.clone(),
            running: state.running.is_some(),
            error: state.last_error.clone(),
            addresses: local_addresses(),
            token: self.auth.token(),
            connected_clients: self.hub.connected_clients(),
            relay: self.relay.status(),
        }
    }
}

/// Whether anything the LAN listener is bound to changed.
///
/// A relay change must not tear the local listener down: the two ways in are independent, and
/// rebinding the port would drop every phone that is already on the local network.
fn listener_changed(previous: &RemoteAccessSettings, next: &RemoteAccessSettings) -> bool {
    previous.enabled != next.enabled
        || previous.bind_address != next.bind_address
        || previous.port != next.port
        || previous.tls != next.tls
}

fn default_device_name() -> String {
    machine_name().unwrap_or_else(|| FALLBACK_DEVICE_NAME.to_string())
}

fn report_serve_result(result: std::io::Result<()>) {
    if let Err(error) = result {
        tracing::warn!(%error, "远程访问服务已异常退出");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::settings::RelaySettings;

    fn relay_settings(url: &str) -> RelaySettings {
        RelaySettings {
            enabled: true,
            url: url.into(),
            certificate_fingerprint: None,
        }
    }

    /// Switching a relay on must not rebind the local port and drop every phone already on it.
    #[test]
    fn a_relay_change_alone_leaves_the_local_listener_alone() {
        let previous = RemoteAccessSettings {
            enabled: true,
            ..RemoteAccessSettings::default()
        };
        let next = RemoteAccessSettings {
            relay: relay_settings("https://relay.example.com"),
            ..previous.clone()
        };

        assert!(!listener_changed(&previous, &next));
    }

    #[test]
    fn every_binding_field_restarts_the_local_listener() {
        let previous = RemoteAccessSettings {
            enabled: true,
            ..RemoteAccessSettings::default()
        };

        for next in [
            RemoteAccessSettings {
                enabled: false,
                ..previous.clone()
            },
            RemoteAccessSettings {
                port: 7421,
                ..previous.clone()
            },
            RemoteAccessSettings {
                bind_address: "127.0.0.1".into(),
                ..previous.clone()
            },
            RemoteAccessSettings {
                tls: false,
                ..previous.clone()
            },
        ] {
            assert!(listener_changed(&previous, &next));
        }
    }

    #[test]
    fn a_device_always_has_a_name_to_announce() {
        assert!(!default_device_name().trim().is_empty());
    }

    /// The panel reads these names verbatim, so the shape is part of the contract with the
    /// frontend and a rename here is a breaking change there.
    #[test]
    fn the_status_reaches_the_panel_in_camel_case() {
        let status = RemoteAccessStatus {
            settings: RemoteAccessSettings {
                enabled: true,
                relay: relay_settings("https://relay.example.com"),
                ..RemoteAccessSettings::default()
            },
            running: true,
            error: None,
            addresses: vec![RemoteAccessAddress {
                address: "192.168.1.20".into(),
                interface_name: "以太网".into(),
                loopback: false,
            }],
            token: "token".into(),
            connected_clients: 2,
            relay: RelayStatus::default(),
        };

        let encoded = serde_json::to_string(&status).expect("the status should serialize");

        for key in [
            "\"bindAddress\"",
            "\"interfaceName\"",
            "\"connectedClients\"",
            "\"relay\":{",
            "\"certificateFingerprint\"",
            "\"deviceId\"",
            "\"deviceName\"",
            "\"connectedSince\"",
            "\"state\":\"disabled\"",
        ] {
            assert!(encoded.contains(key), "{key} is missing from {encoded}");
        }
    }
}
