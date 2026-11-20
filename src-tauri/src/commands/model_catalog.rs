use std::collections::{BTreeMap, HashSet};
use std::time::Duration;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::commands::agent::network_environment;
use crate::config::CredentialStore;
use crate::database::WorkspaceDatabase;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModel {
    provider: String,
    id: String,
    name: String,
    family: String,
    release_date: String,
    retired: bool,
    upgrade_to: Option<String>,
}

#[derive(Serialize)]
pub struct ModelCatalog {
    models: Vec<CatalogModel>,
    warning: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchProviderModelsRequest {
    pub protocol: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub profile_id: Option<String>,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderApiModel {
    pub id: String,
    pub name: String,
}

const MAX_PROVIDER_MODELS_BODY: usize = 8 * 1024 * 1024;
const PROVIDER_MODELS_TIMEOUT: Duration = Duration::from_secs(15);
const ANTHROPIC_DEFAULT_MODELS_URL: &str = "https://api.anthropic.com/v1/models";
const OPENAI_DEFAULT_MODELS_URL: &str = "https://api.openai.com/v1/models";
const ANTHROPIC_API_VERSION: &str = "2023-06-01";

const PROVIDERS: &[(&str, &str)] = &[
    ("anthropic", "Anthropic"),
    ("openai", "OpenAI"),
    ("deepseek", "DeepSeek"),
    ("minimax", "MiniMax"),
    ("zhipuai", "GLM"),
    ("moonshotai", "Kimi"),
];

/// Public model metadata only. Neither API keys nor account credentials are sent to the catalog.
#[tauri::command]
pub async fn read_model_catalog() -> ModelCatalog {
    let result = fetch_catalog().await;
    let (mut models, warning) = match result {
        Ok(models) => (models, None),
        Err(error) => (Vec::new(), Some(error)),
    };
    let home = std::env::var_os("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            crate::platform::home_dir().map(|home| home.join(".codex"))
        });
    if let Some(home) = home {
        let path = home.join("models_cache.json");
        if std::fs::metadata(&path).is_ok_and(|meta| meta.len() < 16 * 1024 * 1024) {
            if let Ok(body) = std::fs::read(path) {
                if let Ok(cache) = serde_json::from_slice(&body) {
                    merge_codex_cache(&mut models, &cache);
                }
            }
        }
    }
    ModelCatalog { models, warning }
}

async fn fetch_catalog() -> Result<Vec<CatalogModel>, String> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .get("https://models.dev/api.json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    if response
        .content_length()
        .is_some_and(|length| length > 16 * 1024 * 1024)
    {
        return Err("Model catalog exceeds size limit".into());
    }
    let body = response.bytes().await.map_err(|error| error.to_string())?;
    if body.len() > 16 * 1024 * 1024 {
        return Err("Model catalog exceeds size limit".into());
    }
    let value = serde_json::from_slice(&body).map_err(|error| error.to_string())?;
    let models = parse_catalog(&value);
    if models.is_empty() {
        return Err("Model catalog contains no supported models".into());
    }
    Ok(models)
}

fn parse_catalog(value: &Value) -> Vec<CatalogModel> {
    let mut result = Vec::new();
    for (key, provider) in PROVIDERS {
        let Some(models) = value
            .get(*key)
            .and_then(|v| v.get("models"))
            .and_then(Value::as_object)
        else {
            continue;
        };
        for model in models.values() {
            if model.get("tool_call").and_then(Value::as_bool) != Some(true)
                || model
                    .get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| id.contains("realtime"))
            {
                continue;
            }
            let Some(id) = model
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| valid_model_id(id))
            else {
                continue;
            };
            result.push(CatalogModel {
                provider: (*provider).into(),
                id: id.into(),
                name: model
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
                    .into(),
                family: model
                    .get("family")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .into(),
                release_date: model
                    .get("release_date")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .into(),
                retired: model
                    .get("status")
                    .and_then(Value::as_str)
                    .is_some_and(|s| matches!(s, "deprecated" | "alpha" | "beta")),
                upgrade_to: None,
            });
        }
    }
    result
}

