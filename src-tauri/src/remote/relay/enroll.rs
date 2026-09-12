//! Trading an enrollment code or an account password for this device's long-lived credential.
//!
//! It is a single request, made once. The password — when that is the way in — appears here and
//! nowhere else: what is kept afterwards is only the credential the relay hands back.

use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::Deserialize;
use termexo_relay_protocol::tunnel::{EnrollRequest, EnrollResponse};

use super::endpoint::RelayEndpoint;
use crate::remote::settings::RelaySettings;

/// Long enough for a relay that has to hash a password, short enough that the panel's button does
/// not sit spinning on an address that is not a relay at all.
const ENROLL_TIMEOUT: Duration = Duration::from_secs(20);

/// The body a relay answers a refusal with. Its wording is the relay's, and the panel shows it
/// unchanged: only the relay knows whether the code expired, was used, or never existed.
#[derive(Deserialize)]
struct RelayFailure {
    error: String,
}

/// What the panel's enrollment form sends.
///
/// The relay's own request body is the shared crate's [`EnrollRequest`], deserialized straight out
/// of `method` so the two ends of the protocol cannot drift apart. The outer `name` is what the
/// device is registered under, which keeps the form to one name field rather than two that could
/// disagree.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayEnrollRequest {
    pub url: String,
    pub method: EnrollRequest,
    pub name: String,
    /// A self-signed relay's certificate, pinned on the first enrollment.
    #[serde(default)]
    pub certificate_fingerprint: Option<String>,
}

impl RelayEnrollRequest {
    /// The relay these settings will point at once the enrollment succeeds, still to be validated.
    pub fn relay_settings(&self) -> RelaySettings {
        RelaySettings {
            enabled: true,
            url: self.url.clone(),
            certificate_fingerprint: self.certificate_fingerprint.clone(),
        }
    }

    /// The name to register under: the form's own field, or the fallback when it was left blank,
    /// so the relay console never lists an unnamed device.
    pub fn device_name(&self, fallback: &str) -> String {
        let name = self.name.trim();
        if name.is_empty() {
            return fallback.to_string();
        }
        name.to_string()
    }

    /// The body to post, with the name the form settled on.
    pub fn into_body(self, name: String) -> EnrollRequest {
        match self.method {
            EnrollRequest::Code { code, .. } => EnrollRequest::Code { code, name },
            EnrollRequest::Password {
                username, password, ..
            } => EnrollRequest::Password {
                username,
                password,
                name,
            },
        }
    }
}

/// Exchanges an enrollment request for a device credential.
pub async fn enroll(
    endpoint: &RelayEndpoint,
    request: &EnrollRequest,
) -> Result<EnrollResponse, String> {
    let response = build_client(endpoint)?
        .post(endpoint.enroll_url())
        .json(request)
        .send()
        .await
        .map_err(|error| format!("无法连接中继：{error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("无法读取中继的响应：{error}"))?;
    if !status.is_success() {
        return Err(enrollment_failure(status, &body));
    }
    serde_json::from_str(&body).map_err(|error| format!("中继返回了无法解析的接入响应：{error}"))
}

/// The same trust decision the tunnel makes: a pinned certificate when the panel stored one, the
/// platform's root store otherwise.
fn build_client(endpoint: &RelayEndpoint) -> Result<Client, String> {
    let builder = Client::builder().timeout(ENROLL_TIMEOUT);
    let builder = match endpoint.pinned_tls_config() {
        Some(tls) => builder.tls_backend_preconfigured(tls),
        None => builder,
    };
    builder
        .build()
        .map_err(|error| format!("无法创建中继请求客户端：{error}"))
}

fn enrollment_failure(status: StatusCode, body: &str) -> String {
    serde_json::from_str::<RelayFailure>(body)
        .map(|failure| failure.error)
        .unwrap_or_else(|_| format!("中继拒绝了接入请求（HTTP {}）。", status.as_u16()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The relay is the only side that knows why an enrollment failed, so its sentence reaches the
    /// panel untouched rather than being replaced by a generic one.
    #[test]
    fn the_relays_own_message_is_passed_through() {
        assert_eq!(
            enrollment_failure(
                StatusCode::FORBIDDEN,
                "{\"error\":\"接入码无效或已过期。\"}"
            ),
            "接入码无效或已过期。"
        );
    }

    #[test]
    fn a_response_that_is_not_a_relay_failure_falls_back_to_the_status() {
        assert_eq!(
            enrollment_failure(StatusCode::BAD_GATEWAY, "<html>502 Bad Gateway</html>"),
            "中继拒绝了接入请求（HTTP 502）。"
        );
    }

    fn parsed(json: &str) -> RelayEnrollRequest {
        serde_json::from_str(json).expect("the panel's payload should deserialize")
    }

    /// The panel sends the shared crate's own request shape, tag and all.
    #[test]
    fn an_enrollment_with_a_code_carries_the_code_and_the_name() {
        let request = parsed(
            r#"{"url":"https://relay.example.com","name":"工作室台式机","method":{"method":"code","code":"AAAA-BBBB","name":"忽略"}}"#,
        );

        assert_eq!(request.relay_settings().url, "https://relay.example.com");
        assert_eq!(request.relay_settings().certificate_fingerprint, None);
        let name = request.device_name("DESKTOP-FALLBACK");
        assert_eq!(name, "工作室台式机");

        // The outer name wins, so the relay console shows what the panel's field said.
        assert!(matches!(
            request.into_body(name),
            EnrollRequest::Code { code, name }
                if code == "AAAA-BBBB" && name == "工作室台式机"
        ));
    }

    #[test]
    fn an_enrollment_with_an_account_keeps_the_credentials_it_was_given() {
        let request = parsed(
            r#"{"url":"https://relay.example.com","name":"  ","method":{"method":"password","username":"ling","password":"s3cret","name":""}}"#,
        );

        // A blank field falls back to the machine name rather than enrolling a nameless device.
        let name = request.device_name("DESKTOP-FALLBACK");
        assert_eq!(name, "DESKTOP-FALLBACK");
        assert!(matches!(
            request.into_body(name),
            EnrollRequest::Password { username, password, name }
                if username == "ling" && password == "s3cret" && name == "DESKTOP-FALLBACK"
        ));
    }

    /// The panel may not send a fingerprint at all; a relay with a real certificate needs none.
    #[test]
    fn a_payload_without_a_fingerprint_still_deserializes() {
        let request = parsed(
            r#"{"url":"https://relay.example.com","name":"台式机","method":{"method":"code","code":"AAAA","name":"台式机"}}"#,
        );

        assert_eq!(request.certificate_fingerprint, None);
    }
}
