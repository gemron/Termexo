//! Trading an enrollment code issued by the upstream for this relay's own device credential.
//!
//! A relay joins an upstream through exactly the same `/api/enroll` a desktop app uses; the only
//! difference is the code's kind. The credential is stored only after the exchange succeeded, so a
//! refused code leaves no half-written upstream behind.

use std::str::FromStr;
use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::Deserialize;
use termexo_relay_protocol::tunnel::{EnrollRequest, EnrollResponse, ENROLL_PATH};

use super::pinning;
use super::settings::{self, UpstreamSettings};
use crate::config::PublicUrl;
use crate::db::Database;

/// Long enough for an upstream that has to hash a password, short enough that the console's button
/// does not sit spinning on an address that is not a relay at all.
const ENROLL_TIMEOUT: Duration = Duration::from_secs(20);

const CLIENT_FAILED: &str = "无法创建上游中继请求客户端：";
const UNREACHABLE: &str = "无法连接上游中继：";
const UNREADABLE_RESPONSE: &str = "无法读取上游中继的响应：";
const MALFORMED_RESPONSE: &str = "上游中继返回了无法解析的接入响应：";
const STORE_FAILED: &str = "无法保存上游中继配置：";

/// The body an upstream answers a refusal with. The wording is the upstream's, and the console
/// shows it unchanged: only that relay knows whether the code expired, was used, or never existed.
#[derive(Deserialize)]
struct UpstreamFailure {
    error: String,
}

/// Exchanges a code for a credential and stores the upstream this relay now belongs to.
pub async fn join(
    database: &Database,
    url: &str,
    code: &str,
    name: &str,
    certificate_fingerprint: Option<String>,
) -> Result<UpstreamSettings, String> {
    let origin = PublicUrl::from_str(url).map_err(|error| error.to_string())?;
    let response = request_credential(
        &format!("{}{ENROLL_PATH}", origin.origin()),
        certificate_fingerprint.as_deref(),
        code,
        name,
    )
    .await?;
    let settings = UpstreamSettings::build(
        origin.origin(),
        response.credential,
        certificate_fingerprint,
    )?;
    settings::store(database, &settings).map_err(|error| format!("{STORE_FAILED}{error}"))?;
    Ok(settings)
}

async fn request_credential(
    enroll_url: &str,
    certificate_fingerprint: Option<&str>,
    code: &str,
    name: &str,
) -> Result<EnrollResponse, String> {
    let request = EnrollRequest::Code {
        code: code.trim().to_string(),
        name: name.to_string(),
    };
    let response = build_client(certificate_fingerprint)?
        .post(enroll_url)
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("{UNREACHABLE}{error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("{UNREADABLE_RESPONSE}{error}"))?;
    if !status.is_success() {
        return Err(describe_failure(status, &body));
    }
    serde_json::from_str(&body).map_err(|error| format!("{MALFORMED_RESPONSE}{error}"))
}

/// The same trust decision the tunnel makes: a pinned certificate when one was supplied, the
/// platform's root store otherwise.
fn build_client(certificate_fingerprint: Option<&str>) -> Result<Client, String> {
    let builder = Client::builder().timeout(ENROLL_TIMEOUT);
    let builder = match pinning::client_config(certificate_fingerprint) {
        Some(tls) => builder.tls_backend_preconfigured(tls),
        None => builder,
    };
    builder
        .build()
        .map_err(|error| format!("{CLIENT_FAILED}{error}"))
}

fn describe_failure(status: StatusCode, body: &str) -> String {
    serde_json::from_str::<UpstreamFailure>(body)
        .map(|failure| failure.error)
        .unwrap_or_else(|_| format!("上游中继拒绝了接入请求（HTTP {}）。", status.as_u16()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Only the upstream knows why an enrollment failed, so its sentence reaches the console
    /// untouched rather than being replaced by a generic one.
    #[test]
    fn the_upstreams_own_message_is_passed_through() {
        assert_eq!(
            describe_failure(StatusCode::FORBIDDEN, r#"{"error":"接入码无效或已过期。"}"#),
            "接入码无效或已过期。"
        );
    }

    #[test]
    fn a_response_that_is_not_a_relay_failure_falls_back_to_the_status() {
        assert_eq!(
            describe_failure(StatusCode::BAD_GATEWAY, "<html>502 Bad Gateway</html>"),
            "上游中继拒绝了接入请求（HTTP 502）。"
        );
    }

    #[tokio::test]
    async fn an_address_that_is_not_an_origin_never_reaches_the_network() {
        let database = Database::open_in_memory().expect("the database should open");

        let error = join(&database, "relay-a.example.com", "AAAA", "中继 B", None)
            .await
            .expect_err("a malformed address should be refused");

        assert!(error.contains("http"), "错误应当说明地址的格式要求");
        assert_eq!(settings::load(&database).expect("a read"), None);
    }
}
