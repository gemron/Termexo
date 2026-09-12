//! Trading an enrollment code or an account password for this device's long-lived credential.
//!
//! It is a single request, made once. The password — when that is the way in — appears here and
//! nowhere else: what is kept afterwards is only the credential the relay hands back.

use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::Deserialize;
use termexo_relay_protocol::tunnel::{EnrollRequest, EnrollResponse};

use super::connect_failure::describe as describe_connect_failure;
use super::endpoint::RelayEndpoint;
use crate::remote::settings::RelaySettings;

/// Long enough for a relay that has to hash a password, short enough that the panel's button does
/// not sit spinning on an address that is not a relay at all.
const ENROLL_TIMEOUT: Duration = Duration::from_secs(20);

const ENROLL_TIMED_OUT: &str =
    "连接中继超时：请确认地址和端口正确，且服务器的防火墙或安全组放行了这个端口。";

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
        .map_err(|error| connect_failure(&error))?;

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

/// A request that never got an HTTP answer. A timeout is told apart because reqwest reports its
/// own deadline without any lower-level cause to show.
fn connect_failure(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return ENROLL_TIMED_OUT.to_string();
    }
    describe_connect_failure(error)
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

    /// Real handshakes against a relay on loopback: the wrapped errors reqwest produces are the
    /// thing under test, and a hand-built chain could not prove their shape.
    mod against_a_listening_relay {
        use std::net::{SocketAddr, TcpListener};

        use axum::routing::post;
        use axum::Router;
        use axum_server::tls_rustls::{from_tcp_rustls, RustlsConfig};
        use axum_server::Handle;
        use termexo_relay_protocol::tunnel::ENROLL_PATH;

        use super::*;
        use crate::remote::relay::connect_failure::{
            CERTIFICATE_NOT_PINNED, NOT_SPEAKING_TLS, UNTRUSTED_CERTIFICATE,
        };
        use crate::remote::relay::endpoint::certificate_fingerprint;

        const LOOPBACK: &str = "127.0.0.1";
        const REFUSAL: &str = "接入码无效或已过期。";
        const OTHER_FINGERPRINT: &str =
            "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

        struct Relay {
            address: SocketAddr,
            /// Present only on a relay that serves TLS.
            fingerprint: Option<String>,
            _handle: Handle<SocketAddr>,
        }

        /// Answers every enrollment with a refusal, which is enough to show the request arrived.
        fn relay_router() -> Router {
            Router::new().route(
                ENROLL_PATH,
                post(|| async {
                    (
                        StatusCode::FORBIDDEN,
                        format!("{{\"error\":\"{REFUSAL}\"}}"),
                    )
                }),
            )
        }

        fn loopback_listener() -> TcpListener {
            let listener = TcpListener::bind((LOOPBACK, 0)).expect("loopback should accept a bind");
            listener
                .set_nonblocking(true)
                .expect("the listener should become non-blocking");
            listener
        }

        async fn self_signed_relay() -> Relay {
            let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
            let certified = rcgen::generate_simple_self_signed(vec![LOOPBACK.to_string()])
                .expect("a certificate should be generated");
            let config = RustlsConfig::from_pem(
                certified.cert.pem().into_bytes(),
                certified.signing_key.serialize_pem().into_bytes(),
            )
            .await
            .expect("the generated certificate should load");
            let listener = loopback_listener();
            let address = listener.local_addr().expect("the listener has an address");
            let handle = Handle::new();
            let server = from_tcp_rustls(listener, config)
                .expect("the TLS server should start")
                .handle(handle.clone());
            tokio::spawn(server.serve(relay_router().into_make_service()));
            Relay {
                address,
                fingerprint: Some(certificate_fingerprint(certified.cert.der())),
                _handle: handle,
            }
        }

        async fn plain_http_relay() -> Relay {
            let listener = loopback_listener();
            let address = listener.local_addr().expect("the listener has an address");
            let handle = Handle::new();
            let server = axum_server::from_tcp(listener)
                .expect("the HTTP server should start")
                .handle(handle.clone());
            tokio::spawn(server.serve(relay_router().into_make_service()));
            Relay {
                address,
                fingerprint: None,
                _handle: handle,
            }
        }

        async fn enroll_over_https(relay: &Relay, fingerprint: Option<&str>) -> String {
            let settings = RelaySettings {
                enabled: true,
                url: format!("https://{}", relay.address),
                certificate_fingerprint: fingerprint.map(str::to_string),
            }
            .normalized()
            .expect("the loopback address is a valid relay address");
            let request = EnrollRequest::Code {
                code: "AAAA-BBBB".into(),
                name: "台式机".into(),
            };
            enroll(&RelayEndpoint::new(&settings), &request)
                .await
                .expect_err("the test relay never grants an enrollment")
        }

        #[tokio::test]
        async fn a_self_signed_relay_without_a_fingerprint_asks_for_one() {
            let relay = self_signed_relay().await;

            assert_eq!(enroll_over_https(&relay, None).await, UNTRUSTED_CERTIFICATE);
        }

        #[tokio::test]
        async fn the_right_fingerprint_reaches_the_relay() {
            let relay = self_signed_relay().await;

            assert_eq!(
                enroll_over_https(&relay, relay.fingerprint.as_deref()).await,
                REFUSAL
            );
        }

        #[tokio::test]
        async fn a_different_certificate_is_not_mistaken_for_the_pinned_one() {
            let relay = self_signed_relay().await;

            assert_eq!(
                enroll_over_https(&relay, Some(OTHER_FINGERPRINT)).await,
                CERTIFICATE_NOT_PINNED
            );
        }

        #[tokio::test]
        async fn an_https_address_for_a_plain_http_relay_points_at_the_scheme() {
            let relay = plain_http_relay().await;

            assert_eq!(enroll_over_https(&relay, None).await, NOT_SPEAKING_TLS);
        }
    }
}
