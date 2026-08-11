use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::config::LaunchEnvironmentStore;
use crate::pty::PtyManager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartRequest {
    pub terminal_id: String,
    #[serde(default)]
    pub runtime_revision: u64,
    pub shell: String,
    pub working_directory: String,
    pub command: Option<String>,
    #[serde(default)]
    pub hide_initial_command: bool,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub fn create_terminal(
    request: TerminalStartRequest,
    app: AppHandle,
    manager: State<'_, PtyManager>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
) -> Result<(), String> {
    let environment = launch_environment
        .take(&request.terminal_id)
        .map_err(|error| error.to_string())?;
    manager
        .start(request, app, environment)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_terminal(
    terminal_id: String,
    data: String,
    manager: State<'_, PtyManager>,
) -> Result<(), String> {
    manager
        .write(&terminal_id, data.as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resize_terminal(
    terminal_id: String,
    cols: u16,
    rows: u16,
    manager: State<'_, PtyManager>,
) -> Result<(), String> {
    manager
        .resize(&terminal_id, cols, rows)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn close_terminal(terminal_id: String, manager: State<'_, PtyManager>) -> Result<(), String> {
    manager
        .close(&terminal_id)
        .map_err(|error| error.to_string())
}
