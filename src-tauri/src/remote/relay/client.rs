//! The control plane of one tunnel session: the outbound WebSocket, the `hello` / `welcome`
//! handshake, the keepalive, and the pump that feeds the multiplexer.
//!
//! A session owns exactly one connection attempt. Everything about *when* to try again lives in
//! the supervisor, so this file only ever reports how the current attempt ended.

use std::sync::Arc;

use axum::Router;
use bytes::Bytes;
use futures_util::stream::{SplitSink, SplitStream, StreamExt};
use futures_util::SinkExt;
use termexo_relay_protocol::frames::{ControlFrame, DeviceKind, RelayAddress, PROTOCOL_VERSION};
use termexo_relay_protocol::tunnel::{
    ChannelByteStream, CLOSE_REVOKED, CLOSE_UNAUTHORIZED, HELLO_TIMEOUT, IDLE_TIMEOUT,
    PING_INTERVAL,
};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::{timeout, Instant, MissedTickBehavior};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::{Error as TungsteniteError, Message};
use tokio_tungstenite::{
    connect_async_tls_with_config, Connector, MaybeTlsStream, WebSocketStream,
};

use super::endpoint::RelayEndpoint;
use super::{mux, LinkStatus};

/// Enough binary frames in flight for a burst of terminal output; yamux's own per-stream windows
/// are what actually bound how much a single viewer may queue.
const FRAME_CAPACITY: usize = 256;

const SOCKET_CLOSED: &str = "与中继的连接已断开。";
const IDLE_MESSAGE: &str = "隧道空闲超时，已断开重连。";
const MULTIPLEXER_CLOSED: &str = "隧道多路复用已结束。";
const WELCOME_TIMEOUT: &str = "中继未在规定时间内完成握手。";
const UNEXPECTED_HANDSHAKE: &str = "中继在握手阶段发送了意外的帧。";
const CREDENTIAL_NOT_A_HEADER: &str = "设备凭据无法放入请求头。";

type TunnelSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
type TunnelSink = SplitSink<TunnelSocket, Message>;
type TunnelStream = SplitStream<TunnelSocket>;

/// Everything one session needs; rebuilt by the supervisor for every attempt.
pub(super) struct SessionConfig {
    pub endpoint: RelayEndpoint,
    /// `tdc1.<deviceId>.<secret>`. It is only ever put into the `Authorization` header and never
    /// logged, so nothing here formats it.
    pub credential: String,
    pub device_name: String,
    pub version: String,
    /// The workbench router built with `via_relay`, shared by every stream of this session.
    pub router: Router,
}

/// How one session ended, and whether it got far enough to count as a successful connection.
pub(super) struct SessionOutcome {
    /// A session that reached `welcome` earns a fresh reconnect backoff; one that never did must
    /// keep backing off so an unreachable relay is not hammered.
    pub connected: bool,
    pub end: SessionEnd,
}

/// Why a session ended. The supervisor turns this into a decision, not the other way round.
#[derive(Debug)]
pub(super) enum SessionEnd {
    /// The relay revoked this device. It will never accept this credential again.
    Revoked(String),
    /// The relay refused the credential or the protocol version. Reconnecting on a timer would
    /// only walk into the relay's own failure lockout, so the link stops and waits for the user.
    Refused(String),
    /// Anything transient: a refused connection, a dropped socket, an idle timeout.
    Interrupted(String),
}

impl SessionEnd {
    pub fn message(&self) -> &str {
        match self {
            Self::Revoked(reason) | Self::Refused(reason) | Self::Interrupted(reason) => reason,
        }
    }
}

/// What the relay said in `welcome`.
struct Welcome {
    device_id: String,
    addresses: Vec<RelayAddress>,
}

