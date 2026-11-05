use crate::database::WorkspaceDatabase;
use crate::one_ring::{
    settings::{Settings, Status, SETTINGS_KEY},
    OneRingManager,
};
use std::sync::Arc;
use tauri::{State, WebviewWindow};

fn desktop(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("请在 Termexo 桌面窗口中管理 Codex 插件。".into())
    }
}

#[tauri::command(async)]
pub fn get_one_ring_plugin(
    window: WebviewWindow,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Status, String> {
    desktop(&window)?;
    Ok(Settings::load(&database)?.status())
}

#[tauri::command(async)]
pub fn check_one_ring_plugin(window: WebviewWindow, settings: Settings) -> Result<Status, String> {
    desktop(&window)?;
    Ok(settings.status())
}

#[tauri::command(async)]
pub fn save_one_ring_plugin(
    window: WebviewWindow,
    settings: Settings,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Status, String> {
    desktop(&window)?;
    if settings.enabled {
        settings.validate()?;
    }
    database
        .write_app_setting(
            SETTINGS_KEY,
            &serde_json::to_string(&settings).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    Ok(settings.status())
}

#[tauri::command]
pub fn complete_one_ring_worker(
    window: WebviewWindow,
    id: String,
    error: Option<String>,
    manager: State<'_, Arc<OneRingManager>>,
) -> Result<(), String> {
    desktop(&window)?;
    manager.complete(&id, error)
}
