//! Wire protocol shared by the Termexo desktop app (`src-tauri`) and the relay service.
//!
//! Both ends speak the same tunnel: control frames on WebSocket text frames, a multiplexed byte
//! stream on binary frames, and a fixed-length preface in front of every stream. Keeping the
//! definitions in one crate is what stops the two binaries from drifting apart, so a protocol
//! change is a change here first and in `docs/architecture/relay-service.md` before that.

pub mod credential;
pub mod frames;
pub mod preface;
pub mod secret;
pub mod throttle;
pub mod tunnel;

/// Stands in for a secret in `Debug` output. Credentials, passwords and enrollment codes travel
/// through structs that are routinely logged on error paths, so their `Debug` is written by hand.
pub(crate) const REDACTED_PLACEHOLDER: &str = "<redacted>";
