use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::account;
use crate::agent::{
    antigravity_settings, AgentAdapter, AgentInstallation, AgentLaunchSpec, AgentSession,
    AntigravityAdapter, AntigravityLaunchOptions, AntigravityModel, AntigravityStatusFeed,
    ClaudeBackgroundSession, ClaudeCodeAdapter, ClaudeLaunchOptions, CodexCliAdapter,
    CodexLaunchOptions, GrokBuildAdapter, GrokLaunchOptions, OpenCodeAdapter,
    OpenCodeLaunchOptions, PiAdapter, PiLaunchOptions,
};
use crate::config::{
    claude_launch_model, normalized_effort, AgentProtocol, CredentialStore, LaunchEnvironmentStore,
    ModelProfile, CLAUDE_EFFORT_LEVELS, CODEX_REASONING_EFFORT_LEVELS,
};
use crate::database::WorkspaceDatabase;
use crate::hooks::{toml_literal, HookEventStore};
use crate::network;

#[tauri::command]
pub async fn detect_claude() -> Result<AgentInstallation, String> {
    tauri::async_runtime::spawn_blocking(|| {
        ClaudeCodeAdapter::new()
            .detect()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn detect_codex() -> Result<AgentInstallation, String> {
    tauri::async_runtime::spawn_blocking(|| {
        CodexCliAdapter::new()
            .detect()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn detect_opencode() -> Result<AgentInstallation, String> {
    tauri::async_runtime::spawn_blocking(|| {
        OpenCodeAdapter::new()
            .detect()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn detect_pi() -> Result<AgentInstallation, String> {
    tauri::async_runtime::spawn_blocking(|| {
        PiAdapter::new().detect().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn scan_pi_sessions(
    project_path: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentSession>, String> {
    let sessions = tauri::async_runtime::spawn_blocking(move || {
        PiAdapter::new()
            .list_sessions(project_path.as_deref())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    database
        .save_agent_sessions(&sessions)
        .map_err(|error| error.to_string())?;
    Ok(sessions)
}

#[tauri::command]
pub async fn detect_grok() -> Result<AgentInstallation, String> {
    tauri::async_runtime::spawn_blocking(|| {
        GrokBuildAdapter::new()
            .detect()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command(async)]
pub fn scan_claude_sessions(
    project_path: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentSession>, String> {
    let profiles = database
        .list_account_profiles()
        .map_err(|error| error.to_string())?;
    let mut sessions = Vec::new();
    for profile in profiles
        .into_iter()
        .filter(|profile| profile.agent_type == "claude")
    {
        account::prepare_managed_directory(&profile)?;
        let mut profile_sessions = match profile.config_dir.as_deref() {
            Some(config_dir) => ClaudeCodeAdapter::with_config_dir(config_dir.into())
                .list_sessions(project_path.as_deref()),
            None => ClaudeCodeAdapter::new().list_sessions(project_path.as_deref()),
        }
        .map_err(|error| error.to_string())?;
        for session in &mut profile_sessions {
            session.account_profile_id = Some(profile.id.clone());
            session.id = format!("claude:{}:{}", profile.id, session.native_session_id);
        }
        sessions.extend(profile_sessions);
    }
    sessions.sort_by(|left, right| right.last_used_at.cmp(&left.last_used_at));
    database
        .save_agent_sessions(&sessions)
        .map_err(|error| error.to_string())?;
    Ok(sessions)
}

#[tauri::command(async)]
pub fn scan_codex_sessions(
    project_path: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentSession>, String> {
    let profiles = database
        .list_account_profiles()
        .map_err(|error| error.to_string())?;
    let mut sessions = Vec::new();
    for profile in profiles
        .into_iter()
        .filter(|profile| profile.agent_type == "codex")
    {
        account::prepare_managed_directory(&profile)?;
        let mut profile_sessions = match profile.config_dir.as_deref() {
            Some(config_dir) => {
                CodexCliAdapter::with_home(config_dir.into()).list_sessions(project_path.as_deref())
            }
            None => CodexCliAdapter::new().list_sessions(project_path.as_deref()),
        }
        .map_err(|error| error.to_string())?;
        for session in &mut profile_sessions {
            session.account_profile_id = Some(profile.id.clone());
            session.id = format!("codex:{}:{}", profile.id, session.native_session_id);
        }
        sessions.extend(profile_sessions);
    }
    sessions.sort_by(|left, right| right.last_used_at.cmp(&left.last_used_at));
    database
        .save_agent_sessions(&sessions)
        .map_err(|error| error.to_string())?;
    Ok(sessions)
}

#[tauri::command]
pub async fn scan_opencode_sessions(
    project_path: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentSession>, String> {
    let sessions = tauri::async_runtime::spawn_blocking(move || {
        let adapter = OpenCodeAdapter::new();
        let installation = adapter.detect().map_err(|error| error.to_string())?;
        if !installation.installed {
            return Ok(Vec::new());
        }
        adapter
            .list_sessions(project_path.as_deref())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    database
        .save_agent_sessions(&sessions)
        .map_err(|error| error.to_string())?;
    Ok(sessions)
}

#[tauri::command]
pub async fn scan_grok_sessions(
    project_path: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentSession>, String> {
    let sessions = tauri::async_runtime::spawn_blocking(move || {
        GrokBuildAdapter::new()
            .list_sessions(project_path.as_deref())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    database
        .save_agent_sessions(&sessions)
        .map_err(|error| error.to_string())?;
    Ok(sessions)
}

#[tauri::command(async)]
pub fn list_agent_sessions(
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentSession>, String> {
    database
        .list_agent_sessions()
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn build_claude_launch_command(
    options: ClaudeLaunchOptions,
) -> Result<AgentLaunchSpec, String> {
    ClaudeCodeAdapter::new()
        .build_launch_command(&options)
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn build_codex_launch_command(options: CodexLaunchOptions) -> Result<AgentLaunchSpec, String> {
    CodexCliAdapter::new()
        .build_launch_command(&options)
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn build_opencode_launch_command(
    options: OpenCodeLaunchOptions,
) -> Result<AgentLaunchSpec, String> {
    OpenCodeAdapter::new()
        .build_launch_command(&options)
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn build_grok_launch_command(options: GrokLaunchOptions) -> Result<AgentLaunchSpec, String> {
    GrokBuildAdapter::new()
        .build_launch_command(&options)
        .map_err(|error| error.to_string())
}

/// Set once the user turns the Antigravity status feed off.
///
/// The feed is on by default, so its absence cannot mean "not wanted yet" — only an explicit
/// refusal can, and it has to outlive the launch that would otherwise reinstate it.
const ANTIGRAVITY_FEED_OPT_OUT: &str = "antigravity_status_feed_opt_out";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareClaudeLaunchRequest {
    pub terminal_id: String,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub name: Option<String>,
    pub profile_id: Option<String>,
    pub mcp_profile_id: Option<String>,
    pub account_profile_id: Option<String>,
    #[serde(default)]
    pub auto_confirm: bool,
    /// Branches the resumed conversation instead of reusing its id, for a session still running.
    #[serde(default)]
    pub fork_session: bool,
    /// Reconnects to a session the CLI still has running instead of starting a new process.
    pub attach_short_id: Option<String>,
    /// Overrides the profile's 1M context window for this terminal; absent keeps what it stores.
    #[serde(default, rename = "context1m")]
    pub context_1m: Option<bool>,
    /// Overrides the profile's reasoning depth for this terminal; absent keeps what it stores.
    #[serde(default)]
    pub effort: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareCodexLaunchRequest {
    #[serde(default)]
    pub one_ring: Option<crate::one_ring::CoordinatorRequest>,
    pub terminal_id: String,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub profile_id: Option<String>,
    pub account_profile_id: Option<String>,
    #[serde(default)]
    pub auto_confirm: bool,
    /// Overrides the profile's reasoning depth for this terminal; absent keeps what it stores.
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareOpenCodeLaunchRequest {
    pub terminal_id: String,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub model: Option<String>,
    #[serde(default)]
    pub continue_last: bool,
    #[serde(default)]
    pub auto_confirm: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparePiLaunchRequest {
    pub terminal_id: String,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub model: Option<String>,
    #[serde(default)]
    pub continue_last: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareGrokLaunchRequest {
    pub terminal_id: String,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub new_session_id: Option<String>,
    pub model: Option<String>,
    #[serde(default)]
    pub continue_last: bool,
    #[serde(default)]
    pub auto_confirm: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareAntigravityLaunchRequest {
    pub terminal_id: String,
    pub workspace_id: Option<String>,
    pub working_directory: Option<String>,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    #[serde(default)]
    pub continue_last: bool,
    #[serde(default)]
    pub auto_confirm: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareAccountLoginRequest {
    pub terminal_id: String,
    pub workspace_id: Option<String>,
    pub account_profile_id: String,
}

#[tauri::command(async)]
pub fn prepare_claude_launch(
    request: PrepareClaudeLaunchRequest,
    database: State<'_, WorkspaceDatabase>,
    hooks: State<'_, HookEventStore>,
    credentials: State<'_, CredentialStore>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
) -> Result<AgentLaunchSpec, String> {
    let profiles = database
        .list_model_profiles()
        .map_err(|error| error.to_string())?;
    let profile = select_profile(&profiles, request.profile_id.as_deref(), |profile| {
        profile.claude_enabled
    });
    let runtime = hooks
        .prepare_claude_runtime(&request.terminal_id)
        .map_err(|error| error.to_string())?;
    let mcp_config_path = match request.mcp_profile_id.as_deref() {
        Some(profile_id) => {
            let profile = database
                .find_mcp_profile(profile_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "MCP Profile 不存在".to_owned())?;
            Some(
                hooks
                    .write_mcp_config(&request.terminal_id, &profile.config_json)
                    .map_err(|error| error.to_string())?,
            )
        }
        None => None,
    };
    // The launch dialog may override what the profile stores, for this one terminal. Both
    // settings are fixed at launch: neither the context window nor the effort can be changed
    // afterwards without restarting the CLI.
    let context_1m = request.context_1m.unwrap_or_else(|| {
        profile
            .as_ref()
            .is_some_and(|profile| profile.claude_context_1m)
    });
    let effort = normalized_effort(
        request.effort.as_deref().unwrap_or_else(|| {
            profile
                .as_ref()
                .map_or("", |profile| profile.claude_effort.as_str())
        }),
        &CLAUDE_EFFORT_LEVELS,
    );
    let model = claude_launch_model(
        profile
            .as_ref()
            .map_or("", |profile| profile.claude_model.as_str()),
        context_1m,
    );

    let mut environment =
        account_profile_environment(&database, request.account_profile_id.as_deref(), "claude")?;
    environment.extend(claude_profile_environment(profile.as_ref(), context_1m));
    if let Some(profile) = profile.as_ref() {
        if let Some(target) = profile.credential_target.as_deref() {
            let token = credentials
                .get_optional(target)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    format!(
                        "模型 Profile「{}」的 API Key 不存在或已失效，请在设置中重新输入并保存。",
                        profile.name
                    )
                })?;
            environment.insert("ANTHROPIC_AUTH_TOKEN".into(), token);
        }
    }
    environment.extend(network_environment(
        &database,
        &credentials,
        request.workspace_id.as_deref(),
    )?);
    let claude_config_dir = environment.get("CLAUDE_CONFIG_DIR").map(PathBuf::from);
    log_proxy_environment(&environment);
    launch_environment
        .put(request.terminal_id, environment)
        .map_err(|error| error.to_string())?;

    let adapter = claude_config_dir
        .map(ClaudeCodeAdapter::with_config_dir)
        .unwrap_or_else(ClaudeCodeAdapter::new);
    adapter
        .build_launch_command(&ClaudeLaunchOptions {
            session_id: request.session_id,
            name: request.name,
            model: (!model.is_empty()).then_some(model),
            effort: (!effort.is_empty()).then_some(effort),
            settings_path: Some(runtime.settings_path),
            mcp_config_path,
            auto_confirm: request.auto_confirm,
            fork_session: request.fork_session,
            attach_short_id: request.attach_short_id,
        })
        .map_err(|error| error.to_string())
}

/**
 * The Claude session still running under this id, if the CLI has one.
 *
 * Claude Code keeps a session alive when its terminal goes away, and then refuses to resume it in
 * place. Callers check this before resuming so they can stop an idle one and hand a busy one back
 * to the user rather than launching a terminal that exits on a message.
 */
#[tauri::command]
pub async fn inspect_claude_background_session(
    session_id: String,
) -> Result<Option<ClaudeBackgroundSession>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ClaudeCodeAdapter::new().background_session(&session_id)
    })
    .await
    .map_err(|error| error.to_string())
}

/// Ends a background session so its id can be resumed in a Termexo terminal again.
#[tauri::command]
pub async fn stop_claude_background_session(short_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ClaudeCodeAdapter::new()
            .stop_background_session(&short_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command(async)]
pub fn prepare_codex_launch(
    request: PrepareCodexLaunchRequest,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
    hooks: State<'_, HookEventStore>,
) -> Result<AgentLaunchSpec, String> {
    let worker_role = database
        .read_app_setting(&format!("one_ring.worker.v1.{}", request.terminal_id))
        .map_err(|e| e.to_string())?;
    let profiles = database
        .list_model_profiles()
        .map_err(|error| error.to_string())?;
    let profile = select_profile(&profiles, request.profile_id.as_deref(), |profile| {
        profile.codex_enabled
    });
    let mut environment =
        account_profile_environment(&database, request.account_profile_id.as_deref(), "codex")?;

    if let Some(profile) = profile.as_ref() {
        if let Some(target) = profile.credential_target.as_deref() {
            let token = credentials
                .get_optional(target)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    format!(
                        "模型 Profile「{}」的 API Key 不存在或已失效，请在设置中重新输入并保存。",
                        profile.name
                    )
                })?;
            environment.insert("OPENAI_API_KEY".into(), token);
        }
    }
    environment.extend(network_environment(
        &database,
        &credentials,
        request.workspace_id.as_deref(),
    )?);
    environment.extend(hooks.codex_hook_environment(&request.terminal_id));
    // The account decides which home the CLI reads its config and sessions from, so the same one
    // has to name the notify program Termexo's override stands in for, and answer whether the
    // session being resumed is still there.
    let adapter = match environment.get("CODEX_HOME") {
        Some(home) => CodexCliAdapter::with_home(home.into()),
        None => CodexCliAdapter::new(),
    };
    let notify_config = hooks
        .codex_notify_config(&request.terminal_id, &adapter.configured_notify_command())
        .map_err(|error| error.to_string())?;
    let hook_configs = hooks
        .codex_hook_configs()
        .map_err(|error| error.to_string())?;
    let effective_model = request
        .model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| profile.as_ref().map(|profile| profile.codex_model.clone()));
    let mut provider_configs = codex_provider_configs(profile.as_ref())?;
    if let Some(role) = worker_role.as_deref() {
        provider_configs.extend(codex_worker_configs(role)?);
    }
    let one_ring =
        crate::one_ring::coordinator_config(&database, &request.terminal_id, request.one_ring)?;
    if let Some((config, _)) = &one_ring {
        provider_configs.push(config.clone());
        if let Some(bridge) = database
            .read_app_setting("one_ring.desktop_bridge.v1")
            .map_err(|e| e.to_string())?
        {
            let bridge: serde_json::Value =
                serde_json::from_str(&bridge).map_err(|e| e.to_string())?;
            for (key, field) in [
                ("TERMEXO_EXECUTABLE", "executable"),
                ("TERMEXO_DATABASE", "database"),
            ] {
                if let Some(value) = bridge[field].as_str() {
                    environment.insert(key.into(), value.into());
                }
            }
            if let Some(account) = &request.account_profile_id {
                environment.insert("TERMEXO_ACCOUNT_PROFILE_ID".into(), account.clone());
            }
        }
    }
    if let (Some(profile), Some(model)) = (profile.as_ref(), effective_model.as_deref()) {
        if let Some(metadata) = codex_model_metadata(profile, model) {
            let catalog_path = hooks
                .write_codex_model_catalog(&request.terminal_id, &metadata.catalog)
                .map_err(|error| error.to_string())?;
            provider_configs.push(format!(
                "model_catalog_json={}",
                toml_literal(&catalog_path).map_err(|error| error.to_string())?
            ));
            provider_configs.push(format!("model_context_window={}", metadata.context_window));
        }
    }
    let reasoning_effort = normalized_effort(
        request.reasoning_effort.as_deref().unwrap_or_else(|| {
            profile
                .as_ref()
                .map_or("", |profile| profile.codex_reasoning_effort.as_str())
        }),
        &CODEX_REASONING_EFFORT_LEVELS,
    );
    if !reasoning_effort.is_empty() {
        provider_configs.push(format!(
            "model_reasoning_effort={}",
            toml_literal(&reasoning_effort).map_err(|error| error.to_string())?
        ));
    }
    log_proxy_environment(&environment);
    launch_environment
        .put(request.terminal_id.clone(), environment)
        .map_err(|error| error.to_string())?;
    // A resume the CLI cannot satisfy is not a recoverable state: it prints "No saved session
    // found" and exits, leaving the terminal at a shell prompt with no agent in it. Starting a
    // fresh session is the outcome the user can still work in.
    let session_id = request.session_id.filter(|session_id| {
        let exists = adapter.session_exists(session_id);
        if !exists {
            tracing::warn!(
                target: "termexo::agent",
                terminal_id = %request.terminal_id,
                "Codex 会话 {session_id} 已不存在，改为开始新会话"
            );
        }
        exists
    });
    hooks.forget_codex_rollout(&request.terminal_id);
    if let Some(session_id) = session_id.as_deref() {
        if let Ok(Some(path)) = adapter.session_transcript_path(session_id) {
            if let Err(error) = hooks.watch_codex_rollout(&request.terminal_id, session_id, path) {
                tracing::warn!(%error, "Could not watch Codex rollout status");
            }
        }
    }
    adapter
        .build_launch_command(&CodexLaunchOptions {
            initial_prompt: if session_id.is_none() {
                one_ring.as_ref().map(|(_, prompt)| prompt.clone())
            } else {
                None
            },
            session_id,
            model: effective_model,
            notify_config: Some(notify_config),
            hook_configs,
            provider_configs,
            auto_confirm: request.auto_confirm && one_ring.is_none() && worker_role.is_none(),
        })
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveWorkerRequest {
    pub terminal_id: String,
    pub workspace_id: String,
    pub role: String,
    #[serde(default = "default_worker_cli")]
    pub cli: String,
    pub instructions_path: String,
    pub model: Option<String>,
    pub account_profile_id: Option<String>,
}

fn default_worker_cli() -> String {
    "codex".into()
}

fn codex_worker_configs(role: &str) -> Result<Vec<String>, String> {
    let sandbox = match role {
        "implementer" => "workspace-write",
        "verifier" => "read-only",
        _ => return Err("无效的 Worker 角色".into()),
    };
    Ok(vec![
        format!("sandbox_mode='{sandbox}'"),
        "approval_policy='on-request'".into(),
        "mcp_servers={}".into(),
        "features.plugins=false".into(),
        "features.multi_agent=false".into(),
    ])
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeWorkerContext {
    model: String,
    instructions_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveWorkerLaunch {
    pub command: String,
    pub native_session_id: Option<String>,
}

#[tauri::command(async)]
pub fn prepare_interactive_worker_launch(
    request: InteractiveWorkerRequest,
    database: State<'_, WorkspaceDatabase>,
    hooks: State<'_, HookEventStore>,
    credentials: State<'_, CredentialStore>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
) -> Result<InteractiveWorkerLaunch, String> {
    let sandbox = match request.role.as_str() {
        "implementer" => "workspace-write",
        "verifier" => "read-only",
        _ => return Err("不支持的 One Ring Worker 角色。".into()),
    };
    let instructions = std::path::PathBuf::from(&request.instructions_path);
    if !instructions.is_absolute() || !instructions.is_file() {
        return Err("Worker 任务说明必须是已存在文件的绝对路径。".into());
    }
    if !matches!(request.cli.as_str(), "codex" | "opencode")
        || (request.cli == "opencode" && request.role != "implementer")
    {
        return Err("当前支持 Codex 实施/验证，以及 OpenCode 实施。".into());
    }
    if request.cli == "opencode" {
        let model = request
            .model
            .as_deref()
            .filter(|model| model.contains('/') && !model.chars().any(char::is_whitespace))
            .ok_or("OpenCode 实施者需要在计划中明确 provider/model。")?;
        let adapter = OpenCodeAdapter::new();
        if adapter.plugin_api_version().map_err(|e| e.to_string())? < 2 {
            return Err("One Ring 交互实施需要 OpenCode 2。".into());
        }
        let session_id = format!("ses_{}", request.terminal_id.replace('-', ""));
        let mut environment = opencode_launch_environment(
            &database,
            &credentials,
            &hooks,
            &request.terminal_id,
            Some(&request.workspace_id),
            Some(&session_id),
            &adapter,
        )?;
        let config = opencode_worker_config(
            environment
                .get("OPENCODE_CONFIG_CONTENT")
                .map(String::as_str),
            model,
            &instructions,
        )?;
        environment.insert("OPENCODE_CONFIG_CONTENT".into(), config);
        database
            .write_app_setting(
                &format!("one_ring.worker.v1.{}", request.terminal_id),
                &request.role,
            )
            .map_err(|e| e.to_string())?;
        database
            .write_app_setting(
                &format!("one_ring.opencode_worker.v1.{}", request.terminal_id),
                &serde_json::to_string(&OpenCodeWorkerContext {
                    model: model.into(),
                    instructions_path: request.instructions_path.clone(),
                })
                .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        launch_environment
            .put(request.terminal_id.clone(), environment)
            .map_err(|e| e.to_string())?;
        let mut launch = adapter
            .build_launch_command(&OpenCodeLaunchOptions {
                session_id: Some(session_id.clone()),
                model: None,
                continue_last: false,
                auto_confirm: false,
            })
            .map_err(|e| e.to_string())?;
        let prompt = format!("Read and follow the One Ring implementer instructions in {}. End with only the required JSON report and keep this interactive CLI open.", request.instructions_path);
        launch
            .command
            .push_str(&format!(" --prompt '{}'", prompt.replace('\'', "''")));
        return Ok(InteractiveWorkerLaunch {
            command: launch.command,
            native_session_id: Some(session_id),
        });
    }
    database
        .write_app_setting(
            &format!("one_ring.worker.v1.{}", request.terminal_id),
            &request.role,
        )
        .map_err(|e| e.to_string())?;
    let mut launch = prepare_codex_launch(
        PrepareCodexLaunchRequest {
            one_ring: None,
            terminal_id: request.terminal_id,
            workspace_id: Some(request.workspace_id),
            session_id: None,
            model: request.model,
            profile_id: None,
            account_profile_id: request.account_profile_id,
            auto_confirm: false,
            reasoning_effort: None,
        },
        database,
        credentials,
        launch_environment,
        hooks,
    )?;
    let prompt = format!("Read and follow the One Ring {} instructions at {}. Remain in this interactive session and return the required JSON report when done.", request.role, serde_json::to_string(&request.instructions_path).map_err(|e| e.to_string())?);
    let quote = |value: &str| format!("'{}'", value.replace('\'', "''"));
    launch.command.push_str(&format!(" --sandbox {sandbox} --ask-for-approval on-request -c {} --disable plugins --disable multi_agent -- {}", quote("mcp_servers={}"), quote(&prompt)));
    Ok(InteractiveWorkerLaunch {
        command: launch.command,
        native_session_id: None,
    })
}

fn opencode_worker_config(
    existing: Option<&str>,
    model: &str,
    instructions: &std::path::Path,
) -> Result<String, String> {
    let mut config: serde_json::Value =
        serde_json::from_str(existing.unwrap_or("{}")).map_err(|e| e.to_string())?;
    let object = config
        .as_object_mut()
        .ok_or("OpenCode config must be an object")?;
    object.insert("model".into(), serde_json::json!(model));
    object.insert("mcp".into(), serde_json::json!({}));
    object.insert("permission".into(), serde_json::json!({ "*": "deny", "read": "allow", "glob": "allow", "grep": "allow", "list": "allow", "edit": "allow", "write": "allow", "apply_patch": "allow", "bash": "ask", "lsp": "allow", "todowrite": "allow", "question": "ask", "task": "deny", "external_directory": "deny" }));
    let instruction_directory = instructions
        .parent()
        .ok_or("Worker instructions need a parent directory")?
        .to_string_lossy()
        .replace('\\', "/");
    let pattern = format!("{instruction_directory}/**");
    config["permission"]["external_directory"] =
        serde_json::json!({ "*": "deny", pattern.clone(): "allow" });
    for tool in ["edit", "write", "apply_patch"] {
        config["permission"][tool] = serde_json::json!({ "*": "allow", pattern.clone(): "deny" });
    }
    serde_json::to_string(&config).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn get_opencode_worker_evidence(session_id: String) -> Result<serde_json::Value, String> {
    OpenCodeAdapter::new()
        .worker_evidence(&session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn list_opencode_worker_models(
    working_directory: Option<String>,
) -> Result<Vec<String>, String> {
    OpenCodeAdapter::new()
        .worker_models(working_directory.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn list_codex_models(
    account_profile_id: Option<String>,
    working_directory: Option<String>,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
) -> Result<Value, String> {
    let executable = CodexCliAdapter::new()
        .detect()
        .map_err(|e| e.to_string())?
        .executable_path
        .ok_or("未安装 Codex CLI")?;
    let mut command = crate::process::hidden_command("node");
    command.args([
        "--input-type=module",
        "-e",
        include_str!("codex-catalog.mjs"),
        &executable,
    ]);
    command.envs(account_profile_environment(
        &database,
        account_profile_id.as_deref(),
        "codex",
    )?);
    command.envs(network_environment(&database, &credentials, None)?);
    if let Some(directory) = working_directory.filter(|directory| !directory.trim().is_empty()) {
        command.current_dir(directory);
    }
    let output = crate::process::run_with_timeout(&mut command, std::time::Duration::from_secs(22))
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn get_worker_transcript_path(
    session_id: String,
    account_profile_id: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Option<String>, String> {
    let environment =
        account_profile_environment(&database, account_profile_id.as_deref(), "codex")?;
    let adapter = environment
        .get("CODEX_HOME")
        .map(|home| CodexCliAdapter::with_home(home.into()))
        .unwrap_or_default();
    adapter
        .session_transcript_path(&session_id)
        .map(|path| path.map(|p| p.to_string_lossy().into_owned()))
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn prepare_opencode_launch(
    request: PrepareOpenCodeLaunchRequest,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
    hooks: State<'_, HookEventStore>,
) -> Result<AgentLaunchSpec, String> {
    let environment = opencode_launch_environment(
        &database,
        &credentials,
        &hooks,
        &request.terminal_id,
        request.workspace_id.as_deref(),
        request.session_id.as_deref(),
        &OpenCodeAdapter::new(),
    )?;
    log_proxy_environment(&environment);
    launch_environment
        .put(request.terminal_id, environment)
        .map_err(|error| error.to_string())?;
    OpenCodeAdapter::new()
        .build_launch_command(&OpenCodeLaunchOptions {
            session_id: request.session_id,
            model: request.model,
            continue_last: request.continue_last,
            auto_confirm: request.auto_confirm,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn prepare_pi_launch(
    request: PreparePiLaunchRequest,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
    hooks: State<'_, HookEventStore>,
) -> Result<AgentLaunchSpec, String> {
    let extension_path = hooks
        .prepare_pi_runtime(&request.terminal_id)
        .map_err(|error| error.to_string())?;
    let launch = PiAdapter::new()
        .build_launch_command(&PiLaunchOptions {
            session_id: request.session_id,
            model: request.model,
            continue_last: request.continue_last,
            extension_path: Some(extension_path),
        })
        .map_err(|error| error.to_string())?;
    let environment =
        network_environment(&database, &credentials, request.workspace_id.as_deref())?;
    launch_environment
        .put(request.terminal_id, environment)
        .map_err(|error| error.to_string())?;
    Ok(launch)
}

#[tauri::command(async)]
pub fn prepare_grok_launch(
    request: PrepareGrokLaunchRequest,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
    hooks: State<'_, HookEventStore>,
) -> Result<AgentLaunchSpec, String> {
    let mut environment =
        network_environment(&database, &credentials, request.workspace_id.as_deref())?;
    environment.extend(
        hooks
            .prepare_grok_runtime(&request.terminal_id)
            .map_err(|error| error.to_string())?,
    );
    launch_environment
        .put(request.terminal_id, environment)
        .map_err(|error| error.to_string())?;
    GrokBuildAdapter::new()
        .build_launch_command(&GrokLaunchOptions {
            session_id: request.session_id,
            new_session_id: request.new_session_id,
            model: request.model,
            continue_last: request.continue_last,
            auto_confirm: request.auto_confirm,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn detect_antigravity() -> Result<AgentInstallation, String> {
    tauri::async_runtime::spawn_blocking(|| {
        AntigravityAdapter::new()
            .detect()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn scan_antigravity_sessions(
    project_path: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentSession>, String> {
    let sessions = tauri::async_runtime::spawn_blocking(move || {
        let adapter = AntigravityAdapter::new();
        let installation = adapter.detect().map_err(|error| error.to_string())?;
        if !installation.installed {
            return Ok(Vec::new());
        }
        adapter
            .list_sessions(project_path.as_deref())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    database
        .save_agent_sessions(&sessions)
        .map_err(|error| error.to_string())?;
    Ok(sessions)
}

/// The models this installation offers, for the launch dialog's picker.
#[tauri::command]
pub async fn list_antigravity_models() -> Result<Vec<AntigravityModel>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        AntigravityAdapter::new()
            .list_models()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Reports whether Termexo's status feed is installed in the CLI's own settings.
#[tauri::command(async)]
pub fn read_antigravity_status_feed() -> Result<AntigravityStatusFeed, String> {
    antigravity_settings::describe().map_err(|error| error.to_string())
}

/// Installs or removes the status feed.
///
/// Turning it off is recorded, because the feed installs itself on first launch and would
/// otherwise come straight back — a switch that undoes itself is not one.
#[tauri::command(async)]
pub fn set_antigravity_status_feed(
    enabled: bool,
    database: State<'_, WorkspaceDatabase>,
) -> Result<AntigravityStatusFeed, String> {
    database
        .write_app_setting(ANTIGRAVITY_FEED_OPT_OUT, if enabled { "" } else { "1" })
        .map_err(|error| error.to_string())?;
    if !enabled {
        return antigravity_settings::remove().map_err(|error| error.to_string());
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    antigravity_settings::install(&executable).map_err(|error| error.to_string())
}

/// Installs the status feed unless the user has turned it off.
///
/// Called from the launch rather than from startup: this writes to a file Termexo does not own, so
/// it happens at the first moment the write is worth anything — and never on a machine whose owner
/// does not run Antigravity at all. A failure is logged and the launch continues, because losing
/// the status display is a far smaller thing than losing the terminal.
fn ensure_antigravity_status_feed(database: &WorkspaceDatabase) {
    let opted_out = database
        .read_app_setting(ANTIGRAVITY_FEED_OPT_OUT)
        .ok()
        .flatten()
        .is_some_and(|value| value == "1");
    if opted_out {
        return;
    }
    let installed = match antigravity_settings::describe() {
        Ok(feed) => feed.installed,
        Err(error) => {
            tracing::warn!(%error, "无法读取 Antigravity 配置，跳过状态回传的安装");
            return;
        }
    };
    let Ok(executable) = std::env::current_exe() else {
        return;
    };
    // An installed feed still has to match this installation: the command carries the path of the
    // executable that wrote it, and an older Termexo wrote it in a shape the CLI cannot run.
    let written = if installed {
        antigravity_settings::refresh(&executable).map(|_| ())
    } else {
        antigravity_settings::install(&executable).map(|_| ())
    };
    if let Err(error) = written {
        tracing::warn!(%error, "无法写入 Antigravity 状态回传配置");
    }
}

#[tauri::command(async)]
pub fn prepare_antigravity_launch(
    request: PrepareAntigravityLaunchRequest,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
    hooks: State<'_, HookEventStore>,
) -> Result<AgentLaunchSpec, String> {
    let environment = antigravity_launch_environment(
        &database,
        &credentials,
        &hooks,
        &request.terminal_id,
        request.workspace_id.as_deref(),
    )?;
    ensure_antigravity_status_feed(&database);
    // The CLI stops to ask about an unfamiliar workspace on first launch, which in a terminal
    // opened to do something else is the last thing the user expects to deal with.
    if let Some(directory) = request.working_directory.as_deref() {
        if let Err(error) = antigravity_settings::trust_workspace(directory) {
            tracing::warn!(%error, "无法将工作目录写入 Antigravity 的信任列表");
        }
    }
    log_proxy_environment(&environment);
    launch_environment
        .put(request.terminal_id, environment)
        .map_err(|error| error.to_string())?;
    AntigravityAdapter::new()
        .build_launch_command(&AntigravityLaunchOptions {
            session_id: request.session_id,
            model: request.model,
            effort: request.effort,
            continue_last: request.continue_last,
            auto_confirm: request.auto_confirm,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn prepare_account_login(
    request: PrepareAccountLoginRequest,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
) -> Result<AgentLaunchSpec, String> {
    let profile = database
        .find_account_profile(&request.account_profile_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "账号 Profile 不存在。".to_owned())?;
    let mut environment = account::environment(&profile);
    environment.extend(network_environment(
        &database,
        &credentials,
        request.workspace_id.as_deref(),
    )?);
    launch_environment
        .put(request.terminal_id, environment)
        .map_err(|error| error.to_string())?;
    let (command, executable_path) = account::login_spec(&profile)?;
    Ok(AgentLaunchSpec {
        command,
        executable_path,
    })
}

fn account_profile_environment(
    database: &WorkspaceDatabase,
    profile_id: Option<&str>,
    agent_type: &str,
) -> Result<HashMap<String, String>, String> {
    let profiles = database
        .list_account_profiles()
        .map_err(|error| error.to_string())?;
    let profile = match profile_id {
        Some(profile_id) => profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .ok_or_else(|| "账号 Profile 不存在。".to_owned())?,
        None => profiles
            .iter()
            .find(|profile| profile.agent_type == agent_type && profile.is_default)
            .or_else(|| {
                profiles
                    .iter()
                    .find(|profile| profile.agent_type == agent_type)
            })
            .ok_or_else(|| "没有可用的账号 Profile。".to_owned())?,
    };
    if profile.agent_type != agent_type {
        return Err("所选账号与 Agent 类型不匹配。".into());
    }
    account::prepare_managed_directory(profile)?;
    Ok(account::environment(profile))
}

/// Records the proxy-related variables a terminal will start with.
///
/// A proxy that works in a plain terminal but stalls inside Termexo is a difference in the
/// injected environment, and guessing at that difference is slower than reading it. Credentials
/// are masked so the log stays safe to share.
fn log_proxy_environment(environment: &HashMap<String, String>) {
    let mut entries = environment
        .iter()
        .filter(|(key, _)| {
            let key = key.to_ascii_uppercase();
            key.ends_with("_PROXY")
                || key.starts_with("NPM_CONFIG_")
                || key == "NODE_EXTRA_CA_CERTS"
        })
        .map(|(key, value)| format!("{key}={}", mask_credentials(value)))
        .collect::<Vec<_>>();
    if entries.is_empty() {
        return;
    }
    entries.sort();
    let line = entries.join(" ");
    tracing::info!(target: "termexo::proxy", "launch proxy env: {line}");
    // The GUI has no console, so the same line goes to a file the user can hand over.
    append_proxy_diagnostic(&line);
}

/// Appends one diagnostic line to `proxy-diagnostics.log` in the app data directory.
///
/// Written with plain `std::fs` rather than through Tauri's path API so the caller does not
/// need an `AppHandle`; failures are ignored because diagnostics must never block a launch.
fn append_proxy_diagnostic(line: &str) {
    let Some(directory) = dirs_app_data() else {
        return;
    };
    let _ = std::fs::create_dir_all(&directory);
    let path = directory.join("proxy-diagnostics.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        use std::io::Write;
        let _ = writeln!(file, "{line}");
    }
}

/// Resolves the same app data directory Tauri uses for `dev.agentdock.desktop`.
fn dirs_app_data() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|base| PathBuf::from(base).join("dev.agentdock.desktop"))
}

/// Replaces any `user:password@` portion of a URL with `***`.
fn mask_credentials(value: &str) -> String {
    let Some((scheme, rest)) = value.split_once("://") else {
        return value.to_owned();
    };
    match rest.split_once('@') {
        Some((_, host)) => format!("{scheme}://***@{host}"),
        None => value.to_owned(),
    }
}

pub(crate) fn network_environment(
    database: &WorkspaceDatabase,
    credentials: &CredentialStore,
    workspace_id: Option<&str>,
) -> Result<HashMap<String, String>, String> {
    let Some(profile) = database
        .find_effective_network_profile(workspace_id)
        .map_err(|error| error.to_string())?
    else {
        return Ok(HashMap::new());
    };
    let password = profile
        .credential_target
        .as_deref()
        .map(|target| credentials.get(target))
        .transpose()
        .map_err(|error| error.to_string())?;
    network::profile_environment(&profile, password.as_deref())
}

fn opencode_launch_environment(
    database: &WorkspaceDatabase,
    credentials: &CredentialStore,
    hooks: &HookEventStore,
    terminal_id: &str,
    workspace_id: Option<&str>,
    session_id: Option<&str>,
    adapter: &OpenCodeAdapter,
) -> Result<HashMap<String, String>, String> {
    let mut environment = network_environment(database, credentials, workspace_id)?;
    // The CLI talks to its private server over loopback. Exclude it even when the selected
    // profile omitted NO_PROXY, while keeping every bypass the user already configured.
    let existing = environment
        .get("NO_PROXY")
        .or_else(|| environment.get("no_proxy"))
        .cloned()
        .or_else(|| std::env::var("NO_PROXY").ok())
        .or_else(|| std::env::var("no_proxy").ok())
        .unwrap_or_default();
    let mut exclusions = existing
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    for loopback in ["localhost", "127.0.0.1", "::1"] {
        if !exclusions
            .iter()
            .any(|value| value.eq_ignore_ascii_case(loopback))
        {
            exclusions.push(loopback.into());
        }
    }
    let no_proxy = exclusions.join(",");
    network::insert_no_proxy_env(&mut environment, no_proxy);
    let runtime = hooks
        .prepare_opencode_runtime(
            terminal_id,
            session_id,
            std::env::var("OPENCODE_CONFIG_CONTENT").ok().as_deref(),
            adapter
                .plugin_api_version()
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    environment.insert("OPENCODE_CONFIG_CONTENT".into(), runtime.config_content);
    if database
        .read_app_setting(&format!("one_ring.worker.v1.{terminal_id}"))
        .map_err(|e| e.to_string())?
        .is_some()
    {
        let context = database
            .read_app_setting(&format!("one_ring.opencode_worker.v1.{terminal_id}"))
            .map_err(|e| e.to_string())?
            .ok_or("OpenCode Worker 上下文缺失，请通过协调会话重新创建 Worker。")?;
        let context: OpenCodeWorkerContext =
            serde_json::from_str(&context).map_err(|e| e.to_string())?;
        let config = opencode_worker_config(
            environment
                .get("OPENCODE_CONFIG_CONTENT")
                .map(String::as_str),
            &context.model,
            std::path::Path::new(&context.instructions_path),
        )?;
        environment.insert("OPENCODE_CONFIG_CONTENT".into(), config);
    }
    Ok(environment)
}

/// Picks the profile an agent should launch with, ignoring any that is switched off for it.
///
/// An explicit choice still has to be enabled: a profile the user turned off for this agent has no
/// endpoint for it, so honouring the request would launch against the other protocol's URL. The
/// default profile wins the fallback, and failing that the first profile that serves this agent.
fn select_profile(
    profiles: &[ModelProfile],
    requested_id: Option<&str>,
    serves_agent: impl Fn(&ModelProfile) -> bool,
) -> Option<ModelProfile> {
    let usable = |profile: &&ModelProfile| serves_agent(profile);
    requested_id
        .and_then(|profile_id| {
            profiles
                .iter()
                .find(|profile| profile.id == profile_id)
                .filter(usable)
        })
        .or_else(|| {
            profiles
                .iter()
                .find(|profile| profile.is_default)
                .filter(usable)
        })
        .or_else(|| profiles.iter().find(usable))
        .cloned()
}

/// Rebuilds the environment a terminal was launched with, from what the terminal itself records.
///
/// The stash filled in by `prepare_*_launch` is consumed once and lives only in memory, so a
/// terminal that reconnects — after an app restart, or any relaunch of its PTY — would otherwise
/// start with none of it: the CLI would fall back to its default home and read as a different
/// account, with no proxy and no provider key. Rebuilding keeps a reconnected terminal on the
/// same account it was created with.
pub(crate) fn relaunch_environment(
    database: &WorkspaceDatabase,
    credentials: &CredentialStore,
    hooks: &HookEventStore,
    request: &RelaunchRequest<'_>,
) -> Result<HashMap<String, String>, String> {
    relaunch_environment_with_opencode_adapter(
        database,
        credentials,
        hooks,
        request,
        &OpenCodeAdapter::new(),
    )
}

fn relaunch_environment_with_opencode_adapter(
    database: &WorkspaceDatabase,
    credentials: &CredentialStore,
    hooks: &HookEventStore,
    request: &RelaunchRequest<'_>,
    opencode: &OpenCodeAdapter,
) -> Result<HashMap<String, String>, String> {
    match request.agent_type {
        "claude" | "codex" => model_agent_relaunch_environment(database, credentials, request),
        "opencode" => opencode_launch_environment(
            database,
            credentials,
            hooks,
            request.terminal_id,
            request.workspace_id,
            request.native_session_id,
            opencode,
        ),
        "pi" => {
            hooks
                .prepare_pi_runtime(request.terminal_id)
                .map_err(|error| error.to_string())?;
            network_environment(database, credentials, request.workspace_id)
        }
        "grok" => {
            let mut environment = network_environment(database, credentials, request.workspace_id)?;
            environment.extend(
                hooks
                    .prepare_grok_runtime(request.terminal_id)
                    .map_err(|error| error.to_string())?,
            );
            Ok(environment)
        }
        "antigravity" => antigravity_launch_environment(
            database,
            credentials,
            hooks,
            request.terminal_id,
            request.workspace_id,
        ),
        // Anything else keeps the environment it inherits.
        _ => Ok(HashMap::new()),
    }
}

/// What a reconnecting terminal knows about the launch whose stashed environment it lost.
pub(crate) struct RelaunchRequest<'a> {
    pub terminal_id: &'a str,
    pub agent_type: &'a str,
    pub native_session_id: Option<&'a str>,
    pub account_profile_id: Option<&'a str>,
    pub model_profile_id: Option<&'a str>,
    pub workspace_id: Option<&'a str>,
}

/// Everything agy is told about a terminal, which it can only learn from its environment.
///
/// A fresh launch and a restored terminal both build it here, because a restored one that missed
/// it went wrong twice over: its status script could not say which terminal it reported for, and
/// with the update switch gone the CLI's self-updater ran — on Windows as a background process in a
/// console window of its own, which flashed up every time Termexo reopened an Antigravity terminal.
/// The status script needs the terminal id because the payload the CLI sends it names the
/// conversation, not the terminal, and one workspace can have several.
fn antigravity_launch_environment(
    database: &WorkspaceDatabase,
    credentials: &CredentialStore,
    hooks: &HookEventStore,
    terminal_id: &str,
    workspace_id: Option<&str>,
) -> Result<HashMap<String, String>, String> {
    let mut environment = network_environment(database, credentials, workspace_id)?;
    environment.extend(hooks.antigravity_environment(terminal_id));
    Ok(environment)
}

/// Claude and Codex take their account home, provider and key from the environment.
fn model_agent_relaunch_environment(
    database: &WorkspaceDatabase,
    credentials: &CredentialStore,
    request: &RelaunchRequest<'_>,
) -> Result<HashMap<String, String>, String> {
    let agent_type = request.agent_type;
    let mut environment =
        account_profile_environment(database, request.account_profile_id, agent_type)?;

    let profile = match request.model_profile_id {
        Some(profile_id) => database
            .list_model_profiles()
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|profile| profile.id == profile_id),
        None => None,
    };
    if let Some(profile) = profile.as_ref() {
        // Codex takes its provider from `-c` overrides on the command line, which the terminal
        // already stores; only Claude reads the provider out of the environment.
        if agent_type == "claude" {
            environment.extend(claude_profile_environment(
                Some(profile),
                profile.claude_context_1m,
            ));
        }
        if let Some(target) = profile.credential_target.as_deref() {
            // A missing key is not fatal here: the terminal is reconnecting, and refusing to
            // start it would be worse than letting the CLI report the problem itself.
            if let Ok(Some(token)) = credentials.get_optional(target) {
                let key = if agent_type == "claude" {
                    "ANTHROPIC_AUTH_TOKEN"
                } else {
                    "OPENAI_API_KEY"
                };
                environment.insert(key.into(), token);
            }
        }
    }
    environment.extend(network_environment(
        database,
        credentials,
        request.workspace_id,
    )?);
    Ok(environment)
}

/// Claude reads its provider from the environment, so the profile becomes env vars.
/// A third-party endpoint reads its model — and the context window it implies — out of the
/// environment, so it has to be handed the same suffixed id the command line carries.
fn claude_profile_environment(
    profile: Option<&ModelProfile>,
    context_1m: bool,
) -> HashMap<String, String> {
    let Some(profile) = profile else {
        return HashMap::new();
    };
    let Some((model, base_url)) = profile.endpoint(AgentProtocol::Anthropic) else {
        return HashMap::new();
    };
    anthropic_profile_environment(profile, &claude_launch_model(model, context_1m), base_url)
}

/// Codex provider id Termexo declares its overrides under.
const CODEX_PROVIDER_ID: &str = "termexo";

const CODEX_RESPONSES_WIRE_API: &str = "responses";

/// Points Codex at a compatible provider through `-c` overrides.
///
/// Codex reads neither `OPENAI_BASE_URL` nor `OPENAI_MODEL` — it resolves providers from its own
/// config, so an endpoint only takes effect when it arrives as a TOML override. Literal strings
/// survive the Windows npm `.cmd` shim, the same reason the hook overrides use them. The key stays
/// in the environment and is named here, so it never appears on the command line.
fn codex_provider_configs(profile: Option<&ModelProfile>) -> Result<Vec<String>, String> {
    let official_provider = format!(
        "model_provider={}",
        toml_literal("openai").map_err(|error| error.to_string())?
    );
    let Some(profile) = profile else {
        // A raw-model launch is an official Codex launch. Never let it inherit a third-party
        // provider from a user config layer or a previously restored terminal.
        return Ok(vec![official_provider]);
    };
    if !profile.codex_enabled {
        return Ok(vec![official_provider]);
    }
    let quote = |value: &str| toml_literal(value).map_err(|error| error.to_string());
    let Some((_, base_url)) = profile.endpoint(AgentProtocol::OpenAi) else {
        return Ok(vec![official_provider]);
    };
    let Some(base_url) = base_url.map(str::trim).filter(|value| !value.is_empty()) else {
        // A prior third-party session records its model provider. Make the official selection an
        // explicit override so a resume or terminal restart cannot carry `termexo` forward.
        return Ok(vec![official_provider]);
    };
    Ok(vec![
        format!("model_provider={}", quote(CODEX_PROVIDER_ID)?),
        format!(
            "model_providers.{CODEX_PROVIDER_ID}.name={}",
            quote(&profile.name)?
        ),
        format!(
            "model_providers.{CODEX_PROVIDER_ID}.base_url={}",
            quote(base_url)?
        ),
        format!(
            "model_providers.{CODEX_PROVIDER_ID}.env_key={}",
            quote("OPENAI_API_KEY")?
        ),
        format!(
            "model_providers.{CODEX_PROVIDER_ID}.wire_api={}",
            quote(CODEX_RESPONSES_WIRE_API)?
        ),
    ])
}

struct CodexModelMetadata {
    catalog: Value,
    context_window: u64,
}

/// Codex only knows metadata for its built-in models. Provider-specific catalog entries keep the
/// CLI from falling back to generic context, reasoning, modality, and tool settings.
fn codex_model_metadata(profile: &ModelProfile, model: &str) -> Option<CodexModelMetadata> {
    let model = model.trim();
    let normalized_model = model.to_ascii_lowercase();
    let (description, default_reasoning_level, reasoning_levels, context_window, input_modalities) =
        if profile.provider.eq_ignore_ascii_case("MiniMax") && normalized_model == "minimax-m3" {
            (
                "MiniMax",
                "high",
                &[("none", "Think-Off"), ("high", "Deep")][..],
                1_000_000,
                &["text", "image"][..],
            )
        } else if profile.provider.eq_ignore_ascii_case("DeepSeek")
            && normalized_model.starts_with("deepseek-v4")
        {
            (
                "DeepSeek",
                "high",
                &[
                    ("high", "High reasoning effort"),
                    ("xhigh", "Maximum reasoning effort"),
                ][..],
                1_000_000,
                &["text"][..],
            )
        } else if profile.provider.eq_ignore_ascii_case("GLM") && normalized_model == "glm-5.2" {
            (
                "GLM",
                "max",
                &[
                    ("none", "Thinking disabled"),
                    ("minimal", "Minimal reasoning effort"),
                    ("low", "Low reasoning effort"),
                    ("medium", "Medium reasoning effort"),
                    ("high", "High reasoning effort"),
                    ("xhigh", "Extra high reasoning effort"),
                    ("max", "Maximum reasoning effort"),
                ][..],
                1_000_000,
                &["text"][..],
            )
        } else if profile.provider.eq_ignore_ascii_case("Kimi") && normalized_model == "kimi-k3" {
            (
                "Kimi",
                "max",
                &[
                    ("low", "Low reasoning effort"),
                    ("high", "High reasoning effort"),
                    ("max", "Maximum reasoning effort"),
                ][..],
                1_048_576,
                &["text", "image"][..],
            )
        } else {
            return None;
        };
    let supported_reasoning_levels = reasoning_levels
        .iter()
        .map(|(effort, description)| json!({ "effort": effort, "description": description }))
        .collect::<Vec<_>>();
    let default_reasoning_summary = if description == "MiniMax" {
        "none"
    } else {
        "auto"
    };

    Some(CodexModelMetadata {
        context_window,
        catalog: json!({
            "models": [{
                "slug": model,
                "display_name": model,
                "description": description,
                "default_reasoning_level": default_reasoning_level,
                "supported_reasoning_levels": supported_reasoning_levels,
                "shell_type": "shell_command",
                "visibility": "list",
                "supported_in_api": true,
                "priority": 0,
                "base_instructions": format!("You are Codex, a coding agent based on {model}. You and the user share the same workspace and collaborate to achieve the user's goals."),
                "supports_reasoning_summaries": true,
                "default_reasoning_summary": default_reasoning_summary,
                "support_verbosity": false,
                "truncation_policy": { "mode": "bytes", "limit": 10000 },
                "supports_parallel_tool_calls": true,
                "experimental_supported_tools": [],
                "input_modalities": input_modalities
            }]
        }),
    })
}

fn anthropic_profile_environment(
    profile: &ModelProfile,
    model: &str,
    base_url: Option<&str>,
) -> HashMap<String, String> {
    let mut environment = HashMap::new();
    let Some(base_url) = base_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return environment;
    };

    environment.insert("ANTHROPIC_BASE_URL".into(), base_url.into());
    environment.insert("API_TIMEOUT_MS".into(), "3000000".into());
    environment.insert(
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".into(),
        "1".into(),
    );

    let model = model.trim();
    if !model.is_empty() {
        for key in [
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "CLAUDE_CODE_SUBAGENT_MODEL",
        ] {
            environment.insert(key.into(), model.into());
        }
        if model.contains("[1m]")
            || (profile.provider.eq_ignore_ascii_case("MiniMax")
                && model.eq_ignore_ascii_case("MiniMax-M3"))
        {
            environment.insert("CLAUDE_CODE_AUTO_COMPACT_WINDOW".into(), "1000000".into());
        }
    }

    if profile.provider.eq_ignore_ascii_case("DeepSeek") {
        environment.insert("CLAUDE_CODE_EFFORT_LEVEL".into(), "max".into());
    }
    environment
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::NetworkProfile;

    #[test]
    fn opencode_worker_keeps_status_plugin_and_pins_model_without_enabling_orchestration() {
        let config: Value = serde_json::from_str(
            &opencode_worker_config(
                Some(r#"{"plugins":["file:///status"],"mcp":{"other":{}}}"#),
                "provider/model",
                std::path::Path::new("C:/state/run/instructions.md"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(config["model"], "provider/model");
        assert_eq!(config["plugins"][0], "file:///status");
        assert_eq!(config["permission"]["*"], "deny");
        assert_eq!(config["permission"]["task"], "deny");
        assert_eq!(config["permission"]["bash"], "ask");
        assert_eq!(
            config["permission"]["external_directory"]["C:/state/run/**"],
            "allow"
        );
        assert_eq!(config["permission"]["edit"]["C:/state/run/**"], "deny");
        assert_eq!(config["mcp"], json!({}));
    }

    #[test]
    fn codex_worker_role_restrictions_are_reusable_for_resumed_launches() {
        let verifier = codex_worker_configs("verifier").unwrap();
        assert!(verifier.contains(&"sandbox_mode='read-only'".into()));
        assert!(verifier.contains(&"mcp_servers={}".into()));
        assert!(verifier.contains(&"features.multi_agent=false".into()));
        assert!(codex_worker_configs("implementer")
            .unwrap()
            .contains(&"sandbox_mode='workspace-write'".into()));
        assert!(codex_worker_configs("coordinator").is_err());
    }

    /// A provider serving both agents, which is how the presets configure one.
    fn profile(id: &str, provider: &str) -> ModelProfile {
        ModelProfile {
            id: id.into(),
            name: provider.into(),
            provider: provider.into(),
            credential_target: Some(format!("profile:{id}")),
            is_default: false,
            has_credential: true,
            claude_enabled: true,
            claude_model: String::new(),
            claude_base_url: None,
            codex_enabled: true,
            codex_model: String::new(),
            codex_base_url: None,
            plan_alert_threshold: 80,
            claude_context_1m: false,
            claude_effort: String::new(),
            codex_reasoning_effort: String::new(),
        }
    }

    #[test]
    fn maps_anthropic_compatible_profile_to_claude_environment() {
        let profile = ModelProfile {
            claude_model: "deepseek-v4-pro[1m]".into(),
            claude_base_url: Some("https://api.deepseek.com/anthropic".into()),
            ..profile("deepseek", "DeepSeek")
        };

        let environment = claude_profile_environment(Some(&profile), false);

        assert_eq!(
            environment.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://api.deepseek.com/anthropic")
        );
        assert_eq!(
            environment.get("ANTHROPIC_MODEL").map(String::as_str),
            Some("deepseek-v4-pro[1m]")
        );
        assert_eq!(
            environment
                .get("ANTHROPIC_DEFAULT_SONNET_MODEL")
                .map(String::as_str),
            Some("deepseek-v4-pro[1m]")
        );
        assert_eq!(
            environment
                .get("CLAUDE_CODE_AUTO_COMPACT_WINDOW")
                .map(String::as_str),
            Some("1000000")
        );
        assert_eq!(
            environment
                .get("CLAUDE_CODE_EFFORT_LEVEL")
                .map(String::as_str),
            Some("max")
        );
    }

    #[test]
    fn leaves_official_anthropic_environment_untouched() {
        let profile = ModelProfile {
            claude_model: "sonnet".into(),
            credential_target: None,
            has_credential: false,
            ..profile("claude-default", "Anthropic")
        };

        assert!(claude_profile_environment(Some(&profile), false).is_empty());
    }

    #[test]
    fn maps_minimax_profile_to_current_claude_compatibility_environment() {
        let profile = ModelProfile {
            claude_model: "MiniMax-M3".into(),
            claude_base_url: Some("https://api.minimaxi.com/anthropic".into()),
            ..profile("minimax", "MiniMax")
        };

        let environment = claude_profile_environment(Some(&profile), false);

        assert_eq!(
            environment.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://api.minimaxi.com/anthropic")
        );
        for key in [
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "CLAUDE_CODE_SUBAGENT_MODEL",
        ] {
            assert_eq!(environment.get(key).map(String::as_str), Some("MiniMax-M3"));
        }
        assert_eq!(
            environment
                .get("CLAUDE_CODE_AUTO_COMPACT_WINDOW")
                .map(String::as_str),
            Some("1000000")
        );
    }

    #[test]
    fn declares_a_responses_provider_as_toml_overrides() {
        let profile = ModelProfile {
            name: "DeepSeek".into(),
            codex_model: "deepseek-v4".into(),
            codex_base_url: Some("https://api.deepseek.com/v1".into()),
            ..profile("deepseek", "DeepSeek")
        };

        let configs = codex_provider_configs(Some(&profile)).unwrap();

        // Codex ignores OPENAI_BASE_URL, so the endpoint only lands through these overrides.
        assert!(configs
            .iter()
            .any(|config| config.starts_with("model_provider=")));
        assert!(configs
            .iter()
            .any(|config| config.contains("base_url=")
                && config.contains("https://api.deepseek.com/v1")));
        assert!(configs
            .iter()
            .any(|config| config.contains("env_key=") && config.contains("OPENAI_API_KEY")));
        assert!(configs
            .iter()
            .any(|config| config.contains("wire_api=") && config.contains("responses")));
        // Literal TOML strings are what survive the Windows npm `.cmd` shim.
        assert!(configs.iter().all(|config| config.contains("'''")));
    }

    #[test]
    fn uses_responses_for_every_supported_third_party_preset() {
        for (provider, model, base_url) in [
            ("DeepSeek", "deepseek-v4", "https://api.deepseek.com/v1"),
            ("MiniMax", "MiniMax-M3", "https://api.minimaxi.com/v1"),
            ("GLM", "glm-5.2", "https://open.bigmodel.cn/api/paas/v4"),
            ("Kimi", "kimi-k3", "https://api.moonshot.cn/v1"),
        ] {
            let profile = ModelProfile {
                name: provider.into(),
                codex_model: model.into(),
                codex_base_url: Some(base_url.into()),
                ..profile(&provider.to_ascii_lowercase(), provider)
            };

            let configs = codex_provider_configs(Some(&profile)).unwrap();

            assert!(configs
                .iter()
                .any(|config| config.contains("wire_api=") && config.contains("responses")));
        }
    }

    #[test]
    fn supplies_the_official_minimax_m3_codex_metadata() {
        let profile = ModelProfile {
            codex_model: "MiniMax-M3".into(),
            codex_base_url: Some("https://api.minimaxi.com/v1".into()),
            ..profile("minimax", "MiniMax")
        };

        let metadata = codex_model_metadata(&profile, "MiniMax-M3").unwrap();
        let model = &metadata.catalog["models"][0];

        assert_eq!(metadata.context_window, 1_000_000);
        assert_eq!(model["slug"], "MiniMax-M3");
        assert_eq!(model["default_reasoning_level"], "high");
        assert_eq!(model["truncation_policy"]["limit"], 10000);
        assert_eq!(model["input_modalities"], json!(["text", "image"]));
    }

    #[test]
    fn does_not_override_metadata_for_other_codex_models() {
        let profile = ModelProfile {
            codex_model: "MiniMax-M3".into(),
            codex_base_url: Some("https://api.minimaxi.com/v1".into()),
            ..profile("minimax", "MiniMax")
        };

        assert!(codex_model_metadata(&profile, "MiniMax-M2.5").is_none());
        let openai = ModelProfile {
            provider: "OpenAI".into(),
            ..profile
        };
        assert!(codex_model_metadata(&openai, "MiniMax-M3").is_none());
    }

    #[test]
    fn supplies_provider_specific_metadata_for_other_codex_models() {
        for (provider, model_name, context_window, default_effort, modalities) in [
            (
                "DeepSeek",
                "deepseek-v4",
                1_000_000,
                "high",
                json!(["text"]),
            ),
            ("GLM", "glm-5.2", 1_000_000, "max", json!(["text"])),
            (
                "Kimi",
                "kimi-k3",
                1_048_576,
                "max",
                json!(["text", "image"]),
            ),
        ] {
            let profile = ModelProfile {
                codex_model: model_name.into(),
                codex_base_url: Some("https://example.com/v1".into()),
                ..profile(&provider.to_ascii_lowercase(), provider)
            };

            let metadata = codex_model_metadata(&profile, model_name).unwrap();
            let model = &metadata.catalog["models"][0];

            assert_eq!(metadata.context_window, context_window);
            assert_eq!(model["slug"], model_name);
            assert_eq!(model["default_reasoning_level"], default_effort);
            assert_eq!(model["input_modalities"], modalities);
        }
    }

    #[test]
    fn accepts_current_deepseek_v4_model_ids() {
        let profile = ModelProfile {
            codex_model: "deepseek-v4-pro".into(),
            codex_base_url: Some("https://api.deepseek.com/v1".into()),
            ..profile("deepseek", "DeepSeek")
        };

        for model_name in ["deepseek-v4", "deepseek-v4-pro", "deepseek-v4-flash"] {
            let metadata = codex_model_metadata(&profile, model_name).unwrap();
            assert_eq!(metadata.catalog["models"][0]["slug"], model_name);
        }
    }

    #[test]
    fn keeps_a_responses_provider_on_the_current_codex_wire_api() {
        let profile = ModelProfile {
            name: "SCNet".into(),
            codex_model: "DeepSeek-V4".into(),
            codex_base_url: Some("https://api.scnet.cn/api/llm/v1".into()),
            ..profile("scnet", "SCNet")
        };

        let configs = codex_provider_configs(Some(&profile)).unwrap();

        assert!(configs
            .iter()
            .any(|config| config.contains("wire_api=") && config.contains("responses")));
    }

    #[test]
    fn explicitly_restores_codex_to_its_built_in_provider_without_an_endpoint() {
        let official = ModelProfile {
            codex_model: "gpt-5.6-sol".into(),
            ..profile("codex-default", "OpenAI")
        };

        let configs = codex_provider_configs(Some(&official)).unwrap();

        assert_eq!(configs, vec!["model_provider='''openai'''".to_owned()]);
        assert!(!configs.iter().any(|config| config.contains("termexo")));
        assert!(!configs
            .iter()
            .any(|config| config.contains("model_catalog_json")));
        assert_eq!(
            codex_provider_configs(None).unwrap(),
            vec!["model_provider='''openai'''".to_owned()]
        );
    }

    #[test]
    fn restores_the_official_provider_when_the_profile_is_switched_off_for_codex() {
        let claude_only = ModelProfile {
            codex_enabled: false,
            codex_model: "kimi-k3".into(),
            codex_base_url: Some("https://api.moonshot.cn/v1".into()),
            ..profile("kimi", "Kimi")
        };

        assert_eq!(
            codex_provider_configs(Some(&claude_only)).unwrap(),
            vec!["model_provider='''openai'''".to_owned()]
        );
    }

    #[test]
    fn serves_each_agent_the_endpoint_meant_for_its_protocol() {
        let profile = ModelProfile {
            claude_model: "deepseek-v4-pro[1m]".into(),
            claude_base_url: Some("https://api.deepseek.com/anthropic".into()),
            codex_model: "deepseek-v4".into(),
            codex_base_url: Some("https://api.deepseek.com/v1".into()),
            ..profile("deepseek", "DeepSeek")
        };

        let claude = claude_profile_environment(Some(&profile), false);
        let codex = codex_provider_configs(Some(&profile)).unwrap();

        assert_eq!(
            claude.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://api.deepseek.com/anthropic")
        );
        assert!(codex
            .iter()
            .any(|config| config.contains("https://api.deepseek.com/v1")));
        // Neither agent may be handed the other's endpoint, which answers a different protocol.
        assert!(!claude
            .values()
            .any(|value| value.contains("api.deepseek.com/v1")));
        assert!(!codex
            .iter()
            .any(|config| config.contains("api.deepseek.com/anthropic")));
    }

    #[test]
    fn contributes_nothing_for_an_agent_the_profile_is_switched_off_for() {
        let profile = ModelProfile {
            claude_model: "kimi-k3".into(),
            claude_base_url: Some("https://api.moonshot.cn/anthropic".into()),
            codex_enabled: false,
            codex_model: "kimi-k3".into(),
            codex_base_url: Some("https://api.moonshot.cn/v1".into()),
            ..profile("kimi", "Kimi")
        };

        assert_eq!(
            codex_provider_configs(Some(&profile)).unwrap(),
            vec!["model_provider='''openai'''".to_owned()]
        );
        assert!(!claude_profile_environment(Some(&profile), false).is_empty());
    }

    #[test]
    fn skips_a_requested_profile_that_does_not_serve_the_agent() {
        let claude_only = ModelProfile {
            claude_model: "sonnet".into(),
            codex_enabled: false,
            ..profile("claude-only", "Anthropic")
        };
        let codex_capable = ModelProfile {
            codex_model: "gpt-5.6-sol".into(),
            claude_enabled: false,
            ..profile("codex-capable", "OpenAI")
        };
        let profiles = vec![claude_only, codex_capable];

        let chosen = select_profile(&profiles, Some("claude-only"), |profile| {
            profile.codex_enabled
        });

        // Falling back beats launching Codex against an Anthropic endpoint.
        assert_eq!(
            chosen.map(|profile| profile.id),
            Some("codex-capable".into())
        );
    }

    #[test]
    fn prefers_the_default_profile_when_none_was_requested() {
        let profiles = vec![
            ModelProfile {
                claude_model: "kimi-k3".into(),
                ..profile("kimi", "Kimi")
            },
            ModelProfile {
                claude_model: "glm-5.2[1m]".into(),
                is_default: true,
                ..profile("glm", "GLM")
            },
        ];

        let chosen = select_profile(&profiles, None, |profile| profile.claude_enabled);

        assert_eq!(chosen.map(|profile| profile.id), Some("glm".into()));
    }

    /// A restored Antigravity terminal once started with none of this, which let the CLI's
    /// self-updater run and flash a console window on every Termexo start.
    #[test]
    fn rebuilds_the_antigravity_environment_for_a_restored_terminal() {
        let directory = std::env::temp_dir().join(format!(
            "termexo-antigravity-relaunch-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let database = WorkspaceDatabase::open(directory.join("agentdock.db")).unwrap();
        let hooks = HookEventStore::new(&directory).unwrap();

        let environment = relaunch_environment(
            &database,
            &CredentialStore,
            &hooks,
            &RelaunchRequest {
                terminal_id: "terminal-1",
                agent_type: "antigravity",
                native_session_id: None,
                account_profile_id: None,
                model_profile_id: None,
                workspace_id: None,
            },
        )
        .unwrap();

        assert_eq!(
            environment
                .get("AGY_CLI_DISABLE_AUTO_UPDATE")
                .map(String::as_str),
            Some("true")
        );
        assert_eq!(
            environment
                .get("TERMEXO_ANTIGRAVITY_TERMINAL_ID")
                .map(String::as_str),
            Some("terminal-1")
        );
        assert!(environment.contains_key("TERMEXO_ANTIGRAVITY_EVENT_FILE"));

        drop(database);
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn restores_opencode_proxy_and_terminal_plugin() {
        let directory = std::env::temp_dir().join(format!(
            "termexo-opencode-relaunch-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let database = WorkspaceDatabase::open(directory.join("termexo.db")).unwrap();
        let hooks = HookEventStore::new(&directory).unwrap();
        // Exercise restoration against a controlled CLI rather than a developer's installation.
        let executable = directory.join(if cfg!(windows) {
            "opencode.cmd"
        } else {
            "opencode"
        });
        std::fs::write(
            &executable,
            if cfg!(windows) {
                "@echo off\r\necho 2.0.0\r\n"
            } else {
                "#!/bin/sh\necho 2.0.0\n"
            },
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let adapter = OpenCodeAdapter::with_executable(executable);
        database
            .save_network_profile(&NetworkProfile {
                id: "proxy".into(),
                name: "proxy".into(),
                scope: "global".into(),
                workspace_id: None,
                enabled: true,
                is_default: true,
                http_proxy: None,
                https_proxy: Some("http://127.0.0.1:7890".into()),
                all_proxy: None,
                no_proxy: Some("internal.example".into()),
                npm_registry: None,
                npm_proxy: None,
                npm_https_proxy: None,
                npm_strict_ssl: true,
                npm_ca_path: None,
                proxy_username: None,
                credential_target: None,
                has_credential: false,
            })
            .unwrap();

        let environment = relaunch_environment_with_opencode_adapter(
            &database,
            &CredentialStore,
            &hooks,
            &RelaunchRequest {
                terminal_id: "terminal-1",
                agent_type: "opencode",
                native_session_id: Some("ses_123"),
                account_profile_id: None,
                model_profile_id: None,
                workspace_id: Some("workspace-1"),
            },
            &adapter,
        )
        .unwrap();

        assert_eq!(
            environment.get("HTTPS_PROXY").map(String::as_str),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            environment.get("NO_PROXY").map(String::as_str),
            Some("internal.example,localhost,127.0.0.1,::1")
        );
        if crate::network::should_emit_lowercase_proxy_vars() {
            assert_eq!(environment.get("no_proxy"), environment.get("NO_PROXY"));
        } else {
            assert!(!environment.contains_key("no_proxy"));
        }
        let config: serde_json::Value =
            serde_json::from_str(environment.get("OPENCODE_CONFIG_CONTENT").unwrap()).unwrap();
        let plugin_path = if config.get("plugins").is_some() {
            directory
                .join("runtime")
                .join("opencode-terminal-1.plugin")
                .join("index.js")
        } else {
            directory
                .join("runtime")
                .join("opencode-terminal-1.plugin.js")
        };
        let plugin = std::fs::read_to_string(plugin_path);
        assert!(plugin.is_ok());
        assert!(plugin.unwrap().contains("ses_123"));
        database
            .write_app_setting("one_ring.worker.v1.terminal-1", "implementer")
            .unwrap();
        database
            .write_app_setting(
                "one_ring.opencode_worker.v1.terminal-1",
                &serde_json::to_string(&OpenCodeWorkerContext {
                    model: "provider/approved-model".into(),
                    instructions_path: directory
                        .join("instructions.md")
                        .to_string_lossy()
                        .into_owned(),
                })
                .unwrap(),
            )
            .unwrap();
        let restored_worker = relaunch_environment_with_opencode_adapter(
            &database,
            &CredentialStore,
            &hooks,
            &RelaunchRequest {
                terminal_id: "terminal-1",
                agent_type: "opencode",
                native_session_id: Some("ses_123"),
                account_profile_id: None,
                model_profile_id: None,
                workspace_id: Some("workspace-1"),
            },
            &adapter,
        )
        .unwrap();
        let restored: Value =
            serde_json::from_str(restored_worker.get("OPENCODE_CONFIG_CONTENT").unwrap()).unwrap();
        assert_eq!(restored["model"], "provider/approved-model");
        assert_eq!(restored["permission"]["task"], "deny");
        assert_eq!(restored["permission"]["*"], "deny");
        drop(database);
        std::fs::remove_dir_all(&directory).ok();
    }
}
