use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use subtle::ConstantTimeEq;

/// 32 random bytes is the same strength as a v4 UUID's entropy plus a wide margin, and base64url
/// keeps the token safe to carry in a URL fragment and inside a QR code.
const TOKEN_BYTES: usize = 32;

/// A brute-force attempt over the local network is throttled rather than blocked outright: the
/// legitimate user mistyping a token must still get back in after the lockout expires.
const MAX_FAILURES_PER_WINDOW: u32 = 5;
const FAILURE_WINDOW: Duration = Duration::from_secs(10 * 60);
const LOCKOUT_DURATION: Duration = Duration::from_secs(10 * 60);

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

/// Generates a fresh access token.
pub fn generate_token() -> Result<String, String> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|error| format!("无法生成访问令牌：{error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Compares two tokens without leaking how far they matched through timing.
pub fn tokens_match(expected: &str, provided: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    expected.as_bytes().ct_eq(provided.as_bytes()).into()
}

#[derive(Debug)]
struct FailureRecord {
    count: u32,
    window_started: Instant,
    locked_until: Option<Instant>,
}

/// Holds the live access token and throttles repeated failures per source address.
///
/// The token lives here rather than in the manager's state so the running server keeps seeing the
/// current value after a regeneration without being restarted.
pub struct RemoteAuth {
    token: RwLock<String>,
    failures: Mutex<HashMap<IpAddr, FailureRecord>>,
}

impl RemoteAuth {
    pub fn new(token: String) -> Self {
        Self {
            token: RwLock::new(token),
            failures: Mutex::new(HashMap::new()),
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
        if let Ok(mut failures) = self.failures.lock() {
            failures.clear();
        }
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
        let expected = self.token();
        // Recovering from poisoning keeps a panic elsewhere from permanently locking every client
        // out; the map only holds throttling counters, so a torn update is harmless.
        let mut failures = self
            .failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if let Some(record) = failures.get(&source) {
            match record.locked_until {
                Some(locked_until) if now < locked_until => return Err(AuthRejection::Locked),
                // The lockout expired: forget the whole record so the next window starts clean.
                Some(_) => {
                    failures.remove(&source);
                }
                None => {}
            }
        }

        if expected.is_empty() {
            return Err(AuthRejection::NotConfigured);
        }
        if tokens_match(&expected, provided) {
            failures.remove(&source);
            return Ok(());
        }

        let record = failures.entry(source).or_insert(FailureRecord {
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
        }
        Err(AuthRejection::InvalidToken)
    }
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use super::*;

    fn source() -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 42))
    }

    #[test]
    fn generated_tokens_are_url_safe_and_unique() {
        let first = generate_token().expect("a token should be generated");
        let second = generate_token().expect("a token should be generated");

        assert_ne!(first, second);
        assert!(!first.contains('=') && !first.contains('+') && !first.contains('/'));
        assert_eq!(
            URL_SAFE_NO_PAD
                .decode(&first)
                .expect("the token should decode")
                .len(),
            TOKEN_BYTES
        );
    }

    #[test]
    fn token_comparison_rejects_prefixes_and_empty_expectations() {
        assert!(tokens_match("abcdef", "abcdef"));
        assert!(!tokens_match("abcdef", "abcde"));
        assert!(!tokens_match("abcdef", "abcdefg"));
        assert!(!tokens_match("", ""));
    }

    #[test]
    fn accepts_the_current_token_and_clears_previous_failures() {
        let auth = RemoteAuth::new("secret".into());
        let now = Instant::now();

        assert_eq!(
            auth.authorize_at(source(), "wrong", now),
            Err(AuthRejection::InvalidToken)
        );
        assert_eq!(auth.authorize_at(source(), "secret", now), Ok(()));
        assert!(!auth
            .failures
            .lock()
            .expect("the lockout table should be readable")
            .contains_key(&source()));
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
    fn failures_spread_beyond_the_window_never_lock() {
        let auth = RemoteAuth::new("secret".into());
        let mut now = Instant::now();

        for _ in 0..(MAX_FAILURES_PER_WINDOW * 3) {
            assert_eq!(
                auth.authorize_at(source(), "wrong", now),
                Err(AuthRejection::InvalidToken)
            );
            now += FAILURE_WINDOW;
        }

        assert_eq!(auth.authorize_at(source(), "secret", now), Ok(()));
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
