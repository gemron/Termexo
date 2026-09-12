//! Everything that decides whether a caller is who it claims to be: passwords, console sessions,
//! enrollment codes and the per-address failure lockout they all share.

pub mod code;
pub mod password;
mod random;
pub mod session;

use std::net::IpAddr;
use std::time::Instant;

use termexo_relay_protocol::throttle::FailureThrottle;

/// Shown to whoever is locked out. Deliberately vague: telling an attacker how long is left, or
/// whether the account even exists, is free information.
pub const LOCKED_OUT_MESSAGE: &str = "失败次数过多，请稍后再试。";

/// One lockout table for every credential check reachable from the network.
///
/// Login, enrollment and tunnel authentication share a counter on purpose: they are three doors
/// into the same relay, and an attacker that gets five tries at each of them gets fifteen.
#[derive(Debug, Default)]
pub struct LockoutTable {
    failures: FailureThrottle<IpAddr>,
}

impl LockoutTable {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether this source address is currently barred from presenting a credential.
    pub fn is_locked(&self, source: IpAddr) -> bool {
        self.failures.is_locked(&source, Instant::now())
    }

    /// Records one refused credential.
    pub fn record_failure(&self, source: IpAddr) {
        // A source that just tripped the lockout is worth a log line; the individual failures are
        // not, or a scan would fill the log on its own.
        if self.failures.record_failure(source, Instant::now()) {
            tracing::warn!(%source, "来源地址失败次数过多，已临时锁定");
        }
    }

    /// Forgets a source address after it proved it holds a valid credential.
    pub fn clear(&self, source: IpAddr) {
        self.failures.clear(&source);
    }
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use termexo_relay_protocol::throttle::MAX_FAILURES_PER_WINDOW;

    use super::*;

    fn source() -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(203, 0, 113, 5))
    }

    #[test]
    fn a_source_locks_after_the_shared_budget_is_spent() {
        let table = LockoutTable::new();

        for _ in 0..MAX_FAILURES_PER_WINDOW {
            assert!(!table.is_locked(source()));
            table.record_failure(source());
        }

        assert!(table.is_locked(source()));
    }

    #[test]
    fn a_success_forgets_the_failures_and_leaves_other_sources_alone() {
        let table = LockoutTable::new();
        let other = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 6));
        for _ in 0..(MAX_FAILURES_PER_WINDOW - 1) {
            table.record_failure(source());
        }

        table.clear(source());
        table.record_failure(source());

        assert!(!table.is_locked(source()));
        assert!(!table.is_locked(other));
    }
}
