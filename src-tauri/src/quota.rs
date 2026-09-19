//! Reads the remaining allowance a provider reports for a model profile.
//!
//! Providers expose two incompatible notions of "what is left": DeepSeek and Kimi answer with
//! money, while MiniMax and GLM answer with a token allowance that resets on a window the provider
//! defines. [`QuotaEntry`] carries both, so the UI renders one shape without knowing which provider
//! it came from.
//!
//! Building the request and parsing the answer are pure functions here; the HTTP call itself lives
//! in `commands::quota`, which owns the proxy and the credential store. That split is what makes
//! every provider's parsing testable without a network.

use std::fs;
use std::io::{BufRead, BufReader, ErrorKind};
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::Serialize;
use serde_json::{Map, Value};
use url::Url;

/// Provider identifiers, matching the `provider` field of the frontend's `PROVIDER_PRESETS`.
const PROVIDER_DEEPSEEK: &str = "DeepSeek";
const PROVIDER_KIMI: &str = "Kimi";
const PROVIDER_MINIMAX: &str = "MiniMax";
const PROVIDER_GLM: &str = "GLM";

/// Fallback origins, used when a profile has no base URL of its own (the provider's own agent
/// needs none) so the documented public endpoint is still reachable.
const DEEPSEEK_DEFAULT_ORIGIN: &str = "https://api.deepseek.com";
const KIMI_DEFAULT_ORIGIN: &str = "https://api.moonshot.cn";
const GLM_DEFAULT_ORIGIN: &str = "https://open.bigmodel.cn";

/// MiniMax serves the token plan from its website host rather than the API host, so unlike the
/// other providers this one cannot be derived from the configured base URL.
const MINIMAX_QUOTA_URL: &str = "https://www.minimaxi.com/v1/token_plan/remains";

const AUTHORIZATION: &str = "Authorization";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QuotaUnit {
    /// A money balance; `currency` carries the code the provider reported.
    Currency,
    Tokens,
    Requests,
    /// Only a share is known — the subscription endpoints report no absolute figure.
    Percent,
}

/// One allowance line: a balance, or one of the several windows a plan is capped on.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaEntry {
    pub label: String,
    pub unit: QuotaUnit,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<f64>,
    /// Consumed share, 0-100. Derived from the totals when the provider does not send it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<i64>,
}

impl QuotaEntry {
    fn new(label: impl Into<String>, unit: QuotaUnit) -> Self {
        Self {
            label: label.into(),
            unit,
            currency: None,
            total: None,
            used: None,
            remaining: None,
            percent: None,
            resets_at: None,
        }
    }

    /// Fills in the consumed share whenever the provider sent enough to derive it.
    fn with_derived_percent(mut self) -> Self {
        if self.percent.is_some() {
            return self;
        }
        let total = self.total.filter(|value| *value > 0.0);
        if let (Some(total), Some(used)) = (total, self.used) {
            self.percent = Some((used / total * 100.0).clamp(0.0, 100.0));
        } else if let (Some(total), Some(remaining)) = (total, self.remaining) {
            self.percent = Some(((total - remaining) / total * 100.0).clamp(0.0, 100.0));
        }
        self
    }
}

/// What a provider reports for one model profile at one point in time.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderQuota {
    pub profile_id: String,
    pub profile_name: String,
    pub provider: String,
    /// False when the endpoint is not part of the provider's published documentation, so the UI
    /// can say so rather than presenting community findings as official.
    pub official: bool,
    pub entries: Vec<QuotaEntry>,
    pub checked_at: i64,
    /// Why there is nothing to show. Always set when `entries` is empty.
    pub diagnostic: Option<String>,
}

impl ProviderQuota {
    pub fn unavailable(
        profile_id: &str,
        profile_name: &str,
        provider: &str,
        checked_at: i64,
        diagnostic: impl Into<String>,
    ) -> Self {
        Self {
            profile_id: profile_id.to_owned(),
            profile_name: profile_name.to_owned(),
            provider: provider.to_owned(),
            official: is_official(provider),
            entries: Vec::new(),
            checked_at,
            diagnostic: Some(diagnostic.into()),
        }
    }
}

/// Everything needed to ask one provider for its remaining allowance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuotaRequest {
    pub url: String,
    pub headers: Vec<(&'static str, String)>,
}

impl QuotaRequest {
    fn bearer(url: String, token: &str) -> Self {
        Self {
            url,
            headers: vec![(AUTHORIZATION, format!("Bearer {token}"))],
        }
    }
}

/// Whether the provider publishes this endpoint in its own documentation.
pub fn is_official(provider: &str) -> bool {
    // GLM's endpoint is a community finding, and the agent CLIs read their subscription
    // allowance from private endpoints their own clients call. None of them is documented.
    ![
        PROVIDER_GLM,
        AGENT_CLAUDE_LABEL,
        AGENT_CODEX_LABEL,
        AGENT_GROK_LABEL,
        AGENT_ANTIGRAVITY_LABEL,
        OPENCODE_PROVIDER_LABEL,
    ]
    .iter()
    .any(|known| provider.eq_ignore_ascii_case(known))
}

/// Whether a balance can be read for this provider at all.
///
/// Anthropic and OpenAI only report usage through organization-level admin APIs, which need a
/// separate admin key and do not cover the subscription plans this app's users authenticate with.
/// SCNet publishes no endpoint. Those all return `None` and the UI states as much.
pub fn supports_quota(provider: &str) -> bool {
    matches!(
        canonical_provider(provider),
        Some(PROVIDER_DEEPSEEK | PROVIDER_KIMI | PROVIDER_MINIMAX | PROVIDER_GLM)
    )
}

fn canonical_provider(provider: &str) -> Option<&'static str> {
    for known in [
        PROVIDER_DEEPSEEK,
        PROVIDER_KIMI,
        PROVIDER_MINIMAX,
        PROVIDER_GLM,
    ] {
        if provider.trim().eq_ignore_ascii_case(known) {
            return Some(known);
        }
    }
    None
}

/// Builds the balance request for a profile, or `None` when the provider offers no such endpoint.
///
/// `base_url` is whichever endpoint the profile already talks to. Deriving the host from it rather
/// than hard-coding one keeps mirrors and regional sites working: Kimi's `api.moonshot.cn` and
/// `api.moonshot.ai` are separate sites whose keys are not interchangeable, and GLM has both
/// `open.bigmodel.cn` and `api.z.ai`.
pub fn build_request(
    provider: &str,
    base_url: Option<&str>,
    api_key: &str,
) -> Option<QuotaRequest> {
    let provider = canonical_provider(provider)?;
    match provider {
        PROVIDER_DEEPSEEK => Some(QuotaRequest::bearer(
            join_origin(base_url, DEEPSEEK_DEFAULT_ORIGIN, "/user/balance"),
            api_key,
        )),
        PROVIDER_KIMI => Some(QuotaRequest::bearer(
            join_origin(base_url, KIMI_DEFAULT_ORIGIN, "/v1/users/me/balance"),
            api_key,
        )),
        PROVIDER_MINIMAX => Some(QuotaRequest::bearer(MINIMAX_QUOTA_URL.to_owned(), api_key)),
        // GLM rejects the `Bearer ` prefix on this endpoint and wants the raw key.
        PROVIDER_GLM => Some(QuotaRequest {
            url: join_origin(
                base_url,
                GLM_DEFAULT_ORIGIN,
                "/api/monitor/usage/quota/limit",
            ),
            headers: vec![(AUTHORIZATION, api_key.to_owned())],
        }),
        _ => None,
    }
}

