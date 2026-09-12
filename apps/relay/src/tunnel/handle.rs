//! The handle other modules use to talk to a live tunnel.
//!
//! Everything a tunnel owns — the WebSocket, the yamux connection — lives inside its own task, so
//! the proxy and the console API only ever hold this handle and ask for work over channels.

use std::io;
use std::sync::Arc;
use std::time::Duration;

use termexo_relay_protocol::frames::ControlFrame;
use termexo_relay_protocol::preface::StreamPreface;
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;
use tokio_util::compat::{Compat, FuturesAsyncReadCompatExt};

/// One stream inside a tunnel, adapted from yamux's futures-io traits to tokio's.
pub type TunnelStream = Compat<yamux::Stream>;

/// How long the proxy waits for a stream before giving up on a device.
///
/// A tunnel that is at its stream limit or whose peer stopped reading would otherwise hold a
/// browser request open indefinitely; ten seconds is long enough that a merely busy device still
/// answers and short enough that a stuck one turns into a visible error.
const OPEN_STREAM_TIMEOUT: Duration = Duration::from_secs(10);

/// Queue depth for stream openings and control frames. Both are low-rate: a browser navigation
/// opens one stream, and the control plane carries a ping every twenty seconds.
pub(super) const COMMAND_CAPACITY: usize = 64;

#[derive(Debug, Error)]
pub enum TunnelError {
    #[error("设备隧道已断开。")]
    Closed,
    #[error("设备当前不在线。")]
    Offline,
    #[error("请求的目标不是一台已知设备。")]
    InvalidTarget,
    #[error("设备在超时前没有接受新的连接。")]
    OpenTimeout,
    #[error("写入流前导失败：{0}")]
    Preface(#[from] io::Error),
}

/// A request for one outbound stream, answered by the tunnel's driver task.
pub(super) struct OpenRequest {
    pub(super) reply: oneshot::Sender<Result<yamux::Stream, yamux::ConnectionError>>,
}

/// What the writer task sends on the WebSocket besides multiplexed data.
pub(super) enum Outgoing {
    Control(ControlFrame),
    Close { code: u16, reason: String },
}

#[derive(Clone)]
pub struct TunnelHandle {
    device_id: Arc<str>,
    opens: mpsc::Sender<OpenRequest>,
    outgoing: mpsc::Sender<Outgoing>,
}

impl TunnelHandle {
    pub(super) fn new(
        device_id: &str,
        opens: mpsc::Sender<OpenRequest>,
        outgoing: mpsc::Sender<Outgoing>,
    ) -> Self {
        Self {
            device_id: Arc::from(device_id),
            opens,
            outgoing,
        }
    }

    /// A handle whose tunnel is already gone. Used as a stand-in in tests and wherever a route has
    /// to be described without a live connection.
    pub fn disconnected(device_id: &str) -> Self {
        let (opens, _) = mpsc::channel(1);
        let (outgoing, _) = mpsc::channel(1);
        Self::new(device_id, opens, outgoing)
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    /// Opens one stream and writes its preface, so what comes back is positioned exactly at the
    /// first byte of HTTP.
    pub async fn open_stream(&self, preface: &StreamPreface) -> Result<TunnelStream, TunnelError> {
        let (reply, answer) = oneshot::channel();
        self.opens
            .send(OpenRequest { reply })
            .await
            .map_err(|_| TunnelError::Closed)?;
        let stream = timeout(OPEN_STREAM_TIMEOUT, answer)
            .await
            .map_err(|_| TunnelError::OpenTimeout)?
            .map_err(|_| TunnelError::Closed)?
            .map_err(|error| {
                tracing::debug!(device = %self.device_id, %error, "打开隧道流失败");
                TunnelError::Closed
            })?;

        let mut stream = FuturesAsyncReadCompatExt::compat(stream);
        stream.write_all(&preface.encode()).await?;
        stream.flush().await?;
        Ok(stream)
    }

    /// Queues a control frame, dropping it if the tunnel is gone or hopelessly behind.
    ///
    /// A control frame is never worth blocking a caller for: a device that cannot keep up with
    /// pings is already on its way to the idle timeout.
    pub fn send_frame(&self, frame: ControlFrame) {
        if self.outgoing.try_send(Outgoing::Control(frame)).is_err() {
            tracing::debug!(device = %self.device_id, "控制帧未能送达设备隧道");
        }
    }

    /// Asks the tunnel to send a close frame and shut down.
    pub fn close(&self, code: u16, reason: &str) {
        let _ = self.outgoing.try_send(Outgoing::Close {
            code,
            reason: reason.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use termexo_relay_protocol::tunnel::CLOSE_GOING_AWAY;

    use super::*;

    #[tokio::test]
    async fn a_disconnected_handle_refuses_to_open_a_stream() {
        let handle = TunnelHandle::disconnected("device-a");

        let error = handle
            .open_stream(&StreamPreface::new("device-a"))
            .await
            .expect_err("a dead tunnel cannot open a stream");

        assert!(matches!(error, TunnelError::Closed));
        assert_eq!(handle.device_id(), "device-a");
    }

    #[tokio::test]
    async fn control_frames_and_closes_on_a_dead_tunnel_are_dropped_quietly() {
        let handle = TunnelHandle::disconnected("device-a");

        handle.send_frame(ControlFrame::Ping);
        handle.close(CLOSE_GOING_AWAY, "服务已停止。");
    }

    #[tokio::test]
    async fn a_queued_close_reaches_the_writer() {
        let (opens, _open_receiver) = mpsc::channel(1);
        let (outgoing, mut outgoing_receiver) = mpsc::channel(1);
        let handle = TunnelHandle::new("device-a", opens, outgoing);

        handle.close(4403, "接入已被中继撤销。");

        let sent = outgoing_receiver
            .recv()
            .await
            .expect("the close should queue");
        assert!(matches!(sent, Outgoing::Close { code: 4403, .. }));
    }
}