fn valid_model_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-:/".contains(c))
}

fn merge_codex_cache(models: &mut Vec<CatalogModel>, cache: &Value) {
    let Some(entries) = cache.get("models").and_then(Value::as_array) else {
        return;
    };
    let mut known: BTreeMap<String, usize> = models
        .iter()
        .enumerate()
        .filter(|(_, model)| model.provider == "OpenAI")
        .map(|(i, model)| (model.id.clone(), i))
        .collect();
    for entry in entries {
        if entry.get("visibility").and_then(Value::as_str) != Some("list") {
            continue;
        }
        let Some(id) = entry
            .get("slug")
            .and_then(Value::as_str)
            .filter(|id| valid_model_id(id))
        else {
            continue;
        };
        let upgrade = entry
            .get("upgrade")
            .and_then(|value| value.get("model"))
            .and_then(Value::as_str)
            .filter(|id| valid_model_id(id))
            .map(str::to_owned);
        if let Some(index) = known.get(id) {
            models[*index].upgrade_to = upgrade;
        } else {
            known.insert(id.into(), models.len());
            models.push(CatalogModel {
                provider: "OpenAI".into(),
                id: id.into(),
                name: entry
                    .get("display_name")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
                    .into(),
                family: String::new(),
                release_date: String::new(),
                retired: false,
                upgrade_to: upgrade,
            });
        }
    }
}

/// Fetches available models directly from a provider's `/v1/models` (or `/models`) endpoint.
///
/// Accepts either an unsaved API key from the editor form or looks up the saved credential for
/// `profile_id` directly in the OS keyring so secrets never round-trip through the frontend.
#[tauri::command]
pub async fn fetch_provider_models(
    request: FetchProviderModelsRequest,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
) -> Result<Vec<ProviderApiModel>, String> {
    let protocol = normalize_protocol(&request.protocol)?;
    let api_key = resolve_provider_api_key(
        request.api_key.as_deref(),
        request.profile_id.as_deref(),
        &database,
        &credentials,
    )?;
    let urls = provider_models_urls(protocol, request.base_url.as_deref())?;
    let proxy = network_environment(&database, &credentials, request.workspace_id.as_deref())
        .ok()
        .and_then(|env| {
            env.get("HTTPS_PROXY")
                .or_else(|| env.get("HTTP_PROXY"))
                .or_else(|| env.get("ALL_PROXY"))
                .cloned()
        });
    let client = build_provider_client(proxy.as_deref())?;
    let is_custom_host = request
        .base_url
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());

    let mut last_error = String::new();
    for (index, url) in urls.iter().enumerate() {
        let mut response = send_models_request(&client, url, protocol, &api_key, false).await?;
        // Some third-party Anthropic-compatible proxies accept Bearer tokens instead of x-api-key.
        if protocol == "anthropic"
            && is_custom_host
            && matches!(
                response.status(),
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
            )
        {
            response = send_models_request(&client, url, protocol, &api_key, true).await?;
        }
        let status = response.status();
        if status.is_success() {
            if response
                .content_length()
                .is_some_and(|length| length as usize > MAX_PROVIDER_MODELS_BODY)
            {
                return Err("供应商返回的模型列表过大。".into());
            }
            let body = response
                .bytes()
                .await
                .map_err(|error| format!("读取模型列表响应失败：{error}"))?;
            if body.len() > MAX_PROVIDER_MODELS_BODY {
                return Err("供应商返回的模型列表过大。".into());
            }
            let value: Value = serde_json::from_slice(&body)
                .map_err(|error| format!("解析模型列表 JSON 失败：{error}"))?;
            let models = parse_provider_models(&value);
            if models.is_empty() {
                return Err("供应商未返回任何可用模型。".into());
            }
            return Ok(models);
        }
        last_error = format!("拉取模型列表失败（HTTP {}）", status.as_u16());
        let try_fallback =
            index + 1 < urls.len() && matches!(status, StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED);
        if !try_fallback {
            return Err(last_error);
        }
    }
    Err(if last_error.is_empty() {
        "拉取模型列表失败。".into()
    } else {
        last_error
    })
}