/// Opens one tunnel and serves it until it ends.
pub(super) async fn run_session(config: &SessionConfig, status: &LinkStatus) -> SessionOutcome {
    let socket = match connect(config).await {
        Ok(socket) => socket,
        Err(end) => return SessionOutcome::failed(end),
    };
    let (mut sink, mut stream) = socket.split();

    if let Err(end) = send_control(&mut sink, hello_frame(config)).await {
        return SessionOutcome::failed(end);
    }
    let welcome = match await_welcome(&mut stream).await {
        Ok(welcome) => welcome,
        Err(end) => return SessionOutcome::failed(end),
    };

    tracing::info!(
        relay = %config.endpoint.authority(),
        addresses = welcome.addresses.len(),
        "中继隧道已建立"
    );
    status.set_connected(
        welcome.device_id.clone(),
        config.device_name.clone(),
        welcome.addresses,
    );

    SessionOutcome {
        connected: true,
        end: pump(sink, stream, config, status, welcome.device_id).await,
    }
}

impl SessionOutcome {
    fn failed(end: SessionEnd) -> Self {
        Self {
            connected: false,
            end,
        }
    }
}

async fn connect(config: &SessionConfig) -> Result<TunnelSocket, SessionEnd> {
    let request = tunnel_request(config).map_err(SessionEnd::Interrupted)?;
    let connector = config
        .endpoint
        .pinned_tls_config()
        .map(|tls| Connector::Rustls(Arc::new(tls)));

    match connect_async_tls_with_config(request, None, false, connector).await {
        Ok((socket, _response)) => Ok(socket),
        Err(error) => Err(connect_failure(error)),
    }
}

/// An HTTP answer to the upgrade is the relay deciding this device may not in; anything else is a
/// network problem that may well be gone by the next attempt.
fn connect_failure(error: TungsteniteError) -> SessionEnd {
    match &error {
        TungsteniteError::Http(response) if response.status().is_client_error() => {
            SessionEnd::Refused(format!(
                "中继拒绝了本设备的接入（HTTP {}）。",
                response.status().as_u16()
            ))
        }
        _ => SessionEnd::Interrupted(format!("无法连接中继：{error}")),
    }
}

fn tunnel_request(config: &SessionConfig) -> Result<Request, String> {
    let mut request = config
        .endpoint
        .tunnel_url()
        .into_client_request()
        .map_err(|error| format!("中继地址无法用于隧道：{error}"))?;
    // The message deliberately carries no part of the credential, because it reaches a log line.
    let mut credential = HeaderValue::from_str(&format!("Bearer {}", config.credential))
        .map_err(|_| CREDENTIAL_NOT_A_HEADER.to_string())?;
    credential.set_sensitive(true);
    request.headers_mut().insert(AUTHORIZATION, credential);
    Ok(request)
}

fn hello_frame(config: &SessionConfig) -> ControlFrame {
    ControlFrame::Hello {
        protocol: PROTOCOL_VERSION,
        kind: DeviceKind::Desktop,
        version: config.version.clone(),
        name: config.device_name.clone(),
        // Only a downstream relay declares an id of its own.
        relay_id: None,
    }
}

async fn await_welcome(stream: &mut TunnelStream) -> Result<Welcome, SessionEnd> {
    let Ok(frame) = timeout(HELLO_TIMEOUT, next_control_frame(stream)).await else {
        return Err(SessionEnd::Interrupted(WELCOME_TIMEOUT.to_string()));
    };
    match frame? {
        ControlFrame::Welcome {
            device_id,
            addresses,
            ..
        } => Ok(Welcome {
            device_id,
            addresses,
        }),
        ControlFrame::AuthFailed { reason } => Err(SessionEnd::Refused(reason)),
        ControlFrame::Revoked { reason } => Err(SessionEnd::Revoked(reason)),
        _ => Err(SessionEnd::Interrupted(UNEXPECTED_HANDSHAKE.to_string())),
    }
}

/// Reads until the relay sends a control frame, skipping the data plane's own frames.
async fn next_control_frame(stream: &mut TunnelStream) -> Result<ControlFrame, SessionEnd> {
    loop {
        let Some(message) = stream.next().await else {
            return Err(SessionEnd::Interrupted(SOCKET_CLOSED.to_string()));
        };
        match message {
            Ok(Message::Text(text)) => return decode_control(&text),
            Ok(Message::Close(frame)) => return Err(close_reason(frame)),
            Ok(_) => continue,
            Err(error) => return Err(read_failure(&error)),
        }
    }
}

