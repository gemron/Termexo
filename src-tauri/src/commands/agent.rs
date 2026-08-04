use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;
use tauri::State;

use crate::account;
use crate::agent::{
    AgentAdapter, AgentInstallation, AgentLaunchSpec, AgentSession, ClaudeCodeAdapter,
    ClaudeLaunchOptions, CodexCliAdapter, CodexLaunchOptions,
};
use crate::config::{CredentialStore, LaunchEnvironmentStore, ModelProfile};
use crate::database::WorkspaceDatabase;
use crate::hooks::HookEventStore;
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
    let profile = request
        .profile_id
        .as_deref()
        .and_then(|profile_id| profiles.iter().find(|profile| profile.id == profile_id))
        .or_else(|| profiles.iter().find(|profile| profile.is_default))
        .cloned();
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
    environment.extend(profile_environment(profile.as_ref()));
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
            model: profile.map(|profile| profile.model),
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
    let profile = request
        .profile_id
        .as_deref()
        .and_then(|profile_id| profiles.iter().find(|profile| profile.id == profile_id))
        .or_else(|| profiles.iter().find(|profile| profile.is_default && profile.api_protocol == "openai"))
        .cloned();
    let mut environment =
        account_profile_environment(&database, request.account_profile_id.as_deref(), "codex")?;
    environment.extend(profile_environment(profile.as_ref()));
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
    launch_environment
        .put(request.terminal_id.clone(), environment)
        .map_err(|error| error.to_string())?;
    let effective_model = request
        .model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            profile
                .as_ref()
                .map(|profile| profile.model.clone())
        });
    CodexCliAdapter::new()
        .build_launch_command(&CodexLaunchOptions {
            session_id: request.session_id,
            model: effective_model,
            notify_config: Some(notify_config),
            hook_configs,
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

fn network_environment(
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

fn profile_environment(profile: Option<&ModelProfile>) -> HashMap<String, String> {
    let Some(profile) = profile else {
        return HashMap::new();
    };
    match profile.api_protocol.as_str() {
        "openai" => openai_profile_environment(profile),
        _ => anthropic_profile_environment(profile),
    }
}

fn anthropic_profile_environment(profile: &ModelProfile) -> HashMap<String, String> {
    let mut environment = HashMap::new();
    let Some(base_url) = profile
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return environment;
    };

    environment.insert("ANTHROPIC_BASE_URL".into(), base_url.into());
    environment.insert("API_TIMEOUT_MS".into(), "3000000".into());
    environment.insert(
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".into(),
        "1".into(),
    );

    let model = profile.model.trim();
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

fn openai_profile_environment(profile: &ModelProfile) -> HashMap<String, String> {
    let mut environment = HashMap::new();
    let Some(base_url) = profile
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return environment;
    };

    environment.insert("OPENAI_BASE_URL".into(), base_url.into());
    environment.insert("API_TIMEOUT_MS".into(), "3000000".into());

    let model = profile.model.trim();
    if !model.is_empty() {
        environment.insert("OPENAI_MODEL".into(), model.into());
    }
    environment
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_anthropic_compatible_profile_to_claude_environment() {
        let profile = ModelProfile {
            id: "deepseek".into(),
            name: "DeepSeek V4 Pro".into(),
            provider: "DeepSeek".into(),
            model: "deepseek-v4-pro[1m]".into(),
            base_url: Some("https://api.deepseek.com/anthropic".into()),
            credential_target: Some("profile:deepseek".into()),
            api_protocol: "anthropic".into(),
            is_default: false,
            has_credential: true,
        };

        let environment = profile_environment(Some(&profile));

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
            id: "claude-default".into(),
            name: "Claude Sonnet".into(),
            provider: "Anthropic".into(),
            model: "sonnet".into(),
            base_url: None,
            credential_target: None,
            api_protocol: "anthropic".into(),
            is_default: true,
            has_credential: false,
        };

        assert!(profile_environment(Some(&profile)).is_empty());
    }

    #[test]
    fn maps_minimax_profile_to_current_claude_compatibility_environment() {
        let profile = ModelProfile {
            id: "minimax".into(),
            name: "MiniMax M3".into(),
            provider: "MiniMax".into(),
            model: "MiniMax-M3".into(),
            base_url: Some("https://api.minimaxi.com/anthropic".into()),
            credential_target: Some("profile:minimax".into()),
            api_protocol: "anthropic".into(),
            is_default: false,
            has_credential: true,
        };

        let environment = profile_environment(Some(&profile));

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
    fn maps_openai_compatible_profile_to_codex_environment() {
        let profile = ModelProfile {
            id: "openai-codex".into(),
            name: "GPT-5.6 Sol".into(),
            provider: "OpenAI".into(),
            model: "gpt-5.6-sol".into(),
            base_url: Some("https://api.openai.com/v1".into()),
            credential_target: Some("profile:openai-codex".into()),
            api_protocol: "openai".into(),
            is_default: true,
            has_credential: true,
        };

        let environment = profile_environment(Some(&profile));

        assert_eq!(
            environment.get("OPENAI_BASE_URL").map(String::as_str),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(
            environment.get("OPENAI_MODEL").map(String::as_str),
            Some("gpt-5.6-sol")
        );
        assert_eq!(
            environment.get("API_TIMEOUT_MS").map(String::as_str),
            Some("3000000")
        );
        assert!(environment.get("ANTHROPIC_BASE_URL").is_none());
        assert!(environment.get("ANTHROPIC_MODEL").is_none());
    }

    #[test]
    fn leaves_official_openai_environment_untouched() {
        let profile = ModelProfile {
            id: "codex-default".into(),
            name: "GPT-5.6 Sol".into(),
            provider: "OpenAI".into(),
            model: "gpt-5.6-sol".into(),
            base_url: None,
            credential_target: None,
            api_protocol: "openai".into(),
            is_default: true,
            has_credential: false,
        };

        assert!(profile_environment(Some(&profile)).is_empty());
    }
}
