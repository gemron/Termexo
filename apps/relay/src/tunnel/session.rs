//! One live tunnel: the handshake, the frame pump and the yamux connection that rides on it.
//!
//! Text frames are the control plane and binary frames are one continuous byte stream for yamux.
//! The relay is the only side that opens streams, so it runs yamux in `Mode::Client` and treats an
//! inbound stream as a peer that is out of spec.

use std::collections::VecDeque;
use std::future::poll_fn;
use std::net::IpAddr;
use std::task::Poll;

use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket};
use bytes::Bytes;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use termexo_relay_protocol::frames::{ControlFrame, DeviceKind, PROTOCOL_VERSION};
use termexo_relay_protocol::tunnel::{
    ChannelByteStream, CLOSE_GOING_AWAY, CLOSE_UNAUTHORIZED, HELLO_TIMEOUT, IDLE_TIMEOUT,
    PING_INTERVAL,
};
use tokio::sync::{mpsc, watch};
use tokio::time::timeout;
use tokio_util::compat::TokioAsyncReadCompatExt;

use super::handle::{OpenRequest, Outgoing, TunnelHandle, COMMAND_CAPACITY};
use crate::audit::{self, action, AuditEntry};
use crate::db::DeviceRecord;
use crate::registry::DirectPresence;
use crate::state::SharedState;

/// Concurrent streams one device may have open, from the design's resource table.
const MAX_CONCURRENT_STREAMS: usize = 64;

/// The per-stream receive window the design asks for.
///
/// yamux 0.14 tunes each stream's window automatically and only exposes a connection-wide ceiling,
/// so the budget is expressed as "the design's per-stream window times the stream limit": the same
/// total, with the library free to move it between streams.
const PER_STREAM_RECEIVE_WINDOW: usize = 256 * 1024;

/// How many binary frames may queue in either direction before the sender has to wait. Backpressure
/// belongs to yamux's own flow control; this only smooths bursts.
const FRAME_QUEUE_CAPACITY: usize = 128;

/// Close reasons. Every one of them reaches the desktop panel, so they are written in Chinese.
const REASON_REPLACED: &str = "设备已在别处重新接入。";
const REASON_PROTOCOL: &str = "未收到有效的 hello 帧。";
const REASON_VERSION_MISMATCH: &str = "隧道协议版本不匹配。";
const REASON_KIND_MISMATCH: &str = "设备类型与中继记录不一致。";

/// Why a tunnel ended, for the audit trail.
#[derive(Debug, Clone, Copy)]
enum CloseCause {
    PeerClosed,
    Idle,
    Transport,
    Local,
}

impl CloseCause {
    fn as_str(self) -> &'static str {
        match self {
            Self::PeerClosed => "peer-closed",
            Self::Idle => "idle-timeout",
            Self::Transport => "transport-error",
            Self::Local => "closed-by-relay",
        }
    }
}

