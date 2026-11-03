//! Antigravity's saved login can query the same quota summary as `/usage` over HTTP.
//! Nothing in this module starts the CLI. The installed binary is read only when Google's
//! access token needs refreshing, because the desktop OAuth client metadata is bundled there.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

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
const FALLBACK_TOKEN_FILE: &str = "jetski-standalone-oauth-token";
const API_ORIGIN: &str = "https://daily-cloudcode-pa.googleapis.com";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
// loadCodeAssist omits the project for generic clients, even with a valid agy login.
const API_USER_AGENT: &str = "antigravity/cli";
const SECRET_PREFIX: &[u8] = b"GOCSPX-";
const SECRET_LENGTH: usize = 35;
const CLIENT_ID_SUFFIX: &[u8] = b".apps.googleusercontent.com";
const CLIENT_ID_RANDOM_LENGTH: usize = 32;
const CLIENT_ID_MAX_DIGITS: usize = 20;
const CLIENT_ID_MIN_DIGITS: usize = 10;
const SCAN_CARRY_LENGTH: usize =
    CLIENT_ID_MAX_DIGITS + 1 + CLIENT_ID_RANDOM_LENGTH + CLIENT_ID_SUFFIX.len();

#[derive(Clone, Debug, PartialEq, Eq)]
enum CredentialSource {
    Keyring,
    File(PathBuf),
}

struct SavedCredential {
    source: CredentialSource,
    raw: Value,
    access_token: String,
    refresh_token: String,
    id_token: Option<String>,
    project_id: Option<String>,
    auth_method: Option<String>,
}

#[derive(Default, Debug, PartialEq, Eq)]
struct OAuthMetadata {
    client_ids: Vec<String>,
    secrets: Vec<String>,
}

#[derive(Deserialize)]
struct QuotaSummary {
    /// Windows that belong to no model group, such as the account-wide five-hour cap.
    #[serde(default)]
    buckets: Vec<QuotaBucket>,
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
    let saved_project = credential.project_id.clone();