fn decode_control(text: &str) -> Result<ControlFrame, SessionEnd> {
    ControlFrame::decode(text)
        .map_err(|error| SessionEnd::Interrupted(format!("中继控制帧无法解析：{error}")))
}

fn read_failure(error: &TungsteniteError) -> SessionEnd {
    SessionEnd::Interrupted(format!("隧道读取失败：{error}"))
}

/// Serves the tunnel until either side ends it.
async fn pump(
    mut sink: TunnelSink,
    mut stream: TunnelStream,
    config: &SessionConfig,
    status: &LinkStatus,
    device_id: String,
) -> SessionEnd {
    let (inbound, inbound_receiver) = mpsc::channel::<Bytes>(FRAME_CAPACITY);
    let (outbound, mut outbound_receiver) = mpsc::channel::<Bytes>(FRAME_CAPACITY);
    let multiplexer = tauri::async_runtime::spawn(mux::serve(
        ChannelByteStream::new(inbound_receiver, outbound),
        config.router.clone(),
        device_id,
    ));

    let mut keepalive = tokio::time::interval(PING_INTERVAL);
    // A tunnel that was blocked for a while needs one ping, not a burst of the ones it missed.
    keepalive.set_missed_tick_behavior(MissedTickBehavior::Delay);
    keepalive.tick().await;
    let mut idle_deadline = Instant::now() + IDLE_TIMEOUT;

    let end = loop {
        tokio::select! {
            _ = tokio::time::sleep_until(idle_deadline) => {
                break SessionEnd::Interrupted(IDLE_MESSAGE.to_string());
            }
            _ = keepalive.tick() => {
                if let Err(end) = send_control(&mut sink, ControlFrame::Ping).await {
                    break end;
                }
            }
            payload = outbound_receiver.recv() => {
                let Some(payload) = payload else {
                    break SessionEnd::Interrupted(MULTIPLEXER_CLOSED.to_string());
                };
                if let Err(error) = sink.send(Message::Binary(payload)).await {
                    break SessionEnd::Interrupted(format!("无法向中继发送数据：{error}"));
                }
            }
            incoming = stream.next() => {
                let Some(message) = incoming else {
                    break SessionEnd::Interrupted(SOCKET_CLOSED.to_string());
                };
                let message = match message {
                    Ok(message) => message,
                    Err(error) => break read_failure(&error),
                };
                idle_deadline = Instant::now() + IDLE_TIMEOUT;
                if let Some(end) = handle_message(message, &mut sink, &inbound, status).await {
                    break end;
                }
            }
        }
    };

    // Dropping the inbound half is what lets the multiplexer see the end of the tunnel; the abort
    // covers a stream whose handler is still waiting on something that will never arrive.
    drop(inbound);
    multiplexer.abort();
    let _ = sink.close().await;
    end
}

/// Returns the reason the session should end, or `None` to keep going.
async fn handle_message(
    message: Message,
    sink: &mut TunnelSink,
    inbound: &mpsc::Sender<Bytes>,
    status: &LinkStatus,
) -> Option<SessionEnd> {
    match message {
        Message::Text(text) => handle_control(&text, sink, status).await,
        Message::Binary(payload) => inbound
            .send(payload)
            .await
            .is_err()
            .then(|| SessionEnd::Interrupted(MULTIPLEXER_CLOSED.to_string())),
        Message::Close(frame) => Some(close_reason(frame)),
        // The WebSocket layer answers its own ping, and no other frame type carries protocol.
        _ => None,
    }
}

