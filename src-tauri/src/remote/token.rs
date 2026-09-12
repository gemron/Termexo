use std::net::IpAddr;
use std::sync::RwLock;
use std::time::Instant;

use termexo_relay_protocol::throttle::FailureThrottle;

pub use termexo_relay_protocol::secret::{generate_token, tokens_match};

/// Why a connection was refused. The message reaches the remote client, so it is user-facing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthRejection {
    /// No token has been generated yet, so nothing can authenticate.
    NotConfigured,
    InvalidToken,
    /// Too many failures from this source address.
    Locked,
}

impl AuthRejection {
    pub fn reason(self) -> &'static str {
        match self {
            Self::NotConfigured => "服务端尚未生成访问令牌。",
            Self::InvalidToken => "访问令牌不正确。",
            Self::Locked => "失败次数过多，请稍后再试。",
        }
    }
}

/// Holds the live access token and throttles repeated failures per source address.
///
/// The token lives here rather than in the manager's state so the running server keeps seeing the
/// current value after a regeneration without being restarted.
pub struct RemoteAuth {
    token: RwLock<String>,
    failures: FailureThrottle<IpAddr>,
}

impl RemoteAuth {
    pub fn new(token: String) -> Self {
        Self {
            token: RwLock::new(token),
            failures: FailureThrottle::new(),
        }
    }

    pub fn token(&self) -> String {
        self.token
            .read()
            .map(|token| token.clone())
            .unwrap_or_default()
    }

    /// Installs a new token and clears the lockout table, so regenerating also unblocks a source
    /// address that was locked out while guessing the previous token.
    pub fn replace_token(&self, token: String) {
        if let Ok(mut current) = self.token.write() {
            *current = token;
        }
        self.failures.reset();
    }

    pub fn authorize(&self, source: IpAddr, provided: &str) -> Result<(), AuthRejection> {
        self.authorize_at(source, provided, Instant::now())
    }

    fn authorize_at(
        &self,
        source: IpAddr,
        provided: &str,
        now: Instant,
    ) -> Result<(), AuthRejection> {
        // A locked source is turned away before the token is even looked at, so a lockout also
        // covers the window in which no token exists yet.
        if self.failures.is_locked(&source, now) {
            return Err(AuthRejection::Locked);
        }

        let expected = self.token();
        if expected.is_empty() {
            return Err(AuthRejection::NotConfigured);
        }
        if tokens_match(&expected, provided) {
            self.failures.clear(&source);
            return Ok(());
        }

        self.failures.record_failure(source, now);
        Err(AuthRejection::InvalidToken)
    }
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use termexo_relay_protocol::throttle::{LOCKOUT_DURATION, MAX_FAILURES_PER_WINDOW};

    use super::*;

    fn source() -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 42))
    }

    #[test]
    fn accepts_the_current_token_and_clears_previous_failures() {
        let auth = RemoteAuth::new("secret".into());
        let now = Instant::now();

        for _ in 0..(MAX_FAILURES_PER_WINDOW - 1) {
            assert_eq!(
                auth.authorize_at(source(), "wrong", now),
                Err(AuthRejection::InvalidToken)
            );
        }
        assert_eq!(auth.authorize_at(source(), "secret", now), Ok(()));

        // The success forgot the earlier failures, so the next ones start a fresh window instead
        // of tripping the lockout one attempt later.
        for _ in 0..(MAX_FAILURES_PER_WINDOW - 1) {
            assert_eq!(
                auth.authorize_at(source(), "wrong", now),
                Err(AuthRejection::InvalidToken)
            );
        }
        assert_eq!(auth.authorize_at(source(), "secret", now), Ok(()));
    }

    #[test]
    fn locks_the_source_address_after_five_failures() {
        let auth = RemoteAuth::new("secret".into());
        let start = Instant::now();

        for _ in 0..MAX_FAILURES_PER_WINDOW {
            assert_eq!(
                auth.authorize_at(source(), "wrong", start),
                Err(AuthRejection::InvalidToken)
            );
        }

        // Even the correct token is refused while the lockout is in effect.
        assert_eq!(
            auth.authorize_at(source(), "secret", start),
            Err(AuthRejection::Locked)
        );
        assert_eq!(
            auth.authorize_at(source(), "secret", start + LOCKOUT_DURATION),
            Ok(())
        );
    }

    #[test]
    fn lockout_is_scoped_to_one_source_address() {
        let auth = RemoteAuth::new("secret".into());
        let now = Instant::now();
        let other = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 43));

        for _ in 0..MAX_FAILURES_PER_WINDOW {
            let _ = auth.authorize_at(source(), "wrong", now);
        }

        assert_eq!(auth.authorize_at(other, "secret", now), Ok(()));
    }

    #[test]
    fn refuses_every_client_until_a_token_exists() {
        let auth = RemoteAuth::new(String::new());

        assert_eq!(
            auth.authorize(source(), ""),
            Err(AuthRejection::NotConfigured)
        );
    }

    #[test]
    fn replacing_the_token_invalidates_the_previous_one_and_clears_lockouts() {
        let auth = RemoteAuth::new("secret".into());
        let now = Instant::now();
        for _ in 0..MAX_FAILURES_PER_WINDOW {
            let _ = auth.authorize_at(source(), "wrong", now);
        }

        auth.replace_token("rotated".into());

        assert_eq!(
            auth.authorize_at(source(), "secret", now),
            Err(AuthRejection::InvalidToken)
        );
        assert_eq!(auth.authorize_at(source(), "rotated", now), Ok(()));
    }
}
