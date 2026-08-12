use crate::fonts::{self, SystemFont};

/// Enumerating the system font collection is a blocking COM call, so it stays off the async runtime.
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    tauri::async_runtime::spawn_blocking(fonts::list_system_fonts)
        .await
        .map_err(|error| error.to_string())?
}
