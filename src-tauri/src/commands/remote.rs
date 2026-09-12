use std::sync::Arc;

use tauri::State;

use crate::remote::qr;
use crate::remote::settings::RemoteAccessSettings;
use crate::remote::{QrCodeImage, RelayEnrollRequest, RemoteAccessManager, RemoteAccessStatus};

#[tauri::command]
pub async fn get_remote_access_status(
    manager: State<'_, Arc<RemoteAccessManager>>,
) -> Result<RemoteAccessStatus, String> {
    Ok(manager.status().await)
}

#[tauri::command]
pub async fn update_remote_access_settings(
    settings: RemoteAccessSettings,
    manager: State<'_, Arc<RemoteAccessManager>>,
) -> Result<RemoteAccessStatus, String> {
    manager.update_settings(settings).await
}

#[tauri::command]
pub async fn regenerate_remote_access_token(
    manager: State<'_, Arc<RemoteAccessManager>>,
) -> Result<RemoteAccessStatus, String> {
    manager.regenerate_token().await
}

/// Trades an enrollment code or an account password for a device credential and brings the
/// tunnel up. Nothing is written when the relay refuses the request.
#[tauri::command]
pub async fn enroll_relay_device(
    request: RelayEnrollRequest,
    manager: State<'_, Arc<RemoteAccessManager>>,
) -> Result<RemoteAccessStatus, String> {
    manager.enroll_relay_device(request).await
}

/// Leaves the relay: the tunnel closes and the device credential is forgotten.
#[tauri::command]
pub async fn disconnect_relay(
    manager: State<'_, Arc<RemoteAccessManager>>,
) -> Result<RemoteAccessStatus, String> {
    manager.disconnect_relay().await
}

/// Encodes an access URL as an SVG path so the panel can draw it without `innerHTML`.
#[tauri::command(async)]
pub fn render_remote_access_qr(url: String) -> Result<QrCodeImage, String> {
    qr::render(&url)
}
