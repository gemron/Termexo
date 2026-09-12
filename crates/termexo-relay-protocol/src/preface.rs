//! The preface a relay writes in front of every stream it opens inside a tunnel.
//!
//! A stream carries one raw HTTP/1.1 connection, so the preface has to be framed by an explicit
//! length instead of a delimiter: a line-oriented reader would buffer past the newline and swallow
//! bytes that belong to the request.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt};

/// Bumped when the preface body changes shape; unrelated to [`crate::frames::PROTOCOL_VERSION`]
/// because a relay may forward streams for peers it does not share a control version with.
pub const PREFACE_VERSION: u32 = 1;
/// A preface only holds a device id and a handful of relay ids, so anything larger is a peer that
/// is out of sync — refusing early keeps a bad length prefix from allocating on our behalf.
pub const MAX_PREFACE_BYTES: usize = 4096;
/// Upper bound on the relay chain a stream may cross. It is the last line of the loop guard: even
/// if announcements and `chain` checks both fail, a circulating stream dies after this many hops.
pub const MAX_HOPS: usize = 8;

/// The preface body is prefixed by its length as a big-endian `u32`.
const LENGTH_PREFIX_BYTES: usize = 4;

/// Tells the far end of a stream which device the stream is for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamPreface {
    pub v: u32,
    pub target: String,
    /// The relays already crossed, in order. Each relay appends its own id before forwarding.
    #[serde(default)]
    pub hops: Vec<String>,
}

impl StreamPreface {
    pub fn new(target: impl Into<String>) -> Self {
        Self {
            v: PREFACE_VERSION,
            target: target.into(),
            hops: Vec::new(),
        }
    }

    /// Records one more relay on the path, for the hop it is about to forward the stream over.
    pub fn with_hop(mut self, relay_id: impl Into<String>) -> Self {
        self.hops.push(relay_id.into());
        self
    }

    /// Renders the length prefix and the body as the first bytes of a stream.
    pub fn encode(&self) -> Vec<u8> {
        // `target` and `hops` are plain strings, so serialization cannot fail; see `ControlFrame`.
        let body =
            serde_json::to_vec(self).expect("a stream preface is plain JSON-compatible data");
        let mut encoded = Vec::with_capacity(LENGTH_PREFIX_BYTES + body.len());
        encoded.extend_from_slice(&(body.len() as u32).to_be_bytes());
        encoded.extend_from_slice(&body);
        encoded
    }

    fn validate(&self) -> Result<(), PrefaceError> {
        if self.v != PREFACE_VERSION {
            return Err(PrefaceError::UnsupportedVersion { version: self.v });
        }
        if self.hops.len() > MAX_HOPS {
            return Err(PrefaceError::TooManyHops {
                hops: self.hops.len(),
            });
        }
        Ok(())
    }
}

/// Why a stream could not be accepted. The text reaches the relay's audit log and the desktop
/// panel, so it is user-facing.
#[derive(Debug, Error)]
pub enum PrefaceError {
    #[error("读取流前导失败：{0}")]
    Read(#[from] std::io::Error),
    #[error("流前导长度 {length} 字节超过 {} 字节上限。", MAX_PREFACE_BYTES)]
    TooLarge { length: usize },
    #[error("流前导不是有效的 JSON：{0}")]
    Malformed(#[from] serde_json::Error),
    #[error("流前导版本 {version} 不受支持，需要版本 {}。", PREFACE_VERSION)]
    UnsupportedVersion { version: u32 },
    #[error("流前导经过 {hops} 台中继，超过 {} 台的上限。", MAX_HOPS)]
    TooManyHops { hops: usize },
}

/// Reads exactly the preface and nothing more, leaving the HTTP bytes behind it untouched.
pub async fn read_preface<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<StreamPreface, PrefaceError> {
    let mut length_prefix = [0_u8; LENGTH_PREFIX_BYTES];
    reader.read_exact(&mut length_prefix).await?;

    let length = u32::from_be_bytes(length_prefix) as usize;
    if length > MAX_PREFACE_BYTES {
        return Err(PrefaceError::TooLarge { length });
    }

    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body).await?;

    let preface: StreamPreface = serde_json::from_slice(&body)?;
    preface.validate()?;
    Ok(preface)
}

#[cfg(test)]
mod tests {
    use tokio::io::AsyncWriteExt;

