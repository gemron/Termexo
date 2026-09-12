//! The reconnect ladder a tunnel client walks after a session ends.
//!
//! Both ends that dial a relay — the desktop app and a relay that has an upstream — have to answer
//! the same question the same way: how long to wait before trying again. Keeping the ladder here
//! means a relay that restarts is picked up just as quickly whichever kind of peer was attached,
//! and a relay that is simply unreachable is not hammered by either of them.

use std::time::Duration;

/// The first wait after a session ends.
pub const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);
/// The ceiling the ladder stops doubling at.
pub const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);

/// How long to wait before the next attempt, doubling up to [`MAX_RECONNECT_DELAY`].
#[derive(Debug)]
pub struct Backoff {
    next: Duration,
}

impl Backoff {
    pub fn new() -> Self {
        Self {
            next: INITIAL_RECONNECT_DELAY,
        }
    }

    /// Takes the current delay and moves the ladder one rung up.
    pub fn take(&mut self) -> Duration {
        let delay = self.next;
        self.next = (self.next * 2).min(MAX_RECONNECT_DELAY);
        delay
    }

    /// A session that actually reached the relay starts the ladder again, so a link that drops
    /// once an hour reconnects in a second every time rather than inheriting an old ceiling.
    pub fn reset(&mut self) {
        self.next = INITIAL_RECONNECT_DELAY;
    }
}

impl Default for Backoff {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_delay_doubles_up_to_half_a_minute() {
        let mut backoff = Backoff::new();

        let delays: Vec<u64> = (0..8).map(|_| backoff.take().as_secs()).collect();

        assert_eq!(delays, vec![1, 2, 4, 8, 16, 30, 30, 30]);
    }

    #[test]
    fn a_session_that_reached_the_relay_starts_the_ladder_again() {
        let mut backoff = Backoff::new();
        for _ in 0..5 {
            backoff.take();
        }

        backoff.reset();

        assert_eq!(backoff.take(), INITIAL_RECONNECT_DELAY);
    }
}
