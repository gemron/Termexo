use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::account;
use crate::agent::{
    AgentAdapter, AgentInstallation, AgentLaunchSpec, AgentSession, ClaudeCodeAdapter,
    ClaudeLaunchOptions, CodexCliAdapter, CodexLaunchOptions,
};
use crate::config::{AgentProtocol, CredentialStore, LaunchEnvironmentStore, ModelProfile};
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

#[tauri::command]
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
pub fn list_agent_sessions(
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentSession>, String> {
    database
        .list_agent_sessions()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn build_claude_launch_command(
    options: ClaudeLaunchOptions,
) -> Result<AgentLaunchSpec, String> {
    ClaudeCodeAdapter::new()
        .build_launch_command(&options)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn build_codex_launch_command(options: CodexLaunchOptions) -> Result<AgentLaunchSpec, String> {
    CodexCliAdapter::new()
        .build_launch_command(&options)
        .map_err(|error| error.to_string())
}

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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareCodexLaunchRequest {
    pub terminal_id: String,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub profile_id: Option<String>,
    pub account_profile_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareAccountLoginRequest {
    pub terminal_id: String,
    pub workspace_id: Option<String>,
    pub account_profile_id: String,
}

#[tauri::command]
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
    let mut environment =
        account_profile_environment(&database, request.account_profile_id.as_deref(), "claude")?;
    environment.extend(claude_profile_environment(profile.as_ref()));
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
            model: profile.map(|profile| profile.claude_model),
            settings_path: Some(runtime.settings_path),
            mcp_config_path,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn prepare_codex_launch(
    request: PrepareCodexLaunchRequest,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
    hooks: State<'_, HookEventStore>,
) -> Result<AgentLaunchSpec, String> {
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
    let notify_config = hooks
        .codex_notify_config(&request.terminal_id)
        .map_err(|error| error.to_string())?;
    let hook_configs = hooks
        .codex_hook_configs()
        .map_err(|error| error.to_string())?;
    let effective_model = request
        .model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| profile.as_ref().map(|profile| profile.codex_model.clone()));
    let mut provider_configs = codex_provider_configs(profile.as_ref())?;
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
    log_proxy_environment(&environment);
    launch_environment
        .put(request.terminal_id.clone(), environment)
        .map_err(|error| error.to_string())?;
    CodexCliAdapter::new()
        .build_launch_command(&CodexLaunchOptions {
            session_id: request.session_id,
            model: effective_model,
            notify_config: Some(notify_config),
            hook_configs,
            provider_configs,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
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

/// Claude reads its provider from the environment, so the profile becomes env vars.
fn claude_profile_environment(profile: Option<&ModelProfile>) -> HashMap<String, String> {
    let Some(profile) = profile else {
        return HashMap::new();
    };
    let Some((model, base_url)) = profile.endpoint(AgentProtocol::Anthropic) else {
        return HashMap::new();
    };
    anthropic_profile_environment(profile, model, base_url)
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
        }
    }

    #[test]
    fn maps_anthropic_compatible_profile_to_claude_environment() {
        let profile = ModelProfile {
            claude_model: "deepseek-v4-pro[1m]".into(),
            claude_base_url: Some("https://api.deepseek.com/anthropic".into()),
            ..profile("deepseek", "DeepSeek")
        };

        let environment = claude_profile_environment(Some(&profile));

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

        assert!(claude_profile_environment(Some(&profile)).is_empty());
    }

    #[test]
    fn maps_minimax_profile_to_current_claude_compatibility_environment() {
        let profile = ModelProfile {
            claude_model: "MiniMax-M3".into(),
            claude_base_url: Some("https://api.minimaxi.com/anthropic".into()),
            ..profile("minimax", "MiniMax")
        };

        let environment = claude_profile_environment(Some(&profile));

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

        let claude = claude_profile_environment(Some(&profile));
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
        assert!(!claude_profile_environment(Some(&profile)).is_empty());
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
}
