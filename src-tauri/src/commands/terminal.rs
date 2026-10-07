use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::agent::OpenCodeAdapter;
use crate::commands::agent::{relaunch_environment, RelaunchRequest};
use crate::config::{CredentialStore, LaunchEnvironmentStore};
use crate::database::WorkspaceDatabase;
use crate::git::watch::RepositoryWatcher;
use crate::git::RepositoryManager;
use crate::hooks::HookEventStore;
use crate::pty::backend::{self, PtyBackendInfo};
use crate::pty::{LiveTerminal, PtyManager, TerminalScrollback};

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
    /// Which client these dimensions describe, so several viewers can share one PTY.
    #[serde(default)]
    pub viewer_id: String,
    /// What the terminal was launched as. Together with the profile ids below it lets a
    /// reconnecting terminal rebuild the environment its original launch stashed, which is
    /// consumed on first use and gone entirely after an app restart.
    #[serde(default)]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub native_session_id: Option<String>,
    #[serde(default)]
    pub account_profile_id: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

/// What the caller needs to render a terminal it has just started or joined.
///
/// The size matters most when joining: a client that attached to a running PTY has to draw the
/// grid the agent is already drawing for, which is not necessarily the one its own window fits.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartResult {
    pub attached: bool,
    pub runtime_revision: u64,
    pub cols: u16,
    pub rows: u16,
}

// Tauri injects each managed state as its own argument, so the count follows what the command reads.
#[allow(clippy::too_many_arguments)]
#[tauri::command(async)]
pub fn create_terminal(
    mut request: TerminalStartRequest,
    app: AppHandle,
    manager: State<'_, PtyManager>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    hooks: State<'_, HookEventStore>,
    repositories: State<'_, RepositoryManager>,
) -> Result<TerminalStartResult, String> {
    // Opening a viewer is never a request to replace a running process. A phone can hold an
    // older workspace row, and treating its revision as a relaunch kills the desktop's agent
    // and leaves its output subscription on the old revision. Explicit model/account switches
    // already close the previous PTY before saving their new launch.
    if let Some(attached) = manager
        .attachment(&request.terminal_id)
        .map_err(|error| error.to_string())?
    {
        return Ok(attached);
    }

    let mut environment = launch_environment
        .take(&request.terminal_id)
        .map_err(|error| error.to_string())?;
    // Empty means this terminal is reconnecting rather than starting for the first time: the
    // stash is single-use and in-memory. Without rebuilding, the CLI would start against its
    // default home and read as a different account than the one the terminal was created with.
    if environment.is_empty() {
        if let Some(agent_type) = request.agent_type.as_deref() {
            environment = relaunch_environment(
                &database,
                &credentials,
                &hooks,
                &RelaunchRequest {
                    terminal_id: &request.terminal_id,
                    agent_type,
                    native_session_id: request.native_session_id.as_deref(),
                    account_profile_id: request.account_profile_id.as_deref(),
                    model_profile_id: request.profile_id.as_deref(),
                    workspace_id: request.workspace_id.as_deref(),
                },
            )?;
        }
    }
    if request.agent_type.as_deref() == Some("opencode") {
        OpenCodeAdapter::new()
            .ensure_private_server(&mut request.command)
            .map_err(|error| error.to_string())?;
    }
    app.state::<std::sync::Arc<crate::mcp::McpManager>>()
        .prepare_agent_launch(&mut request, &mut environment)?;
    if let Err(error) = repositories.capture_baseline(
        request.workspace_id.as_deref(),
        &request.terminal_id,
        request.runtime_revision,
        &request.working_directory,
    ) {
        tracing::warn!(terminal_id = %request.terminal_id, "无法记录 Git 会话基线：{error}");
    }
    let cols = request.cols;
    let rows = request.rows;
    let runtime_revision = request.runtime_revision;
    let terminal_id = request.terminal_id.clone();
    let started = manager
        .start(request, app, environment)
        .map_err(|error| error.to_string())?;
    // Another viewer can win the start race while this one is preparing its launch.
    if !started {
        return manager
            .attachment(&terminal_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("terminal {terminal_id} closed while attaching"));
    }
    Ok(TerminalStartResult {
        attached: false,
        runtime_revision,
        cols,
        rows,
    })
}

/// Returns everything a client needs to catch up with a terminal it was not connected to.
#[tauri::command(async)]
pub fn read_terminal_scrollback(
    terminal_id: String,
    manager: State<'_, PtyManager>,
) -> Result<TerminalScrollback, String> {
    manager
        .read_scrollback(&terminal_id)
        .map_err(|error| error.to_string())
}

/// Reports which terminals still have a process running, and which launch of each.
///
/// A client cannot tell from its own startup whether the backend started with it: a reloaded
/// window and a second client both load into a backend whose terminals are still running, and
/// relaunching those would kill the agents working in them.
#[tauri::command]
pub fn list_live_terminals(manager: State<'_, PtyManager>) -> Result<Vec<LiveTerminal>, String> {
    manager.live_terminals().map_err(|error| error.to_string())
}

/// Reports the pseudo console terminals run on, which decides what the frontend may leave to
/// xterm. An old system ConPTY reflows wrapped lines itself, so xterm has to stop doing it too.
#[tauri::command]
pub fn get_pty_backend() -> PtyBackendInfo {
    backend::describe()
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

/// Records the foreground and background a terminal is drawn in (`#rrggbb`), so the PTY can answer
/// a program's colour queries itself instead of leaving every viewer to answer them.
#[tauri::command]
pub fn set_terminal_palette(
    terminal_id: String,
    foreground: String,
    background: String,
    manager: State<'_, PtyManager>,
) -> Result<(), String> {
    manager
        .set_palette(&terminal_id, &foreground, &background)
        .map_err(|error| error.to_string())
}

/// Reports a viewer's window size; `claim` marks the user working there, which hands that view
/// the terminal's size. Everyone else renders whatever grid it settles on.
#[tauri::command]
pub fn resize_terminal(
    terminal_id: String,
    viewer_id: String,
    cols: u16,
    rows: u16,
    claim: bool,
    app: AppHandle,
    manager: State<'_, PtyManager>,
) -> Result<(), String> {
    manager
        .resize(&terminal_id, &viewer_id, cols, rows, claim, &app)
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn close_terminal(
    terminal_id: String,
    preserve_repository_baseline: bool,
    manager: State<'_, PtyManager>,
    repositories: State<'_, RepositoryManager>,
    watcher: State<'_, RepositoryWatcher>,
    hooks: State<'_, HookEventStore>,
) -> Result<(), String> {
    hooks.forget_codex_rollout(&terminal_id);
    let result = manager
        .close(&terminal_id)
        .map_err(|error| error.to_string());
    watcher.release(&terminal_id);
    if !preserve_repository_baseline {
        repositories.remove_terminal(&terminal_id);
        manager.forget_palette(&terminal_id);
    }
    result
}
