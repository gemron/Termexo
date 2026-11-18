use std::sync::Arc;

use tauri::State;

use crate::remote_hosts::{
    ProbeOutcome, ProbeRemoteHostRequest, RemoteHostManager, RemoteHostsSnapshot,
    SaveRemoteHostRequest,
};

#[tauri::command]
pub async fn list_remote_hosts(
    manager: State<'_, Arc<RemoteHostManager>>,
) -> Result<RemoteHostsSnapshot, String> {
    Ok(manager.snapshot().await)
}

#[tauri::command]
pub async fn save_remote_host(
    request: SaveRemoteHostRequest,
    manager: State<'_, Arc<RemoteHostManager>>,
) -> Result<RemoteHostsSnapshot, String> {
    manager.save_host(request).await
}

#[tauri::command]
pub async fn delete_remote_host(
    host_id: String,
    manager: State<'_, Arc<RemoteHostManager>>,
) -> Result<RemoteHostsSnapshot, String> {
    manager.delete_host(&host_id).await
}

#[tauri::command]
pub async fn reorder_remote_hosts(
    host_ids: Vec<String>,
    manager: State<'_, Arc<RemoteHostManager>>,
) -> Result<RemoteHostsSnapshot, String> {
    manager.reorder_hosts(host_ids).await
}

#[tauri::command]
pub async fn probe_remote_host(
    request: ProbeRemoteHostRequest,
    manager: State<'_, Arc<RemoteHostManager>>,
) -> Result<ProbeOutcome, String> {
    manager.probe_host(request).await
}

#[tauri::command]
pub async fn refresh_remote_hosts(
    manager: State<'_, Arc<RemoteHostManager>>,
) -> Result<RemoteHostsSnapshot, String> {
    Ok(manager.refresh_all().await)
}

#[tauri::command]
pub async fn open_remote_host(
    host_id: String,
    manager: State<'_, Arc<RemoteHostManager>>,
) -> Result<RemoteHostsSnapshot, String> {
    manager.open_host(&host_id).await
}

#[tauri::command]
pub async fn close_remote_host(
    host_id: String,
    manager: State<'_, Arc<RemoteHostManager>>,
) -> Result<RemoteHostsSnapshot, String> {
    manager.close_host(&host_id).await
}
