//! Per-source failure throttling, shared by the workbench token gate and by the relay's tunnel,
//! login and enrollment endpoints.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// A brute-force attempt over the local network is throttled rather than blocked outright: the
/// legitimate user mistyping a token must still get back in after the lockout expires.
pub const MAX_FAILURES_PER_WINDOW: u32 = 5;
pub const FAILURE_WINDOW: Duration = Duration::from_secs(10 * 60);
pub const LOCKOUT_DURATION: Duration = Duration::from_secs(10 * 60);

#[derive(Debug)]
struct FailureRecord {
    count: u32,
    window_started: Instant,
    locked_until: Option<Instant>,
}

/// Counts authentication failures per key — a source address for every current caller — and locks
/// a key out once they come too fast.
///
/// The caller passes `now` in rather than letting the table read the clock, so a test can move time
/// forward without sleeping.
#[derive(Debug)]
pub struct FailureThrottle<K: Hash + Eq> {
    failures: Mutex<HashMap<K, FailureRecord>>,
}

impl<K: Hash + Eq> FailureThrottle<K> {
    pub fn new() -> Self {
        Self {
            failures: Mutex::new(HashMap::new()),
        }
    }

    /// Whether the key is currently locked out. An expired lockout is forgotten on the way, so the
    /// next window starts clean.
    pub fn is_locked(&self, key: &K, now: Instant) -> bool {
        let mut failures = self.failures();
        let Some(record) = failures.get(key) else {
            return false;
        };
        match record.locked_until {
            Some(locked_until) if now < locked_until => true,
            Some(_) => {
                failures.remove(key);
                false
            }
            None => false,
        }
    }

    /// Records one failure and reports whether the key is locked out as a result.
    pub fn record_failure(&self, key: K, now: Instant) -> bool {
        let mut failures = self.failures();
        let record = failures.entry(key).or_insert(FailureRecord {
            count: 0,
            window_started: now,
            locked_until: None,
        });
        if now.duration_since(record.window_started) >= FAILURE_WINDOW {
            record.count = 0;
            record.window_started = now;
        }
        record.count += 1;
        if record.count >= MAX_FAILURES_PER_WINDOW {
            record.locked_until = Some(now + LOCKOUT_DURATION);
            return true;
        }
        false
    }

    /// Forgets one key, which is what a successful authentication does.
    pub fn clear(&self, key: &K) {
        self.failures().remove(key);
    }

    /// Forgets every key. Rotating the secret everyone was guessing also unblocks whoever was
    /// locked out while guessing the previous one.
    pub fn reset(&self) {
        self.failures().clear();
    }

    fn failures(&self) -> MutexGuard<'_, HashMap<K, FailureRecord>> {
        // Recovering from poisoning keeps a panic elsewhere from permanently locking every client
        // out; the map only holds throttling counters, so a torn update is harmless.
        self.failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl<K: Hash + Eq> Default for FailureThrottle<K> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use super::*;

    fn source() -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 42))
    }

    fn throttle() -> FailureThrottle<IpAddr> {
        FailureThrottle::new()
    }

    #[test]
    fn an_unknown_key_is_never_locked() {
        assert!(!throttle().is_locked(&source(), Instant::now()));
    }

    #[test]
    fn the_key_locks_on_the_configured_failure() {
        let throttle = throttle();
        let now = Instant::now();

        for _ in 0..(MAX_FAILURES_PER_WINDOW - 1) {
            assert!(!throttle.record_failure(source(), now));
            assert!(!throttle.is_locked(&source(), now));
        }

        assert!(throttle.record_failure(source(), now));
        assert!(throttle.is_locked(&source(), now));
    }

    #[test]
    fn the_lockout_expires_and_the_record_is_forgotten() {
        let throttle = throttle();
        let start = Instant::now();
        for _ in 0..MAX_FAILURES_PER_WINDOW {
            throttle.record_failure(source(), start);
        }

        assert!(!throttle.is_locked(&source(), start + LOCKOUT_DURATION));
        // The record is gone, so the next window needs the full count again rather than one more.
        assert!(!throttle.record_failure(source(), start + LOCKOUT_DURATION));
    }

    #[test]
    fn failures_spread_beyond_the_window_never_lock() {
        let throttle = throttle();
        let mut now = Instant::now();

        for _ in 0..(MAX_FAILURES_PER_WINDOW * 3) {
            assert!(!throttle.record_failure(source(), now));
            now += FAILURE_WINDOW;
        }
    }

    #[test]
    fn lockout_is_scoped_to_one_key() {
        let throttle = throttle();
        let now = Instant::now();
        let other = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 43));
        for _ in 0..MAX_FAILURES_PER_WINDOW {
            throttle.record_failure(source(), now);
        }

        assert!(throttle.is_locked(&source(), now));
        assert!(!throttle.is_locked(&other, now));
    }

    #[test]
    fn clearing_one_key_restarts_its_count() {
        let throttle = throttle();
        let now = Instant::now();
        for _ in 0..(MAX_FAILURES_PER_WINDOW - 1) {
            throttle.record_failure(source(), now);
        }

        throttle.clear(&source());

        assert!(!throttle.record_failure(source(), now));
    }

    #[test]
    fn resetting_releases_every_locked_key() {
        let throttle = throttle();
        let now = Instant::now();
        for _ in 0..MAX_FAILURES_PER_WINDOW {
            throttle.record_failure(source(), now);
        }

        throttle.reset();

        assert!(!throttle.is_locked(&source(), now));
    }
}
