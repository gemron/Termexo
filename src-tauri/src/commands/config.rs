use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

use crate::account;
use crate::agent::{AgentAdapter, AgentLaunchSpec, ClaudeCodeAdapter, ClaudeLaunchOptions};
use crate::config::{
    AccountProfile, AccountProfileInput, CredentialStore, McpProfile, McpProfileInput,
    ModelProfile, ModelProfileInput, NetworkProfile, NetworkProfileInput,
};
use crate::database::WorkspaceDatabase;
use crate::network::{self, NetworkTestResult};

#[tauri::command]
pub fn list_model_profiles(
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
) -> Result<Vec<ModelProfile>, String> {
    let mut profiles = database
        .list_model_profiles()
        .map_err(|error| error.to_string())?;
    for profile in &mut profiles {
        profile.has_credential = match profile.credential_target.as_deref() {
            Some(target) => credentials
                .contains(target)
                .map_err(|error| error.to_string())?,
            None => false,
        };
    }
    Ok(profiles)
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
    let preserved_credential_target = match existing
        .as_ref()
        .and_then(|profile| profile.credential_target.as_deref())
    {
        Some(target)
            if credentials
                .contains(target)
                .map_err(|error| error.to_string())? =>
        {
            Some(target.to_owned())
        }
        _ => None,
    };
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
            _ => preserved_credential_target,
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
    if profile.base_url.is_some() && !profile.has_credential {
        return Err(format!(
            "模型 Profile「{}」使用第三方 Endpoint，必须输入并保存 API Key。",
            profile.name
        ));
    }
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
pub fn list_account_profiles(
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AccountProfile>, String> {
    let mut profiles = database
        .list_account_profiles()
        .map_err(|error| error.to_string())?;
    for profile in &mut profiles {
        profile.diagnostic = "正在后台检测登录状态…".into();
    }
    Ok(profiles)
}

#[tauri::command]
pub async fn save_account_profile(
    input: AccountProfileInput,
    app: AppHandle,
    database: State<'_, WorkspaceDatabase>,
) -> Result<AccountProfile, String> {
    let requested_agent_type = account::validate_agent_type(&input.agent_type)?.to_owned();
    let profile_id = account::validate_profile_id(&input.id)?.to_owned();
    let name = input.name.trim().to_owned();
    if name.is_empty() {
        return Err("账号名称不能为空。".into());
    }
    let existing = database
        .find_account_profile(&profile_id)
        .map_err(|error| error.to_string())?;
    let is_system = existing.as_ref().is_some_and(|profile| profile.is_system);
    let agent_type = existing
        .as_ref()
        .filter(|profile| profile.is_system)
        .map(|profile| profile.agent_type.clone())
        .unwrap_or(requested_agent_type);
    let config_dir = if is_system {
        None
    } else {
        Some(
            account::managed_config_dir(
                &app.path().app_data_dir().map_err(|e| e.to_string())?,
                &agent_type,
                &profile_id,
            )?
            .to_string_lossy()
            .into_owned(),
        )
    };
    let mut profile = AccountProfile {
        id: profile_id,
        name,
        agent_type,
        config_dir,
        is_default: input.is_default,
        is_system,
        authenticated: false,
        diagnostic: String::new(),
    };
    account::prepare_managed_directory(&profile)?;
    database
        .save_account_profile(&profile)
        .map_err(|error| error.to_string())?;
    profile = tauri::async_runtime::spawn_blocking(move || account::refresh_status(profile))
        .await
        .map_err(|error| error.to_string())?;
    Ok(profile)
}

#[tauri::command]
pub async fn refresh_account_profile(
    profile_id: String,
    database: State<'_, WorkspaceDatabase>,
) -> Result<AccountProfile, String> {
    let profile = database
        .find_account_profile(&profile_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "账号 Profile 不存在。".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || account::refresh_status(profile))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_account_profile(
    profile_id: String,
    database: State<'_, WorkspaceDatabase>,
) -> Result<(), String> {
    let profile = database
        .find_account_profile(&profile_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "账号 Profile 不存在。".to_owned())?;
    if profile.is_system {
        return Err("系统账号不能删除。".into());
    }
    database
        .delete_account_profile(&profile_id)
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
        if credentials
            .get_optional(&target)
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Err(format!(
                "模型 Profile「{}」的 API Key 不存在或已失效，请重新输入并保存。",
                profile.name
            ));
        }
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
