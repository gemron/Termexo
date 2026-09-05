use std::sync::Arc;

use tauri::State;

use crate::remote::qr;
use crate::remote::settings::RemoteAccessSettings;
use crate::remote::{QrCodeImage, RemoteAccessManager, RemoteAccessStatus};

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

/// Encodes an access URL as an SVG path so the panel can draw it without `innerHTML`.
#[tauri::command]
pub fn render_remote_access_qr(url: String) -> Result<QrCodeImage, String> {
    qr::render(&url)
}
