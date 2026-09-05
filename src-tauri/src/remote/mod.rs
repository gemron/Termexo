pub mod bridge;
pub mod qr;
pub mod server;
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

use crate::config::{CredentialStore, REMOTE_ACCESS_CREDENTIAL_TARGET};
use crate::database::WorkspaceDatabase;
use crate::remote::server::{ConnectionCommand, ServerContext};
use crate::remote::settings::RemoteAccessSettings;
use crate::remote::token::RemoteAuth;

pub use bridge::{
    broadcast_event, RemoteEventHub, EVENT_AGENT_EVENTS, EVENT_TERMINAL_EXIT,
    EVENT_TERMINAL_OUTPUT, EVENT_TERMINAL_RESIZED, EVENT_WORKSPACE_CHANGED,
    EVENT_WORKSPACE_DELETED,
};
pub use qr::QrCodeImage;

/// How long open connections may finish their close handshake before the listener is torn down.
const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
/// Upper bound on waiting for the serving task, so a stuck connection cannot hang a settings save.
const SHUTDOWN_WAIT: Duration = Duration::from_secs(5);

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

/// Owns the remote access settings, the access token and the embedded server's lifecycle.
pub struct RemoteAccessManager {
    app: AppHandle,
    hub: Arc<RemoteEventHub>,
    auth: Arc<RemoteAuth>,
    state: Mutex<ManagerState>,
}

impl RemoteAccessManager {
    pub fn new(app: AppHandle, hub: Arc<RemoteEventHub>) -> Self {
        let stored_settings = settings::load(&app.state::<WorkspaceDatabase>());
        let stored_token = app
            .state::<CredentialStore>()
            .get_optional(REMOTE_ACCESS_CREDENTIAL_TARGET)
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "无法读取远程访问令牌");
                None
            })
            .unwrap_or_default();

        Self {
            app,
            hub,
            auth: Arc::new(RemoteAuth::new(stored_token)),
            state: Mutex::new(ManagerState {
                settings: stored_settings,
                last_error: None,
                running: None,
            }),
        }
    }

    /// Starts the server when the stored settings ask for it, recording the failure otherwise.
    pub async fn start_if_enabled(&self) {
        if !self.state.lock().await.settings.enabled {
            return;
        }
        if let Err(error) = self.start().await {
            tracing::warn!(%error, "远程访问服务启动失败");
        }
    }

    pub async fn start(&self) -> Result<(), String> {
        let mut state = self.state.lock().await;
        self.ensure_running(&mut state).await
    }

    pub async fn status(&self) -> RemoteAccessStatus {
        let state = self.state.lock().await;
        self.snapshot(&state)
    }

    /// Persists new settings, then restarts the server only when something it depends on changed.
    pub async fn update_settings(
        &self,
        settings: RemoteAccessSettings,
    ) -> Result<RemoteAccessStatus, String> {
        settings.validate()?;

        let mut state = self.state.lock().await;
        let restart_required = state.settings != settings;
        {
            let database = self.app.state::<WorkspaceDatabase>();
            settings::store(&database, &settings)?;
        }
        state.settings = settings;

        if restart_required {
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
        Ok(self.snapshot(&state))
    }

    /// Issues a new token and forces every connected client back through authentication.
    pub async fn regenerate_token(&self) -> Result<RemoteAccessStatus, String> {
        let token = token::generate_token()?;
        self.persist_token(&token)?;
        self.auth.replace_token(token);

        let state = self.state.lock().await;
        if let Some(running) = &state.running {
            let _ = running.commands.send(ConnectionCommand::Reauthenticate);
        }
        Ok(self.snapshot(&state))
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
        let context = Arc::new(ServerContext {
            app: self.app.clone(),
            hub: self.hub.clone(),
            auth: self.auth.clone(),
            commands: command_receiver,
            secure: settings.tls,
            port: settings.port,
            version: self.app.package_info().version.to_string(),
        });
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

    /// Generates the access token the first time the service is switched on.
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

    fn snapshot(&self, state: &ManagerState) -> RemoteAccessStatus {
        RemoteAccessStatus {
            settings: state.settings.clone(),
            running: state.running.is_some(),
            error: state.last_error.clone(),
            addresses: local_addresses(),
            token: self.auth.token(),
            connected_clients: self.hub.connected_clients(),
        }
    }
}

fn report_serve_result(result: std::io::Result<()>) {
    if let Err(error) = result {
        tracing::warn!(%error, "远程访问服务已异常退出");
    }
}
