use tauri::State;

use crate::database::{Workspace, WorkspaceDatabase};

#[tauri::command]
pub fn list_workspaces(database: State<'_, WorkspaceDatabase>) -> Result<Vec<Workspace>, String> {
    database.list().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_workspace(
    workspace: Workspace,
    database: State<'_, WorkspaceDatabase>,
) -> Result<(), String> {
    database.save(&workspace).map_err(|error| error.to_string())
}
