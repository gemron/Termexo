//! Antigravity's saved login can query the same quota summary as `/usage` over HTTP.
//! Nothing in this module starts the CLI. The installed binary is read only when Google's
//! access token needs refreshing, because the desktop OAuth client metadata is bundled there.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::agent::{
    AntigravityAdapter, AntigravityUsage, AntigravityUsageBucket, AntigravityUsageGroup,
};

const CREDENTIAL_SERVICE: &str = "gemini";
const CREDENTIAL_USER: &str = "antigravity";
const CREDENTIAL_TARGET: &str = "gemini:antigravity";
const API_ORIGIN: &str = "https://daily-cloudcode-pa.googleapis.com";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
// loadCodeAssist omits the project for generic clients, even with a valid agy login.
const API_USER_AGENT: &str = "antigravity/cli";
const SECRET_PREFIX: &[u8] = b"GOCSPX-";
const SECRET_LENGTH: usize = 35;

struct SavedCredential {
    raw: Value,
    access_token: String,
    refresh_token: String,
    id_token: String,
}

#[derive(Deserialize)]
struct QuotaSummary {
    #[serde(default)]
    groups: Vec<QuotaGroup>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuotaGroup {
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    buckets: Vec<QuotaBucket>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuotaBucket {
    #[serde(default)]
    display_name: String,
    remaining_fraction: Option<f64>,
    reset_time: Option<String>,
}

#[derive(Deserialize)]
struct RefreshedToken {
    access_token: String,
    expires_in: i64,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

enum QueryError {
    Unauthorized,
    Other(String),
}

pub(super) async fn read_usage(client: &Client) -> Result<AntigravityUsage, String> {
    let credential = tauri::async_runtime::spawn_blocking(read_saved_credential)
        .await
        .map_err(|error| format!("读取 Antigravity 登录状态失败：{error}"))??;

    match query_usage(client, &credential.access_token).await {
        Ok(usage) => Ok(usage),
        Err(QueryError::Unauthorized) => {
            let token = refresh_access_token(client, credential).await?;
            query_usage(client, &token)
                .await
                .map_err(|error| match error {
                    QueryError::Unauthorized => {
                        "Antigravity 登录已失效，请在 agy 中重新登录".into()
                    }
                    QueryError::Other(reason) => reason,
                })
        }
        Err(QueryError::Other(reason)) => Err(reason),
    }
}

async fn query_usage(client: &Client, token: &str) -> Result<AntigravityUsage, QueryError> {
    let response = client
        .post(format!("{API_ORIGIN}/v1internal:loadCodeAssist"))
        .bearer_auth(token)
        .header(reqwest::header::USER_AGENT, API_USER_AGENT)
        .json(&json!({ "metadata": { "ideType": "ANTIGRAVITY" } }))
        .send()
        .await
        .map_err(|error| QueryError::Other(format!("请求 Antigravity 项目失败：{error}")))?;
    let response = checked_response(response)?;
    let body: Value = response
        .json()
        .await
        .map_err(|error| QueryError::Other(format!("解析 Antigravity 项目失败：{error}")))?;
    let project = body
        .get("cloudaicompanionProject")
        .and_then(Value::as_str)
        .filter(|project| !project.is_empty())
        .ok_or_else(|| QueryError::Other("Antigravity 未返回额度查询所需的项目 ID".into()))?;

    let response = client
        .post(format!("{API_ORIGIN}/v1internal:retrieveUserQuotaSummary"))
        .bearer_auth(token)
        .header(reqwest::header::USER_AGENT, API_USER_AGENT)
        .json(&json!({ "project": project }))
        .send()
        .await
        .map_err(|error| QueryError::Other(format!("请求 Antigravity 额度失败：{error}")))?;
    let response = checked_response(response)?;
    let summary: QuotaSummary = response
        .json()
        .await
        .map_err(|error| QueryError::Other(format!("解析 Antigravity 额度失败：{error}")))?;
    usage_from_summary(summary).map_err(QueryError::Other)
}

fn checked_response(response: reqwest::Response) -> Result<reqwest::Response, QueryError> {
    match response.status() {
        StatusCode::UNAUTHORIZED => Err(QueryError::Unauthorized),
        status if status.is_success() => Ok(response),
        status => Err(QueryError::Other(format!(
            "Antigravity 额度接口返回 {status}"
        ))),
    }
}

fn usage_from_summary(summary: QuotaSummary) -> Result<AntigravityUsage, String> {
    let groups = summary
        .groups
        .into_iter()
        .map(|group| AntigravityUsageGroup {
            name: group.display_name,
            buckets: group
                .buckets
                .into_iter()
                .map(|bucket| AntigravityUsageBucket {
                    name: bucket.display_name,
                    remaining_fraction: bucket.remaining_fraction,
                    reset_time: bucket.reset_time,
                })
                .collect(),
        })
        .collect::<Vec<_>>();
    if groups.is_empty() {
        return Err("Antigravity 未返回额度分组".into());
    }
    Ok(AntigravityUsage { groups })
}

fn read_saved_credential() -> Result<SavedCredential, String> {
    let entry =
        keyring::Entry::new_with_target(CREDENTIAL_TARGET, CREDENTIAL_SERVICE, CREDENTIAL_USER)
            .map_err(|error| format!("打开 Antigravity 登录凭据失败：{error}"))?;
    let secret = entry.get_secret().map_err(|error| match error {
        keyring::Error::NoEntry => "未找到 Antigravity 登录凭据，请先在 agy 中登录".to_owned(),
        other => format!("读取 Antigravity 登录凭据失败：{other}"),
    })?;
    let raw: Value = serde_json::from_slice(&secret)
        .map_err(|_| "Antigravity 登录凭据格式无效，请在 agy 中重新登录".to_owned())?;
    let field = |path: &str| {
        raw.pointer(path)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| "Antigravity 登录凭据不完整，请在 agy 中重新登录".to_owned())
    };
    Ok(SavedCredential {
        access_token: field("/token/access_token")?,
        refresh_token: field("/token/refresh_token")?,
        id_token: field("/id_token")?,
        raw,
    })
}

async fn refresh_access_token(
    client: &Client,
    credential: SavedCredential,
) -> Result<String, String> {
    let client_id = client_id_from_token(&credential.id_token)?;
    let executable = AntigravityAdapter::new()
        .executable_path()
        .ok_or_else(|| "Antigravity 登录已过期，未找到 agy 客户端以刷新登录状态".to_owned())?;
    let secrets = tauri::async_runtime::spawn_blocking(move || oauth_secrets(&executable))
        .await
        .map_err(|error| format!("读取 agy 登录配置失败：{error}"))??;

    let mut refreshed = None;
    for secret in secrets {
        let response = client
            .post(TOKEN_URL)
            .form(&[
                ("client_id", client_id.as_str()),
                ("client_secret", secret.as_str()),
                ("refresh_token", credential.refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|error| format!("刷新 Antigravity 登录状态失败：{error}"))?;
        if response.status().is_success() {
            refreshed = Some(
                response
                    .json::<RefreshedToken>()
                    .await
                    .map_err(|error| format!("解析 Antigravity 登录刷新结果失败：{error}"))?,
            );
            break;
        }
    }
    let refreshed =
        refreshed.ok_or_else(|| "Antigravity 登录已失效，请在 agy 中重新登录".to_owned())?;
    let token = refreshed.access_token.clone();
    tauri::async_runtime::spawn_blocking(move || save_refreshed_credential(credential, refreshed))
        .await
        .map_err(|error| format!("保存 Antigravity 登录状态失败：{error}"))??;
    Ok(token)
}

fn client_id_from_token(id_token: &str) -> Result<String, String> {
    let payload = id_token
        .split('.')
        .nth(1)
        .ok_or_else(|| "Antigravity 登录凭据缺少客户端信息".to_owned())?;
    let payload = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| "Antigravity 登录凭据的客户端信息无效".to_owned())?;
    let claims: Value = serde_json::from_slice(&payload)
        .map_err(|_| "Antigravity 登录凭据的客户端信息无效".to_owned())?;
    claims
        .get("aud")
        .and_then(Value::as_str)
        .filter(|audience| !audience.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Antigravity 登录凭据缺少客户端 ID".to_owned())
}

/// Read only the OAuth metadata in the user's installed CLI. Desktop OAuth secrets are bundled
/// with the application; do not copy one into Termexo's source or print it in diagnostics.
fn oauth_secrets(path: &Path) -> Result<Vec<String>, String> {
    let mut file = File::open(path).map_err(|error| format!("读取 agy 客户端失败：{error}"))?;
    let mut chunk = [0u8; 8192];
    let mut carry = Vec::new();
    let mut secrets = Vec::new();
    loop {
        let count = file
            .read(&mut chunk)
            .map_err(|error| format!("读取 agy 客户端失败：{error}"))?;
        if count == 0 {
            break;
        }
        carry.extend_from_slice(&chunk[..count]);
        for start in 0..carry.len().saturating_sub(SECRET_LENGTH - 1) {
            let candidate = &carry[start..start + SECRET_LENGTH];
            if candidate.starts_with(SECRET_PREFIX)
                && candidate[SECRET_PREFIX.len()..]
                    .iter()
                    .all(u8::is_ascii_alphanumeric)
            {
                let secret = String::from_utf8_lossy(candidate).into_owned();
                if !secrets.contains(&secret) {
                    secrets.push(secret);
                }
            }
        }
        let keep = carry.len().min(SECRET_LENGTH - 1);
        carry.drain(..carry.len() - keep);
    }
    if secrets.is_empty() {
        return Err("agy 客户端未提供刷新登录状态所需的信息，请在 agy 中重新登录".into());
    }
    Ok(secrets)
}

fn save_refreshed_credential(
    original: SavedCredential,
    refreshed: RefreshedToken,
) -> Result<(), String> {
    let current = read_saved_credential()?;
    if current.access_token != original.access_token
        || current.refresh_token != original.refresh_token
    {
        // agy refreshed this credential itself while the HTTP request was in flight.
        return Ok(());
    }
    let mut raw = current.raw;
    let token = raw
        .get_mut("token")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "Antigravity 登录凭据格式无效".to_owned())?;
    token.insert("access_token".into(), Value::String(refreshed.access_token));
    if let Some(refresh_token) = refreshed.refresh_token {
        token.insert("refresh_token".into(), Value::String(refresh_token));
    }
    let expiry = (OffsetDateTime::now_utc() + time::Duration::seconds(refreshed.expires_in))
        .format(&Rfc3339)
        .map_err(|error| format!("计算 Antigravity 登录到期时间失败：{error}"))?;
    token.insert("expiry".into(), Value::String(expiry));
    if let Some(id_token) = refreshed.id_token {
        raw.as_object_mut()
            .ok_or_else(|| "Antigravity 登录凭据格式无效".to_owned())?
            .insert("id_token".into(), Value::String(id_token));
    }
    let password = serde_json::to_vec(&raw)
        .map_err(|error| format!("保存 Antigravity 登录状态失败：{error}"))?;
    keyring::Entry::new_with_target(CREDENTIAL_TARGET, CREDENTIAL_SERVICE, CREDENTIAL_USER)
        .and_then(|entry| entry.set_secret(&password))
        .map_err(|error| format!("保存 Antigravity 登录状态失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_http_summary_into_named_usage_windows() {
        let summary: QuotaSummary = serde_json::from_value(json!({
            "groups": [
                { "displayName": "Gemini Models", "buckets": [
                    { "displayName": "Weekly Limit Remaining", "remainingFraction": 0.25,
                      "resetTime": "2026-09-23T08:44:42Z" }
                ]},
                { "displayName": "Claude and GPT models", "buckets": [
                    { "displayName": "Weekly Limit Remaining", "remainingFraction": 1.0 }
                ]}
            ]
        }))
        .unwrap();
        let usage = usage_from_summary(summary).unwrap();
        assert_eq!(usage.groups.len(), 2);
        assert_eq!(usage.groups[0].name, "Gemini Models");
        assert_eq!(usage.groups[0].buckets[0].remaining_fraction, Some(0.25));
        assert_eq!(
            usage.groups[0].buckets[0].reset_time.as_deref(),
            Some("2026-09-23T08:44:42Z")
        );
    }

    #[test]
    fn rejects_summary_without_quota_groups() {
        let summary: QuotaSummary = serde_json::from_value(json!({})).unwrap();
        assert!(usage_from_summary(summary).is_err());
    }

    #[test]
    fn finds_oauth_secret_across_read_boundary() {
        let path = std::env::temp_dir().join(format!("termexo-agy-oauth-{}", std::process::id()));
        let mut bytes = vec![b'x'; 8188];
        bytes.extend_from_slice(b"GOCSPX-abcdefghijklmnopqrstuvwxyz12");
        std::fs::write(&path, bytes).unwrap();
        let secrets = oauth_secrets(&path).unwrap();
        std::fs::remove_file(path).unwrap();
        assert_eq!(secrets, vec!["GOCSPX-abcdefghijklmnopqrstuvwxyz12"]);
    }
}
