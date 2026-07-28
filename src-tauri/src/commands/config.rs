use serde::Deserialize;
use tauri::State;

use crate::agent::{AgentAdapter, AgentLaunchSpec, ClaudeCodeAdapter, ClaudeLaunchOptions};
use crate::config::{
    CredentialStore, McpProfile, McpProfileInput, ModelProfile, ModelProfileInput, NetworkProfile,
    NetworkProfileInput,
};
use crate::database::WorkspaceDatabase;
use crate::network::{self, NetworkTestResult};

#[tauri::command]
pub fn list_model_profiles(
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<ModelProfile>, String> {
    database
        .list_model_profiles()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_model_profile(
    input: ModelProfileInput,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
) -> Result<ModelProfile, String> {
    let existing = database
        .find_model_profile(&input.id)
        .map_err(|error| error.to_string())?;
    let credential_target = if input.clear_credential {
        if let Some(target) = existing
            .as_ref()
            .and_then(|profile| profile.credential_target.as_deref())
        {
            credentials.delete(target);
        }
        None
    } else {
        match input.api_key.as_deref().map(str::trim) {
            Some(api_key) if !api_key.is_empty() => {
                let target = format!("model-profile:{}", input.id);
                credentials
                    .set(&target, api_key)
                    .map_err(|error| error.to_string())?;
                Some(target)
            }
            _ => existing.and_then(|profile| profile.credential_target),
        }
    };
    let profile = ModelProfile {
        id: input.id,
        name: input.name.trim().to_owned(),
        provider: input.provider.trim().to_owned(),
        model: input.model.trim().to_owned(),
        base_url: input
            .base_url
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
        has_credential: credential_target.is_some(),
        credential_target,
        is_default: input.is_default,
    };
    database
        .save_model_profile(&profile)
        .map_err(|error| error.to_string())?;
    Ok(profile)
}

#[tauri::command]
pub fn delete_model_profile(
    profile_id: String,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
) -> Result<(), String> {
    if let Some(profile) = database
        .find_model_profile(&profile_id)
        .map_err(|error| error.to_string())?
    {
        if let Some(target) = profile.credential_target {
            credentials.delete(&target);
        }
    }
    database
        .delete_model_profile(&profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_mcp_profiles(
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<McpProfile>, String> {
    database
        .list_mcp_profiles()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_mcp_profile(
    input: McpProfileInput,
    database: State<'_, WorkspaceDatabase>,
) -> Result<McpProfile, String> {
    let parsed = serde_json::from_str::<serde_json::Value>(&input.config_json)
        .map_err(|error| format!("MCP 配置不是有效 JSON：{error}"))?;
    if !parsed.is_object() {
        return Err("MCP 配置必须是 JSON 对象".into());
    }
    let profile = McpProfile {
        id: input.id,
        name: input.name.trim().to_owned(),
        config_json: serde_json::to_string_pretty(&parsed).map_err(|error| error.to_string())?,
    };
    database
        .save_mcp_profile(&profile)
        .map_err(|error| error.to_string())?;
    Ok(profile)
}

#[tauri::command]
pub fn delete_mcp_profile(
    profile_id: String,
    database: State<'_, WorkspaceDatabase>,
) -> Result<(), String> {
    database
        .delete_mcp_profile(&profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_network_profiles(
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<NetworkProfile>, String> {
    database
        .list_network_profiles()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_network_profile(
    input: NetworkProfileInput,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
) -> Result<NetworkProfile, String> {
    let existing = database
        .find_network_profile(&input.id)
        .map_err(|error| error.to_string())?;
    let proxy_username = optional_trim(input.proxy_username);
    let credential_target = if input.clear_credential || proxy_username.is_none() {
        if let Some(target) = existing
            .as_ref()
            .and_then(|profile| profile.credential_target.as_deref())
        {
            credentials.delete(target);
        }
        None
    } else {
        match input.proxy_password.as_deref().map(str::trim) {
            Some(password) if !password.is_empty() => {
                let target = format!("network-profile:{}", input.id);
                credentials
                    .set(&target, password)
                    .map_err(|error| error.to_string())?;
                Some(target)
            }
            _ => existing.and_then(|profile| profile.credential_target),
        }
    };
    let scope = input.scope.trim().to_owned();
    let profile = NetworkProfile {
        id: input.id,
        name: input.name.trim().to_owned(),
        workspace_id: (scope == "workspace")
            .then(|| optional_trim(input.workspace_id))
            .flatten(),
        scope,
        enabled: input.enabled,
        is_default: input.is_default,
        http_proxy: optional_trim(input.http_proxy),
        https_proxy: optional_trim(input.https_proxy),
        all_proxy: optional_trim(input.all_proxy),
        no_proxy: optional_trim(input.no_proxy),
        npm_registry: optional_trim(input.npm_registry),
        npm_proxy: optional_trim(input.npm_proxy),
        npm_https_proxy: optional_trim(input.npm_https_proxy),
        npm_strict_ssl: input.npm_strict_ssl,
        npm_ca_path: optional_trim(input.npm_ca_path),
        proxy_username,
        has_credential: credential_target.is_some(),
        credential_target,
    };
    network::validate_profile(&profile)?;
    if profile.has_credential && profile.proxy_username.is_none() {
        return Err("代理密码存在时必须填写用户名".into());
    }
    database
        .save_network_profile(&profile)
        .map_err(|error| error.to_string())?;
    Ok(profile)
}

#[tauri::command]
pub fn delete_network_profile(
    profile_id: String,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
) -> Result<(), String> {
    if let Some(profile) = database
        .find_network_profile(&profile_id)
        .map_err(|error| error.to_string())?
    {
        if let Some(target) = profile.credential_target {
            credentials.delete(&target);
        }
    }
    database
        .delete_network_profile(&profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn test_network_profile(
    profile_id: String,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
) -> Result<NetworkTestResult, String> {
    let profile = database
        .find_network_profile(&profile_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "代理 Profile 不存在".to_owned())?;
    let password = profile
        .credential_target
        .as_deref()
        .map(|target| credentials.get(target))
        .transpose()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        network::test_profile(&profile, password.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn optional_trim(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateClaudeProfileRequest {
    pub profile_id: String,
}

#[tauri::command]
pub fn validate_claude_profile(
    request: ValidateClaudeProfileRequest,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
) -> Result<(), String> {
    let profile = database
        .find_model_profile(&request.profile_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "模型 Profile 不存在".to_owned())?;
    if let Some(target) = profile.credential_target {
        credentials
            .get(&target)
            .map(|_| ())
            .map_err(|error| error.to_string())?;
    }
    ClaudeCodeAdapter::new()
        .build_launch_command(&ClaudeLaunchOptions {
            session_id: None,
            name: None,
            model: Some(profile.model),
            settings_path: None,
            mcp_config_path: None,
        })
        .map(|_: AgentLaunchSpec| ())
        .map_err(|error| error.to_string())
}
