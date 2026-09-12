//! Console sessions: the cookie, its sliding lifetime and the CSRF header that has to accompany
//! every modifying request.

use std::net::IpAddr;

use termexo_relay_protocol::credential::hash_secret;
use termexo_relay_protocol::secret::random_base64url;

use crate::db::{now_millis, Database, DatabaseError, SessionRecord, UserRecord};

pub const SESSION_COOKIE_NAME: &str = "termexo_relay_session";

/// 32 random bytes, the same strength as the workbench access token.
const SESSION_TOKEN_BYTES: usize = 32;

/// Seven days of inactivity ends a session; every request pushes the deadline back.
pub const SESSION_LIFETIME_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// How much the deadline has to move before it is worth a write.
///
/// The console polls the device list every ten seconds, and extending on literally every request
/// would turn that poll into a database write per client per poll for no benefit: a session that is
/// renewed once an hour still never expires while somebody is using it.
const SESSION_RENEWAL_THRESHOLD_MS: i64 = 60 * 60 * 1000;

/// Header a modifying console request must carry.
///
/// A cross-site form post cannot set a custom header, and the cookie is `SameSite=Strict` on top of
/// that, so the two together are what keeps another origin from acting as a logged-in operator.
pub const CSRF_HEADER: &str = "x-requested-with";
pub const CSRF_HEADER_VALUE: &str = "termexo-console";

/// Creates a session and returns the cookie value, which is the only time it exists in the clear.
pub fn create_session(
    database: &Database,
    user_id: &str,
    ip: Option<IpAddr>,
) -> Result<String, DatabaseError> {
    let token = random_base64url(SESSION_TOKEN_BYTES).map_err(DatabaseError::Random)?;
    let created_at = now_millis();
    database.create_session(&SessionRecord {
        id_hash: hash_secret(&token),
        user_id: user_id.to_string(),
        created_at,
        expires_at: created_at + SESSION_LIFETIME_MS,
        ip: ip.map(|address| address.to_string()),
    })?;
    Ok(token)
}

/// Resolves a cookie value to its account, sliding the deadline forward on the way.
///
/// Returns `None` for a session that never existed, ran out, or belongs to an account that has
/// since been disabled or deleted — a disabled operator must lose access without having to be
/// logged out explicitly.
pub fn resolve_session(
    database: &Database,
    token: &str,
    now: i64,
) -> Result<Option<UserRecord>, DatabaseError> {
    let id_hash = hash_secret(token);
    let Some(session) = database.find_session(&id_hash)? else {
        return Ok(None);
    };
    if session.is_expired(now) {
        database.delete_session(&id_hash)?;
        return Ok(None);
    }
    let Some(user) = database.find_user(&session.user_id)? else {
        database.delete_session(&id_hash)?;
        return Ok(None);
    };
    if user.disabled {
        database.delete_session(&id_hash)?;
        return Ok(None);
    }
    if let Some(expires_at) = renewed_expiry(session.expires_at, now) {
        database.extend_session(&id_hash, expires_at)?;
    }
    Ok(Some(user))
}

pub fn destroy_session(database: &Database, token: &str) -> Result<(), DatabaseError> {
    database.delete_session(&hash_secret(token))
}

/// The new deadline, or `None` when the stored one is still close enough to be left alone.
pub fn renewed_expiry(current_expires_at: i64, now: i64) -> Option<i64> {
    let extended = now + SESSION_LIFETIME_MS;
    (extended - current_expires_at >= SESSION_RENEWAL_THRESHOLD_MS).then_some(extended)
}

/// Builds the `Set-Cookie` value for a fresh session.
///
/// `Secure` is only added when the relay is actually reachable over https: a browser silently drops
/// a `Secure` cookie on a plain-http origin, which would make a relay behind a terminating proxy
/// impossible to log in to.
pub fn session_cookie(token: &str, secure: bool) -> String {
    format!(
        "{SESSION_COOKIE_NAME}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={}{}",
        SESSION_LIFETIME_MS / 1000,
        secure_attribute(secure)
    )
}

/// Builds the `Set-Cookie` value that clears the session.
pub fn cleared_session_cookie(secure: bool) -> String {
    format!(
        "{SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0{}",
        secure_attribute(secure)
    )
}