fn normalize_protocol(protocol: &str) -> Result<&'static str, String> {
    match protocol.trim().to_ascii_lowercase().as_str() {
        "anthropic" | "claude" => Ok("anthropic"),
        "openai" | "codex" => Ok("openai"),
        _ => Err("不支持的模型接口协议，仅支持 Anthropic 或 OpenAI 兼容接口。".into()),
    }
}

fn resolve_provider_api_key(
    inline_key: Option<&str>,
    profile_id: Option<&str>,
    database: &WorkspaceDatabase,
    credentials: &CredentialStore,
) -> Result<String, String> {
    if let Some(key) = inline_key.map(str::trim).filter(|key| !key.is_empty()) {
        return Ok(key.to_owned());
    }
    if let Some(profile_id) = profile_id.map(str::trim).filter(|id| !id.is_empty()) {
        if let Some(profile) = database
            .find_model_profile(profile_id)
            .map_err(|error| error.to_string())?
        {
            if let Some(target) = profile.credential_target.as_deref() {
                if let Some(secret) = credentials
                    .get_optional(target)
                    .map_err(|error| error.to_string())?
                    .filter(|secret| !secret.trim().is_empty())
                {
                    return Ok(secret);
                }
            }
        }
    }
    Err("请先输入或保存 API Key 后再拉取模型列表。".into())
}

fn provider_models_urls(protocol: &str, base_url: Option<&str>) -> Result<Vec<String>, String> {
    let trimmed = base_url.map(str::trim).unwrap_or("");
    if trimmed.is_empty() {
        return Ok(vec![match protocol {
            "anthropic" => ANTHROPIC_DEFAULT_MODELS_URL.to_owned(),
            _ => OPENAI_DEFAULT_MODELS_URL.to_owned(),
        }]);
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("Endpoint 地址必须以 http:// 或 https:// 开头。".into());
    }
    let normalized = trimmed.trim_end_matches('/');
    if normalized.ends_with("/models") {
        return Ok(vec![normalized.to_owned()]);
    }
    let last_segment = normalized.rsplit('/').next().unwrap_or("");
    let ends_with_version = last_segment.starts_with('v')
        && last_segment.len() >= 2
        && last_segment.as_bytes()[1].is_ascii_digit();
    if ends_with_version {
        Ok(vec![format!("{normalized}/models")])
    } else {
        Ok(vec![
            format!("{normalized}/v1/models"),
            format!("{normalized}/models"),
        ])
    }
}

fn build_provider_client(proxy: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(PROVIDER_MODELS_TIMEOUT);
    if let Some(proxy) = proxy {
        let proxy =
            reqwest::Proxy::all(proxy).map_err(|error| format!("代理配置无效：{error}"))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|error| format!("无法初始化网络请求：{error}"))
}

async fn send_models_request(
    client: &reqwest::Client,
    url: &str,
    protocol: &str,
    api_key: &str,
    bearer_override: bool,
) -> Result<reqwest::Response, String> {
    let mut req = client.get(url).header(reqwest::header::ACCEPT, "application/json");
    if protocol == "anthropic" && !bearer_override {
        req = req
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION);
    } else {
        req = req.bearer_auth(api_key);
        if protocol == "anthropic" {
            req = req.header("anthropic-version", ANTHROPIC_API_VERSION);
        }
    }
    req.send()
        .await
        .map_err(|error| format!("无法连接模型接口：{error}"))
}