    use super::*;

    const TARGET: &str = "abcdefghijklmnopqrstuvwxyz";

    /// Feeds bytes through an in-memory pipe, which is the closest stand-in for a yamux stream.
    async fn read_from(bytes: &[u8]) -> Result<StreamPreface, PrefaceError> {
        let (mut client, mut server) = tokio::io::duplex(MAX_PREFACE_BYTES * 2);
        client
            .write_all(bytes)
            .await
            .expect("the pipe should accept the preface");
        // Ending the stream is what turns a truncated preface into an error instead of a hang.
        drop(client);
        read_preface(&mut server).await
    }

    #[tokio::test]
    async fn a_preface_survives_a_round_trip() {
        let preface = StreamPreface::new(TARGET)
            .with_hop("relay-a")
            .with_hop("relay-b");

        assert_eq!(
            read_from(&preface.encode())
                .await
                .expect("it should decode"),
            preface
        );
    }

    #[test]
    fn a_fresh_preface_carries_the_current_version_and_no_hops() {
        let preface = StreamPreface::new(TARGET);

        assert_eq!(preface.v, PREFACE_VERSION);
        assert!(preface.hops.is_empty());
    }

    #[tokio::test]
    async fn reading_stops_at_the_end_of_the_preface() {
        let preface = StreamPreface::new(TARGET);
        let (mut client, mut server) = tokio::io::duplex(MAX_PREFACE_BYTES * 2);
        let mut wire = preface.encode();
        wire.extend_from_slice(b"GET / HTTP/1.1\r\n");
        client
            .write_all(&wire)
            .await
            .expect("the pipe should accept the bytes");

        assert_eq!(
            read_preface(&mut server).await.expect("it should decode"),
            preface
        );

        // Whatever follows the preface belongs to HTTP and must still be there for hyper.
        let mut rest = [0_u8; 16];
        server
            .read_exact(&mut rest)
            .await
            .expect("the request line should remain");
        assert_eq!(&rest, b"GET / HTTP/1.1\r\n");
    }

    #[tokio::test]
    async fn an_oversized_preface_is_refused_before_it_is_read() {
        let mut wire = ((MAX_PREFACE_BYTES + 1) as u32).to_be_bytes().to_vec();
        wire.extend_from_slice(b"{}");

        assert!(matches!(
            read_from(&wire).await,
            Err(PrefaceError::TooLarge { length }) if length == MAX_PREFACE_BYTES + 1
        ));
    }

    #[tokio::test]
    async fn too_many_hops_are_refused() {
        let mut preface = StreamPreface::new(TARGET);
        for index in 0..=MAX_HOPS {
            preface = preface.with_hop(format!("relay-{index}"));
        }

        assert!(matches!(
            read_from(&preface.encode()).await,
            Err(PrefaceError::TooManyHops { hops }) if hops == MAX_HOPS + 1
        ));
    }

    #[tokio::test]
    async fn the_hop_limit_itself_is_still_accepted() {
        let mut preface = StreamPreface::new(TARGET);
        for index in 0..MAX_HOPS {
            preface = preface.with_hop(format!("relay-{index}"));
        }

        assert!(read_from(&preface.encode()).await.is_ok());
    }

    #[tokio::test]
    async fn a_foreign_version_is_refused() {
        let preface = StreamPreface {
            v: PREFACE_VERSION + 1,
            target: TARGET.into(),
            hops: Vec::new(),
        };

        assert!(matches!(
            read_from(&preface.encode()).await,
            Err(PrefaceError::UnsupportedVersion { version }) if version == PREFACE_VERSION + 1
        ));
    }

    #[tokio::test]
    async fn a_body_that_is_not_json_is_refused() {
        let mut wire = 2_u32.to_be_bytes().to_vec();
        wire.extend_from_slice(b"[]");

        assert!(matches!(
            read_from(&wire).await,
            Err(PrefaceError::Malformed(_))
        ));
    }

    #[tokio::test]
    async fn a_truncated_preface_is_refused() {
        let preface = StreamPreface::new(TARGET);
        let wire = preface.encode();

        assert!(matches!(
            read_from(&wire[..wire.len() - 1]).await,
            Err(PrefaceError::Read(_))
        ));
    }
}