/// Picks the session token out of a `Cookie` header.
pub fn read_session_cookie(header: &str) -> Option<&str> {
    header.split(';').find_map(|entry| {
        let (name, value) = entry.trim().split_once('=')?;
        (name == SESSION_COOKIE_NAME && !value.is_empty()).then_some(value)
    })
}

/// Whether a modifying request carries the console's CSRF marker.
pub fn has_csrf_marker(header: Option<&str>) -> bool {
    header.is_some_and(|value| value.eq_ignore_ascii_case(CSRF_HEADER_VALUE))
}

fn secure_attribute(secure: bool) -> &'static str {
    if secure {
        "; Secure"
    } else {
        ""
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::UserRole;

    fn database_with_user(disabled: bool) -> (Database, String) {
        let database = Database::open_in_memory().expect("the database should open");
        let user = database
            .create_user("alice", "hash", UserRole::Admin)
            .expect("a user");
        if disabled {
            database
                .update_user(
                    &user.id,
                    &crate::db::UserUpdate {
                        disabled: Some(true),
                        ..Default::default()
                    },
                )
                .expect("the update should apply");
        }
        (database, user.id)
    }

    #[test]
    fn a_session_resolves_to_its_account_and_the_cookie_value_is_not_stored() {
        let (database, user_id) = database_with_user(false);

        let token = create_session(&database, &user_id, None).expect("a session");
        let resolved = resolve_session(&database, &token, now_millis())
            .expect("the lookup should work")
            .expect("the session should resolve");

        assert_eq!(resolved.id, user_id);
        assert!(database
            .find_session(&token)
            .expect("the lookup should work")
            .is_none());
        assert!(database
            .find_session(&hash_secret(&token))
            .expect("the lookup should work")
            .is_some());
    }

    #[test]
    fn an_expired_session_is_refused_and_forgotten() {
        let (database, user_id) = database_with_user(false);
        let token = create_session(&database, &user_id, None).expect("a session");

        let resolved = resolve_session(&database, &token, now_millis() + SESSION_LIFETIME_MS + 1)
            .expect("the lookup should work");

        assert!(resolved.is_none());
        assert!(database
            .find_session(&hash_secret(&token))
            .expect("the lookup should work")
            .is_none());
    }

    #[test]
    fn a_disabled_account_loses_its_session() {
        let (database, user_id) = database_with_user(true);
        let token = create_session(&database, &user_id, None).expect("a session");

        assert!(resolve_session(&database, &token, now_millis())
            .expect("the lookup should work")
            .is_none());
    }

    #[test]
    fn the_deadline_slides_only_once_it_has_moved_far_enough() {
        let now = now_millis();
        let fresh = now + SESSION_LIFETIME_MS;

        assert_eq!(renewed_expiry(fresh, now), None);
        assert_eq!(
            renewed_expiry(fresh, now + SESSION_RENEWAL_THRESHOLD_MS - 1),
            None
        );
        assert_eq!(
            renewed_expiry(fresh, now + SESSION_RENEWAL_THRESHOLD_MS),
            Some(now + SESSION_RENEWAL_THRESHOLD_MS + SESSION_LIFETIME_MS)
        );
    }

    #[test]
    fn the_cookie_carries_secure_only_over_https() {
        let secure = session_cookie("token", true);
        let plain = session_cookie("token", false);

        assert!(secure.contains("; Secure"));
        assert!(secure.contains("HttpOnly"));
        assert!(secure.contains("SameSite=Strict"));
        assert!(!plain.contains("Secure"));
        assert!(cleared_session_cookie(false).contains("Max-Age=0"));
    }

    #[test]
    fn the_session_cookie_is_picked_out_of_a_crowded_header() {
        assert_eq!(
            read_session_cookie(&format!("other=1; {SESSION_COOKIE_NAME}=abc; last=2")),
            Some("abc")
        );
        assert_eq!(read_session_cookie("other=1"), None);
        assert_eq!(
            read_session_cookie(&format!("{SESSION_COOKIE_NAME}=")),
            None,
            "an empty value is not a session"
        );
    }

    #[test]
    fn the_csrf_marker_is_required_verbatim_but_case_insensitively() {
        assert!(has_csrf_marker(Some(CSRF_HEADER_VALUE)));
        assert!(has_csrf_marker(Some("Termexo-Console")));
        assert!(!has_csrf_marker(Some("XMLHttpRequest")));
        assert!(!has_csrf_marker(None));
    }
}