fn parse_provider_models(value: &Value) -> Vec<ProviderApiModel> {
    let items = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array))
        .or_else(|| value.as_array());
    let Some(items) = items else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    let mut models = Vec::new();
    for item in items {
        let raw_id = item
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| item.as_str())
            .map(str::trim);
        let Some(id) = raw_id.filter(|id| valid_model_id(id)) else {
            continue;
        };
        if !seen.insert(id.to_owned()) {
            continue;
        }
        let name = item
            .get("display_name")
            .or_else(|| item.get("displayName"))
            .or_else(|| item.get("name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(id);
        models.push(ProviderApiModel {
            id: id.to_owned(),
            name: name.to_owned(),
        });
    }
    models
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_coding_models_and_metadata_but_rejects_unknown_providers_and_commands() {
        let models = parse_catalog(&json!({"anthropic":{"models":{
            "old":{"id":"claude-sonnet-4-6","tool_call":true,"family":"claude-sonnet","release_date":"2026-02-17","status":"deprecated"},
            "new":{"id":"claude-sonnet-5","name":"Sonnet 5","tool_call":true,"family":"claude-sonnet","release_date":"2026-09-01"},
            "invalid":{"id":"bad; command","tool_call":true}, "image":{"id":"image-only","tool_call":false}
        }}, "unknown":{"models":{"m":{"id":"x","tool_call":true}}}}));
        assert_eq!(models.len(), 2);
        assert!(models.iter().any(|model| model.retired));
        assert!(models.iter().all(|model| model.provider == "Anthropic"));
    }

    #[test]
    fn merges_visible_codex_models_and_official_upgrade_without_exposing_other_fields() {
        let mut models = parse_catalog(
            &json!({"openai":{"models":{"old":{"id":"old","tool_call":true,"family":"gpt-sol","release_date":"2026-01-01"}}}}),
        );
        merge_codex_cache(
            &mut models,
            &json!({"models":[
                {"slug":"old","visibility":"list","upgrade":{"model":"new"}},
                {"slug":"new","display_name":"New","visibility":"list"},
                {"slug":"hidden","visibility":"hide"}
            ]}),
        );
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].upgrade_to.as_deref(), Some("new"));
        assert_eq!(models[0].family, "gpt-sol");
    }

    #[test]
    fn builds_provider_models_urls_for_official_versioned_and_custom_hosts() {
        assert_eq!(
            provider_models_urls("anthropic", None).unwrap(),
            vec!["https://api.anthropic.com/v1/models"]
        );
        assert_eq!(
            provider_models_urls("openai", Some("   ")).unwrap(),
            vec!["https://api.openai.com/v1/models"]
        );
        assert_eq!(
            provider_models_urls("openai", Some("https://api.deepseek.com/v1/")).unwrap(),
            vec!["https://api.deepseek.com/v1/models"]
        );
        assert_eq!(
            provider_models_urls("openai", Some("https://open.bigmodel.cn/api/paas/v4")).unwrap(),
            vec!["https://open.bigmodel.cn/api/paas/v4/models"]
        );
        assert_eq!(
            provider_models_urls("anthropic", Some("https://api.deepseek.com/anthropic")).unwrap(),
            vec![
                "https://api.deepseek.com/anthropic/v1/models",
                "https://api.deepseek.com/anthropic/models",
            ]
        );
        assert!(provider_models_urls("openai", Some("ftp://invalid.local")).is_err());
    }

    #[test]
    fn parses_openai_and_anthropic_models_payloads_and_deduplicates() {
        let openai = parse_provider_models(&json!({
            "object": "list",
            "data": [
                { "id": "deepseek-chat" },
                { "id": "deepseek-reasoner", "display_name": "DeepSeek Reasoner" },
                { "id": "deepseek-chat" },
                { "id": "bad; shell" }
            ]
        }));
        assert_eq!(
            openai,
            vec![
                ProviderApiModel {
                    id: "deepseek-chat".into(),
                    name: "deepseek-chat".into(),
                },
                ProviderApiModel {
                    id: "deepseek-reasoner".into(),
                    name: "DeepSeek Reasoner".into(),
                },
            ]
        );
    }
}
