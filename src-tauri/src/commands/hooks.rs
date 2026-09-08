use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::database::WorkspaceDatabase;
use crate::hooks::{AgentEvent, ClaudeRuntimeSettings, HookEventStore};
use crate::remote::{broadcast_event, RemoteEventHub, EVENT_AGENT_EVENTS};

/// The UI keeps this many recent events, so a batch never needs to carry more than that.
const BROADCAST_LIMIT: usize = 250;

#[tauri::command(async)]
pub fn prepare_claude_runtime(
    terminal_id: String,
    hooks: State<'_, HookEventStore>,
) -> Result<ClaudeRuntimeSettings, String> {
    hooks
        .prepare_claude_runtime(&terminal_id)
        .map_err(|error| error.to_string())
}

/// Drains the hook spool into the database and announces the new batch.
///
/// The spool is consumed from a byte cursor, so whichever client polls first would otherwise be
/// the only one to see a batch. Broadcasting it lets every client derive terminal state from the
/// same events regardless of who triggered the sync.
#[tauri::command(async)]
pub fn sync_agent_events(
    app: AppHandle,
    hooks: State<'_, HookEventStore>,
    database: State<'_, WorkspaceDatabase>,
    events: State<'_, Arc<RemoteEventHub>>,
) -> Result<Vec<AgentEvent>, String> {
    let batch = hooks.read_new_events().map_err(|error| error.to_string())?;
    database
        .save_agent_events(&batch)
        .map_err(|error| error.to_string())?;
    // Only once the batch is in the database is the spool safe to throw away.
    hooks
        .compact_spool_once()
        .map_err(|error| error.to_string())?;
    // The first drain after an upgrade can return every event the old spool held — tens of
    // thousands, all already in the database. The UI keeps only the newest few hundred, so that
    // is all it is sent, and all this call returns.
    let recent = batch[batch.len().saturating_sub(BROADCAST_LIMIT)..].to_vec();
    if !recent.is_empty() {
        broadcast_event(&app, &events, EVENT_AGENT_EVENTS, &recent);
    }
    Ok(recent)
}

#[tauri::command(async)]
pub fn list_agent_events(
    terminal_id: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentEvent>, String> {
    database
        .list_agent_events(terminal_id.as_deref())
        .map_err(|error| error.to_string())
}
