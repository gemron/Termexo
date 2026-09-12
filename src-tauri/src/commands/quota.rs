//! Asks each configured provider what allowance is left on its key.
//!
//! Every request goes out over the workspace's network profile, because the providers that answer
//! these endpoints sit on both sides of the GFW and a user who needs a proxy for the model needs
//! the same proxy for its balance.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::agent::{AgentAdapter, AntigravityAdapter, AntigravityUsage};
use crate::commands::agent::network_environment;
use crate::config::{AccountProfile, CredentialStore, ModelProfile};
use crate::database::WorkspaceDatabase;
use crate::quota::{self, ProviderQuota};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const USER_AGENT: &str = "Termexo-Quota";

/// How long a reading stays fresh. Balances move only as fast as the agent spends, and these
/// endpoints are not meant to be polled — the previous local-estimate implementation rescanned
/// every event once per second and stalled the database behind it.
const CACHE_TTL: Duration = Duration::from_secs(60);

/// The agents' usage endpoints are rate limited far more aggressively than the providers' balance
/// APIs — Anthropic's answers 429 to anything that polls it — so those readings are held longer.
const AGENT_CACHE_TTL: Duration = Duration::from_secs(300);
/// OpenCode's plugin refreshes these services once a minute; use the same conservative cadence.
const OPENCODE_CACHE_TTL: Duration = Duration::from_secs(60);

/// Distinguishes an agent subscription's cache entry from a model profile of the same id.
const AGENT_CACHE_PREFIX: &str = "agent:";
const ANTIGRAVITY_QUOTA_ID: &str = "agent:antigravity";

/// Remembers the last reading per profile so reopening the panel does not re-hit every provider.
#[derive(Default)]
pub struct QuotaCache(Mutex<HashMap<String, ProviderQuota>>);

impl QuotaCache {
    fn fresh(&self, profile_id: &str, now: i64, ttl: Duration) -> Option<ProviderQuota> {
        let cache = self.0.lock().ok()?;
        let quota = cache.get(profile_id)?;
        let age = now.saturating_sub(quota.checked_at);
        (age >= 0 && age < ttl.as_millis() as i64).then(|| quota.clone())
    }

    fn store(&self, quota: &ProviderQuota) {
        if let Ok(mut cache) = self.0.lock() {
            cache.insert(quota.profile_id.clone(), quota.clone());
        }
    }
}

/// One profile's request, resolved on the main thread so the credential store and database stay
/// off the async tasks.
struct PendingQuery {
    profile_id: String,
    profile_name: String,
    provider: String,
    parser: QuotaParser,
    request: quota::QuotaRequest,
}

enum QuotaParser {
    Provider,
    Agent(String),
    OpenCodeCodex,
    OpenCodeGo,
}