/// Replaces the path of a configured base URL with the quota path, keeping scheme, host and port.
fn join_origin(base_url: Option<&str>, fallback_origin: &str, path: &str) -> String {
    let origin = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| Url::parse(value).ok())
        .filter(|url| url.has_host())
        .map(|url| {
            let port = url
                .port()
                .map(|port| format!(":{port}"))
                .unwrap_or_default();
            // `url.host_str()` is Some because `has_host()` passed.
            format!("{}://{}{port}", url.scheme(), url.host_str().unwrap_or(""))
        })
        .unwrap_or_else(|| fallback_origin.to_owned());
    format!("{origin}{path}")
}

/// Turns a provider's response into allowance lines.
///
/// Returns `Err` with a Chinese message when the endpoint answered but in a shape this build does
/// not recognise — that is a reportable state, not a crash.
pub fn parse_response(provider: &str, body: &Value) -> Result<Vec<QuotaEntry>, String> {
    match canonical_provider(provider) {
        Some(PROVIDER_DEEPSEEK) => parse_deepseek(body),
        Some(PROVIDER_KIMI) => parse_kimi(body),
        Some(PROVIDER_MINIMAX) => parse_minimax(body),
        Some(PROVIDER_GLM) => parse_glm(body),
        _ => Err("该供应商未提供余量接口".to_owned()),
    }
}

/// DeepSeek reports one balance per currency, with the amounts sent as strings.
fn parse_deepseek(body: &Value) -> Result<Vec<QuotaEntry>, String> {
    let infos = body
        .get("balance_infos")
        .and_then(Value::as_array)
        .ok_or_else(|| "DeepSeek 返回的余额结构无法识别".to_owned())?;
    let entries = infos
        .iter()
        .filter_map(|info| {
            let currency = info.get("currency").and_then(Value::as_str)?;
            let mut entry = QuotaEntry::new("可用余额", QuotaUnit::Currency);
            entry.currency = Some(currency.to_owned());
            entry.remaining = loose_number(info, "total_balance");
            entry.total = entry.remaining;
            Some(entry)
        })
        .collect::<Vec<_>>();
    if entries.is_empty() {
        return Err("DeepSeek 未返回任何余额条目".to_owned());
    }
    Ok(entries)
}

/// Kimi reports a single USD balance under `data`.
fn parse_kimi(body: &Value) -> Result<Vec<QuotaEntry>, String> {
    let data = body
        .get("data")
        .filter(|data| data.is_object())
        .ok_or_else(|| "Kimi 返回的余额结构无法识别".to_owned())?;
    let available =
        loose_number(data, "available_balance").ok_or_else(|| "Kimi 未返回可用余额".to_owned())?;
    let mut entry = QuotaEntry::new("可用余额", QuotaUnit::Currency);
    entry.currency = Some("USD".to_owned());
    entry.remaining = Some(available);
    entry.total = Some(available);
    Ok(vec![entry])
}

/// GLM reports several caps at once — a token allowance per rolling window plus a request cap.
///
/// The endpoint is undocumented, so only the fields the community consistently observes are read
/// and anything else is ignored rather than guessed at.
fn parse_glm(body: &Value) -> Result<Vec<QuotaEntry>, String> {
    let limits = body
        .get("data")
        .and_then(|data| data.get("limits"))
        .and_then(Value::as_array)
        .ok_or_else(|| "GLM 返回的配额结构无法识别".to_owned())?;
    let mut token_windows = 0;
    let entries = limits
        .iter()
        .filter_map(|limit| {
            let kind = limit
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let unit = if kind.eq_ignore_ascii_case("TIME_LIMIT") {
                QuotaUnit::Requests
            } else {
                QuotaUnit::Tokens
            };
            if unit == QuotaUnit::Tokens {
                token_windows += 1;
            }
            let label = glm_label(kind, token_windows);
            let mut entry = QuotaEntry::new(label, unit);
            entry.used = loose_number(limit, "usage");
            entry.remaining = loose_number(limit, "remaining");
            entry.total = loose_number(limit, "currentValue");
            entry.percent = loose_number(limit, "percentage");
            // A provider that sends neither a count nor a share has nothing to display.
            if entry.used.is_none() && entry.remaining.is_none() && entry.percent.is_none() {
                return None;
            }
            Some(entry.with_derived_percent())
        })
        .collect::<Vec<_>>();
    if entries.is_empty() {
        return Err("GLM 未返回任何配额条目".to_owned());
    }
    Ok(entries)
}

/// GLM sends the rolling windows in order without naming them, so they are numbered.
fn glm_label(kind: &str, token_window: usize) -> String {
    if kind.eq_ignore_ascii_case("TIME_LIMIT") {
        return "请求次数".to_owned();
    }
    match token_window {
        1 => "Token 额度（较短窗口）".to_owned(),
        _ => format!("Token 额度（窗口 {token_window}）"),
    }
}

/// MiniMax caps each model on two windows at once: a rolling interval and the calendar week.
///
/// Despite the `token_plan` endpoint name, the allowance is counted in **requests** — every figure
/// arrives as a `*_count`. The plan is reported per model under `model_remains`.
fn parse_minimax(body: &Value) -> Result<Vec<QuotaEntry>, String> {
    if let Some(code) = body
        .get("base_resp")
        .and_then(|resp| loose_number(resp, "status_code"))
        .filter(|code| *code != 0.0)
    {
        let message = body
            .get("base_resp")
            .and_then(|resp| resp.get("status_msg"))
            .and_then(Value::as_str)
            .unwrap_or("未提供说明");
        return Err(format!("MiniMax 余量接口返回错误 {code}：{message}"));
    }

    let models = body
        .get("model_remains")
        .ok_or_else(|| format!("MiniMax 返回了未识别的结构（字段：{}）", key_outline(body)))?;
    // A single-model plan may arrive as one object rather than a list.
    let models: Vec<&Value> = match models {
        Value::Array(items) => items.iter().collect(),
        Value::Object(_) => vec![models],
        _ => Vec::new(),
    };

    let mut entries = Vec::new();
    for model in models {
        let Some(model) = model.as_object() else {
            continue;
        };
        let name = model
            .get("model_name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let label = |window: &str| {
            if name.is_empty() {
                window.to_owned()
            } else {
                format!("{name} · {window}")
            }
        };
        entries.extend(minimax_window(
            model,
            label("当前区间"),
            "current_interval_total_count",
            "current_interval_usage_count",
            "current_interval_remaining_percent",
            "end_time",
        ));
        entries.extend(minimax_window(
            model,
            label("本周"),
            "current_weekly_total_count",
            "current_weekly_usage_count",
            "current_weekly_remaining_percent",
            "weekly_end_time",
        ));
    }
    if entries.is_empty() {
        return Err(format!(
            "MiniMax 返回了未识别的结构（字段：{}）",
            key_outline(body)
        ));
    }
    Ok(entries)
}

/// Builds one MiniMax window from its prefixed counters.
fn minimax_window(
    model: &Map<String, Value>,
    label: String,
    total_key: &str,
    usage_key: &str,
    remaining_percent_key: &str,
    end_key: &str,
) -> Option<QuotaEntry> {
    let total = map_number(model, total_key);
    let used = map_number(model, usage_key);
    let remaining_percent = map_number(model, remaining_percent_key);
    if total.is_none() && used.is_none() && remaining_percent.is_none() {
        return None;
    }
    let mut entry = QuotaEntry::new(label, QuotaUnit::Requests);
    entry.total = total;
    entry.used = used;
    entry.remaining = match (total, used) {
        (Some(total), Some(used)) => Some((total - used).max(0.0)),
        _ => None,
    };
    entry.resets_at = map_number(model, end_key).map(normalize_timestamp);
    // Prefer the raw counters, which carry no rounding of the provider's own.
    let mut entry = entry.with_derived_percent();
    if entry.percent.is_none() {
        // MiniMax reports what is *left*; `percent` here is what has been consumed.
        entry.percent = remaining_percent.map(|value| (100.0 - value).clamp(0.0, 100.0));
    }
    Some(entry)
}

