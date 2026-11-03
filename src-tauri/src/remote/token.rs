use std::net::IpAddr;
use std::sync::RwLock;
use std::time::Instant;

use data_encoding::BASE64URL_NOPAD;
use hmac::{Hmac, Mac};
use sha2::Sha256;
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

    /// A domain-separated viewing credential. Knowing it cannot recover the control token.
    /// Rotating the control token also revokes every existing viewing link.
    pub fn read_only_token(&self) -> String {
        viewing_token(&self.token())
    }

    /// Returns the verified value and the permission bound to the credential, never a client flag.
    pub fn authorize_access_with<T>(
        &self,
        source: IpAddr,
        verify: impl FnMut(&str) -> Option<T>,
    ) -> Result<(T, bool), AuthRejection> {
        self.authorize_scoped_at(source, verify, Instant::now(), true)
    }

    /// Installs a new token and clears the lockout table, so regenerating also unblocks a source
    /// address that was locked out while guessing the previous token.
    pub fn replace_token(&self, token: String) {
        if let Ok(mut current) = self.token.write() {
            *current = token;
        }
        self.failures.reset();
    }

    fn authorize_scoped_at<T>(
        &self,
        source: IpAddr,
        mut verify: impl FnMut(&str) -> Option<T>,
        now: Instant,
        allow_viewing: bool,
    ) -> Result<(T, bool), AuthRejection> {
        // A locked source is turned away before the token is even looked at, so a lockout also
        // covers the window in which no token exists yet.
        if self.failures.is_locked(&source, now) {
            return Err(AuthRejection::Locked);
        }

        let expected = self.token();
        if expected.is_empty() {
            return Err(AuthRejection::NotConfigured);
        }
        if let Some(accepted) = verify(&expected) {
            self.failures.clear(&source);
            return Ok((accepted, false));
        }
        if allow_viewing {
            if let Some(accepted) = verify(&viewing_token(&expected)) {
                self.failures.clear(&source);
                return Ok((accepted, true));
            }
        }

        self.failures.record_failure(source, now);
        Err(AuthRejection::InvalidToken)
    }
}

fn viewing_token(control_token: &str) -> String {
    if control_token.is_empty() {
        return String::new();
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(control_token.as_bytes())
        .expect("HMAC accepts keys of any length");
    mac.update(b"termexo-remote-read-only-v1");
    BASE64URL_NOPAD.encode(&mac.finalize().into_bytes())
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use termexo_relay_protocol::throttle::{LOCKOUT_DURATION, MAX_FAILURES_PER_WINDOW};

    use super::*;

    #[test]
    fn viewing_credentials_are_scoped_and_rotate_with_control_credentials() {
        let auth = RemoteAuth::new("control-secret".into());
        let view = auth.read_only_token();
        assert_ne!(view, auth.token());
        let verify = |provided: &str| {
            auth.authorize_access_with(source(), |expected| {
                tokens_match(expected, provided).then_some(())
            })
        };
        assert_eq!(verify("control-secret"), Ok(((), false)));
        assert_eq!(verify(&view), Ok(((), true)));
        assert_eq!(
            auth.authorize_scoped_at(
                source(),
                |expected| tokens_match(expected, &view).then_some(()),
                Instant::now(),
                false
            ),
            Err(AuthRejection::InvalidToken)
        );
        auth.replace_token("new-control-secret".into());
        assert_ne!(auth.read_only_token(), view);
        assert_eq!(verify(&view), Err(AuthRejection::InvalidToken));
        assert_eq!(verify("control-secret"), Err(AuthRejection::InvalidToken));
    }

    #[test]
    fn a_viewing_handshake_counts_as_one_failure_not_two() {
        let auth = RemoteAuth::new("control-secret".into());
        let now = Instant::now();
        for _ in 0..MAX_FAILURES_PER_WINDOW - 1 {
            assert_eq!(
                auth.authorize_scoped_at(source(), |_| None::<()>, now, true),
                Err(AuthRejection::InvalidToken)
            );
        }
        let view = auth.read_only_token();
        assert_eq!(
            auth.authorize_scoped_at(
                source(),
                |expected| { tokens_match(expected, &view).then_some(()) },
                now,
                true
            ),
            Ok(((), true))
        );
    }

    fn source() -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 42))
    }

    /// The v1 handshake's comparison, expressed through the gate every client now passes through.
    fn authorize_token_at(
        auth: &RemoteAuth,
        source: IpAddr,
        provided: &str,
        now: Instant,
    ) -> Result<(), AuthRejection> {
        auth.authorize_scoped_at(
            source,
            |expected| tokens_match(expected, provided).then_some(()),
            now,
            true,
        )
        .map(|(accepted, _)| accepted)
    }

    #[test]
    fn accepts_the_current_token_and_clears_previous_failures() {
        let auth = RemoteAuth::new("secret".into());
        let now = Instant::now();

        for _ in 0..(MAX_FAILURES_PER_WINDOW - 1) {
            assert_eq!(
                authorize_token_at(&auth, source(), "wrong", now),
                Err(AuthRejection::InvalidToken)
            );
        }
        assert_eq!(authorize_token_at(&auth, source(), "secret", now), Ok(()));

        // The success forgot the earlier failures, so the next ones start a fresh window instead
        // of tripping the lockout one attempt later.
        for _ in 0..(MAX_FAILURES_PER_WINDOW - 1) {
            assert_eq!(
                authorize_token_at(&auth, source(), "wrong", now),
                Err(AuthRejection::InvalidToken)
            );
        }
        assert_eq!(authorize_token_at(&auth, source(), "secret", now), Ok(()));
    }

    #[test]
    fn locks_the_source_address_after_five_failures() {
        let auth = RemoteAuth::new("secret".into());
        let start = Instant::now();

        for _ in 0..MAX_FAILURES_PER_WINDOW {
            assert_eq!(
                authorize_token_at(&auth, source(), "wrong", start),
                Err(AuthRejection::InvalidToken)
            );
        }

        // Even the correct token is refused while the lockout is in effect.
        assert_eq!(
            authorize_token_at(&auth, source(), "secret", start),
            Err(AuthRejection::Locked)
        );
        assert_eq!(
            authorize_token_at(&auth, source(), "secret", start + LOCKOUT_DURATION),
            Ok(())
        );
    }

    #[test]
    fn lockout_is_scoped_to_one_source_address() {
        let auth = RemoteAuth::new("secret".into());
        let now = Instant::now();
        let other = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 43));

        for _ in 0..MAX_FAILURES_PER_WINDOW {
            let _ = authorize_token_at(&auth, source(), "wrong", now);
        }

        assert_eq!(authorize_token_at(&auth, other, "secret", now), Ok(()));
    }

    #[test]
    fn refuses_every_client_until_a_token_exists() {
        let auth = RemoteAuth::new(String::new());

        assert_eq!(
            auth.authorize_access_with(source(), |_| Some(())),
            Err(AuthRejection::NotConfigured)
        );
    }

    #[test]
    fn replacing_the_token_invalidates_the_previous_one_and_clears_lockouts() {
        let auth = RemoteAuth::new("secret".into());
        let now = Instant::now();
        for _ in 0..MAX_FAILURES_PER_WINDOW {
            let _ = authorize_token_at(&auth, source(), "wrong", now);
        }

        auth.replace_token("rotated".into());

        assert_eq!(
            authorize_token_at(&auth, source(), "secret", now),
            Err(AuthRejection::InvalidToken)
        );
        assert_eq!(authorize_token_at(&auth, source(), "rotated", now), Ok(()));
    }
}
