//! Turns the binary frames of a tunnel into the single byte stream yamux multiplexes over.
//!
//! Each end routes a WebSocket's text frames to the control plane and its binary frames into this
//! adapter, so the multiplexer never learns that it is running on top of a WebSocket.

use std::future::Future;
use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::{Buf, Bytes};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::mpsc::error::SendError;
use tokio::sync::mpsc::{OwnedPermit, Receiver, Sender};

/// Reported once the outbound half is gone, so a multiplexer stops writing instead of spinning.
const OUTBOUND_CLOSED_MESSAGE: &str = "隧道出站通道已关闭。";

type Reservation = Pin<Box<dyn Future<Output = Result<OwnedPermit<Bytes>, SendError<()>>> + Send>>;

/// The write half's state. A bounded channel can only be awaited through a reservation future, and
/// that future has to live between polls because `poll_write` may return `Pending`.
enum Outbound {
    Idle(Sender<Bytes>),
    Reserving(Reservation),
    Closed,
}

/// A byte stream over one pair of frame channels.
pub struct ChannelByteStream {
    inbound: Receiver<Bytes>,
    /// What is left of the inbound frame currently being read out.
    pending: Bytes,
    outbound: Outbound,
}

impl ChannelByteStream {
    pub fn new(inbound: Receiver<Bytes>, outbound: Sender<Bytes>) -> Self {
        Self {
            inbound,
            pending: Bytes::new(),
            outbound: Outbound::Idle(outbound),
        }
    }
}

impl AsyncRead for ChannelByteStream {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let stream = self.get_mut();
        if buffer.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }

        // A frame may be empty, and reporting zero filled bytes would be read as end of stream, so
        // keep pulling frames until one of them actually carries payload.
        while stream.pending.is_empty() {
            match stream.inbound.poll_recv(context) {
                Poll::Ready(Some(frame)) => stream.pending = frame,
                Poll::Ready(None) => return Poll::Ready(Ok(())),
                Poll::Pending => return Poll::Pending,
            }
        }

        // One frame can be larger than the reader's buffer, so what is left stays for the next read.
        let taken = stream.pending.len().min(buffer.remaining());
        buffer.put_slice(&stream.pending[..taken]);
        stream.pending.advance(taken);
        Poll::Ready(Ok(()))
    }
}

impl AsyncWrite for ChannelByteStream {
    fn poll_write(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        let stream = self.get_mut();
        if data.is_empty() {
            return Poll::Ready(Ok(0));
        }

        loop {
            match std::mem::replace(&mut stream.outbound, Outbound::Closed) {
                Outbound::Closed => return Poll::Ready(Err(outbound_closed())),
                Outbound::Idle(sender) => {
                    stream.outbound = Outbound::Reserving(Box::pin(sender.reserve_owned()));
                }
                // The reservation is independent of the payload, so resuming a `Pending` write with
                // a different buffer is safe: the slot is only filled once a permit is in hand.
                Outbound::Reserving(mut reservation) => match reservation.as_mut().poll(context) {
                    Poll::Pending => {
                        stream.outbound = Outbound::Reserving(reservation);
                        return Poll::Pending;
                    }
                    Poll::Ready(Err(_)) => return Poll::Ready(Err(outbound_closed())),
                    Poll::Ready(Ok(permit)) => {
                        // One `poll_write` becomes exactly one binary frame.
                        stream.outbound = Outbound::Idle(permit.send(Bytes::copy_from_slice(data)));
                        return Poll::Ready(Ok(data.len()));
                    }
                },
            }
        }
    }

