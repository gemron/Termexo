//! Manages saved remote Termexo hosts, their health statuses, and the windows opened for them.

pub mod probe;
pub mod store;
pub mod window;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use termexo_relay_protocol::secret::random_base64url;
use tokio::sync::Mutex;

use crate::config::CredentialStore;
use crate::database::WorkspaceDatabase;

pub use probe::{ProbeOutcome, RemoteHostHealth};
pub use store::{RemoteHost, SaveRemoteHostRequest};

/// Local desktop event emitted when hosts or their statuses change; deliberately not forwarded
/// through `RemoteEventHub`.
pub const EVENT_REMOTE_HOSTS_CHANGED: &str = "remote-hosts-changed";
const HOST_ID_RANDOM_BYTES: usize = 12;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostStatus {
    pub host_id: String,
    pub health: RemoteHostHealth,
    pub version: Option<String>,
    pub latency_ms: Option<u32>,
    pub checked_at: Option<i64>,
    pub error: Option<String>,
    pub open: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostsSnapshot {
    pub hosts: Vec<RemoteHost>,
    pub statuses: Vec<RemoteHostStatus>,
}

/// Request payload for `probe_remote_host`: either an ad-hoc `{ url, token }` from the edit dialog
/// or an existing `host_id` (optionally overriding `url` / `token` while editing).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeRemoteHostRequest {
    pub host_id: Option<String>,
    pub url: Option<String>,
    pub token: Option<String>,
    /// When `true`, also verifies the token via `/ws` handshake; when `false`, checks `/api/health`
    /// only so background refreshes never risk triggering the remote host's failure lockout.
    #[serde(default)]
    pub verify_token: bool,
}

struct ManagerState {
    hosts: Vec<RemoteHost>,
    statuses: HashMap<String, RemoteHostStatus>,
}

pub struct RemoteHostManager {
    app: AppHandle,
    state: Mutex<ManagerState>,
}

