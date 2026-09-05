use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::config::{CredentialStore, LaunchEnvironmentStore};
use crate::database::WorkspaceDatabase;
use crate::git::RepositoryManager;
use crate::pty::{PtyManager, TerminalScrollback};

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
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub fn create_terminal(
    request: TerminalStartRequest,
    app: AppHandle,
    manager: State<'_, PtyManager>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    repositories: State<'_, RepositoryManager>,
) -> Result<TerminalStartResult, String> {
    match manager
        .runtime_revision(&request.terminal_id)
        .map_err(|error| error.to_string())?
    {
        // The same launch is already running — typically a second client opening the workbench.
        // Consuming the stashed environment or resetting the Git baseline here would corrupt the
        // running terminal's state, so attaching skips all of it.
        Some(revision) if revision == request.runtime_revision => {
            let size = manager
                .size(&request.terminal_id)
                .map_err(|error| error.to_string())?
                .unwrap_or((request.cols, request.rows));
            return Ok(TerminalStartResult {
                attached: true,
                cols: size.0,
                rows: size.1,
            });
        }
        // A newer revision means the terminal was relaunched (model switch, session resume); the
        // previous process must be killed before the id is reused. Closing removes the session
        // before it kills, so a failure here leaves nothing in the way of the new terminal —
        // refusing to launch over it would strand the user with a terminal that cannot restart.
        Some(_) => {
            if let Err(error) = manager.close(&request.terminal_id) {
                tracing::warn!(
                    terminal_id = %request.terminal_id,
                    "关闭上一个终端进程失败，继续启动新终端：{error}"
                );
            }
        }
        None => {}
    }

    let mut environment = launch_environment
        .take(&request.terminal_id)
        .map_err(|error| error.to_string())?;
    // Empty means this terminal is reconnecting rather than starting for the first time: the
    // stash is single-use and in-memory. Without rebuilding, the CLI would start against its
    // default home and read as a different account than the one the terminal was created with.
    if environment.is_empty() {
        if let Some(agent_type) = request.agent_type.as_deref() {
            environment = crate::commands::agent::relaunch_environment(
                &database,
                &credentials,
                agent_type,
                request.account_profile_id.as_deref(),
                request.profile_id.as_deref(),
                request.workspace_id.as_deref(),
            )?;
        }
    }
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
    let started = manager
        .start(request, app, environment)
        .map_err(|error| error.to_string())?;
    Ok(TerminalStartResult {
        attached: !started,
        cols,
        rows,
    })
}

/// Returns everything a client needs to catch up with a terminal it was not connected to.
#[tauri::command]
pub fn read_terminal_scrollback(
    terminal_id: String,
    manager: State<'_, PtyManager>,
) -> Result<TerminalScrollback, String> {
    manager
        .read_scrollback(&terminal_id)
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

#[tauri::command]
pub fn close_terminal(
    terminal_id: String,
    preserve_repository_baseline: bool,
    manager: State<'_, PtyManager>,
    repositories: State<'_, RepositoryManager>,
) -> Result<(), String> {
    let result = manager
        .close(&terminal_id)
        .map_err(|error| error.to_string());
    if !preserve_repository_baseline {
        repositories.remove_terminal(&terminal_id);
    }
    result
}
