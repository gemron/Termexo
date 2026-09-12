//! Carrying a stream the upstream opened on to the device it is addressed to.
//!
//! A relay in the middle of a chain never parses the HTTP inside a stream. It reads the preface,
//! looks the target up in its own routing table, opens one stream towards the next hop with the
//! preface extended by its own id, and copies bytes in both directions from then on.

use termexo_relay_protocol::preface::{read_preface, PrefaceError, StreamPreface, MAX_HOPS};
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncWrite};

use crate::state::RelayState;
use crate::tunnel::TunnelError;

/// Why a stream the upstream opened could not be carried any further. Every sentence reaches the
/// relay's log, so they are written the way the rest of the service is.
#[derive(Debug, Error)]
enum StreamRejection {
    #[error("{0}")]
    Preface(#[from] PrefaceError),
    #[error("流前导已经过本中继，说明中继链成环。")]
    Loop,
    #[error("流前导已经过 {hops} 台中继，再转发一跳会超过上限。")]
    Budget { hops: usize },
    #[error("目标设备 {target} 不在本中继的路由表中。")]
    Unknown { target: String },
    #[error("{0}")]
    Open(#[from] TunnelError),
    #[error("转发流时出错：{0}")]
    Copy(std::io::Error),
}

/// Serves one stream from the upstream until either side closes it.
pub async fn serve<S>(state: &RelayState, mut upstream: S)
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    if let Err(rejection) = carry(state, &mut upstream).await {
        // Dropping the stream is what tells the upstream this hop refused it.
        tracing::warn!(reason = %rejection, "已拒绝上游开来的流");
    }
}

async fn carry<S>(state: &RelayState, upstream: &mut S) -> Result<(), StreamRejection>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let preface = read_preface(upstream).await?;
    let forwarded = extend(&preface, &state.relay_id)?;
    let route =
        state
            .registry
            .route(&forwarded.target)
            .ok_or_else(|| StreamRejection::Unknown {
                target: forwarded.target.clone(),
            })?;

    let mut downstream = route.link().open_stream(&forwarded).await?;
    tokio::io::copy_bidirectional(upstream, &mut downstream)
        .await
        .map_err(StreamRejection::Copy)?;
    Ok(())
}

/// The preface for the next hop: the same target, with this relay recorded on the path.
///
/// Appending happens before the routing table is consulted, because both loop guards are about the
/// path the stream has already taken rather than about where it is going.
fn extend(preface: &StreamPreface, relay_id: &str) -> Result<StreamPreface, StreamRejection> {
    if preface.hops.iter().any(|hop| hop == relay_id) {
        return Err(StreamRejection::Loop);
    }
    // The preface reader allows exactly MAX_HOPS, so a stream that already fills the budget cannot
    // gain this relay's own id.
    if preface.hops.len() >= MAX_HOPS {
        return Err(StreamRejection::Budget {
            hops: preface.hops.len(),
        });
    }
    Ok(StreamPreface {
        v: preface.v,
        target: preface.target.clone(),
        hops: preface
            .hops
            .iter()
            .cloned()
            .chain(std::iter::once(relay_id.to_string()))
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RELAY_ID: &str = "relay-b";
    const TARGET: &str = "officedesktopbbbbbbbbbbbbb";

    fn preface(hops: &[&str]) -> StreamPreface {
        let mut preface = StreamPreface::new(TARGET);
        preface.hops = hops.iter().map(|hop| hop.to_string()).collect();
        preface
    }

    #[test]
    fn forwarding_records_this_relay_after_the_hops_the_stream_already_crossed() {
        let extended = extend(&preface(&["relay-a"]), RELAY_ID).expect("it should forward");

        assert_eq!(extended.target, TARGET);
        assert_eq!(extended.hops, vec!["relay-a".to_string(), RELAY_ID.into()]);
    }

    /// The last line of the loop guard: a stream that already crossed this relay is circulating.
    #[test]
    fn a_stream_that_already_crossed_this_relay_is_refused() {
        let rejection = extend(&preface(&["relay-a", RELAY_ID]), RELAY_ID)
            .expect_err("a circulating stream should be refused");

        assert!(matches!(rejection, StreamRejection::Loop));
    }

    #[test]
    fn a_stream_that_fills_the_hop_budget_is_refused() {
        let hops: Vec<String> = (0..MAX_HOPS)
            .map(|index| format!("relay-{index}"))
            .collect();
        let borrowed: Vec<&str> = hops.iter().map(String::as_str).collect();

        assert!(matches!(
            extend(&preface(&borrowed), RELAY_ID),
            Err(StreamRejection::Budget { .. })
        ));
        assert!(extend(&preface(&borrowed[..MAX_HOPS - 1]), RELAY_ID).is_ok());
    }
}