#[tauri::command]
pub async fn get_provider_quotas(
    workspace_id: Option<String>,
    force: bool,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    cache: State<'_, QuotaCache>,
) -> Result<Vec<ProviderQuota>, String> {
    let now = now_ms();
    let profiles = database
        .list_model_profiles()
        .map_err(|error| error.to_string())?;
    let proxy = proxy_url(&database, &credentials, workspace_id.as_deref());

    let mut resolved = Vec::new();
    let mut pending = Vec::new();
    for profile in profiles {
        if !force {
            if let Some(cached) = cache.fresh(&profile.id, now, CACHE_TTL) {
                resolved.push(cached);
                continue;
            }
        }
        match resolve(&profile, &credentials, now) {
            Ok(query) => pending.push(query),
            Err(unavailable) => resolved.push(unavailable),
        }
    }

    // Claude Code and Codex authenticate with a subscription, so their allowance hangs off the
    // signed-in account rather than off any model profile.
    let accounts = database
        .list_account_profiles()
        .map_err(|error| error.to_string())?;
    for account in accounts {
        let cache_key = format!("{AGENT_CACHE_PREFIX}{}", account.id);
        if !force {
            if let Some(cached) = cache.fresh(&cache_key, now, AGENT_CACHE_TTL) {
                resolved.push(cached);
                continue;
            }
        }
        match resolve_agent(&account, &cache_key, now) {
            Ok(query) => pending.push(query),
            Err(unavailable) => resolved.push(unavailable),
        }
    }

    let opencode_credentials = quota::read_opencode_credentials();
    for source in [OpenCodeSource::Codex, OpenCodeSource::Go] {
        if opencode_credentials
            .as_ref()
            .is_ok_and(|credentials| !source.is_configured(credentials))
        {
            continue;
        }
        let id = source.id();
        if !force {
            if let Some(cached) = cache.fresh(id, now, OPENCODE_CACHE_TTL) {
                resolved.push(cached);
                continue;
            }
        }
        match resolve_opencode(source, opencode_credentials.as_ref(), now) {
            Ok(query) => pending.push(query),
            Err(unavailable) => resolved.push(unavailable),
        }
    }

    // Antigravity does not use per-account profiles, but is driven directly as an installation.
    // Its allowance status is reported under a dedicated agent entry.
    let antigravity_task = if !force {
        if let Some(cached) = cache.fresh(ANTIGRAVITY_QUOTA_ID, now, AGENT_CACHE_TTL) {
            resolved.push(cached);
            None
        } else {
            Some(tauri::async_runtime::spawn_blocking(move || {
                resolve_antigravity(now)
            }))
        }
    } else {
        Some(tauri::async_runtime::spawn_blocking(move || {
            resolve_antigravity(now)
        }))
    };

    if !pending.is_empty() {
        let client = build_client(proxy.as_deref())?;
        // One slow provider must not hold up the rest, so every request is in flight at once.
        let handles = pending
            .into_iter()
            .map(|query| {
                let client = client.clone();
                tauri::async_runtime::spawn(async move { execute(client, query).await })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            let quota = handle
                .await
                .map_err(|error| format!("查询供应商余量失败：{error}"))?;
            cache.store(&quota);
            resolved.push(quota);
        }
    }

    if let Some(task) = antigravity_task {
        let quota = task
            .await
            .map_err(|error| format!("查询 Antigravity 余量状态失败：{error}"))?;
        cache.store(&quota);
        resolved.push(quota);
    }

    resolved.sort_by(|left, right| left.profile_name.cmp(&right.profile_name));
    Ok(resolved)
}

/// Turns a profile into a request, or into the reason there will not be one.
fn resolve(
    profile: &ModelProfile,
    credentials: &CredentialStore,
    now: i64,
) -> Result<PendingQuery, ProviderQuota> {
    let unavailable = |reason: &str| {
        ProviderQuota::unavailable(&profile.id, &profile.name, &profile.provider, now, reason)
    };
    if !quota::supports_quota(&profile.provider) {
        return Err(unavailable("该供应商未提供余量查询接口"));
    }
    let Some(target) = profile.credential_target.as_deref() else {
        return Err(unavailable("尚未配置 API 密钥，无法查询余量"));
    };
    let api_key = match credentials.get(target) {
        Ok(key) => key,
        Err(error) => return Err(unavailable(&format!("读取 API 密钥失败：{error}"))),
    };
    // Either endpoint identifies the provider's host; the key is shared between the two protocols.
    let base_url = profile
        .claude_base_url
        .as_deref()
        .or(profile.codex_base_url.as_deref());
    let request = quota::build_request(&profile.provider, base_url, &api_key)
        .ok_or_else(|| unavailable("该供应商未提供余量查询接口"))?;
    Ok(PendingQuery {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        provider: profile.provider.clone(),
        parser: QuotaParser::Provider,
        request,
    })
}

/// Turns a signed-in account into a subscription-allowance request.
fn resolve_agent(
    account: &AccountProfile,
    cache_key: &str,
    now: i64,
) -> Result<PendingQuery, ProviderQuota> {
    let provider = quota::agent_display_name(&account.agent_type);
    let token = quota::read_agent_token(&account.agent_type, account.config_dir.as_deref())
        .map_err(|reason| {
            ProviderQuota::unavailable(cache_key, &account.name, provider, now, reason)
        })?;
    Ok(PendingQuery {
        profile_id: cache_key.to_owned(),
        profile_name: account.name.clone(),
        provider: provider.to_owned(),
        parser: QuotaParser::Agent(account.agent_type.clone()),
        request: quota::build_agent_request(&account.agent_type, &token),
    })
}

#[derive(Clone, Copy)]
enum OpenCodeSource {
    Codex,
    Go,
}

impl OpenCodeSource {
    fn id(self) -> &'static str {
        match self {
            Self::Codex => quota::OPENCODE_CODEX_QUOTA_ID,
            Self::Go => quota::OPENCODE_GO_QUOTA_ID,
        }
    }

    fn profile_name(self) -> &'static str {
        match self {
            Self::Codex => quota::OPENCODE_CODEX_PROFILE_NAME,
            Self::Go => quota::OPENCODE_GO_PROFILE_NAME,
        }
    }

    fn is_configured(self, credentials: &quota::OpenCodeCredentials) -> bool {
        match self {
            Self::Codex => credentials.codex.is_some(),
            Self::Go => credentials.go_api_key.is_some(),
        }
    }
}