// ---------------------------------------------------------------------------
// Agent subscription allowances
// ---------------------------------------------------------------------------
//
// Claude Code and Codex CLI authenticate with a subscription rather than an API key, so neither
// vendor's public API can report what is left — Anthropic's and OpenAI's usage reports are
// organization-level admin endpoints that a Pro/Max or Plus/Pro account cannot call. Both CLIs do
// show the figure themselves (`/usage`, `/status`), by calling a private endpoint with the OAuth
// token they stored at login. That is the same route taken here.

pub const AGENT_CLAUDE_LABEL: &str = "Claude Code";
pub const AGENT_CODEX_LABEL: &str = "Codex";
pub const AGENT_GROK_LABEL: &str = "Grok Build";
pub const AGENT_ANTIGRAVITY_LABEL: &str = "Antigravity";
pub const GROK_QUOTA_ID: &str = "agent:grok";
pub const OPENCODE_PROVIDER_LABEL: &str = "OpenCode";
pub const OPENCODE_CODEX_QUOTA_ID: &str = "agent:opencode:codex";
pub const OPENCODE_GO_QUOTA_ID: &str = "agent:opencode:go";
pub const OPENCODE_CODEX_PROFILE_NAME: &str = "OpenCode · Codex";
pub const OPENCODE_GO_PROFILE_NAME: &str = "OpenCode Go";

/// The endpoint behind Claude Code's `/usage`.
const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
/// The endpoint Codex CLI polls for its `/status` figures.
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
/// The same credits route Grok Build uses for its `/usage` panel.
const GROK_CREDITS_URL: &str = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
/// The endpoint OpenCode Go uses for its rolling, weekly and monthly subscription windows.
const OPENCODE_GO_USAGE_URL: &str = "https://opencode.ai/zen/go/v1/usage";
/// The beta gate on the usage endpoint; without it the request is rejected outright.
const CLAUDE_OAUTH_BETA: &str = "oauth-2025-04-20";
/// Anthropic buckets this endpoint by User-Agent. A client that does not look like Claude Code
/// lands in a far stricter bucket that starts answering 429 almost immediately.
const CLAUDE_USER_AGENT: &str = "claude-code/2.0.0";

pub fn agent_display_name(agent_type: &str) -> &'static str {
    match agent_type.trim() {
        "claude" => AGENT_CLAUDE_LABEL,
        "grok" => AGENT_GROK_LABEL,
        "antigravity" => AGENT_ANTIGRAVITY_LABEL,
        _ => AGENT_CODEX_LABEL,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenCodeCodexCredential {
    pub access_token: String,
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OpenCodeCredentials {
    pub codex: Option<OpenCodeCodexCredential>,
    pub go_api_key: Option<String>,
}

/// Reads only the two credentials needed for allowance requests from OpenCode's own auth store.
pub fn read_opencode_credentials() -> Result<OpenCodeCredentials, String> {
    let fallback_go_api_key = std::env::var("OPENCODE_API_KEY").ok();
    let injected = std::env::var("OPENCODE_AUTH_CONTENT")
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .filter(Value::is_object);
    let auth = match injected {
        Some(auth) => auth,
        None => {
            let path = opencode_auth_path();
            match fs::read_to_string(&path) {
                Ok(content) => serde_json::from_str::<Value>(&content)
                    .map_err(|error| format!("OpenCode 登录凭据解析失败：{error}"))?,
                Err(error) if error.kind() == ErrorKind::NotFound => Value::Object(Map::new()),
                Err(error) => return Err(format!("无法读取 OpenCode 登录凭据：{error}")),
            }
        }
    };
    parse_opencode_credentials(&auth, fallback_go_api_key.as_deref())
}

fn opencode_auth_path() -> PathBuf {
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .map(PathBuf::from)
                .map(|home| home.join(".local").join("share"))
        });
    data_home
        .unwrap_or_default()
        .join("opencode")
        .join("auth.json")
}

fn parse_opencode_credentials(
    auth: &Value,
    fallback_go_api_key: Option<&str>,
) -> Result<OpenCodeCredentials, String> {
    let auth = auth
        .as_object()
        .ok_or_else(|| "OpenCode 登录凭据必须是 JSON 对象".to_owned())?;
    let codex = auth
        .get("openai")
        .and_then(Value::as_object)
        .filter(|credential| credential.get("type").and_then(Value::as_str) == Some("oauth"))
        .and_then(|credential| {
            let access_token = credential
                .get("access")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|token| !token.is_empty())?;
            let account_id = credential
                .get("accountId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_owned)
                .or_else(|| chatgpt_account_id(access_token));
            Some(OpenCodeCodexCredential {
                access_token: access_token.to_owned(),
                account_id,
            })
        });
    let stored_go_api_key = auth
        .get("opencode-go")
        .and_then(Value::as_object)
        .filter(|credential| credential.get("type").and_then(Value::as_str) == Some("api"))
        .and_then(|credential| credential.get("key"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty());
    let go_api_key = stored_go_api_key
        .or_else(|| {
            fallback_go_api_key
                .map(str::trim)
                .filter(|key| !key.is_empty())
        })
        .map(str::to_owned);
    Ok(OpenCodeCredentials { codex, go_api_key })
}

/// Reads the account claim OpenAI places in its OAuth JWT without validating or logging the token.
fn chatgpt_account_id(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| URL_SAFE.decode(payload))
        .ok()?;
    let claims = serde_json::from_slice::<Value>(&decoded).ok()?;
    claims
        .get("chatgpt_account_id")
        .or_else(|| {
            claims
                .get("https://api.openai.com/auth")
                .and_then(|auth| auth.get("chatgpt_account_id"))
        })
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
}

/// Locates an agent's configuration home, honouring the per-account isolation.
///
/// An account profile carries its own directory (exported to the agent as `CLAUDE_CONFIG_DIR` or
/// `CODEX_HOME`), so each signed-in account is read separately. The default profile has none and
/// falls back to the CLI's own location.
fn agent_home(agent_type: &str, config_dir: Option<&str>) -> PathBuf {
    if let Some(directory) = config_dir
        .map(str::trim)
        .filter(|directory| !directory.is_empty())
    {
        return PathBuf::from(directory);
    }
    let (variable, default_directory) = if agent_type == "claude" {
        ("CLAUDE_CONFIG_DIR", ".claude")
    } else {
        ("CODEX_HOME", ".codex")
    };
    if let Some(configured) = std::env::var_os(variable) {
        return PathBuf::from(configured);
    }
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
        .join(default_directory)
}

