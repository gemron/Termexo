use std::collections::HashSet;
use std::sync::Arc;
use std::{fs, path::Path};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::database::WorkspaceDatabase;
use crate::remote::{broadcast_event, RemoteEventHub, EVENT_TODO_SNAPSHOT_CHANGED};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TodoSnapshotChangedEvent {
    workspace_id: String,
    snapshot: Option<Value>,
    origin_id: Option<String>,
}

#[tauri::command(async)]
pub fn list_todo_snapshots(database: State<'_, WorkspaceDatabase>) -> Result<Vec<Value>, String> {
    database
        .list_todo_snapshots()
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn save_todo_snapshot(
    snapshot: Value,
    origin_id: Option<String>,
    app: AppHandle,
    database: State<'_, WorkspaceDatabase>,
    events: State<'_, Arc<RemoteEventHub>>,
) -> Result<(), String> {
    let workspace_id = snapshot
        .get("workspaceId")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .ok_or("Task snapshot is missing a workspace ID")?;
    if snapshot.get("version").and_then(Value::as_u64) != Some(1)
        || !snapshot.get("projects").is_some_and(Value::is_array)
        || !snapshot.get("tasks").is_some_and(Value::is_array)
    {
        return Err("Task snapshot has an unsupported format".into());
    }
    let mut project_ids = HashSet::new();
    for project in snapshot["projects"].as_array().unwrap() {
        let id = project.get("id").and_then(Value::as_str).unwrap_or("");
        if id.trim().is_empty()
            || !project_ids.insert(id)
            || project.get("workspaceId").and_then(Value::as_str) != Some(workspace_id)
            || !project.get("name").is_some_and(Value::is_string)
            || !project.get("path").is_some_and(Value::is_string)
        {
            return Err("Task snapshot contains an invalid project".into());
        }
    }
    for task in snapshot["tasks"].as_array().unwrap() {
        if task
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .is_empty()
            || task.get("workspaceId").and_then(Value::as_str) != Some(workspace_id)
            || !task
                .get("projectId")
                .and_then(Value::as_str)
                .is_some_and(|id| project_ids.contains(id))
            || !task.get("title").is_some_and(Value::is_string)
        {
            return Err("Task snapshot contains an invalid task".into());
        }
    }
    if serde_json::to_vec(&snapshot)
        .map_err(|error| error.to_string())?
        .len()
        > 16 * 1024 * 1024
    {
        return Err("Task snapshot exceeds the 16 MB limit".into());
    }
    database
        .save_todo_snapshot(workspace_id, &snapshot)
        .map_err(|error| error.to_string())?;
    broadcast_event(
        &app,
        &events,
        EVENT_TODO_SNAPSHOT_CHANGED,
        &TodoSnapshotChangedEvent {
            workspace_id: workspace_id.to_owned(),
            snapshot: Some(snapshot),
            origin_id,
        },
    );
    Ok(())
}

#[tauri::command(async)]
pub fn delete_todo_snapshot(
    workspace_id: String,
    origin_id: Option<String>,
    app: AppHandle,
    database: State<'_, WorkspaceDatabase>,
    events: State<'_, Arc<RemoteEventHub>>,
) -> Result<(), String> {
    database
        .delete_todo_snapshot(&workspace_id)
        .map_err(|error| error.to_string())?;
    broadcast_event(
        &app,
        &events,
        EVENT_TODO_SNAPSHOT_CHANGED,
        &TodoSnapshotChangedEvent {
            workspace_id,
            snapshot: None,
            origin_id,
        },
    );
    Ok(())
}

#[tauri::command(async)]
pub fn write_todo_export(path: String, contents: String) -> Result<(), String> {
    if contents.len() > 16 * 1024 * 1024 {
        return Err("Task export exceeds the 16 MB limit".into());
    }
    let destination = Path::new(&path);
    if !destination.is_absolute()
        || destination
            .extension()
            .and_then(|extension| extension.to_str())
            != Some("json")
    {
        return Err("Choose an absolute .json file path".into());
    }
    fs::write(destination, contents)
        .map_err(|error| format!("Failed to write task export: {error}"))
}
