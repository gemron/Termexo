use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::database::{Workspace, WorkspaceDatabase};
use crate::remote::{
    broadcast_event, RemoteEventHub, EVENT_WORKSPACE_CHANGED, EVENT_WORKSPACE_DELETED,
};

/// Announces a saved workspace to every other client.
///
/// `originId` is the client that made the change; it echoes back so the sender can ignore its own
/// write instead of re-applying it over newer local edits.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceChangedEvent {
    workspace: Workspace,
    origin_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDeletedEvent {
    workspace_id: String,
    origin_id: Option<String>,
}

#[tauri::command]
pub fn list_workspaces(database: State<'_, WorkspaceDatabase>) -> Result<Vec<Workspace>, String> {
    database.list().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_workspace(
    workspace: Workspace,
    origin_id: Option<String>,
    app: AppHandle,
    database: State<'_, WorkspaceDatabase>,
    events: State<'_, Arc<RemoteEventHub>>,
) -> Result<(), String> {
    database
        .save(&workspace)
        .map_err(|error| error.to_string())?;
    broadcast_event(
        &app,
        &events,
        EVENT_WORKSPACE_CHANGED,
        &WorkspaceChangedEvent {
            workspace,
            origin_id,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn delete_workspace(
    workspace_id: String,
    origin_id: Option<String>,
    app: AppHandle,
    database: State<'_, WorkspaceDatabase>,
    events: State<'_, Arc<RemoteEventHub>>,
) -> Result<(), String> {
    database
        .delete_workspace(&workspace_id)
        .map_err(|error| error.to_string())?;
    broadcast_event(
        &app,
        &events,
        EVENT_WORKSPACE_DELETED,
        &WorkspaceDeletedEvent {
            workspace_id,
            origin_id,
        },
    );
    Ok(())
}