/// Reads the OAuth access token an agent CLI stored when it signed in.
pub fn read_agent_token(agent_type: &str, config_dir: Option<&str>) -> Result<String, String> {
    let home = agent_home(agent_type, config_dir);
    let (file, path_to_token): (&str, [&str; 2]) = if agent_type == "claude" {
        (".credentials.json", ["claudeAiOauth", "accessToken"])
    } else {
        ("auth.json", ["tokens", "access_token"])
    };
    let path = home.join(file);
    let value = read_json(&path)?;
    value
        .get(path_to_token[0])
        .and_then(|nested| nested.get(path_to_token[1]))
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            format!(
                "{} 尚未登录，无法查询订阅额度",
                agent_display_name(agent_type)
            )
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrokCredential {
    pub key: String,
    pub user_id: String,
}

/// Reuses the Grok CLI's signed-in account without copying its refresh token.
pub fn read_grok_credential() -> Result<GrokCredential, String> {
    let home = grok_home().ok_or_else(|| "无法找到 Grok Build 配置目录".to_owned())?;
    let auth = read_json(&home.join("auth.json"))?;
    parse_grok_credential(&auth)
}

fn grok_home() -> Option<PathBuf> {
    std::env::var_os("GROK_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .map(|home| PathBuf::from(home).join(".grok"))
        })
}

/// The free plan omits its percentage even after it runs out. Grok's own limit error is the only
/// local evidence that this period is exhausted; an older period's error must not count.
pub fn latest_grok_free_usage_exhaustion() -> Option<i64> {
    latest_grok_free_usage_exhaustion_in(&grok_home()?.join("logs/unified.jsonl"))
}

fn latest_grok_free_usage_exhaustion_in(path: &Path) -> Option<i64> {
    let file = fs::File::open(path).ok()?;
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter(|line| line.contains("subscription:free-usage-exhausted"))
        .filter_map(|line| serde_json::from_str::<Value>(&line).ok())
        .filter(|event| {
            event
                .pointer("/ctx/error")
                .and_then(Value::as_str)
                .is_some_and(|error| error.contains("subscription:free-usage-exhausted"))
        })
        .filter_map(|event| event.get("ts").and_then(parse_timestamp))
        .max()
}

fn parse_grok_credential(auth: &Value) -> Result<GrokCredential, String> {
    let entries = auth
        .as_object()
        .ok_or_else(|| "Grok Build 登录凭据格式无效".to_owned())?;
    let candidate = entries
        .iter()
        .filter_map(|(scope, value)| {
            if scope != "https://auth.x.ai"
                && !scope.starts_with("https://auth.x.ai::")
                && !scope.starts_with("https://accounts.x.ai/")
            {
                return None;
            }
            let key = value.get("key")?.as_str()?.trim();
            let user_id = value.get("user_id")?.as_str()?.trim();
            if key.is_empty() || user_id.is_empty() {
                return None;
            }
            Some(GrokCredential {
                key: key.into(),
                user_id: user_id.into(),
            })
        })
        .next();
    candidate.ok_or_else(|| "Grok Build 尚未通过 grok.com 登录，请先运行 grok login".to_owned())
}

pub fn build_grok_request(
    credential: &GrokCredential,
    version: Option<&str>,
    proxy_base_url: Option<&str>,
) -> QuotaRequest {
    let url = proxy_base_url
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(|base| format!("{}/billing?format=credits", base.trim_end_matches('/')))
        .unwrap_or_else(|| GROK_CREDITS_URL.to_owned());
    let mut request = QuotaRequest::bearer(url, &credential.key);
    request.headers.extend([
        ("X-XAI-Token-Auth", "xai-grok-cli".to_owned()),
        ("x-userid", credential.user_id.clone()),
        ("x-grok-client-mode", "interactive".to_owned()),
        ("Accept", "application/json".to_owned()),
    ]);
    if let Some(version) = version.and_then(|value| value.split_whitespace().nth(1)) {
        request
            .headers
            .push(("x-grok-client-version", version.to_owned()));
    }
    request
}

/// The weekly percentage is shared across Grok products, including Build.
pub fn parse_grok_response(body: &Value) -> Result<Vec<QuotaEntry>, String> {
    parse_grok_response_with_exhaustion(body, None)
}

pub fn parse_grok_response_with_exhaustion(
    body: &Value,
    exhausted_at: Option<i64>,
) -> Result<Vec<QuotaEntry>, String> {
    let config = body
        .get("config")
        .ok_or_else(|| "Grok Build 未返回额度配置".to_owned())?;
    let period = config.get("currentPeriod");
    let period_type = period
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let label = if period_type.contains("WEEKLY") {
        "每周共享额度"
    } else if period_type.contains("MONTHLY") {
        "每月共享额度"
    } else {
        "订阅共享额度"
    };
    let legacy_limit = config
        .get("monthlyLimit")
        .and_then(|value| loose_number(value, "val"))
        .filter(|value| *value > 0.0);
    let used_percent = loose_number(config, "creditUsagePercent")
        .or_else(|| {
            legacy_limit.and_then(|limit| {
                config
                    .get("used")
                    .and_then(|value| loose_number(value, "val"))
                    .map(|used| used / limit * 100.0)
            })
        })
        // An omitted percentage is unknown. In particular, an exhausted free allowance can
        // return a period without a usable percentage; treating absence as zero is misleading.
        .filter(|percent| percent.is_finite());
    let mut entries = Vec::new();
    if used_percent.is_some() || period.is_some() {
        let period_start = period
            .and_then(|value| value.get("start"))
            .and_then(parse_timestamp);
        let period_end = period
            .and_then(|value| value.get("end"))
            .and_then(parse_timestamp);
        let exhausted = used_percent.is_none()
            && exhausted_at.is_some_and(|at| {
                period_start.is_some_and(|start| at >= start)
                    && period_end.is_none_or(|end| at < end)
            });
        let mut entry = QuotaEntry::new(
            if exhausted {
                "免费额度已用尽（依据 Grok 限额错误）"
            } else if used_percent.is_none() {
                "本期额度（服务端未提供用量百分比）"
            } else {
                label
            },
            QuotaUnit::Percent,
        );
        entry.percent = used_percent.map(|percent| percent.clamp(0.0, 100.0));
        if exhausted {
            entry.percent = Some(100.0);
        }
        entry.resets_at = period
            .and_then(|value| value.get("end"))
            .or_else(|| config.get("billingPeriodEnd"))
            .and_then(parse_timestamp);
        entries.push(entry);
    }
    if let Some(balance) = config
        .get("prepaidBalance")
        .and_then(|value| loose_number(value, "val"))
        .filter(|balance| balance.is_finite() && *balance > 0.0)
    {
        let mut entry = QuotaEntry::new("额外点数余额", QuotaUnit::Currency);
        entry.currency = Some("USD".into());
        entry.remaining = Some(balance / 100.0);
        entries.push(entry);
    }
    if entries.is_empty() {
        return Err(format!(
            "Grok Build 返回了未识别的额度结构（字段：{}）",
            key_outline(body)
        ));
    }
    Ok(entries)
}

fn read_json(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|_| "尚未登录，未找到登录凭据".to_owned())?;
    serde_json::from_str(&text).map_err(|error| format!("登录凭据解析失败：{error}"))
}

pub fn build_agent_request(agent_type: &str, token: &str) -> QuotaRequest {
    if agent_type == "claude" {
        QuotaRequest {
            url: CLAUDE_USAGE_URL.to_owned(),
            headers: vec![
                (AUTHORIZATION, format!("Bearer {token}")),
                ("anthropic-beta", CLAUDE_OAUTH_BETA.to_owned()),
                ("User-Agent", CLAUDE_USER_AGENT.to_owned()),
            ],
        }
    } else {
        QuotaRequest::bearer(CODEX_USAGE_URL.to_owned(), token)
    }
}

pub fn build_opencode_codex_request(credential: &OpenCodeCodexCredential) -> QuotaRequest {
    let mut request = QuotaRequest::bearer(CODEX_USAGE_URL.to_owned(), &credential.access_token);
    request
        .headers
        .push(("Accept", "application/json".to_owned()));
    if let Some(account_id) = credential.account_id.as_deref() {
        request
            .headers
            .push(("ChatGPT-Account-Id", account_id.to_owned()));
    }
    request
}

