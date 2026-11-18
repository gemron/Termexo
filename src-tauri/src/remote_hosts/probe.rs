//! Health check and v2 token handshake against a remote Termexo instance.
//!
//! Background polling only hits `/api/health`: touching `/ws` with a bad token would count against
//! the remote machine's failure lockout (5 failures per 10 minutes). The WebSocket handshake runs
//! only when the user clicks "Test", saves a host, or opens a window.

use std::time::{Duration, Instant};

use data_encoding::BASE64URL_NOPAD;
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::time::timeout;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::ORIGIN;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use crate::remote::relay::{error_chain, is_untrusted_certificate};
use crate::remote::session_crypto::{
    decode_nonce, Direction, HandshakeNonce, SealedFrame, SessionSecrets, PROTOCOL_VERSION,
};

use super::store::NormalizedHostUrl;

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const HEALTH_SUFFIX: &str = "api/health";
const WEBSOCKET_SUFFIX: &str = "ws";
const PROBE_CLIENT_ID: &str = "termexo-host-probe";

const SELF_SIGNED_UNSUPPORTED: &str =
    "对方使用的是自签名 HTTPS 证书，当前版本的桌面窗口暂无法直接加载自签名证书。请改用该机器的中继访问地址，或在受控局域网内将对方的 HTTPS 设为关闭。";