fn resolve_opencode(
    source: OpenCodeSource,
    credentials: Result<&quota::OpenCodeCredentials, &String>,
    now: i64,
) -> Result<PendingQuery, ProviderQuota> {
    let unavailable = |reason: String| {
        ProviderQuota::unavailable(
            source.id(),
            source.profile_name(),
            quota::OPENCODE_PROVIDER_LABEL,
            now,
            reason,
        )
    };
    let credentials = credentials.map_err(|reason| unavailable(reason.clone()))?;
    let (parser, request) = match source {
        OpenCodeSource::Codex => {
            let credential = credentials
                .codex
                .as_ref()
                .ok_or_else(|| unavailable("OpenCode 尚未连接 ChatGPT Plus/Pro".to_owned()))?;
            (
                QuotaParser::OpenCodeCodex,
                quota::build_opencode_codex_request(credential),
            )
        }
        OpenCodeSource::Go => {
            let api_key = credentials
                .go_api_key
                .as_deref()
                .ok_or_else(|| unavailable("OpenCode 尚未连接 OpenCode Go".to_owned()))?;
            (
                QuotaParser::OpenCodeGo,
                quota::build_opencode_go_request(api_key),
            )
        }
    };
    Ok(PendingQuery {
        profile_id: source.id().to_owned(),
        profile_name: source.profile_name().to_owned(),
        provider: quota::OPENCODE_PROVIDER_LABEL.to_owned(),
        parser,
        request,
    })
}

fn resolve_antigravity(now: i64) -> ProviderQuota {
    let adapter = AntigravityAdapter::new();
    match adapter.detect() {
        Ok(installation) if installation.installed => {}
        _ => {
            return ProviderQuota::unavailable(
                ANTIGRAVITY_QUOTA_ID,
                quota::AGENT_ANTIGRAVITY_LABEL,
                quota::AGENT_ANTIGRAVITY_LABEL,
                now,
                "未检测到 Antigravity CLI（agy）",
            )
        }
    }

    // The allowance lives behind the CLI's own `/usage` command; there is no endpoint to call.
    let usage = match adapter.read_usage() {
        Ok(usage) => usage,
        Err(error) => {
            return ProviderQuota::unavailable(
                ANTIGRAVITY_QUOTA_ID,
                quota::AGENT_ANTIGRAVITY_LABEL,
                quota::AGENT_ANTIGRAVITY_LABEL,
                now,
                error.to_string(),
            )
        }
    };

    let entries = antigravity_entries(&usage);
    if entries.is_empty() {
        return ProviderQuota::unavailable(
            ANTIGRAVITY_QUOTA_ID,
            quota::AGENT_ANTIGRAVITY_LABEL,
            quota::AGENT_ANTIGRAVITY_LABEL,
            now,
            "Antigravity 未报告任何额度窗口",
        );
    }
    ProviderQuota {
        profile_id: ANTIGRAVITY_QUOTA_ID.to_owned(),
        profile_name: quota::AGENT_ANTIGRAVITY_LABEL.to_owned(),
        provider: quota::AGENT_ANTIGRAVITY_LABEL.to_owned(),
        official: quota::is_official(quota::AGENT_ANTIGRAVITY_LABEL),
        entries,
        checked_at: now,
        diagnostic: None,
    }
}

/// One line per allowance window, named by the group of models that shares it.
///
/// A group's name is what distinguishes the windows — "Gemini Models" and "Claude and GPT models"
/// each have a window called "Weekly Limit Remaining", so the bucket's own name alone would give
/// two identical rows.
fn antigravity_entries(usage: &AntigravityUsage) -> Vec<quota::QuotaEntry> {
    let mut entries = Vec::new();
    for group in &usage.groups {
        for bucket in &group.buckets {
            let Some(remaining) = bucket.remaining_fraction else {
                continue;
            };
            let label = match (group.name.trim(), bucket.name.trim()) {
                ("", "") => continue,
                ("", name) => name.to_owned(),
                (group_name, "") => group_name.to_owned(),
                (group_name, name) => format!("{group_name} · {name}"),
            };
            entries.push(quota::remaining_share_entry(
                label,
                remaining,
                bucket.reset_time.as_deref(),
            ));
        }
    }
    entries
}