pub fn build_opencode_go_request(api_key: &str) -> QuotaRequest {
    let mut request = QuotaRequest::bearer(OPENCODE_GO_USAGE_URL.to_owned(), api_key);
    request
        .headers
        .push(("Accept", "application/json".to_owned()));
    request
}

pub fn parse_opencode_codex_response(body: &Value) -> Result<Vec<QuotaEntry>, String> {
    let rate_limit = body
        .get("rate_limit")
        .ok_or_else(|| "OpenCode Codex 未返回订阅额度".to_owned())?;
    Ok(vec![
        parse_used_window(
            rate_limit.get("primary_window"),
            "5 小时窗口",
            "used_percent",
            "reset_at",
        )?,
        parse_used_window(
            rate_limit.get("secondary_window"),
            "每周额度",
            "used_percent",
            "reset_at",
        )?,
    ])
}

pub fn parse_opencode_go_response(body: &Value) -> Result<Vec<QuotaEntry>, String> {
    let usage = body
        .get("usage")
        .ok_or_else(|| "OpenCode Go 未返回订阅额度".to_owned())?;
    Ok(vec![
        parse_used_window(usage.get("rolling"), "5 小时窗口", "percent", "resetsAt")?,
        parse_used_window(usage.get("weekly"), "每周额度", "percent", "resetsAt")?,
        parse_used_window(usage.get("monthly"), "每月额度", "percent", "resetsAt")?,
    ])
}

fn parse_used_window(
    value: Option<&Value>,
    label: &str,
    percent_key: &str,
    reset_key: &str,
) -> Result<QuotaEntry, String> {
    let value = value.ok_or_else(|| format!("{label}不可用"))?;
    let percent = loose_number(value, percent_key)
        .filter(|percent| percent.is_finite())
        .ok_or_else(|| format!("{label}的已用比例无效"))?;
    let resets_at = value
        .get(reset_key)
        .and_then(parse_timestamp)
        .ok_or_else(|| format!("{label}的重置时间无效"))?;
    let mut entry = QuotaEntry::new(label, QuotaUnit::Percent);
    entry.percent = Some(percent.clamp(0.0, 100.0));
    entry.resets_at = Some(resets_at);
    Ok(entry)
}

/// Turns an agent's usage response into allowance lines.
///
/// Both endpoints are private and undocumented, and both have changed shape before, so rather than
/// hard-coding one layout this walks the response for any object that reports a percentage and
/// treats it as one window. That survives a renamed wrapper or an extra nesting level.
pub fn parse_agent_response(agent_type: &str, body: &Value) -> Result<Vec<QuotaEntry>, String> {
    let mut entries = Vec::new();
    collect_windows(body, "", &mut entries);
    if entries.is_empty() {
        return Err(format!(
            "{} 返回了未识别的结构（字段：{}）",
            agent_display_name(agent_type),
            key_outline(body)
        ));
    }
    // Windows arrive in an arbitrary order; the shortest one first reads best.
    entries.sort_by(|left, right| left.label.cmp(&right.label));
    Ok(entries)
}

/// Percentage keys meaning "already consumed", then the ones meaning "still available".
const USED_PERCENT_KEYS: [&str; 5] = [
    "utilization",
    "used_percent",
    "percent_used",
    "usage_percent",
    "percentage",
];
const LEFT_PERCENT_KEYS: [&str; 3] = ["percent_left", "remaining_percent", "percent_remaining"];
const RESET_AT_KEYS: [&str; 4] = ["resets_at", "reset_at", "resets_at_utc", "reset_time"];

fn collect_windows(value: &Value, key: &str, entries: &mut Vec<QuotaEntry>) {
    match value {
        Value::Object(object) => {
            if let Some(entry) = window_entry(object, key) {
                entries.push(entry);
            }
            for (child_key, child) in object {
                collect_windows(child, child_key, entries);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_windows(child, key, entries);
            }
        }
        _ => {}
    }
}

fn window_entry(object: &Map<String, Value>, key: &str) -> Option<QuotaEntry> {
    let used = USED_PERCENT_KEYS
        .iter()
        .find_map(|name| map_number(object, name));
    let left = LEFT_PERCENT_KEYS
        .iter()
        .find_map(|name| map_number(object, name));
    let percent = used.or_else(|| left.map(|value| 100.0 - value))?;
    // A window that states its own length names itself better than its key does: Codex hangs its
    // limits off `primary`/`secondary`, which says nothing about which is the 5-hour one.
    let label = map_number(object, "limit_window_seconds")
        .map(duration_label)
        .or_else(|| {
            object
                .get("name")
                .or_else(|| object.get("window"))
                .and_then(Value::as_str)
                .map(window_label)
        })
        .unwrap_or_else(|| window_label(key));
    let mut entry = QuotaEntry::new(label, QuotaUnit::Percent);
    entry.percent = Some(percent.clamp(0.0, 100.0));
    entry.resets_at = RESET_AT_KEYS
        .iter()
        .find_map(|name| object.get(*name).and_then(parse_timestamp));
    Some(entry)
}

/// Names a window by how long it runs.
fn duration_label(seconds: f64) -> String {
    let hours = (seconds / 3_600.0).round() as i64;
    if hours < 24 {
        format!("{hours} 小时窗口")
    } else {
        format!("{} 天窗口", (hours as f64 / 24.0).round() as i64)
    }
}

/// Names the windows the agents actually report, and passes anything else through.
fn window_label(key: &str) -> String {
    let normalized = key.to_ascii_lowercase();
    if normalized.contains("five_hour") || normalized.contains("5h") {
        "5 小时窗口".to_owned()
    } else if normalized.contains("seven_day")
        || normalized.contains("weekly")
        || normalized.contains("week")
    {
        "每周额度".to_owned()
    } else if normalized.contains("opus") {
        "Opus 额度".to_owned()
    } else if normalized.is_empty() {
        "订阅额度".to_owned()
    } else {
        key.replace('_', " ")
    }
}

/// Accepts a numeric epoch or an RFC 3339 string, which both endpoints have been seen to use.
/// Builds an allowance line from the share of a window that is left.
///
/// The agent CLIs report what remains rather than what was spent, and give no absolute figure to
/// go with it — there is no token count or balance behind a weekly cap. `percent` carries the
/// consumed share, which is what the rest of the app reads, so the reported share is inverted here
/// once rather than at each place that draws it.
pub fn remaining_share_entry(
    label: impl Into<String>,
    remaining_fraction: f64,
    reset_time: Option<&str>,
) -> QuotaEntry {
    let mut entry = QuotaEntry::new(label, QuotaUnit::Percent);
    let remaining = remaining_fraction.clamp(0.0, 1.0);
    entry.percent = Some(((1.0 - remaining) * 100.0).clamp(0.0, 100.0));
    entry.resets_at = reset_time
        .map(|text| Value::String(text.to_owned()))
        .as_ref()
        .and_then(parse_timestamp);
    entry
}

fn parse_timestamp(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_f64().map(normalize_timestamp),
        Value::String(text) => text
            .trim()
            .parse::<f64>()
            .ok()
            .map(normalize_timestamp)
            .or_else(|| parse_rfc3339(text)),
        _ => None,
    }
}

