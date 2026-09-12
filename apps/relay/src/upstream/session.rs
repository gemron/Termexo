//! One attempt at being a device of another relay: the outbound WebSocket, the handshake, the
//! announcements this relay makes, and the streams the upstream opens on it.
//!
//! A session owns exactly one connection attempt. Everything about *when* to try again lives in
//! the supervisor, so this file only ever reports how the current attempt ended.

use std::future::poll_fn;
use std::sync::Arc;

use bytes::Bytes;
use futures_util::stream::{SplitSink, SplitStream, StreamExt};
use futures_util::SinkExt;
use termexo_relay_protocol::frames::{
    AnnouncedDevice, ControlFrame, DeviceKind, RelayAddress, PROTOCOL_VERSION,
};
use termexo_relay_protocol::tunnel::{
    ChannelByteStream, CLOSE_REVOKED, CLOSE_UNAUTHORIZED, HELLO_TIMEOUT, IDLE_TIMEOUT,
    PING_INTERVAL,
};
use tokio::net::TcpStream;
use tokio::sync::broadcast::error::RecvError;
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
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};

use super::addresses::UpstreamReach;
use super::forward;
use super::settings::UpstreamSettings;
use super::{pinning, publish_addresses};
use crate::registry::RegistryChange;
use crate::state::{SharedState, RELAY_VERSION};

/// Enough binary frames in flight for a burst of forwarded output; yamux's own per-stream windows
/// are what actually bound how much a single viewer may queue.
const FRAME_CAPACITY: usize = 256;

/// The upstream opens every stream on this link, so it never needs more than the relay allows one
/// device; the same ceiling as the downstream side keeps one link from starving the others.
const MAX_CONCURRENT_STREAMS: usize = 64;

const SOCKET_CLOSED: &str = "与上游中继的连接已断开。";
const IDLE_MESSAGE: &str = "上游隧道空闲超时，已断开重连。";
const MULTIPLEXER_CLOSED: &str = "上游隧道多路复用已结束。";
const WELCOME_TIMEOUT: &str = "上游中继未在规定时间内完成握手。";
const UNEXPECTED_HANDSHAKE: &str = "上游中继在握手阶段发送了意外的帧。";
const CREDENTIAL_NOT_A_HEADER: &str = "上游设备凭据无法放入请求头。";
const REGISTRY_CLOSED: &str = "本中继的路由表已停止发布变更。";
const LOOP_DETECTED: &str = "上游中继链里已经包含本中继，接入会形成环路。";

type TunnelSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
type TunnelSink = SplitSink<TunnelSocket, Message>;
type TunnelStream = SplitStream<TunnelSocket>;

/// How one session ended, and whether it got far enough to count as a successful connection.
pub(super) struct SessionOutcome {
    /// A session that reached `welcome` earns a fresh reconnect backoff; one that never did must
    /// keep backing off so an unreachable upstream is not hammered.
    pub connected: bool,
    pub end: SessionEnd,
}

/// Why a session ended. The supervisor turns this into a decision, not the other way round.
#[derive(Debug)]
pub(super) enum SessionEnd {
    /// The upstream revoked this relay. It will never accept this credential again.
    Revoked(String),
    /// The upstream refused the credential or the protocol version. Reconnecting on a timer would
    /// only walk into its failure lockout, so the link stops and waits for the operator.
    Refused(String),
    /// This relay is already part of the upstream's own chain. Retrying would be refused again.
    Looped(String),
    /// Anything transient: a refused connection, a dropped socket, an idle timeout.
    Interrupted(String),
}

