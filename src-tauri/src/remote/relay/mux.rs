//! The data plane of a tunnel: yamux over the tunnel's binary frames, one HTTP/1.1 connection per
//! stream.
//!
//! The relay opens every stream, so this end is the multiplexer's server. Each stream carries one
//! raw HTTP connection for the workbench's own router, which is what keeps the remote workbench a
//! single implementation rather than a second backend.

use std::future::poll_fn;

use axum::Router;
use hyper::server::conn::http1;
use hyper_util::rt::TokioIo;
use hyper_util::service::TowerToHyperService;
use termexo_relay_protocol::preface::{read_preface, PrefaceError, StreamPreface};
use termexo_relay_protocol::tunnel::ChannelByteStream;
use thiserror::Error;
use tokio::io::AsyncRead;
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};

/// The relay allows a device this many concurrent streams, so accepting more would only let a
/// misbehaving peer hold connections this end will never see traffic on.
const MAX_CONCURRENT_STREAMS: usize = 64;

/// Runs the multiplexer until the tunnel's byte stream ends.
///
/// Returning is how the session learns that the data plane is gone; the caller tears the control
/// plane down with it.
pub(super) async fn serve(byte_stream: ChannelByteStream, router: Router, device_id: String) {
    let mut config = yamux::Config::default();
    config.set_max_num_streams(MAX_CONCURRENT_STREAMS);
    // yamux speaks the `futures` I/O traits, so both ends of every stream cross `tokio_util`'s
    // compatibility shim: the tunnel's byte stream on the way in, each stream on the way out.
    let mut connection = yamux::Connection::new(byte_stream.compat(), config, yamux::Mode::Server);

    loop {
        match poll_fn(|context| connection.poll_next_inbound(context)).await {
            Some(Ok(stream)) => {
                tauri::async_runtime::spawn(serve_stream(
                    stream,
                    router.clone(),
                    device_id.clone(),
                ));
            }
            Some(Err(error)) => {
                tracing::debug!(%error, "隧道多路复用连接已出错");
                return;
            }
            None => return,
        }
    }
}

async fn serve_stream(stream: yamux::Stream, router: Router, device_id: String) {
    let mut io = stream.compat();
    if let Err(rejection) = accept_stream(&mut io, &device_id).await {
        // Dropping the stream is what tells the relay this end refused it.
        tracing::warn!(reason = %rejection, "已拒绝一条中继流");
        return;
    }

    // `with_upgrades` is what carries the workbench's own `/ws` connection through the tunnel: the
    // upgrade turns the rest of this stream into the WebSocket's frames.
    if let Err(error) = http1::Builder::new()
        .serve_connection(TokioIo::new(io), TowerToHyperService::new(router))
        .with_upgrades()
        .await
    {
        tracing::debug!(%error, "隧道内的 HTTP 连接已结束");
    }
}

/// Why a stream the relay opened was refused.
#[derive(Debug, Error)]
enum StreamRejection {
    #[error("{0}")]
    Preface(#[from] PrefaceError),
    /// A relay whose routing table is out of date would otherwise hand another device's browser
    /// this machine's workbench.
    #[error("流前导指向设备 {target}，与本机设备不符。")]
    WrongTarget { target: String },
}

/// Consumes the preface and confirms the stream is addressed to this device.
///
/// Only the preface is read, so the HTTP request behind it reaches hyper untouched.
async fn accept_stream<S: AsyncRead + Unpin>(
    io: &mut S,
    device_id: &str,
) -> Result<StreamPreface, StreamRejection> {
    let preface = read_preface(io).await?;
    if preface.target != device_id {
        return Err(StreamRejection::WrongTarget {
            target: preface.target,
        });
    }
    Ok(preface)
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::*;

    const DEVICE_ID: &str = "abcdefghijklmnopqrstuvwxyz";
    const DUPLEX_CAPACITY: usize = 4096;

    /// Writes a preface followed by the first bytes of a request, the way the relay does.
    async fn open_stream(preface: &StreamPreface) -> tokio::io::DuplexStream {
        let (mut relay, device) = tokio::io::duplex(DUPLEX_CAPACITY);
        relay
            .write_all(&preface.encode())
            .await
            .expect("the preface should be written");
        relay
            .write_all(b"GET / HTTP/1.1\r\n")
            .await
            .expect("the request should be written");
        device
    }

    #[tokio::test]
    async fn a_stream_for_this_device_is_accepted_and_leaves_the_request_untouched() {
        let mut io = open_stream(&StreamPreface::new(DEVICE_ID)).await;

        let preface = accept_stream(&mut io, DEVICE_ID)
            .await
            .expect("a stream for this device should be accepted");
        assert_eq!(preface.target, DEVICE_ID);

        // Reading the preface must not have consumed any of the HTTP bytes behind it.
        let mut request = [0_u8; 16];
        io.read_exact(&mut request)
            .await
            .expect("the request should still be there");
        assert_eq!(&request, b"GET / HTTP/1.1\r\n");
    }

    #[tokio::test]
    async fn a_stream_addressed_to_another_device_is_refused() {
        let mut io = open_stream(&StreamPreface::new("zyxwvutsrqponmlkjihgfedcba")).await;

        let rejection = accept_stream(&mut io, DEVICE_ID)
            .await
            .expect_err("a stream for another device should be refused");

        assert!(matches!(rejection, StreamRejection::WrongTarget { .. }));
    }

    #[tokio::test]
    async fn a_stream_whose_preface_is_unreadable_is_refused() {
        let (mut relay, mut device) = tokio::io::duplex(DUPLEX_CAPACITY);
        relay
            .write_all(b"not a preface")
            .await
            .expect("the bytes should be written");
        drop(relay);

        assert!(matches!(
            accept_stream(&mut device, DEVICE_ID).await,
            Err(StreamRejection::Preface(_))
        ));
    }
}