/// Reads the `YYYY-MM-DDTHH:MM:SS` prefix as UTC milliseconds.
///
/// Any zone suffix is ignored rather than parsed: getting it wrong shifts a "resets in N hours"
/// label by a few hours, which beats dragging in a date library for one field.
fn parse_rfc3339(text: &str) -> Option<i64> {
    if text.len() < 19 {
        return None;
    }
    let year: i64 = text.get(0..4)?.parse().ok()?;
    let month: i64 = text.get(5..7)?.parse().ok()?;
    let day: i64 = text.get(8..10)?.parse().ok()?;
    let hour: i64 = text.get(11..13)?.parse().ok()?;
    let minute: i64 = text.get(14..16)?.parse().ok()?;
    let second: i64 = text.get(17..19)?.parse().ok()?;
    let seconds = days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second;
    Some(seconds * 1_000)
}

/// Days between 1970-01-01 and the given civil date (Howard Hinnant's `days_from_civil`).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Seconds and milliseconds both appear in the wild; anything below this is treated as seconds.
const MILLISECOND_EPOCH_FLOOR: f64 = 100_000_000_000.0;

fn normalize_timestamp(value: f64) -> i64 {
    if value < MILLISECOND_EPOCH_FLOOR {
        (value * 1000.0) as i64
    } else {
        value as i64
    }
}

/// Reads a number that the provider may have sent as a JSON number or as a string.
fn loose_number(value: &Value, key: &str) -> Option<f64> {
    number_of(value.get(key))
}

fn map_number(object: &Map<String, Value>, key: &str) -> Option<f64> {
    number_of(object.get(key))
}