/// Runs one tunnel from the accepted upgrade until it ends.
pub(super) async fn run(state: SharedState, socket: WebSocket, device: DeviceRecord, peer: IpAddr) {
    let (mut sink, mut stream) = socket.split();
    let Some(hello) = accept_hello(&state, &mut sink, &mut stream, &device).await else {
        return;
    };

    let (outgoing_sender, outgoing_receiver) = mpsc::channel(COMMAND_CAPACITY);
    let (opens_sender, opens_receiver) = mpsc::channel(COMMAND_CAPACITY);
    let (inbound_sender, inbound_receiver) = mpsc::channel(FRAME_QUEUE_CAPACITY);
    let (data_sender, data_receiver) = mpsc::channel(FRAME_QUEUE_CAPACITY);
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);

    let handle = TunnelHandle::new(&device.id, opens_sender, outgoing_sender);
    let writer = tokio::spawn(write_frames(
        sink,
        data_receiver,
        outgoing_receiver,
        shutdown_sender,
    ));
    let driver = tokio::spawn(drive_multiplexer(
        ChannelByteStream::new(inbound_receiver, data_sender),
        opens_receiver,
    ));

    let registration = state.registry.connect(DirectPresence {
        device_id: device.id.clone(),
        name: device.name.clone(),
        kind: hello.kind,
        relay_id: hello.relay_id.clone(),
        ip: Some(peer.to_string()),
        version: Some(hello.version.clone()),
        handle: handle.clone(),
    });
    if let Some(previous) = registration.displaced {
        previous.close(CLOSE_GOING_AWAY, REASON_REPLACED);
    }
    if let Err(error) =
        state
            .database
            .record_device_connection(&device.id, &peer.to_string(), &hello.version)
    {
        tracing::warn!(%error, device = %device.id, "无法记录设备接入信息");
    }
    audit::record(
        &state.database,
        AuditEntry::by_device(&device.id, action::TUNNEL_CONNECTED)
            .from_ip(peer)
            .detail("kind", hello.kind_label())
            .detail("version", hello.version.as_str()),
    );
    tracing::info!(device = %device.id, kind = hello.kind_label(), "设备隧道已建立");

    let cause = read_frames(
        &state,
        &mut stream,
        inbound_sender,
        &handle,
        hello.kind,
        shutdown_receiver,
    )
    .await;

    handle.close(CLOSE_GOING_AWAY, "中继正在关闭这条隧道。");
    driver.abort();
    let _ = writer.await;
    state.registry.disconnect(&device.id, registration.serial);
    if let Err(error) = state.database.record_device_disconnection(&device.id) {
        tracing::warn!(%error, device = %device.id, "无法记录设备断开时间");
    }
    audit::record(
        &state.database,
        AuditEntry::by_device(&device.id, action::TUNNEL_DISCONNECTED)
            .from_ip(peer)
            .detail("cause", cause.as_str()),
    );
    tracing::info!(device = %device.id, cause = cause.as_str(), "设备隧道已断开");
}

/// What an accepted `hello` told the relay.
struct Hello {
    kind: DeviceKind,
    version: String,
    relay_id: Option<String>,
}

impl Hello {
    fn kind_label(&self) -> &'static str {
        crate::db::device_kind_label(self.kind)
    }
}

/// Reads and validates the first frame, answering with `welcome` or closing the tunnel.
async fn accept_hello(
    state: &SharedState,
    sink: &mut SplitSink<WebSocket, Message>,
    stream: &mut SplitStream<WebSocket>,
    device: &DeviceRecord,
) -> Option<Hello> {
    let frame = match timeout(HELLO_TIMEOUT, stream.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => ControlFrame::decode(text.as_str()).ok(),
        _ => None,
    };
    let Some(ControlFrame::Hello {
        protocol,
        kind,
        version,
        relay_id,
        ..
    }) = frame
    else {
        reject(sink, REASON_PROTOCOL).await;
        return None;
    };

    if protocol != PROTOCOL_VERSION {
        tracing::info!(device = %device.id, protocol, "设备隧道协议版本不匹配");
        reject(sink, REASON_VERSION_MISMATCH).await;
        return None;
    }
    if kind != device.kind {
        tracing::info!(device = %device.id, "设备声明的类型与记录不一致");
        reject(sink, REASON_KIND_MISMATCH).await;
        return None;
    }

    let welcome = ControlFrame::Welcome {
        device_id: device.id.clone(),
        relay_id: state.relay_id.clone(),
        addresses: vec![state.relay_address(&device.id)],
        // The upstream chain is empty until cascading lands; this relay is the top of it.
        chain: Vec::new(),
    };
    if sink
        .send(Message::Text(Utf8Bytes::from(welcome.encode())))
        .await
        .is_err()
    {
        return None;
    }
    Some(Hello {
        kind,
        version,
        relay_id,
    })
}

