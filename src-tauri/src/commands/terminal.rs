use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::config::{CredentialStore, LaunchEnvironmentStore};
use crate::database::WorkspaceDatabase;
use crate::git::RepositoryManager;
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

#[tauri::command]
pub fn create_terminal(
    request: TerminalStartRequest,
    app: AppHandle,
    manager: State<'_, PtyManager>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    repositories: State<'_, RepositoryManager>,
) -> Result<(), String> {
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