async fn execute(client: reqwest::Client, query: PendingQuery) -> ProviderQuota {
    let checked_at = now_ms();
    let unavailable = |reason: String| {
        ProviderQuota::unavailable(
            &query.profile_id,
            &query.profile_name,
            &query.provider,
            checked_at,
            reason,
        )
    };

    let mut builder = client.get(&query.request.url);
    for (name, value) in &query.request.headers {
        builder = builder.header(*name, value);
    }
    let response = match builder.send().await {
        Ok(response) => response,
        Err(error) => return unavailable(format!("请求余量接口失败：{error}")),
    };
    if !response.status().is_success() {
        return unavailable(format!("余量接口返回 {}", response.status()));
    }
    let body = match response.json::<serde_json::Value>().await {
        Ok(body) => body,
        Err(error) => return unavailable(format!("解析余量响应失败：{error}")),
    };

    let parsed = match &query.parser {
        QuotaParser::Provider => quota::parse_response(&query.provider, &body),
        QuotaParser::Agent(agent_type) => quota::parse_agent_response(agent_type, &body),
        QuotaParser::OpenCodeCodex => quota::parse_opencode_codex_response(&body),
        QuotaParser::OpenCodeGo => quota::parse_opencode_go_response(&body),
    };
    match parsed {
        Ok(entries) => ProviderQuota {
            profile_id: query.profile_id,
            profile_name: query.profile_name,
            official: quota::is_official(&query.provider),
            provider: query.provider,
            entries,
            checked_at,
            diagnostic: None,
        },
        Err(reason) => {
            // The message carries key names only, so it is safe to log and to show.
            tracing::warn!("{reason}");
            unavailable(reason)
        }
    }
}

fn build_client(proxy: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT);
    if let Some(proxy) = proxy {
        let proxy = reqwest::Proxy::all(proxy)
            .map_err(|error| format!("代理配置无效，无法查询余量：{error}"))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|error| format!("无法创建余量查询请求：{error}"))
}

/// Reuses the agents' own proxy resolution so the balance follows the model traffic.
fn proxy_url(
    database: &WorkspaceDatabase,
    credentials: &CredentialStore,
    workspace_id: Option<&str>,
) -> Option<String> {
    let environment = network_environment(database, credentials, workspace_id).ok()?;
    environment
        .get("HTTPS_PROXY")
        .or_else(|| environment.get("HTTP_PROXY"))
        .or_else(|| environment.get("ALL_PROXY"))
        .cloned()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usage(payload: &str) -> AntigravityUsage {
        serde_json::from_str(payload).unwrap()
    }

    /// Both groups name their window the same thing, so the group has to be part of the label or
    /// the panel shows two identical rows.
    #[test]
    fn each_group_window_becomes_its_own_named_line() {
        let usage = usage(
            r#"{"groups":[
                {"name":"Gemini Models","buckets":[
                    {"name":"Weekly Limit Remaining","remaining_fraction":0,
                     "reset_time":"2026-09-18T16:45:19Z"}]},
                {"name":"Claude and GPT models","buckets":[
                    {"name":"Weekly Limit Remaining","remaining_fraction":1}]}]}"#,
        );

        let entries = antigravity_entries(&usage);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].label, "Gemini Models · Weekly Limit Remaining");
        assert_eq!(entries[0].percent, Some(100.0));
        assert_eq!(
            entries[1].label,
            "Claude and GPT models · Weekly Limit Remaining"
        );
        assert_eq!(entries[1].percent, Some(0.0));
    }

    /// A window with no figure is skipped rather than drawn as an empty bar.
    #[test]
    fn a_window_without_a_share_is_skipped() {
        let usage = usage(r#"{"groups":[{"name":"G","buckets":[{"name":"W"}]}]}"#);

        assert!(antigravity_entries(&usage).is_empty());
    }

    #[test]
    fn opencode_sources_are_offered_only_for_credentials_that_exist() {
        let credentials = quota::OpenCodeCredentials {
            codex: Some(quota::OpenCodeCodexCredential {
                access_token: "token".to_owned(),
                account_id: None,
            }),
            go_api_key: None,
        };

        assert!(OpenCodeSource::Codex.is_configured(&credentials));
        assert!(!OpenCodeSource::Go.is_configured(&credentials));
    }

    #[test]
    fn an_opencode_source_resolves_to_its_stable_panel_identity() {
        let credentials = quota::OpenCodeCredentials {
            codex: None,
            go_api_key: Some("go-key".to_owned()),
        };

        let query = resolve_opencode(OpenCodeSource::Go, Ok(&credentials), 42).unwrap();

        assert_eq!(query.profile_id, quota::OPENCODE_GO_QUOTA_ID);
        assert_eq!(query.profile_name, quota::OPENCODE_GO_PROFILE_NAME);
        assert_eq!(query.provider, quota::OPENCODE_PROVIDER_LABEL);
        assert!(matches!(query.parser, QuotaParser::OpenCodeGo));
    }
}