/// Refuses a tunnel after the upgrade, which the protocol does with a frame and close code 4401.
async fn reject(sink: &mut SplitSink<WebSocket, Message>, reason: &'static str) {
    let frame = ControlFrame::AuthFailed {
        reason: reason.to_string(),
    };
    let _ = sink
        .send(Message::Text(Utf8Bytes::from(frame.encode())))
        .await;
    let _ = sink
        .send(Message::Close(Some(CloseFrame {
            code: CLOSE_UNAUTHORIZED,
            reason: Utf8Bytes::from_static(""),
        })))
        .await;
    let _ = sink.close().await;
}

/// Pumps everything the relay sends onto the WebSocket: multiplexed data, control frames and the
/// periodic ping.
async fn write_frames(
    mut sink: SplitSink<WebSocket, Message>,
    mut data: mpsc::Receiver<Bytes>,
    mut outgoing: mpsc::Receiver<Outgoing>,
    shutdown: watch::Sender<bool>,
) {
    let mut ping = tokio::time::interval(PING_INTERVAL);
    // The first tick of an interval fires immediately, which would ping before the device has
    // settled; skipping it keeps the cadence at exactly one ping per interval.
    ping.tick().await;

    loop {
        let message = tokio::select! {
            frame = data.recv() => match frame {
                // The multiplexer is gone, so there is nothing left to carry.
                None => break,
                Some(bytes) => Message::Binary(bytes),
            },
            command = outgoing.recv() => match command {
                None => break,
                Some(Outgoing::Control(frame)) => Message::Text(Utf8Bytes::from(frame.encode())),
                Some(Outgoing::Close { code, reason }) => {
                    let _ = sink
                        .send(Message::Close(Some(CloseFrame {
                            code,
                            reason: Utf8Bytes::from(reason),
                        })))
                        .await;
                    break;
                }
            },
            _ = ping.tick() => Message::Text(Utf8Bytes::from(ControlFrame::Ping.encode())),
        };
        if sink.send(message).await.is_err() {
            break;
        }
    }

    let _ = sink.close().await;
    // Telling the reader that the socket is finished is what ends the session when the close was
    // asked for locally rather than by the peer.
    let _ = shutdown.send(true);
}

/// Reads the device's frames until the tunnel ends.
async fn read_frames(
    state: &SharedState,
    stream: &mut SplitStream<WebSocket>,
    inbound: mpsc::Sender<Bytes>,
    handle: &TunnelHandle,
    kind: DeviceKind,
    mut shutdown: watch::Receiver<bool>,
) -> CloseCause {
    loop {
        let next = tokio::select! {
            _ = shutdown.changed() => return CloseCause::Local,
            result = timeout(IDLE_TIMEOUT, stream.next()) => result,
        };
        let message = match next {
            Err(_) => return CloseCause::Idle,
            Ok(None) | Ok(Some(Ok(Message::Close(_)))) => return CloseCause::PeerClosed,
            Ok(Some(Err(_))) => return CloseCause::Transport,
            Ok(Some(Ok(message))) => message,
        };

        match message {
            Message::Text(text) => match ControlFrame::decode(text.as_str()) {
                Ok(frame) => handle_control_frame(state, handle, kind, frame),
                Err(error) => {
                    tracing::debug!(device = %handle.device_id(), %error, "忽略无法解析的控制帧");
                }
            },
            // A full queue means the multiplexer stopped reading, which only happens once the
            // connection is finished; sending applies the backpressure that keeps memory bounded.
            Message::Binary(bytes) => {
                if inbound.send(bytes).await.is_err() {
                    return CloseCause::Transport;
                }
            }
            // axum answers protocol-level pings by itself, so nothing else needs handling here.
            Message::Ping(_) | Message::Pong(_) | Message::Close(_) => {}
        }
    }
}

