use tauri::State;

use crate::database::WorkspaceDatabase;
use crate::hooks::{AgentEvent, ClaudeRuntimeSettings, HookEventStore};

#[tauri::command]
pub fn prepare_claude_runtime(
    terminal_id: String,
    hooks: State<'_, HookEventStore>,
) -> Result<ClaudeRuntimeSettings, String> {
    hooks
        .prepare_claude_runtime(&terminal_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn sync_agent_events(
    hooks: State<'_, HookEventStore>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentEvent>, String> {
    let events = hooks.read_new_events().map_err(|error| error.to_string())?;
    database
        .save_agent_events(&events)
        .map_err(|error| error.to_string())?;
    Ok(events)
}

#[tauri::command]
pub fn list_agent_events(
    terminal_id: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentEvent>, String> {
    database
        .list_agent_events(terminal_id.as_deref())
        .map_err(|error| error.to_string())
}