fn number_of(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn visit_objects(value: &Value, visit: &mut impl FnMut(&Map<String, Value>)) {
    match value {
        Value::Object(object) => {
            visit(object);
            for child in object.values() {
                visit_objects(child, visit);
            }
        }
        Value::Array(items) => {
            for child in items {
                visit_objects(child, visit);
            }
        }
        _ => {}
    }
}

/// Key names only — never values, which would put balances or secrets into the log.
fn key_outline(value: &Value) -> String {
    let mut keys = Vec::new();
    visit_objects(value, &mut |object| {
        for key in object.keys() {
            if !keys.contains(key) {
                keys.push(key.clone());
            }
        }
    });
    keys.sort();
    keys.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The CLIs report what is left; the app draws what has been consumed.
    #[test]
    fn a_remaining_share_becomes_a_consumed_percentage() {
        let spent = remaining_share_entry("周额度", 0.0, Some("2026-09-18T16:45:19Z"));
        assert_eq!(spent.unit, QuotaUnit::Percent);
        assert_eq!(spent.percent, Some(100.0));
        // 2026-09-18T16:45:19Z
        assert_eq!(spent.resets_at, Some(1_789_749_919_000));

        let untouched = remaining_share_entry("周额度", 1.0, None);
        assert_eq!(untouched.percent, Some(0.0));
        assert_eq!(untouched.resets_at, None);
    }

    /// A share outside 0-1 is a provider bug, not a reason to draw a nonsense bar.
    #[test]
    fn a_share_outside_the_range_is_clamped() {
        assert_eq!(remaining_share_entry("x", 1.5, None).percent, Some(0.0));
        assert_eq!(remaining_share_entry("x", -0.5, None).percent, Some(100.0));
    }
    use serde_json::json;

    #[test]
    fn derives_the_quota_host_from_the_profile_endpoint() {
        // Kimi's international and mainland sites issue separate keys, so the balance has to be
        // read from whichever host the profile already authenticates against.
        let request = build_request(
            "Kimi",
            Some("https://api.moonshot.ai/anthropic"),
            "test-key",
        )
        .unwrap();

        assert_eq!(request.url, "https://api.moonshot.ai/v1/users/me/balance");
        assert_eq!(
            request.headers,
            vec![("Authorization", "Bearer test-key".to_owned())]
        );
    }

    #[test]
    fn falls_back_to_the_documented_host_without_a_base_url() {
        let request = build_request("DeepSeek", None, "test-key").unwrap();

        assert_eq!(request.url, "https://api.deepseek.com/user/balance");
    }

    #[test]
    fn sends_the_glm_key_without_a_bearer_prefix() {
        // This endpoint rejects `Bearer `, unlike every other provider here.
        let request = build_request(
            "GLM",
            Some("https://open.bigmodel.cn/api/anthropic"),
            "test-key",
        )
        .unwrap();

        assert_eq!(
            request.url,
            "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
        );
        assert_eq!(
            request.headers,
            vec![("Authorization", "test-key".to_owned())]
        );
    }

    #[test]
    fn reads_minimax_from_its_website_host_not_the_api_host() {
        let request = build_request(
            "MiniMax",
            Some("https://api.minimaxi.com/anthropic"),
            "test-key",
        )
        .unwrap();

        assert_eq!(request.url, MINIMAX_QUOTA_URL);
    }

    #[test]
    fn offers_no_request_for_providers_without_an_endpoint() {
        assert!(build_request("Anthropic", None, "test-key").is_none());
        assert!(build_request("OpenAI", None, "test-key").is_none());
        assert!(build_request("SCNet", None, "test-key").is_none());
        assert!(!supports_quota("Anthropic"));
        assert!(!supports_quota("SCNet"));
    }

    #[test]
    fn parses_deepseek_string_amounts_per_currency() {
        let body = json!({
            "is_available": true,
            "balance_infos": [{
                "currency": "CNY",
                "total_balance": "110.00",
                "granted_balance": "10.00",
                "topped_up_balance": "100.00"
            }]
        });

        let entries = parse_response("DeepSeek", &body).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].currency.as_deref(), Some("CNY"));
        assert_eq!(entries[0].remaining, Some(110.0));
        assert_eq!(entries[0].unit, QuotaUnit::Currency);
    }

    #[test]
    fn parses_the_kimi_available_balance() {
        let body = json!({
            "code": 0,
            "data": {
                "available_balance": 49.58894,
                "voucher_balance": 46.58893,
                "cash_balance": 3.00001
            },
            "scode": "0x0",
            "status": true
        });

        let entries = parse_response("Kimi", &body).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].remaining, Some(49.58894));
        assert_eq!(entries[0].currency.as_deref(), Some("USD"));
    }

    #[test]
    fn parses_every_glm_window_and_keeps_the_reported_share() {
        let body = json!({
            "data": {
                "level": "pro",
                "limits": [
                    { "type": "TIME_LIMIT", "usage": 12, "currentValue": 100, "remaining": 88 },
                    { "type": "TOKENS_LIMIT", "usage": 300, "currentValue": 1000, "remaining": 700, "percentage": 30 },
                    { "type": "TOKENS_LIMIT", "usage": 4000, "currentValue": 20000, "remaining": 16000 }
                ]
            }
        });

        let entries = parse_response("GLM", &body).unwrap();

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].unit, QuotaUnit::Requests);
        assert_eq!(entries[1].unit, QuotaUnit::Tokens);
        assert_eq!(entries[1].percent, Some(30.0));
        // The second token window sends no share, so it is derived from used/total.
        assert_eq!(entries[2].percent, Some(20.0));
    }

    #[test]
    fn parses_both_minimax_windows_per_model_as_request_counts() {
        // Field names taken from a real `token_plan/remains` response.
        let body = json!({
            "base_resp": { "status_code": 0, "status_msg": "success" },
            "model_remains": [{
                "model_name": "MiniMax-M3",
                "current_interval_total_count": 1000,
                "current_interval_usage_count": 300,
                "current_interval_remaining_percent": 70,
                "current_interval_status": "normal",
                "start_time": 1_754_000_000u64,
                "end_time": 1_754_018_000u64,
                "remains_time": 18_000,
                "current_weekly_total_count": 5000,
                "current_weekly_usage_count": 1000,
                "current_weekly_remaining_percent": 80,
                "current_weekly_status": "normal",
                "weekly_start_time": 1_753_900_000u64,
                "weekly_end_time": 1_754_500_000u64,
                "weekly_remains_time": 500_000
            }]
        });

        let entries = parse_response("MiniMax", &body).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].label, "MiniMax-M3 · 当前区间");
        // The plan is sold in requests, not tokens, despite the endpoint's name.
        assert_eq!(entries[0].unit, QuotaUnit::Requests);
        assert_eq!(entries[0].remaining, Some(700.0));
        // `percent` is consumption, while MiniMax reports what is left.
        assert_eq!(entries[0].percent, Some(30.0));
        assert_eq!(entries[0].resets_at, Some(1_754_018_000_000));
        assert_eq!(entries[1].label, "MiniMax-M3 · 本周");
        assert_eq!(entries[1].remaining, Some(4000.0));
        assert_eq!(entries[1].percent, Some(20.0));
        assert_eq!(entries[1].resets_at, Some(1_754_500_000_000));
    }

    #[test]
    fn falls_back_to_the_minimax_remaining_share_without_counters() {
        let body = json!({
            "model_remains": { "current_weekly_remaining_percent": 35 }
        });

        let entries = parse_response("MiniMax", &body).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].label, "本周");
        assert_eq!(entries[0].percent, Some(65.0));
    }

    #[test]
    fn surfaces_a_minimax_error_response() {
        let body = json!({
            "base_resp": { "status_code": 1004, "status_msg": "invalid api key" }
        });

        let error = parse_response("MiniMax", &body).unwrap_err();

        assert!(error.contains("1004"));
        assert!(error.contains("invalid api key"));
    }

    #[test]
    fn reports_an_unrecognised_minimax_shape_with_key_names_only() {
        let body = json!({ "base_resp": { "status_code": 0 }, "payload": { "note": "unknown" } });

        let error = parse_response("MiniMax", &body).unwrap_err();

        assert!(error.contains("未识别"));
        // Key names help tighten the parser; values could carry the balance itself.
        assert!(error.contains("status_code"));
        assert!(!error.contains("unknown"));
    }

    #[test]
    fn marks_only_the_undocumented_endpoints_as_unofficial() {
        assert!(is_official("DeepSeek"));
        assert!(is_official("Kimi"));
        assert!(is_official("MiniMax"));
        assert!(!is_official("GLM"));
        // The agent endpoints are private APIs their own clients call or undocumented.
        assert!(!is_official(AGENT_CLAUDE_LABEL));
        assert!(!is_official(AGENT_CODEX_LABEL));
        assert!(!is_official(AGENT_GROK_LABEL));
        assert!(!is_official(AGENT_ANTIGRAVITY_LABEL));
        assert!(!is_official(OPENCODE_PROVIDER_LABEL));
    }

    #[test]
    fn reports_expected_agent_display_names() {
        assert_eq!(agent_display_name("claude"), AGENT_CLAUDE_LABEL);
        assert_eq!(agent_display_name("codex"), AGENT_CODEX_LABEL);
        assert_eq!(agent_display_name("grok"), AGENT_GROK_LABEL);
        assert_eq!(agent_display_name("antigravity"), AGENT_ANTIGRAVITY_LABEL);
    }

    #[test]
    fn reads_grok_login_and_builds_the_cli_billing_request() {
        let auth = json!({
            "https://other.example": {"key": "other", "user_id": "other-user"},
            "https://auth.x.ai::client": {
                "key": "grok-token",
                "user_id": "grok-user",
                "refresh_token": "must-not-be-used"
            }
        });
        let credential = parse_grok_credential(&auth).unwrap();
        assert_eq!(credential.key, "grok-token");
        assert_eq!(credential.user_id, "grok-user");
        let request = build_grok_request(&credential, Some("grok 1.0.34 (build)"), None);
        assert_eq!(request.url, GROK_CREDITS_URL);
        assert!(request
            .headers
            .contains(&("X-XAI-Token-Auth", "xai-grok-cli".into())));
        assert!(request
            .headers
            .contains(&("x-grok-client-version", "1.0.34".into())));
        assert!(!request
            .headers
            .iter()
            .any(|(_, value)| value == "must-not-be-used"));
        assert!(parse_grok_credential(&json!({
            "https://other.example": {"key": "foreign-token", "user_id": "user"}
        }))
        .is_err());
    }

    #[test]
    fn parses_grok_shared_weekly_usage_and_extra_credits() {
        let body = json!({
            "config": {
                "creditUsagePercent": 37.5,
                "currentPeriod": {
                    "type": "USAGE_PERIOD_TYPE_WEEKLY",
                    "end": "2026-09-22T00:00:00+00:00"
                },
                "isUnifiedBillingUser": true,
                "prepaidBalance": {"val": 725}
            }
        });
        let entries = parse_grok_response(&body).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].label, "每周共享额度");
        assert_eq!(entries[0].percent, Some(37.5));
        assert!(entries[0].resets_at.is_some());
        assert_eq!(entries[1].remaining, Some(7.25));
        assert_eq!(entries[1].currency.as_deref(), Some("USD"));
    }

    #[test]
    fn does_not_invent_zero_usage_when_grok_omits_the_percentage() {
        let current = json!({
            "config": {
                "currentPeriod": {"type": "USAGE_PERIOD_TYPE_WEEKLY", "end": "2026-09-22T00:00:00Z"},
                "isUnifiedBillingUser": true,
                "monthlyLimit": {"val": 1000},
                "productUsage": [{"product": "PRODUCT_GROK_BUILD", "usagePercent": 0}],
                "prepaidBalance": {"val": 0}
            }
        });
        let entries = parse_grok_response(&current).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].percent, None);
        assert!(entries[0].resets_at.is_some());
        let serialized = serde_json::to_value(&entries[0]).unwrap();
        assert!(serialized.get("percent").is_none());
        assert!(serialized.get("remaining").is_none());
        assert!(parse_grok_response(&json!({"config": {"unexpected": true}})).is_err());
    }

    #[test]
    fn infers_exhaustion_only_from_a_grok_error_in_the_current_period() {
        let body = json!({"config": {"currentPeriod": {
            "type": "USAGE_PERIOD_TYPE_WEEKLY",
            "start": "2026-09-15T00:00:00Z",
            "end": "2026-09-22T00:00:00Z"
        }}});
        let current = parse_rfc3339("2026-09-19T16:23:02Z").unwrap();
        let old = parse_rfc3339("2026-09-14T16:23:02Z").unwrap();
        assert_eq!(
            parse_grok_response_with_exhaustion(&body, Some(current)).unwrap()[0].percent,
            Some(100.0)
        );
        assert_eq!(
            parse_grok_response_with_exhaustion(&body, Some(old)).unwrap()[0].percent,
            None
        );
    }

    #[test]
    fn reads_the_last_grok_free_usage_limit_error_without_using_log_contents_as_usage() {
        let root = std::env::temp_dir().join(format!("termexo-grok-quota-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let log = root.join("unified.jsonl");
        fs::write(
            &log,
            concat!(
                "{\"ts\":\"2026-09-18T10:00:00Z\",\"msg\":\"agent response failed\",\"ctx\":{\"error\":\"subscription:free-usage-exhausted\"}}\n",
                "{\"ts\":\"2026-09-19T16:23:02Z\",\"msg\":\"agent response failed\",\"ctx\":{\"error\":\"subscription:free-usage-exhausted\"}}\n",
                "{\"ts\":\"2026-09-20T00:00:00Z\",\"msg\":\"user mentioned subscription:free-usage-exhausted\"}\n",
            ),
        )
        .unwrap();
        assert_eq!(
            latest_grok_free_usage_exhaustion_in(&log),
            parse_rfc3339("2026-09-19T16:23:02Z")
        );
        fs::remove_file(log).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn accepts_an_explicit_zero_grok_usage_percentage() {
        let body = json!({"config": {"creditUsagePercent": 0, "isUnifiedBillingUser": true}});
        assert_eq!(parse_grok_response(&body).unwrap()[0].percent, Some(0.0));
    }

    #[test]
    fn sends_the_headers_the_claude_usage_endpoint_requires() {
        let request = build_agent_request("claude", "test-token");

        assert_eq!(request.url, CLAUDE_USAGE_URL);
        assert_eq!(
            request.headers,
            vec![
                ("Authorization", "Bearer test-token".to_owned()),
                ("anthropic-beta", CLAUDE_OAUTH_BETA.to_owned()),
                // Anything else lands in a bucket that answers 429 almost immediately.
                ("User-Agent", CLAUDE_USER_AGENT.to_owned()),
            ]
        );
    }

    #[test]
    fn parses_the_claude_rolling_and_weekly_windows() {
        let body = json!({
            "five_hour": { "utilization": 45, "resets_at": "2026-08-10T05:00:00Z" },
            "seven_day": { "utilization": 20, "resets_at": "2026-08-14T03:00:00Z" }
        });

        let entries = parse_agent_response("claude", &body).unwrap();

        assert_eq!(entries.len(), 2);
        let five_hour = entries
            .iter()
            .find(|entry| entry.label == "5 小时窗口")
            .unwrap();
        assert_eq!(five_hour.unit, QuotaUnit::Percent);
        assert_eq!(five_hour.percent, Some(45.0));
        // 2026-08-10T05:00:00Z
        assert_eq!(five_hour.resets_at, Some(1_786_338_000_000));
        assert!(entries.iter().any(|entry| entry.label == "每周额度"));
    }

    #[test]
    fn names_codex_windows_by_their_length_and_inverts_percent_left() {
        // Codex hangs limits off `primary`/`secondary`, so the window length is what identifies them.
        let body = json!({
            "plan": "plus",
            "rate_limits": {
                "primary": { "percent_left": 70, "limit_window_seconds": 18000, "reset_at": 1_754_000_000u64 },
                "secondary": { "percent_left": 88, "limit_window_seconds": 604800 }
            }
        });

        let entries = parse_agent_response("codex", &body).unwrap();

        assert_eq!(entries.len(), 2);
        let five_hour = entries
            .iter()
            .find(|entry| entry.label == "5 小时窗口")
            .unwrap();
        // `percent_left` is what remains; `percent` is what has been consumed.
        assert_eq!(five_hour.percent, Some(30.0));
        assert_eq!(five_hour.resets_at, Some(1_754_000_000_000));
        let weekly = entries
            .iter()
            .find(|entry| entry.label == "7 天窗口")
            .unwrap();
        assert_eq!(weekly.percent, Some(12.0));
    }

    #[test]
    fn reports_an_unrecognised_agent_shape_with_key_names_only() {
        let body = json!({ "account": { "plan": "pro" } });

        let error = parse_agent_response("claude", &body).unwrap_err();

        assert!(error.contains("未识别"));
        assert!(error.contains("plan"));
        assert!(!error.contains("pro"));
    }

    #[test]
    fn reads_opencode_codex_and_go_credentials_without_exposing_other_auth_entries() {
        let payload = URL_SAFE_NO_PAD.encode(
            br#"{"https://api.openai.com/auth":{"chatgpt_account_id":"account-from-jwt"}}"#,
        );
        let auth = json!({
            "openai": { "type": "oauth", "access": format!("header.{payload}.signature") },
            "opencode-go": { "type": "api", "key": "stored-go-key" },
            "another-provider": { "type": "api", "key": "must-not-be-read" }
        });

        let credentials = parse_opencode_credentials(&auth, Some("fallback-go-key")).unwrap();

        assert_eq!(
            credentials.codex,
            Some(OpenCodeCodexCredential {
                access_token: format!("header.{payload}.signature"),
                account_id: Some("account-from-jwt".to_owned()),
            })
        );
        assert_eq!(credentials.go_api_key.as_deref(), Some("stored-go-key"));
    }

    #[test]
    fn opencode_go_uses_the_environment_fallback_only_without_a_stored_key() {
        let credentials =
            parse_opencode_credentials(&json!({}), Some("environment-go-key")).unwrap();

        assert_eq!(
            credentials.go_api_key.as_deref(),
            Some("environment-go-key")
        );
        assert!(credentials.codex.is_none());
    }

    #[test]
    fn builds_opencode_usage_requests_with_the_required_identity_headers() {
        let codex = build_opencode_codex_request(&OpenCodeCodexCredential {
            access_token: "codex-token".to_owned(),
            account_id: Some("account-2".to_owned()),
        });
        assert_eq!(codex.url, CODEX_USAGE_URL);
        assert_eq!(
            codex.headers,
            vec![
                (AUTHORIZATION, "Bearer codex-token".to_owned()),
                ("Accept", "application/json".to_owned()),
                ("ChatGPT-Account-Id", "account-2".to_owned()),
            ]
        );

        let go = build_opencode_go_request("go-key");
        assert_eq!(go.url, OPENCODE_GO_USAGE_URL);
        assert_eq!(
            go.headers,
            vec![
                (AUTHORIZATION, "Bearer go-key".to_owned()),
                ("Accept", "application/json".to_owned()),
            ]
        );
    }

    #[test]
    fn parses_opencode_codex_primary_and_secondary_windows() {
        let entries = parse_opencode_codex_response(&json!({
            "rate_limit": {
                "primary_window": { "used_percent": 25, "reset_at": 1_800_000_000u64 },
                "secondary_window": { "used_percent": 50, "reset_at": 1_800_100_000u64 }
            }
        }))
        .unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].label, "5 小时窗口");
        assert_eq!(entries[0].percent, Some(25.0));
        assert_eq!(entries[0].resets_at, Some(1_800_000_000_000));
        assert_eq!(entries[1].label, "每周额度");
        assert_eq!(entries[1].percent, Some(50.0));
    }

    #[test]
    fn parses_all_opencode_go_windows() {
        let entries = parse_opencode_go_response(&json!({
            "usage": {
                "rolling": { "percent": 20, "resetsAt": "2027-01-15T10:00:00.000Z" },
                "weekly": { "percent": 40, "resetsAt": "2027-01-18T00:00:00.000Z" },
                "monthly": { "percent": 60, "resetsAt": "2027-02-01T00:00:00.000Z" }
            }
        }))
        .unwrap();

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].label, "5 小时窗口");
        assert_eq!(entries[0].percent, Some(20.0));
        assert_eq!(entries[1].label, "每周额度");
        assert_eq!(entries[2].label, "每月额度");
        assert_eq!(entries[2].percent, Some(60.0));
    }

    #[test]
    fn rejects_an_incomplete_opencode_usage_window() {
        let error = parse_opencode_go_response(&json!({
            "usage": {
                "rolling": { "percent": null, "resetsAt": "2027-01-15T10:00:00.000Z" },
                "weekly": { "percent": 40, "resetsAt": "2027-01-18T00:00:00.000Z" },
                "monthly": { "percent": 60, "resetsAt": "2027-02-01T00:00:00.000Z" }
            }
        }))
        .unwrap_err();

        assert!(error.contains("5 小时窗口"));
        assert!(error.contains("已用比例无效"));
    }
}