/// Applies one control frame from a device.
fn handle_control_frame(
    state: &SharedState,
    handle: &TunnelHandle,
    kind: DeviceKind,
    frame: ControlFrame,
) {
    match frame {
        ControlFrame::Ping => handle.send_frame(ControlFrame::Pong),
        ControlFrame::Pong => {}
        // Only a downstream relay may speak for other devices; a desktop that tries is ignored
        // rather than trusted, because accepting it would let any device hijack any route.
        ControlFrame::Announce { devices } if kind == DeviceKind::Relay => {
            state
                .registry
                .apply_announcement(handle.device_id(), handle, devices);
        }
        ControlFrame::DeviceOnline { id, name, via } if kind == DeviceKind::Relay => {
            state.registry.announce_device(
                handle.device_id(),
                handle,
                termexo_relay_protocol::frames::AnnouncedDevice {
                    id,
                    name,
                    online: true,
                    via,
                },
            );
        }
        ControlFrame::DeviceOffline { id } if kind == DeviceKind::Relay => {
            state.registry.withdraw_device(handle.device_id(), &id);
        }
        other => {
            tracing::debug!(device = %handle.device_id(), frame = ?other, "忽略设备发来的控制帧");
        }
    }
}

/// Owns the yamux connection and answers requests for outbound streams.
///
/// Both halves have to be driven from the same task because every yamux operation needs `&mut` on
/// the connection; a single `poll_fn` is what keeps them from fighting over it.
async fn drive_multiplexer(
    transport: ChannelByteStream,
    mut requests: mpsc::Receiver<OpenRequest>,
) {
    let mut connection = yamux::Connection::new(
        TokioAsyncReadCompatExt::compat(transport),
        multiplexer_config(),
        yamux::Mode::Client,
    );
    let mut pending: VecDeque<OpenRequest> = VecDeque::new();

    poll_fn(|context| loop {
        let mut progressed = false;

        while let Poll::Ready(request) = requests.poll_recv(context) {
            match request {
                Some(request) => pending.push_back(request),
                // Every handle is gone, so nothing will ask for a stream again.
                None => return Poll::Ready(()),
            }
        }

        while !pending.is_empty() {
            match connection.poll_new_outbound(context) {
                Poll::Ready(Ok(stream)) => {
                    if let Some(request) = pending.pop_front() {
                        let _ = request.reply.send(Ok(stream));
                    }
                    progressed = true;
                }
                Poll::Ready(Err(error)) => {
                    // One failure ends the connection, so every queued request fails with it.
                    for request in pending.drain(..) {
                        let _ = request.reply.send(Err(yamux::ConnectionError::Closed));
                    }
                    tracing::debug!(%error, "隧道多路复用连接已结束");
                    return Poll::Ready(());
                }
                Poll::Pending => break,
            }
        }

        match connection.poll_next_inbound(context) {
            // The relay is the only side that opens streams; anything inbound is dropped, which
            // resets it rather than letting a confused peer hold resources.
            Poll::Ready(Some(Ok(_))) => progressed = true,
            Poll::Ready(Some(Err(_)) | None) => return Poll::Ready(()),
            Poll::Pending => {}
        }

        if !progressed {
            return Poll::Pending;
        }
    })
    .await;
}

fn multiplexer_config() -> yamux::Config {
    let mut config = yamux::Config::default();
    config.set_max_num_streams(MAX_CONCURRENT_STREAMS);
    config.set_max_connection_receive_window(Some(
        MAX_CONCURRENT_STREAMS * PER_STREAM_RECEIVE_WINDOW,
    ));
    config
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_multiplexer_budget_matches_the_designed_limits() {
        let _ = multiplexer_config();

        assert_eq!(MAX_CONCURRENT_STREAMS, 64);
        assert_eq!(PER_STREAM_RECEIVE_WINDOW, 256 * 1024);
    }

    #[test]
    fn every_close_cause_has_a_stable_audit_label() {
        assert_eq!(CloseCause::Idle.as_str(), "idle-timeout");
        assert_eq!(CloseCause::PeerClosed.as_str(), "peer-closed");
        assert_eq!(CloseCause::Transport.as_str(), "transport-error");
        assert_eq!(CloseCause::Local.as_str(), "closed-by-relay");
    }
}
