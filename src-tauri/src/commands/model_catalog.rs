use std::collections::BTreeMap;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

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
            std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .map(|home| std::path::PathBuf::from(home).join(".codex"))
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
}
