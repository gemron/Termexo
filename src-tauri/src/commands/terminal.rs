use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Manager, State};

use crate::agent::OpenCodeAdapter;
use crate::commands::agent::{network_environment, relaunch_environment, RelaunchRequest};
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
    /// Literal overrides for this process only; never applied to the Termexo process.
    #[serde(default)]
    pub environment: HashMap<String, String>,
    pub terminal_id: String,
    #[serde(default)]
    pub runtime_revision: u64,
    pub shell: String,
    pub working_directory: String,
    pub command: Option<String>,
    #[serde(default)]
    pub hide_initial_command: bool,
    /// Authentication subcommands must not receive chat-only CLI flags or MCP configuration.
    #[serde(default)]
    pub account_login: bool,
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

    validate_terminal_environment(&request.environment)?;
    // Rebuild only launches recorded by the removed built-in workflow engine. Existing PTYs
    // were attached above; ordinary user commands and saved workflow files are left alone.
    if !request.account_login && legacy_workflow_launch(&database, &request.terminal_id)? {
        use crate::commands::agent::{
            prepare_codex_launch, prepare_opencode_launch, PrepareCodexLaunchRequest,
            PrepareOpenCodeLaunchRequest,
        };
        let launch = match request.agent_type.as_deref() {
            Some("codex") => Some(prepare_codex_launch(
                PrepareCodexLaunchRequest {
                    terminal_id: request.terminal_id.clone(),
                    workspace_id: request.workspace_id.clone(),
                    session_id: request.native_session_id.clone(),
                    profile_id: request.profile_id.clone(),
                    account_profile_id: request.account_profile_id.clone(),
                    model: None,
                    auto_confirm: false,
                    reasoning_effort: None,
                },
                app.state(),
                app.state(),
                app.state(),
                app.state(),
            )?),
            Some("opencode") => Some(prepare_opencode_launch(
                PrepareOpenCodeLaunchRequest {
                    terminal_id: request.terminal_id.clone(),
                    workspace_id: request.workspace_id.clone(),
                    session_id: request.native_session_id.clone(),
                    model: None,
                    auto_confirm: false,
                    continue_last: false,
                },
                app.state(),
                app.state(),
                app.state(),
                app.state(),
            )?),
            _ => None,
        };
        if let Some(launch) = launch {
            request.command = Some(launch.command);
        }
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
    // Unified default network injection: every PTY spawn applies the effective profile, so
    // shell terminals (UI new, MCP terminal_create, remote) get the same proxy as agent tasks.
    // prepare_*_launch already carries it; only missing keys are filled, never overwriting.
    match network_environment(&database, &credentials, request.workspace_id.as_deref()) {
        Ok(default_env) => {
            for (key, value) in default_env {
                environment.entry(key).or_insert(value);
            }
        }
        Err(error) => {
            tracing::warn!(terminal_id = %request.terminal_id, "无法应用默认网络配置：{error}");
        }
    }
    crate::process::apply_node_runtime(&mut environment);
    if request.agent_type.as_deref() == Some("opencode") {
        OpenCodeAdapter::new()
            .ensure_private_server(&mut request.command)
            .map_err(|error| error.to_string())?;
    }
    app.state::<std::sync::Arc<crate::mcp::McpManager>>()
        .prepare_agent_launch(&mut request, &mut environment)?;
    apply_terminal_environment(&mut environment, &request.environment);
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

fn legacy_workflow_launch(database: &WorkspaceDatabase, terminal_id: &str) -> Result<bool, String> {
    for prefix in ["one_ring.coordinator.v1.", "one_ring.worker.v1."] {
        if database
            .read_app_setting(&format!("{prefix}{terminal_id}"))
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

const MAX_TERMINAL_ENVIRONMENT_VARIABLES: usize = 100;
const MAX_TERMINAL_ENVIRONMENT_VALUE_LENGTH: usize = 16_384;

fn validate_terminal_environment(environment: &HashMap<String, String>) -> Result<(), String> {
    if environment.len() > MAX_TERMINAL_ENVIRONMENT_VARIABLES {
        return Err(format!(
            "环境变量最多 {MAX_TERMINAL_ENVIRONMENT_VARIABLES} 项。"
        ));
    }
    let mut names = HashSet::new();
    for (name, value) in environment {
        let mut chars = name.chars();
        if !chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Err("环境变量名须以字母或下划线开头，只能包含字母、数字和下划线。".into());
        }
        if value.contains('\0')
            || value.encode_utf16().count() > MAX_TERMINAL_ENVIRONMENT_VALUE_LENGTH
        {
            return Err("环境变量值包含空字符或超过长度限制。".into());
        }
        let key = if cfg!(windows) {
            name.to_ascii_lowercase()
        } else {
            name.clone()
        };
        if !names.insert(key) {
            return Err("当前主机不允许重复的环境变量名。".into());
        }
    }
    Ok(())
}

fn apply_terminal_environment(
    base: &mut HashMap<String, String>,
    overrides: &HashMap<String, String>,
) {
    for (name, value) in overrides {
        #[cfg(windows)]
        base.retain(|key, _| !key.eq_ignore_ascii_case(name));
        base.insert(name.clone(), value.clone());
    }
}

/// Returns everything a client needs to catch up with a terminal it was not connected to.
/// Viewing does not start a process or change its size, palette or ownership.
#[tauri::command]
pub fn attach_terminal(
    terminal_id: String,
    manager: State<'_, PtyManager>,
) -> Result<TerminalStartResult, String> {
    manager
        .attachment(&terminal_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "该终端当前未运行。".to_owned())
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

#[cfg(test)]
mod environment_tests {
    use super::*;

    #[test]
    fn legacy_workflow_migration_requires_a_record_for_the_exact_terminal() {
        let database = WorkspaceDatabase::open(std::path::PathBuf::from(":memory:")).unwrap();
        database
            .write_app_setting("one_ring.worker.v1.worker-1", "implementer")
            .unwrap();
        database
            .write_app_setting("one_ring.coordinator.v1.coordinator-1", "{}")
            .unwrap();
        assert!(legacy_workflow_launch(&database, "worker-1").unwrap());
        assert!(legacy_workflow_launch(&database, "coordinator-1").unwrap());
        assert!(!legacy_workflow_launch(&database, "worker").unwrap());
        assert!(!legacy_workflow_launch(&database, "custom-one-ring-command").unwrap());
        assert!(database
            .read_app_setting("one_ring.worker.v1.worker-1")
            .unwrap()
            .is_some());
    }

    #[test]
    fn overrides_are_literal_scoped_and_can_set_empty_values() {
        let parent = std::env::var("TERMEXO_COMMAND_TEST_VARIABLE").ok();
        let mut base = HashMap::from([
            ("PORT".into(), "3000".into()),
            ("UNCHANGED".into(), "keep".into()),
        ]);
        let overrides = HashMap::from([
            ("PORT".into(), "4300".into()),
            ("EMPTY".into(), String::new()),
            (
                "TERMEXO_COMMAND_TEST_VARIABLE".into(),
                "  literal $HOME = 'value'\nnext  ".into(),
            ),
        ]);
        validate_terminal_environment(&overrides).unwrap();
        apply_terminal_environment(&mut base, &overrides);
        assert_eq!(base.get("PORT"), overrides.get("PORT"));
        assert_eq!(base.get("EMPTY").unwrap(), "");
        assert_eq!(base.get("UNCHANGED").unwrap(), "keep");
        assert_eq!(
            base.get("TERMEXO_COMMAND_TEST_VARIABLE"),
            overrides.get("TERMEXO_COMMAND_TEST_VARIABLE")
        );
        assert_eq!(std::env::var("TERMEXO_COMMAND_TEST_VARIABLE").ok(), parent);
    }

    #[test]
    fn malformed_overrides_are_rejected_and_legacy_requests_need_no_environment() {
        for overrides in [
            HashMap::from([("BAD=NAME".into(), "x".into())]),
            HashMap::from([("PORT".into(), "a\0b".into())]),
        ] {
            assert!(validate_terminal_environment(&overrides).is_err());
        }
        let request: TerminalStartRequest = serde_json::from_value(serde_json::json!({
            "terminalId": "t", "shell": "", "workingDirectory": "/project", "cols": 80, "rows": 24
        }))
        .unwrap();
        assert!(request.environment.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn windows_replaces_environment_names_without_case_ambiguity() {
        let mut base = HashMap::from([("Path".into(), "old".into())]);
        let overrides = HashMap::from([("PATH".into(), "custom".into())]);
        apply_terminal_environment(&mut base, &overrides);
        assert_eq!(base.len(), 1);
        assert_eq!(base.get("PATH").unwrap(), "custom");
        assert!(validate_terminal_environment(&HashMap::from([
            ("Port".into(), "1".into()),
            ("PORT".into(), "2".into())
        ]))
        .is_err());
    }
}