impl RemoteHostManager {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let hosts = store::load_hosts(&app.state::<WorkspaceDatabase>());
        let statuses = hosts
            .iter()
            .map(|host| (host.id.clone(), initial_status(&host.id)))
            .collect();
        Arc::new(Self {
            app,
            state: Mutex::new(ManagerState { hosts, statuses }),
        })
    }

    pub async fn snapshot(&self) -> RemoteHostsSnapshot {
        let state = self.state.lock().await;
        self.build_snapshot(&state)
    }

    pub async fn save_host(
        self: &Arc<Self>,
        request: SaveRemoteHostRequest,
    ) -> Result<RemoteHostsSnapshot, String> {
        let name = request.name.trim().to_string();
        if name.is_empty() {
            return Err("远程主机名称不能为空。".into());
        }
        let normalized = store::normalize_host_url(&request.url)?;
        let provided_token = request
            .token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        let mut state = self.state.lock().await;
        let existing_index = request
            .id
            .as_deref()
            .and_then(|id| state.hosts.iter().position(|host| host.id == id));

        let host_id = match existing_index {
            Some(index) => state.hosts[index].id.clone(),
            None => generate_host_id()?,
        };

        let credentials = self.app.state::<CredentialStore>();
        let effective_token = match provided_token {
            Some(token) => {
                store::write_token(&credentials, &host_id, &token)?;
                token
            }
            None => store::read_token(&credentials, &host_id)?
                .filter(|stored| !stored.trim().is_empty())
                .ok_or_else(|| "请填写远程主机的访问令牌。".to_string())?,
        };

        let group = clean_optional(request.group);
        let color = clean_optional(request.color);
        let now = now_millis();

        match existing_index {
            Some(index) => {
                let current = &mut state.hosts[index];
                current.name = name;
                current.kind = normalized.kind;
                current.url = normalized.url.clone();
                current.group = group;
                current.color = color;
            }
            None => {
                let next_order = state
                    .hosts
                    .iter()
                    .map(|host| host.sort_order)
                    .max()
                    .map_or(0, |max| max + 1);
                state.hosts.push(RemoteHost {
                    id: host_id.clone(),
                    name,
                    kind: normalized.kind,
                    url: normalized.url.clone(),
                    read_only: false,
                    group,
                    color,
                    sort_order: next_order,
                    created_at: now,
                    last_connected_at: None,
                });
                state
                    .statuses
                    .insert(host_id.clone(), initial_status(&host_id));
            }
        }

        store::store_hosts(&self.app.state::<WorkspaceDatabase>(), &state.hosts)?;
        let snapshot = self.build_snapshot(&state);
        drop(state);

        self.emit_snapshot(&snapshot);
        let manager = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let outcome = probe::probe_with_token(&normalized, &effective_token).await;
            manager.apply_probe_outcome(&host_id, outcome).await;
        });

        Ok(snapshot)
    }

    pub async fn delete_host(&self, host_id: &str) -> Result<RemoteHostsSnapshot, String> {
        let _ = window::close_window(&self.app, host_id);
        store::delete_token(&self.app.state::<CredentialStore>(), host_id);

        let mut state = self.state.lock().await;
        state.hosts.retain(|host| host.id != host_id);
        state.statuses.remove(host_id);
        normalize_sort_order(&mut state.hosts);
        store::store_hosts(&self.app.state::<WorkspaceDatabase>(), &state.hosts)?;

        let snapshot = self.build_snapshot(&state);
        drop(state);
        self.emit_snapshot(&snapshot);
        Ok(snapshot)
    }

    pub async fn reorder_hosts(&self, ordered_ids: Vec<String>) -> Result<RemoteHostsSnapshot, String> {
        let mut state = self.state.lock().await;
        let order_map: HashMap<&str, usize> = ordered_ids
            .iter()
            .enumerate()
            .map(|(index, id)| (id.as_str(), index))
            .collect();
        let fallback = ordered_ids.len();
        state.hosts.sort_by_key(|host| {
            order_map
                .get(host.id.as_str())
                .copied()
                .unwrap_or(fallback + host.sort_order.max(0) as usize)
        });
        normalize_sort_order(&mut state.hosts);
        store::store_hosts(&self.app.state::<WorkspaceDatabase>(), &state.hosts)?;

        let snapshot = self.build_snapshot(&state);
        drop(state);
        self.emit_snapshot(&snapshot);
        Ok(snapshot)
    }

    pub async fn probe_host(
        self: &Arc<Self>,
        request: ProbeRemoteHostRequest,
    ) -> Result<ProbeOutcome, String> {
        let (target, token, host_id_for_update) = self.resolve_probe_inputs(&request).await?;
        if let Some(host_id) = &host_id_for_update {
            self.mark_probing(host_id).await;
        }
        let outcome = match (request.verify_token, token) {
            (true, Some(token)) => probe::probe_with_token(&target, &token).await,
            (true, None) => {
                return Err("请先填写远程主机的访问令牌。".into());
            }
            (false, _) => probe::check_health(&target).await,
        };
        if let Some(host_id) = host_id_for_update {
            self.apply_probe_outcome(&host_id, outcome.clone()).await;
        }
        Ok(outcome)
    }

    pub async fn refresh_all(self: &Arc<Self>) -> RemoteHostsSnapshot {
        let targets: Vec<(String, store::NormalizedHostUrl)> = {
            let mut state = self.state.lock().await;
            let list: Vec<(String, store::NormalizedHostUrl)> = state
                .hosts
                .iter()
                .filter_map(|host| {
                    store::normalize_host_url(&host.url)
                        .ok()
                        .map(|normalized| (host.id.clone(), normalized))
                })
                .collect();
            for (host_id, _) in &list {
                if let Some(status) = state.statuses.get_mut(host_id) {
                    status.health = RemoteHostHealth::Probing;
                }
            }
            let snapshot = self.build_snapshot(&state);
            self.emit_snapshot(&snapshot);
            list
        };

        for (host_id, target) in targets {
            let outcome = probe::check_health(&target).await;
            self.apply_probe_outcome(&host_id, outcome).await;
        }
        self.snapshot().await
    }

    pub async fn open_host(self: &Arc<Self>, host_id: &str) -> Result<RemoteHostsSnapshot, String> {
        let host = {
            let state = self.state.lock().await;
            state
                .hosts
                .iter()
                .find(|item| item.id == host_id)
                .cloned()
                .ok_or_else(|| "未找到该远程主机。".to_string())?
        };
        let token = store::read_token(&self.app.state::<CredentialStore>(), host_id)?
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "未找到该远程主机的访问令牌，请编辑主机重新填写。".to_string())?;

        // Check that the host can be loaded before opening a blank/broken window on a self-signed cert.
        let normalized = store::normalize_host_url(&host.url)?;
        let outcome = probe::probe_with_token(&normalized, &token).await;
        self.apply_probe_outcome(host_id, outcome.clone()).await;
        if outcome.health == RemoteHostHealth::UntrustedCertificate
            || outcome.health == RemoteHostHealth::Unauthorized
        {
            return Err(outcome
                .error
                .unwrap_or_else(|| "远程主机鉴权或证书检查未通过。".into()));
        }

        let manager = Arc::clone(self);
        let closed_id = host_id.to_string();
        window::open_or_focus_window(&self.app, &host, &token, move || {
            let manager = Arc::clone(&manager);
            let closed_id = closed_id.clone();
            tauri::async_runtime::spawn(async move {
                manager.record_window_closed(&closed_id).await;
            });
        })?;

        let mut state = self.state.lock().await;
        if let Some(entry) = state.hosts.iter_mut().find(|item| item.id == host_id) {
            entry.last_connected_at = Some(now_millis());
            let _ = store::store_hosts(&self.app.state::<WorkspaceDatabase>(), &state.hosts);
        }
        let snapshot = self.build_snapshot(&state);
        drop(state);
        self.emit_snapshot(&snapshot);
        Ok(snapshot)
    }

    pub async fn close_host(&self, host_id: &str) -> Result<RemoteHostsSnapshot, String> {
        window::close_window(&self.app, host_id)?;
        let state = self.state.lock().await;
        let snapshot = self.build_snapshot(&state);
        drop(state);
        self.emit_snapshot(&snapshot);
        Ok(snapshot)
    }

    async fn resolve_probe_inputs(
        &self,
        request: &ProbeRemoteHostRequest,
    ) -> Result<(store::NormalizedHostUrl, Option<String>, Option<String>), String> {
        let state = self.state.lock().await;
        let existing = request
            .host_id
            .as_deref()
            .and_then(|id| state.hosts.iter().find(|host| host.id == id))
            .cloned();
        drop(state);

        let raw_url = request
            .url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| existing.as_ref().map(|host| host.url.clone()))
            .ok_or_else(|| "请填写远程主机地址。".to_string())?;
        let target = store::normalize_host_url(&raw_url)?;

        let provided_token = request
            .token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let token = match provided_token {
            Some(token) => Some(token),
            None => match &existing {
                Some(host) => store::read_token(&self.app.state::<CredentialStore>(), &host.id)?,
                None => None,
            },
        };
        let update_id = existing
            .filter(|host| host.url == target.url)
            .map(|host| host.id);
        Ok((target, token, update_id))
    }

    async fn mark_probing(&self, host_id: &str) {
        let mut state = self.state.lock().await;
        if let Some(status) = state.statuses.get_mut(host_id) {
            status.health = RemoteHostHealth::Probing;
        }
        let snapshot = self.build_snapshot(&state);
        drop(state);
        self.emit_snapshot(&snapshot);
    }

    async fn apply_probe_outcome(&self, host_id: &str, outcome: ProbeOutcome) {
        let mut state = self.state.lock().await;
        if let Some(read_only) = outcome.read_only {
            if let Some(host) = state.hosts.iter_mut().find(|item| item.id == host_id) {
                if host.read_only != read_only {
                    host.read_only = read_only;
                    let _ = store::store_hosts(&self.app.state::<WorkspaceDatabase>(), &state.hosts);
                }
            }
        }
        if let Some(status) = state.statuses.get_mut(host_id) {
            status.health = outcome.health;
            if outcome.version.is_some() {
                status.version = outcome.version;
            }
            status.latency_ms = outcome.latency_ms;
            status.checked_at = Some(now_millis());
            status.error = outcome.error;
        }
        let snapshot = self.build_snapshot(&state);
        drop(state);
        self.emit_snapshot(&snapshot);
    }

    async fn record_window_closed(&self, host_id: &str) {
        let mut state = self.state.lock().await;
        if let Some(entry) = state.hosts.iter_mut().find(|item| item.id == host_id) {
            entry.last_connected_at = Some(now_millis());
            let _ = store::store_hosts(&self.app.state::<WorkspaceDatabase>(), &state.hosts);
        }
        let snapshot = self.build_snapshot(&state);
        drop(state);
        self.emit_snapshot(&snapshot);
    }

    fn build_snapshot(&self, state: &ManagerState) -> RemoteHostsSnapshot {
        let statuses = state
            .hosts
            .iter()
            .map(|host| {
                let mut status = state
                    .statuses
                    .get(&host.id)
                    .cloned()
                    .unwrap_or_else(|| initial_status(&host.id));
                status.open = window::is_window_open(&self.app, &host.id);
                status
            })
            .collect();
        RemoteHostsSnapshot {
            hosts: state.hosts.clone(),
            statuses,
        }
    }

    fn emit_snapshot(&self, snapshot: &RemoteHostsSnapshot) {
        let _ = self.app.emit(EVENT_REMOTE_HOSTS_CHANGED, snapshot);
    }
}

fn initial_status(host_id: &str) -> RemoteHostStatus {
    RemoteHostStatus {
        host_id: host_id.to_string(),
        health: RemoteHostHealth::Unknown,
        version: None,
        latency_ms: None,
        checked_at: None,
        error: None,
        open: false,
    }
}

fn normalize_sort_order(hosts: &mut [RemoteHost]) {
    for (index, host) in hosts.iter_mut().enumerate() {
        host.sort_order = index as i32;
    }
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn generate_host_id() -> Result<String, String> {
    random_base64url(HOST_ID_RANDOM_BYTES)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