    match query_usage(client, &credential.access_token, saved_project.as_deref()).await {
        Ok(usage) => Ok(usage),
        Err(QueryError::Unauthorized) => {
            let token = refresh_access_token(client, credential).await?;
            query_usage(client, &token, saved_project.as_deref())
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

async fn query_usage(
    client: &Client,
    token: &str,
    saved_project: Option<&str>,
) -> Result<AntigravityUsage, QueryError> {
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
        .and_then(|value| {
            value
                .as_str()
                .or_else(|| value.get("id").and_then(Value::as_str))
        })
        .filter(|project| !project.is_empty())
        .or(saved_project)
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
    let convert = |buckets: Vec<QuotaBucket>| {
        buckets
            .into_iter()
            .map(|bucket| AntigravityUsageBucket {
                name: bucket.display_name,
                remaining_fraction: bucket.remaining_fraction,
                reset_time: bucket.reset_time,
            })
            .collect::<Vec<_>>()
    };
    let mut groups = Vec::new();
    // The ungrouped windows lead, as they do in the CLI's own `/usage` panel.
    if !summary.buckets.is_empty() {
        groups.push(AntigravityUsageGroup {
            name: String::new(),
            buckets: convert(summary.buckets),
        });
    }
    groups.extend(
        summary
            .groups
            .into_iter()
            .map(|group| AntigravityUsageGroup {
                name: group.display_name,
                buckets: convert(group.buckets),
            }),
    );
    if groups.is_empty() {
        return Err("Antigravity 未返回额度分组".into());
    }
    Ok(AntigravityUsage { groups })
}

fn read_saved_credential() -> Result<SavedCredential, String> {
    let keyring_result =
        keyring::Entry::new_with_target(CREDENTIAL_TARGET, CREDENTIAL_SERVICE, CREDENTIAL_USER)
            .map_err(|error| format!("打开 Antigravity 登录凭据失败：{error}"))
            .and_then(|entry| {
                entry.get_secret().map_err(|error| match error {
                    keyring::Error::NoEntry => {
                        "未找到 Antigravity 登录凭据，请先在 agy 中登录".to_owned()
                    }
                    other => format!("读取 Antigravity 登录凭据失败：{other}"),
                })
            });

    match keyring_result {
        Ok(secret) => parse_saved_credential(&secret, CredentialSource::Keyring),
        Err(keyring_error) => {
            if let Some(path) = fallback_token_file() {
                if let Ok(secret) = std::fs::read(&path) {
                    return parse_saved_credential(&secret, CredentialSource::File(path));
                }
            }
            Err(keyring_error)
        }
    }
}

fn fallback_token_file() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    let path = PathBuf::from(home)
        .join(".gemini")
        .join(FALLBACK_TOKEN_FILE);
    path.is_file().then_some(path)
}

fn parse_saved_credential(
    secret: &[u8],
    source: CredentialSource,
) -> Result<SavedCredential, String> {
    let raw: Value = serde_json::from_slice(secret)
        .map_err(|_| "Antigravity 登录凭据格式无效，请在 agy 中重新登录".to_owned())?;
    let optional = |path: &str| {
        raw.pointer(path)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let required = |primary: &str, fallback: &str| {
        optional(primary)
            .or_else(|| optional(fallback))
            .ok_or_else(|| "Antigravity 登录凭据不完整，请在 agy 中重新登录".to_owned())
    };
    Ok(SavedCredential {
        source,
        access_token: required("/token/access_token", "/access_token")?,
        refresh_token: required("/token/refresh_token", "/refresh_token")?,
        // Newer agy versions omit `id_token` from StoredToken and only persist `id_token_email`.
        id_token: optional("/id_token").or_else(|| optional("/token/id_token")),
        project_id: optional("/project_id"),
        auth_method: optional("/auth_method"),
        raw,
    })
}

async fn refresh_access_token(
    client: &Client,
    credential: SavedCredential,
) -> Result<String, String> {
    let token_client_id = credential
        .id_token
        .as_deref()
        .and_then(|token| client_id_from_token(token).ok());
    let executable = AntigravityAdapter::new()
        .executable_path()
        .ok_or_else(|| "Antigravity 登录已过期，未找到 agy 客户端以刷新登录状态".to_owned())?;
    let metadata = tauri::async_runtime::spawn_blocking(move || oauth_metadata(&executable))
        .await
        .map_err(|error| format!("读取 agy 登录配置失败：{error}"))??;
    let candidates = candidate_oauth_clients(
        token_client_id.as_deref(),
        credential.auth_method.as_deref(),
        &metadata,
    )?;

    let mut refreshed = None;
    for (client_id, secret) in candidates {
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

fn candidate_oauth_clients(
    token_client_id: Option<&str>,
    auth_method: Option<&str>,
    metadata: &OAuthMetadata,
) -> Result<Vec<(String, String)>, String> {
    if metadata.secrets.is_empty() {
        return Err("agy 客户端未提供刷新登录状态所需的信息，请在 agy 中重新登录".into());
    }
    let mut pairs = Vec::new();
    let mut push_unique = |client_id: &str, secret: &str| {
        if !pairs.iter().any(|(existing_id, existing_secret)| {
            existing_id == client_id && existing_secret == secret
        }) {
            pairs.push((client_id.to_owned(), secret.to_owned()));
        }
    };

    if let Some(client_id) = token_client_id {
        for secret in &metadata.secrets {
            push_unique(client_id, secret);
        }
    }

    let paired_len = metadata.client_ids.len().min(metadata.secrets.len());
    if auth_method == Some("oauth-personal") && paired_len >= 2 {
        push_unique(&metadata.client_ids[1], &metadata.secrets[1]);
    }
    for index in 0..paired_len {
        push_unique(&metadata.client_ids[index], &metadata.secrets[index]);
    }
    for client_id in &metadata.client_ids {
        for secret in &metadata.secrets {
            push_unique(client_id, secret);
        }
    }

    if pairs.is_empty() {
        return Err("Antigravity 登录凭据缺少客户端 ID，请在 agy 中重新登录".into());
    }
    Ok(pairs)
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

/// Read only the OAuth metadata in the user's installed CLI. Desktop OAuth client IDs and secrets
/// are bundled with the application; do not copy one into Termexo's source or print it in diagnostics.
fn oauth_metadata(path: &Path) -> Result<OAuthMetadata, String> {
    let mut file = File::open(path).map_err(|error| format!("读取 agy 客户端失败：{error}"))?;
    let mut chunk = [0u8; 8192];
    let mut carry = Vec::new();
    let mut metadata = OAuthMetadata::default();
    loop {
        let count = file
            .read(&mut chunk)
            .map_err(|error| format!("读取 agy 客户端失败：{error}"))?;
        if count == 0 {
            break;
        }
        carry.extend_from_slice(&chunk[..count]);
        scan_oauth_chunk(&carry, &mut metadata);
        let keep = carry.len().min(SCAN_CARRY_LENGTH - 1);
        carry.drain(..carry.len() - keep);
    }
    if metadata.secrets.is_empty() {
        return Err("agy 客户端未提供刷新登录状态所需的信息，请在 agy 中重新登录".into());
    }
    Ok(metadata)
}

fn scan_oauth_chunk(bytes: &[u8], metadata: &mut OAuthMetadata) {
    for start in 0..bytes.len().saturating_sub(SECRET_LENGTH - 1) {
        let candidate = &bytes[start..start + SECRET_LENGTH];
        if candidate.starts_with(SECRET_PREFIX)
            && candidate[SECRET_PREFIX.len()..]
                .iter()
                .all(u8::is_ascii_alphanumeric)
        {
            let secret = String::from_utf8_lossy(candidate).into_owned();
            if !metadata.secrets.contains(&secret) {
                metadata.secrets.push(secret);
            }
        }
    }

    let min_prefix = CLIENT_ID_MIN_DIGITS + 1 + CLIENT_ID_RANDOM_LENGTH;
    if bytes.len() < min_prefix + CLIENT_ID_SUFFIX.len() {
        return;
    }
    for suffix_start in min_prefix..=bytes.len() - CLIENT_ID_SUFFIX.len() {
        if &bytes[suffix_start..suffix_start + CLIENT_ID_SUFFIX.len()] != CLIENT_ID_SUFFIX {
            continue;
        }
        let random_start = suffix_start - CLIENT_ID_RANDOM_LENGTH;
        if bytes[random_start - 1] != b'-' {
            continue;
        }
        let random_part = &bytes[random_start..suffix_start];
        if !random_part
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        {
            continue;
        }
        let hyphen = random_start - 1;
        let min_digit_index = hyphen.saturating_sub(CLIENT_ID_MAX_DIGITS);
        let mut digit_start = hyphen;
        while digit_start > min_digit_index && bytes[digit_start - 1].is_ascii_digit() {
            digit_start -= 1;
        }
        let digit_len = hyphen - digit_start;
        if digit_len < CLIENT_ID_MIN_DIGITS {
            continue;
        }
        let client_id =
            String::from_utf8_lossy(&bytes[digit_start..suffix_start + CLIENT_ID_SUFFIX.len()])
                .into_owned();
        if !metadata.client_ids.contains(&client_id) {
            metadata.client_ids.push(client_id);
        }
    }
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
    if let Some(token) = raw.get_mut("token").and_then(Value::as_object_mut) {
        token.insert("access_token".into(), Value::String(refreshed.access_token));
        if let Some(refresh_token) = refreshed.refresh_token {
            token.insert("refresh_token".into(), Value::String(refresh_token));
        }
        let expiry = (OffsetDateTime::now_utc() + time::Duration::seconds(refreshed.expires_in))
            .format(&Rfc3339)
            .map_err(|error| format!("计算 Antigravity 登录到期时间失败：{error}"))?;
        token.insert("expiry".into(), Value::String(expiry));
    } else if let Some(root) = raw.as_object_mut() {
        root.insert("access_token".into(), Value::String(refreshed.access_token));
        if let Some(refresh_token) = refreshed.refresh_token {
            root.insert("refresh_token".into(), Value::String(refresh_token));
        }
    } else {
        return Err("Antigravity 登录凭据格式无效".into());
    }
    if let Some(id_token) = refreshed.id_token {
        if let Some(root) = raw.as_object_mut() {
            if root.contains_key("id_token") {
                root.insert("id_token".into(), Value::String(id_token));
            }
        }
    }
    let password = serde_json::to_vec(&raw)
        .map_err(|error| format!("保存 Antigravity 登录状态失败：{error}"))?;
    match current.source {
        CredentialSource::Keyring => {
            keyring::Entry::new_with_target(CREDENTIAL_TARGET, CREDENTIAL_SERVICE, CREDENTIAL_USER)
                .and_then(|entry| entry.set_secret(&password))
                .map_err(|error| format!("保存 Antigravity 登录状态失败：{error}"))
        }
        CredentialSource::File(path) => std::fs::write(path, &password)
            .map_err(|error| format!("保存 Antigravity 登录状态失败：{error}")),
    }
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
    fn keeps_ungrouped_windows_ahead_of_the_groups() {
        let summary: QuotaSummary = serde_json::from_value(json!({
            "buckets": [
                { "displayName": "Five Hour Limit Remaining", "remainingFraction": 0.9799 }
            ],
            "groups": [
                { "displayName": "Gemini 4 Argon", "buckets": [
                    { "displayName": "Gemini 4 Argon Weekly Limit", "remainingFraction": 0.8451 }
                ]}
            ]
        }))
        .unwrap();
        let usage = usage_from_summary(summary).unwrap();
        assert_eq!(usage.groups.len(), 2);
        assert_eq!(usage.groups[0].name, "");
        assert_eq!(usage.groups[0].buckets[0].name, "Five Hour Limit Remaining");
        assert_eq!(usage.groups[1].name, "Gemini 4 Argon");
    }

    #[test]
    fn rejects_summary_without_quota_groups() {
        let summary: QuotaSummary = serde_json::from_value(json!({})).unwrap();
        assert!(usage_from_summary(summary).is_err());
    }

    #[test]
    fn parses_saved_credential_without_legacy_id_token() {
        let payload = serde_json::to_vec(&json!({
            "token": {
                "access_token": "ya29.access",
                "refresh_token": "1//refresh",
                "token_type": "Bearer"
            },
            "auth_method": "oauth-personal",
            "id_token_email": "user@example.com",
            "project_id": "companion-project-123"
        }))
        .unwrap();

        let credential = parse_saved_credential(&payload, CredentialSource::Keyring).unwrap();
        assert_eq!(credential.access_token, "ya29.access");
        assert_eq!(credential.refresh_token, "1//refresh");
        assert_eq!(credential.id_token, None);
        assert_eq!(
            credential.project_id.as_deref(),
            Some("companion-project-123")
        );
        assert_eq!(credential.auth_method.as_deref(), Some("oauth-personal"));
    }

    #[test]
    fn finds_oauth_metadata_across_read_boundary() {
        let path = std::env::temp_dir().join(format!("termexo-agy-oauth-{}", std::process::id()));
        // Exercise the real parser shape with generated, deliberately synthetic metadata.
        let client_id = format!(
            "{}-{}{}",
            "0".repeat(CLIENT_ID_MIN_DIGITS),
            "x".repeat(CLIENT_ID_RANDOM_LENGTH),
            std::str::from_utf8(CLIENT_ID_SUFFIX).unwrap()
        );
        let secret = format!(
            "{}{}",
            std::str::from_utf8(SECRET_PREFIX).unwrap(),
            "x".repeat(SECRET_LENGTH - SECRET_PREFIX.len())
        );
        let mut bytes = vec![b'x'; 8180];
        bytes.extend_from_slice(client_id.as_bytes());
        bytes.extend_from_slice(secret.as_bytes());
        std::fs::write(&path, bytes).unwrap();
        let metadata = oauth_metadata(&path).unwrap();
        std::fs::remove_file(path).unwrap();
        assert_eq!(metadata.client_ids, vec![client_id]);
        assert_eq!(metadata.secrets, vec![secret]);
    }

    #[test]
    fn orders_personal_oauth_client_first_when_auth_method_is_personal() {
        let metadata = OAuthMetadata {
            client_ids: vec!["business-test-client".into(), "personal-test-client".into()],
            secrets: vec!["business-test-secret".into(), "personal-test-secret".into()],
        };
        let pairs = candidate_oauth_clients(None, Some("oauth-personal"), &metadata).unwrap();
        assert_eq!(
            pairs[0],
            ("personal-test-client".into(), "personal-test-secret".into(),)
        );
    }
}