    /// Nothing is buffered here: an accepted write has already been handed to the channel.
    fn poll_flush(self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<io::Result<()>> {
        // Dropping the sender is what lets the frame pump see the end of the stream and close the
        // WebSocket rather than wait for more frames.
        self.get_mut().outbound = Outbound::Closed;
        Poll::Ready(Ok(()))
    }
}

fn outbound_closed() -> io::Error {
    io::Error::new(io::ErrorKind::BrokenPipe, OUTBOUND_CLOSED_MESSAGE)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::mpsc;

    use super::*;

    const CHANNEL_CAPACITY: usize = 8;
    /// Long enough to let a ready write finish, short enough to keep a blocked one from stalling
    /// the suite.
    const BLOCKED_WRITE_PROBE: Duration = Duration::from_millis(50);

    struct Harness {
        stream: ChannelByteStream,
        inbound: mpsc::Sender<Bytes>,
        outbound: mpsc::Receiver<Bytes>,
    }

    fn harness(capacity: usize) -> Harness {
        let (inbound, inbound_receiver) = mpsc::channel(capacity);
        let (outbound_sender, outbound) = mpsc::channel(capacity);
        Harness {
            stream: ChannelByteStream::new(inbound_receiver, outbound_sender),
            inbound,
            outbound,
        }
    }

    #[tokio::test]
    async fn frames_are_read_back_as_one_continuous_stream() {
        let mut harness = harness(CHANNEL_CAPACITY);
        for frame in [&b"hel"[..], &b"lo "[..], &b"world"[..]] {
            harness
                .inbound
                .send(Bytes::from_static(frame))
                .await
                .expect("the stream should accept the frame");
        }
        drop(harness.inbound);

        let mut read = String::new();
        harness
            .stream
            .read_to_string(&mut read)
            .await
            .expect("the stream should read to the end");

        assert_eq!(read, "hello world");
    }

    #[tokio::test]
    async fn a_frame_larger_than_the_buffer_is_read_in_pieces() {
        let mut harness = harness(CHANNEL_CAPACITY);
        harness
            .inbound
            .send(Bytes::from_static(b"abcdef"))
            .await
            .expect("the stream should accept the frame");

        let mut first = [0_u8; 2];
        harness
            .stream
            .read_exact(&mut first)
            .await
            .expect("the first piece should be readable");
        let mut rest = [0_u8; 4];
        harness
            .stream
            .read_exact(&mut rest)
            .await
            .expect("the rest of the frame should be readable");

        assert_eq!(&first, b"ab");
        assert_eq!(&rest, b"cdef");
    }

    #[tokio::test]
    async fn an_empty_frame_is_not_the_end_of_the_stream() {
        let mut harness = harness(CHANNEL_CAPACITY);
        harness
            .inbound
            .send(Bytes::new())
            .await
            .expect("the stream should accept the frame");
        harness
            .inbound
            .send(Bytes::from_static(b"x"))
            .await
            .expect("the stream should accept the frame");

        let mut read = [0_u8; 1];
        harness
            .stream
            .read_exact(&mut read)
            .await
            .expect("the payload after the empty frame should be readable");

        assert_eq!(&read, b"x");
    }

    #[tokio::test]
    async fn dropping_the_inbound_half_ends_the_stream() {
        let mut harness = harness(CHANNEL_CAPACITY);
        drop(harness.inbound);

        let mut read = Vec::new();
        harness
            .stream
            .read_to_end(&mut read)
            .await
            .expect("the stream should end cleanly");

        assert!(read.is_empty());
    }

    #[tokio::test]
    async fn each_write_becomes_one_frame() {
        let mut harness = harness(CHANNEL_CAPACITY);

        harness
            .stream
            .write_all(b"abc")
            .await
            .expect("the write should be accepted");
        harness
            .stream
            .write_all(b"de")
            .await
            .expect("the write should be accepted");

        assert_eq!(
            harness.outbound.recv().await,
            Some(Bytes::from_static(b"abc"))
        );
        assert_eq!(
            harness.outbound.recv().await,
            Some(Bytes::from_static(b"de"))
        );
    }

    #[tokio::test]
    async fn shutting_down_closes_the_outbound_channel() {
        let mut harness = harness(CHANNEL_CAPACITY);
        harness
            .stream
            .write_all(b"abc")
            .await
            .expect("the write should be accepted");

        harness
            .stream
            .shutdown()
            .await
            .expect("shutdown should succeed");

        assert_eq!(
            harness.outbound.recv().await,
            Some(Bytes::from_static(b"abc"))
        );
        assert_eq!(harness.outbound.recv().await, None);
        assert_eq!(
            harness
                .stream
                .write(b"late")
                .await
                .expect_err("a write after shutdown should fail")
                .kind(),
            io::ErrorKind::BrokenPipe
        );
    }

    #[tokio::test]
    async fn a_full_outbound_channel_holds_the_write_back() {
        let mut harness = harness(1);
        harness
            .stream
            .write_all(b"first")
            .await
            .expect("the first write should be accepted");

        assert!(
            tokio::time::timeout(BLOCKED_WRITE_PROBE, harness.stream.write_all(b"second"))
                .await
                .is_err(),
            "the write should wait for room in the channel"
        );

        assert_eq!(
            harness.outbound.recv().await,
            Some(Bytes::from_static(b"first"))
        );
        harness
            .stream
            .write_all(b"second")
            .await
            .expect("the write should go through once there is room");
        assert_eq!(
            harness.outbound.recv().await,
            Some(Bytes::from_static(b"second"))
        );
    }
}