const TIMEOUT_MESSAGE: &str = "连接远程主机超时，请检查地址与网络是否可达。";
const NOT_TERMEXO_MESSAGE: &str = "该地址没有返回有效的 Termexo 健康检查响应。";
const HANDSHAKE_FAILED_MESSAGE: &str = "远程主机未按 Termexo 协议完成握手。";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteHostHealth {
    Unknown,
    Probing,
    Online,
    Offline,
    Unauthorized,
    UntrustedCertificate,
    Incompatible,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeOutcome {
    pub health: RemoteHostHealth,
    pub version: Option<String>,
    pub latency_ms: Option<u32>,
    pub read_only: Option<bool>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthBody {
    version: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ServerHandshakeFrame {
    Challenge {
        #[serde(default)]
        protocol: u8,
        #[serde(rename = "nonceS", default)]
        nonce_s: String,
        #[serde(rename = "sealedRequired", default)]
        sealed_required: bool,
    },
    Sealed(SealedFrame),
    Ready {
        #[serde(rename = "readOnly", default)]
        read_only: bool,
    },
    AuthFailed {
        reason: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientAuthFrame<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    protocol: Option<u8>,
    client_id: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<&'a str>,
    #[serde(rename = "nonceC", skip_serializing_if = "Option::is_none")]
    nonce_c: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    proof: Option<String>,
}

/// Checks `/api/health` only. Safe to run on a timer because it never touches authentication.
pub async fn check_health(target: &NormalizedHostUrl) -> ProbeOutcome {
    let client = match Client::builder().timeout(PROBE_TIMEOUT).build() {
        Ok(client) => client,
        Err(error) => {
            return ProbeOutcome::failed(
                RemoteHostHealth::Offline,
                format!("无法创建检测客户端：{error}"),
            );
        }
    };
    let health_url = format!("{}{HEALTH_SUFFIX}", target.url);
    let started = Instant::now();
    let response = match client.get(&health_url).send().await {
        Ok(response) => response,
        Err(error) => return classify_request_error(&error),
    };
    let latency_ms = u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX);
    if !response.status().is_success() {
        return ProbeOutcome::failed(
            RemoteHostHealth::Offline,
            format!("远程主机返回了 HTTP {}。", response.status().as_u16()),
        );
    }
    match response.json::<HealthBody>().await {
        Ok(body) if !body.version.trim().is_empty() => ProbeOutcome {
            health: RemoteHostHealth::Online,
            version: Some(body.version),
            latency_ms: Some(latency_ms),
            read_only: None,
            error: None,
        },
        _ => ProbeOutcome::failed(RemoteHostHealth::Incompatible, NOT_TERMEXO_MESSAGE.into()),
    }
}

/// Checks `/api/health` and then verifies the access token over `/ws` without sending the token in
/// the clear on a sealed link.
pub async fn probe_with_token(target: &NormalizedHostUrl, token: &str) -> ProbeOutcome {
    let mut outcome = check_health(target).await;
    if outcome.health != RemoteHostHealth::Online {
        return outcome;
    }
    match timeout(PROBE_TIMEOUT, verify_token(target, token.trim())).await {
        Ok(Ok(read_only)) => {
            outcome.read_only = Some(read_only);
            outcome
        }
        Ok(Err((health, reason))) => ProbeOutcome {
            health,
            version: outcome.version,
            latency_ms: outcome.latency_ms,
            read_only: None,
            error: Some(reason),
        },
        Err(_) => ProbeOutcome {
            health: RemoteHostHealth::Offline,
            version: outcome.version,
            latency_ms: outcome.latency_ms,
            read_only: None,
            error: Some(TIMEOUT_MESSAGE.into()),
        },
    }
}

async fn verify_token(
    target: &NormalizedHostUrl,
    token: &str,
) -> Result<bool, (RemoteHostHealth, String)> {
    let ws_url = websocket_url(&target.url);
    let mut request = ws_url
        .into_client_request()
        .map_err(|error| (RemoteHostHealth::Offline, format!("无法构造握手请求：{error}")))?;
    let origin = HeaderValue::from_str(&target.origin)
        .map_err(|_| (RemoteHostHealth::Offline, "远程主机 Origin 头无效。".into()))?;
    request.headers_mut().insert(ORIGIN, origin);

    let (mut socket, _) = connect_async(request).await.map_err(|error| {
        if is_untrusted_certificate(&error) {
            (
                RemoteHostHealth::UntrustedCertificate,
                SELF_SIGNED_UNSUPPORTED.to_string(),
            )
        } else {
            (
                RemoteHostHealth::Offline,
                format!("无法建立 WebSocket 连接：{}", error_chain(&error)),
            )
        }
    })?;

    let challenge = next_server_frame(&mut socket).await?;
    let ServerHandshakeFrame::Challenge {
        protocol,
        nonce_s,
        sealed_required,
    } = challenge
    else {
        return Err((
            RemoteHostHealth::Incompatible,
            HANDSHAKE_FAILED_MESSAGE.into(),
        ));
    };

    let (auth_json, mut opener) = build_auth_response(target.secure, protocol, sealed_required, &nonce_s, token)?;
    socket
        .send(Message::Text(auth_json.into()))
        .await
        .map_err(|error| (RemoteHostHealth::Offline, format!("发送鉴权帧失败：{error}")))?;

    let reply = next_server_frame(&mut socket).await?;
    let _ = socket.close(None).await;
    interpret_auth_reply(reply, opener.as_mut())
}

fn build_auth_response(
    secure: bool,
    protocol: u8,
    sealed_required: bool,
    nonce_s: &str,
    token: &str,
) -> Result<(String, Option<crate::remote::session_crypto::FrameOpener>), (RemoteHostHealth, String)>
{
    if protocol >= PROTOCOL_VERSION {
        let server_nonce = decode_nonce(nonce_s).ok_or_else(|| {
            (
                RemoteHostHealth::Incompatible,
                "远程主机返回的握手随机数无效。".into(),
            )
        })?;
        let client_nonce = HandshakeNonce::generate()
            .map_err(|error| (RemoteHostHealth::Offline, error))?;
        let secrets = SessionSecrets::derive(token, &server_nonce, &client_nonce.bytes);
        let proof = BASE64URL_NOPAD.encode(&secrets.proof(&server_nonce, &client_nonce.bytes));
        let frame = ClientAuthFrame {
            kind: "auth",
            protocol: Some(PROTOCOL_VERSION),
            client_id: PROBE_CLIENT_ID,
            token: None,
            nonce_c: Some(&client_nonce.encoded),
            proof: Some(proof),
        };
        let encoded = serde_json::to_string(&frame)
            .map_err(|error| (RemoteHostHealth::Offline, error.to_string()))?;
        return Ok((encoded, Some(secrets.opener(Direction::ServerToClient))));
    }
    if secure || sealed_required {
        return Err((
            RemoteHostHealth::Incompatible,
            "远程主机协议版本过旧，不支持加密握手。".into(),
        ));
    }
    let frame = ClientAuthFrame {
        kind: "auth",
        protocol: None,
        client_id: PROBE_CLIENT_ID,
        token: Some(token),
        nonce_c: None,
        proof: None,
    };
    let encoded = serde_json::to_string(&frame)
        .map_err(|error| (RemoteHostHealth::Offline, error.to_string()))?;
    Ok((encoded, None))
}

fn interpret_auth_reply(
    reply: ServerHandshakeFrame,
    opener: Option<&mut crate::remote::session_crypto::FrameOpener>,
) -> Result<bool, (RemoteHostHealth, String)> {
    match reply {
        ServerHandshakeFrame::AuthFailed { reason } => {
            Err((RemoteHostHealth::Unauthorized, reason))
        }
        ServerHandshakeFrame::Sealed(sealed) => {
            let Some(opener) = opener else {
                return Err((
                    RemoteHostHealth::Incompatible,
                    HANDSHAKE_FAILED_MESSAGE.into(),
                ));
            };
            let plaintext = opener.open(&sealed).map_err(|error| {
                (
                    RemoteHostHealth::Incompatible,
                    error.reason().to_string(),
                )
            })?;
            let inner: ServerHandshakeFrame = serde_json::from_slice(&plaintext).map_err(|_| {
                (
                    RemoteHostHealth::Incompatible,
                    HANDSHAKE_FAILED_MESSAGE.into(),
                )
            })?;
            match inner {
                ServerHandshakeFrame::Ready { read_only, .. } => Ok(read_only),
                ServerHandshakeFrame::AuthFailed { reason } => {
                    Err((RemoteHostHealth::Unauthorized, reason))
                }
                _ => Err((
                    RemoteHostHealth::Incompatible,
                    HANDSHAKE_FAILED_MESSAGE.into(),
                )),
            }
        }
        ServerHandshakeFrame::Ready { read_only, .. } if opener.is_none() => Ok(read_only),
        _ => Err((
            RemoteHostHealth::Incompatible,
            HANDSHAKE_FAILED_MESSAGE.into(),
        )),
    }
}

async fn next_server_frame(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Result<ServerHandshakeFrame, (RemoteHostHealth, String)> {
    loop {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => {
                return serde_json::from_str::<ServerHandshakeFrame>(&text).map_err(|_| {
                    (
                        RemoteHostHealth::Incompatible,
                        HANDSHAKE_FAILED_MESSAGE.into(),
                    )
                });
            }
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
            Some(Ok(Message::Close(frame))) => {
                let reason = frame
                    .map(|close| close.reason.to_string())
                    .filter(|text| !text.is_empty())
                    .unwrap_or_else(|| "远程主机关闭了连接。".into());
                return Err((RemoteHostHealth::Unauthorized, reason));
            }
            Some(Ok(_)) => continue,
            Some(Err(error)) => {
                return Err((
                    RemoteHostHealth::Offline,
                    format!("读取握手响应失败：{error}"),
                ))
            }
            None => {
                return Err((
                    RemoteHostHealth::Offline,
                    "远程主机在握手完成前断开了连接。".into(),
                ))
            }
        }
    }
}

fn websocket_url(base_url: &str) -> String {
    let (scheme, rest) = base_url.split_once("://").unwrap_or(("https", base_url));
    let ws_scheme = if scheme == "https" { "wss" } else { "ws" };
    format!("{ws_scheme}://{rest}{WEBSOCKET_SUFFIX}")
}

fn classify_request_error(error: &reqwest::Error) -> ProbeOutcome {
    if error.is_timeout() {
        return ProbeOutcome::failed(RemoteHostHealth::Offline, TIMEOUT_MESSAGE.into());
    }
    if is_untrusted_certificate(error) {
        return ProbeOutcome::failed(
            RemoteHostHealth::UntrustedCertificate,
            SELF_SIGNED_UNSUPPORTED.into(),
        );
    }
    ProbeOutcome::failed(
        RemoteHostHealth::Offline,
        format!("无法连接远程主机：{}", error_chain(error)),
    )
}

impl ProbeOutcome {
    pub fn failed(health: RemoteHostHealth, error: String) -> Self {
        Self {
            health,
            version: None,
            latency_ms: None,
            read_only: None,
            error: Some(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_websocket_endpoint_from_both_lan_and_relay_urls() {
        assert_eq!(
            websocket_url("http://192.168.1.20:7420/"),
            "ws://192.168.1.20:7420/ws"
        );
        assert_eq!(
            websocket_url("https://relay.example.com/d/abcdefghijklmnopqrstuvwxyz/"),
            "wss://relay.example.com/d/abcdefghijklmnopqrstuvwxyz/ws"
        );
    }

    #[test]
    fn builds_a_sealed_v2_auth_frame_that_matches_the_server_verifier() {
        let challenge = HandshakeNonce::generate().expect("server nonce");
        let token = "sample-access-token";
        let (encoded, opener) =
            build_auth_response(true, PROTOCOL_VERSION, true, &challenge.encoded, token)
                .expect("v2 auth frame");

        assert!(opener.is_some());
        let parsed: serde_json::Value = serde_json::from_str(&encoded).expect("json");
        assert_eq!(parsed["type"], "auth");
        assert_eq!(parsed["protocol"], PROTOCOL_VERSION);
        assert!(parsed.get("token").is_none());

        let nonce_c = decode_nonce(parsed["nonceC"].as_str().unwrap()).expect("client nonce");
        let proof = BASE64URL_NOPAD
            .decode(parsed["proof"].as_str().unwrap().as_bytes())
            .expect("proof bytes");
        let secrets = SessionSecrets::derive(token, &challenge.bytes, &nonce_c);
        assert!(secrets.proof_matches(&challenge.bytes, &nonce_c, &proof));
    }

    #[test]
    fn refuses_to_send_a_plaintext_token_over_a_secure_or_sealed_link() {
        assert!(build_auth_response(true, 1, false, "", "secret").is_err());
        assert!(build_auth_response(false, 1, true, "", "secret").is_err());
        assert!(build_auth_response(false, 1, false, "", "secret").is_ok());
    }
}