impl SessionEnd {
    pub fn message(&self) -> &str {
        match self {
            Self::Revoked(reason)
            | Self::Refused(reason)
            | Self::Looped(reason)
            | Self::Interrupted(reason) => reason,
        }
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

/// What the upstream said in `welcome`.
struct Welcome {
    device_id: String,
    relay_id: String,
    addresses: Vec<RelayAddress>,
    chain: Vec<String>,
}

/// Opens one tunnel to the upstream and serves it until it ends.
pub(super) async fn run(state: &SharedState, settings: &UpstreamSettings) -> SessionOutcome {
    let socket = match connect(settings).await {
        Ok(socket) => socket,
        Err(end) => return SessionOutcome::failed(end),
    };
    let (mut sink, mut stream) = socket.split();

    if let Err(end) = send_control(&mut sink, hello_frame(state)).await {
        return SessionOutcome::failed(end);
    }
    let welcome = match await_welcome(&mut stream).await {
        Ok(welcome) => welcome,
        Err(end) => return SessionOutcome::failed(end),
    };
    if let Some(end) = refuse_loop(state, &welcome) {
        return SessionOutcome::failed(end);
    }

    adopt(state, settings, &welcome);
    tracing::info!(
        upstream = %settings.authority(),
        relay_id = %welcome.relay_id,
        "上游中继隧道已建立"
    );

    let end = pump(sink, stream, state, &welcome).await;
    withdraw(state, settings, end.message());
    SessionOutcome {
        connected: true,
        end,
    }
}

/// Refuses an upstream whose chain already contains this relay, which is the announced half of the
/// loop guard: joining would make streams circle forever.
fn refuse_loop(state: &SharedState, welcome: &Welcome) -> Option<SessionEnd> {
    let looping = welcome.relay_id == state.relay_id
        || welcome.chain.iter().any(|relay| *relay == state.relay_id);
    looping.then(|| SessionEnd::Looped(LOOP_DETECTED.to_string()))
}

/// Publishes the chain this relay just joined to everything attached to it.
fn adopt(state: &SharedState, settings: &UpstreamSettings, welcome: &Welcome) {
    state.upstream.set_reach(UpstreamReach::from_welcome(
        &welcome.device_id,
        &welcome.relay_id,
        &welcome.addresses,
        &welcome.chain,
    ));
    state.upstream.set_connected(&welcome.relay_id);
    super::record_connected(state, settings, &welcome.relay_id);
    publish_addresses(state);
}

/// Takes the chain away again: no address beyond this relay works while the link is down.
fn withdraw(state: &SharedState, settings: &UpstreamSettings, reason: &str) {
    state.upstream.clear_reach();
    super::record_disconnected(state, settings, reason);
    publish_addresses(state);
}

async fn connect(settings: &UpstreamSettings) -> Result<TunnelSocket, SessionEnd> {
    let request = tunnel_request(settings).map_err(SessionEnd::Interrupted)?;
    let connector = pinning::client_config(settings.certificate_fingerprint.as_deref())
        .map(|tls| Connector::Rustls(Arc::new(tls)));

    match connect_async_tls_with_config(request, None, false, connector).await {
        Ok((socket, _response)) => Ok(socket),
        Err(error) => Err(connect_failure(error)),
    }
}

/// An HTTP answer to the upgrade is the upstream deciding this relay may not in; anything else is
/// a network problem that may well be gone by the next attempt.
fn connect_failure(error: TungsteniteError) -> SessionEnd {
    match &error {
        TungsteniteError::Http(response) if response.status().is_client_error() => {
            SessionEnd::Refused(format!(
                "上游中继拒绝了本中继的接入（HTTP {}）。",
                response.status().as_u16()
            ))
        }
        _ => SessionEnd::Interrupted(format!("无法连接上游中继：{error}")),
    }
}

fn tunnel_request(settings: &UpstreamSettings) -> Result<Request, String> {
    let mut request = settings
        .tunnel_url()
        .into_client_request()
        .map_err(|error| format!("上游中继地址无法用于隧道：{error}"))?;
    let mut credential = HeaderValue::from_str(&format!("Bearer {}", settings.credential))
        .map_err(|_| CREDENTIAL_NOT_A_HEADER.to_string())?;
    credential.set_sensitive(true);
    request.headers_mut().insert(AUTHORIZATION, credential);
    Ok(request)
}

fn hello_frame(state: &SharedState) -> ControlFrame {
    ControlFrame::Hello {
        protocol: PROTOCOL_VERSION,
        kind: DeviceKind::Relay,
        version: RELAY_VERSION.to_string(),
        name: state.public_url.host().to_string(),
        // A downstream relay declares its own id, which is what an upstream's loop guard and its
        // announcement hop names are built on.
        relay_id: Some(state.relay_id.clone()),
    }
}

async fn await_welcome(stream: &mut TunnelStream) -> Result<Welcome, SessionEnd> {
    let Ok(frame) = timeout(HELLO_TIMEOUT, next_control_frame(stream)).await else {
        return Err(SessionEnd::Interrupted(WELCOME_TIMEOUT.to_string()));
    };
    match frame? {
        ControlFrame::Welcome {
            device_id,
            relay_id,
            addresses,
            chain,
        } => Ok(Welcome {
            device_id,
            relay_id,
            addresses,
            chain,
        }),
        ControlFrame::AuthFailed { reason } => Err(SessionEnd::Refused(reason)),
        ControlFrame::Revoked { reason } => Err(SessionEnd::Revoked(reason)),
        _ => Err(SessionEnd::Interrupted(UNEXPECTED_HANDSHAKE.to_string())),
    }
}

/// Reads until the upstream sends a control frame, skipping the data plane's own frames.
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
        .map_err(|error| SessionEnd::Interrupted(format!("上游控制帧无法解析：{error}")))
}

fn read_failure(error: &TungsteniteError) -> SessionEnd {
    SessionEnd::Interrupted(format!("上游隧道读取失败：{error}"))
}

/// Serves the tunnel until either side ends it.
async fn pump(
    mut sink: TunnelSink,
    mut stream: TunnelStream,
    state: &SharedState,
    welcome: &Welcome,
) -> SessionEnd {
    let (inbound, inbound_receiver) = mpsc::channel::<Bytes>(FRAME_CAPACITY);
    let (outbound, mut outbound_receiver) = mpsc::channel::<Bytes>(FRAME_CAPACITY);
    let multiplexer = tokio::spawn(serve_streams(
        ChannelByteStream::new(inbound_receiver, outbound),
        state.clone(),
    ));

    // Subscribing before the snapshot is taken is what keeps a device that comes up during the
    // handshake from being missed: the worst case is one redundant `device-online`.
    let mut changes = state.registry.subscribe();
    if let Err(end) = send_control(&mut sink, snapshot_frame(state, &welcome.relay_id)).await {
        multiplexer.abort();
        return end;
    }

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
            change = changes.recv() => {
                let frame = match change {
                    Ok(change) => announcement_frame(change, &welcome.relay_id),
                    // Falling behind is recovered from with a fresh snapshot rather than by
                    // guessing which changes were dropped.
                    Err(RecvError::Lagged(_)) => Some(snapshot_frame(state, &welcome.relay_id)),
                    Err(RecvError::Closed) => {
                        break SessionEnd::Interrupted(REGISTRY_CLOSED.to_string());
                    }
                };
                if let Some(frame) = frame {
                    if let Err(end) = send_control(&mut sink, frame).await {
                        break end;
                    }
                }
            }
            payload = outbound_receiver.recv() => {
                let Some(payload) = payload else {
                    break SessionEnd::Interrupted(MULTIPLEXER_CLOSED.to_string());
                };
                if let Err(error) = sink.send(Message::Binary(payload)).await {
                    break SessionEnd::Interrupted(format!("无法向上游中继发送数据：{error}"));
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
                if let Some(end) = handle_message(message, &mut sink, &inbound, state, welcome).await
                {
                    break end;
                }
            }
        }
    };