async fn handle_control(
    text: &str,
    sink: &mut TunnelSink,
    status: &LinkStatus,
) -> Option<SessionEnd> {
    let frame = match ControlFrame::decode(text) {
        Ok(frame) => frame,
        Err(error) => {
            tracing::warn!(%error, "中继发送了无法解析的控制帧");
            return None;
        }
    };
    match frame {
        ControlFrame::Addresses { addresses } => {
            status.set_addresses(addresses);
            None
        }
        ControlFrame::Revoked { reason } => Some(SessionEnd::Revoked(reason)),
        ControlFrame::AuthFailed { reason } => Some(SessionEnd::Refused(reason)),
        ControlFrame::Ping => send_control(sink, ControlFrame::Pong).await.err(),
        // `welcome` belongs to the handshake, and the announcement frames belong to a downstream
        // relay rather than to a desktop.
        _ => None,
    }
}

/// Maps the close code onto what it means for this link.
///
/// 4403 is the one code that ends the link for good: the relay has revoked the device, so the
/// credential is worthless and reconnecting would only be refused.
fn close_reason(frame: Option<CloseFrame>) -> SessionEnd {
    let Some(frame) = frame else {
        return SessionEnd::Interrupted(SOCKET_CLOSED.to_string());
    };
    let reason = frame.reason.to_string();
    match u16::from(frame.code) {
        CLOSE_REVOKED => SessionEnd::Revoked(reason),
        CLOSE_UNAUTHORIZED => SessionEnd::Refused(reason),
        _ => SessionEnd::Interrupted(format!("中继关闭了隧道：{reason}")),
    }
}

async fn send_control(sink: &mut TunnelSink, frame: ControlFrame) -> Result<(), SessionEnd> {
    sink.send(Message::Text(frame.encode().into()))
        .await
        .map_err(|error| SessionEnd::Interrupted(format!("无法向中继发送控制帧：{error}")))
}

#[cfg(test)]
mod tests {
    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
    use tokio_tungstenite::tungstenite::Utf8Bytes;

    use super::*;

    fn close_frame(code: u16, reason: &str) -> Option<CloseFrame> {
        Some(CloseFrame {
            code: CloseCode::from(code),
            reason: Utf8Bytes::from(reason.to_string()),
        })
    }

    /// Revocation is permanent, an unauthorized close asks the user to act, and anything else is
    /// just a connection that has to be made again.
    #[test]
    fn the_close_code_decides_whether_the_link_ever_comes_back() {
        assert!(matches!(
            close_reason(close_frame(CLOSE_REVOKED, "接入已被撤销。")),
            SessionEnd::Revoked(reason) if reason == "接入已被撤销。"
        ));
        assert!(matches!(
            close_reason(close_frame(CLOSE_UNAUTHORIZED, "凭据无效。")),
            SessionEnd::Refused(_)
        ));
        assert!(matches!(
            close_reason(close_frame(1001, "going away")),
            SessionEnd::Interrupted(_)
        ));
        assert!(matches!(close_reason(None), SessionEnd::Interrupted(_)));
    }

    #[test]
    fn the_handshake_announces_this_build_as_a_desktop() {
        let config = SessionConfig {
            endpoint: RelayEndpoint::new(
                &crate::remote::settings::RelaySettings {
                    enabled: true,
                    url: "https://relay.example.com".into(),
                    certificate_fingerprint: None,
                }
                .normalized()
                .expect("the test address should be valid"),
            ),
            credential: "tdc1.abcdefghijklmnopqrstuvwxyz.secret".into(),
            device_name: "工作室台式机".into(),
            version: "0.9.0".into(),
            router: Router::new(),
        };

        let encoded = hello_frame(&config).encode();

        assert!(encoded.contains("\"type\":\"hello\""));
        assert!(encoded.contains("\"kind\":\"desktop\""));
        assert!(encoded.contains(&format!("\"protocol\":{PROTOCOL_VERSION}")));
        assert!(encoded.contains("工作室台式机"));

        // The credential travels in the header, never in a frame.
        assert!(!encoded.contains("tdc1."));

        let request = tunnel_request(&config).expect("the request should be built");
        assert_eq!(request.uri().to_string(), "wss://relay.example.com/tunnel");
        assert!(request
            .headers()
            .get(AUTHORIZATION)
            .expect("the credential should be presented")
            .is_sensitive());
    }
}