    // Dropping the inbound half is what lets the multiplexer see the end of the tunnel; the abort
    // covers a stream whose copy is still waiting on bytes that will never arrive.
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
    state: &SharedState,
    welcome: &Welcome,
) -> Option<SessionEnd> {
    match message {
        Message::Text(text) => handle_control(&text, sink, state, welcome).await,
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
    state: &SharedState,
    welcome: &Welcome,
) -> Option<SessionEnd> {
    let frame = match ControlFrame::decode(text) {
        Ok(frame) => frame,
        Err(error) => {
            tracing::warn!(%error, "上游中继发送了无法解析的控制帧");
            return None;
        }
    };
    match frame {
        // The chain above changed, so every device attached here has a different address list now.
        ControlFrame::Addresses { addresses } => {
            state.upstream.set_reach(UpstreamReach::from_welcome(
                &welcome.device_id,
                &welcome.relay_id,
                &addresses,
                &welcome.chain,
            ));
            publish_addresses(state);
            None
        }
        ControlFrame::Revoked { reason } => Some(SessionEnd::Revoked(reason)),
        ControlFrame::AuthFailed { reason } => Some(SessionEnd::Refused(reason)),
        ControlFrame::Ping => send_control(sink, ControlFrame::Pong).await.err(),
        // `welcome` belongs to the handshake, and the announcement frames only ever travel the
        // other way.
        _ => None,
    }
}

/// Everything this relay can offer the upstream right now.
fn snapshot_frame(state: &SharedState, upstream_relay_id: &str) -> ControlFrame {
    ControlFrame::Announce {
        devices: state
            .registry
            .announcements()
            .into_iter()
            .filter(|device| is_routable_for(device, upstream_relay_id))
            .collect(),
    }
}

/// One reachability change, as the increment the upstream is told about it.
fn announcement_frame(change: RegistryChange, upstream_relay_id: &str) -> Option<ControlFrame> {
    match change {
        RegistryChange::Online(device) => {
            if !is_routable_for(&device, upstream_relay_id) {
                return None;
            }
            Some(ControlFrame::DeviceOnline {
                id: device.id,
                name: device.name,
                via: device.via,
            })
        }
        // A withdrawal is always worth sending: the upstream ignores an id it does not route.
        RegistryChange::Offline { device_id } => {
            Some(ControlFrame::DeviceOffline { id: device_id })
        }
    }
}

/// Whether the upstream could actually use this announcement. A chain that already runs through
/// the upstream would come straight back to it, which is the loop the design guards against.
fn is_routable_for(device: &AnnouncedDevice, upstream_relay_id: &str) -> bool {
    !device.via.iter().any(|hop| hop == upstream_relay_id)
}

/// Accepts the streams the upstream opens and carries each one to its device.
///
/// The upstream is the side that opens streams, so this end runs the multiplexer as its server —
/// the mirror image of what the relay does towards its own devices.
async fn serve_streams(byte_stream: ChannelByteStream, state: SharedState) {
    let mut config = yamux::Config::default();
    config.set_max_num_streams(MAX_CONCURRENT_STREAMS);
    let mut connection = yamux::Connection::new(
        TokioAsyncReadCompatExt::compat(byte_stream),
        config,
        yamux::Mode::Server,
    );

    loop {
        match poll_fn(|context| connection.poll_next_inbound(context)).await {
            Some(Ok(stream)) => {
                let state = state.clone();
                tokio::spawn(async move {
                    forward::serve(&state, FuturesAsyncReadCompatExt::compat(stream)).await;
                });
            }
            Some(Err(error)) => {
                tracing::debug!(%error, "上游隧道多路复用连接已出错");
                return;
            }
            None => return,
        }
    }
}

/// Maps the close code onto what it means for this link.
///
/// 4403 is the one code that ends the link for good: the upstream has revoked this relay, so the
/// credential is worthless and reconnecting would only be refused.
fn close_reason(frame: Option<CloseFrame>) -> SessionEnd {
    let Some(frame) = frame else {
        return SessionEnd::Interrupted(SOCKET_CLOSED.to_string());
    };
    let reason = frame.reason.to_string();
    match u16::from(frame.code) {
        CLOSE_REVOKED => SessionEnd::Revoked(reason),
        CLOSE_UNAUTHORIZED => SessionEnd::Refused(reason),
        _ => SessionEnd::Interrupted(format!("上游中继关闭了隧道：{reason}")),
    }
}

async fn send_control(sink: &mut TunnelSink, frame: ControlFrame) -> Result<(), SessionEnd> {
    sink.send(Message::Text(frame.encode().into()))
        .await
        .map_err(|error| SessionEnd::Interrupted(format!("无法向上游中继发送控制帧：{error}")))
}

#[cfg(test)]
mod tests {
    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
    use tokio_tungstenite::tungstenite::Utf8Bytes;

    use super::*;

    const UPSTREAM_RELAY_ID: &str = "relay-a";

    fn announced(id: &str, via: &[&str]) -> AnnouncedDevice {
        AnnouncedDevice {
            id: id.to_string(),
            name: format!("设备 {id}"),
            online: true,
            via: via.iter().map(|hop| hop.to_string()).collect(),
        }
    }

    fn close_frame(code: u16, reason: &str) -> Option<CloseFrame> {
        Some(CloseFrame {
            code: CloseCode::from(code),
            reason: Utf8Bytes::from(reason.to_string()),
        })
    }

    /// Revocation is permanent, an unauthorized close asks the operator to act, and anything else
    /// is just a connection that has to be made again.
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

    /// An announcement that already crossed the upstream would come straight back to it.
    #[test]
    fn an_announcement_that_runs_through_the_upstream_is_not_sent() {
        assert!(is_routable_for(
            &announced("device-b", &["relay-b"]),
            UPSTREAM_RELAY_ID
        ));
        assert!(!is_routable_for(
            &announced("device-b", &["relay-b", UPSTREAM_RELAY_ID]),
            UPSTREAM_RELAY_ID
        ));
    }

    #[test]
    fn a_change_becomes_the_increment_the_upstream_understands() {
        let online = announcement_frame(
            RegistryChange::Online(announced("device-b", &["relay-b"])),
            UPSTREAM_RELAY_ID,
        );
        let offline = announcement_frame(
            RegistryChange::Offline {
                device_id: "device-b".into(),
            },
            UPSTREAM_RELAY_ID,
        );

        assert!(matches!(
            online,
            Some(ControlFrame::DeviceOnline { id, via, .. })
                if id == "device-b" && via == vec!["relay-b".to_string()]
        ));
        assert!(matches!(
            offline,
            Some(ControlFrame::DeviceOffline { id }) if id == "device-b"
        ));
        assert!(
            announcement_frame(
                RegistryChange::Online(announced("device-b", &[UPSTREAM_RELAY_ID])),
                UPSTREAM_RELAY_ID
            )
            .is_none(),
            "成环的通告不应发给上游"
        );
    }

    #[test]
    fn the_handshake_announces_this_build_as_a_relay() {
        let state = crate::state::tests::state_for_tests("relay-b");

        let encoded = hello_frame(&state).encode();

        assert!(encoded.contains("\"type\":\"hello\""));
        assert!(encoded.contains("\"kind\":\"relay\""));
        assert!(encoded.contains("\"relayId\":\"relay-b\""));
        assert!(encoded.contains(&format!("\"protocol\":{PROTOCOL_VERSION}")));
    }

    #[test]
    fn an_upstream_chain_that_contains_this_relay_is_refused() {
        let state = crate::state::tests::state_for_tests("relay-b");
        let looping = Welcome {
            device_id: "link".into(),
            relay_id: UPSTREAM_RELAY_ID.into(),
            addresses: Vec::new(),
            chain: vec!["relay-c".into(), "relay-b".into()],
        };
        let clean = Welcome {
            device_id: "link".into(),
            relay_id: UPSTREAM_RELAY_ID.into(),
            addresses: Vec::new(),
            chain: vec!["relay-c".into()],
        };

        assert!(matches!(
            refuse_loop(&state, &looping),
            Some(SessionEnd::Looped(_))
        ));
        assert!(refuse_loop(&state, &clean).is_none());
    }

    /// Dialling oneself is the shortest possible loop, and the chain alone does not describe it.
    #[test]
    fn an_upstream_that_is_this_relay_itself_is_refused() {
        let state = crate::state::tests::state_for_tests("relay-b");
        let welcome = Welcome {
            device_id: "link".into(),
            relay_id: "relay-b".into(),
            addresses: Vec::new(),
            chain: Vec::new(),
        };

        assert!(matches!(
            refuse_loop(&state, &welcome),
            Some(SessionEnd::Looped(_))
        ));
    }

    #[test]
    fn the_credential_travels_in_the_header_and_never_in_a_frame() {
        let settings = UpstreamSettings::build(
            "https://relay-a.example.com",
            "tdc1.abcdefghijklmnopqrstuvwxyz.c2VjcmV0LXZhbHVlLWZvci10ZXN0aW5n".into(),
            None,
        )
        .expect("the settings should build");

        let request = tunnel_request(&settings).expect("the request should be built");

        assert_eq!(
            request.uri().to_string(),
            "wss://relay-a.example.com/tunnel"
        );
        assert!(request
            .headers()
            .get(AUTHORIZATION)
            .expect("the credential should be presented")
            .is_sensitive());
    }
}
