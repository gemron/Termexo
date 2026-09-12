//! The optional second gate in front of a device: `access = relay-login`.
//!
//! By default a device address carries no secret worth protecting — enumerating device ids reveals
//! only that some machine is online — and the real gate is the desktop's own access token. A
//! device marked `relay-login` adds a gate the relay itself can enforce: the browser must hold a
//! console session belonging to the device's owner, or to an administrator.
//!
//! The check runs before anything else the proxy does, on every request of that device: the page,
//! its assets and the WebSocket upgrade alike. Guarding only the document would leave `/ws` open,
//! which is the one path that actually carries the terminal.

use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};

use crate::address::{DeviceEntry, DeviceTarget};
use crate::auth::session::read_session_cookie;
use crate::auth::session::resolve_session;
use crate::db::{now_millis, DeviceRecord, UserRecord};
use crate::state::RelayState;

/// Where a browser without a session is sent, and the parameter that carries it back afterwards.
const LOGIN_PATH: &str = "/console/login";
const NEXT_PARAMETER: &str = "next";

const FORBIDDEN_TITLE: &str = "无权访问该设备";
const FORBIDDEN_BODY: &str = "<p>这台设备只允许它的所有者或中继管理员访问。</p>\
     <p>如果你认为这是配置问题，请联系中继管理员。</p>";

/// Decides whether one request may be forwarded, and what to answer instead when it may not.
///
/// A device this relay has no row for — one a downstream relay announced — is treated as public:
/// its policy belongs to the relay it actually enrolled with, and that relay enforces it on its
/// own hop.
pub fn guard(
    state: &RelayState,
    headers: &HeaderMap,
    device: Option<&DeviceRecord>,
    target: &DeviceTarget,
    query: Option<&str>,
) -> Option<Response> {
    let device = device?;
    if !device.access.requires_console_session() {
        return None;
    }
    if target.entry == DeviceEntry::Subdomain {
        // The console session cookie is host-only, so it never accompanies a request on a device
        // subdomain, and widening it to the whole base domain would hand it to every device this
        // relay proxies for. The path form on the relay's own host is the entry that can be
        // authenticated, so the browser is sent there instead.
        return Some(redirect(&state.addressing.path_form_url(
            &target.device_id,
            &target.rest,
            query,
        )));
    }

    match signed_in_user(state, headers) {
        None => Some(redirect(&login_url(
            &target.base_path(),
            &target.rest,
            query,
        ))),
        Some(user) if device.is_reachable_by(&user.id, user.role.is_admin()) => None,
        Some(_) => Some(forbidden_page()),
    }
}

/// The console account behind a request, or `None` when there is no usable session.
///
/// A lookup failure is treated as "not signed in": the request is refused either way, and letting
/// a database hiccup open a restricted device would be the wrong way to fail.
fn signed_in_user(state: &RelayState, headers: &HeaderMap) -> Option<UserRecord> {
    let token = headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(read_session_cookie)?;
    match resolve_session(&state.database, token, now_millis()) {
        Ok(user) => user,
        Err(error) => {
            tracing::error!(%error, "校验控制台会话失败");
            None
        }
    }
}

/// `/console/login?next=<this request>`, so signing in lands back on the device that was asked for.
fn login_url(base: &str, rest: &str, query: Option<&str>) -> String {
    let query = query.map(|query| format!("?{query}")).unwrap_or_default();
    format!(
        "{LOGIN_PATH}?{NEXT_PARAMETER}={}",
        percent_encode(&format!("{base}{rest}{query}"))
    )
}

fn redirect(location: &str) -> Response {
    match axum::http::HeaderValue::from_str(location) {
        Ok(value) => (StatusCode::FOUND, [(header::LOCATION, value)]).into_response(),
        // Unreachable with a percent-encoded target, and a redirect nobody can follow is still
        // better than a header nobody validated.
        Err(_) => forbidden_page(),
    }
}

fn forbidden_page() -> Response {
    crate::proxy::html_page(
        StatusCode::FORBIDDEN,
        FORBIDDEN_TITLE,
        FORBIDDEN_BODY.to_string(),
    )
}

/// Percent-encodes everything outside RFC 3986's unreserved set.
///
/// The value goes into a `Location` header, so encoding conservatively is what keeps a crafted
/// request path from turning into a second header or a second query parameter.
fn percent_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;
    use termexo_relay_protocol::credential::DeviceCredential;
    use termexo_relay_protocol::frames::DeviceKind;

    use super::*;
    use crate::auth::session::create_session;
    use crate::db::{DeviceAccess, DeviceUpdate, NewDevice, UserRole};
    use crate::state::tests::state_for_tests;
    use crate::state::SharedState;

    fn device(state: &RelayState, owner: Option<&str>, access: DeviceAccess) -> DeviceRecord {
        let credential = DeviceCredential::generate().expect("a credential");
        let record = state
            .database
            .create_device(NewDevice {
                id: credential.device_id.as_str(),
                kind: DeviceKind::Desktop,
                name: "书房台式机",
                owner_user_id: owner,
                secret_hash: &credential.secret_hash(),
                note: None,
            })
            .expect("the device should be created");
        state
            .database
            .update_device(
                &record.id,
                &DeviceUpdate {
                    access: Some(access),
                    ..Default::default()
                },
            )
            .expect("the policy should apply");
        state
            .database
            .find_device(&record.id)
            .expect("the lookup should work")
            .expect("the device should exist")
    }

    fn user(state: &RelayState, username: &str, role: UserRole) -> UserRecord {
        state
            .database
            .create_user(username, "hash", role)
            .expect("a user")
    }

    fn cookies(state: &RelayState, user_id: &str) -> HeaderMap {
        let token = create_session(&state.database, user_id, None).expect("a session");
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_str(&format!("termexo_relay_session={token}"))
                .expect("a header value"),
        );
        headers
    }

    fn target(device_id: &str, rest: &str, entry: DeviceEntry) -> DeviceTarget {
        DeviceTarget {
            device_id: device_id.to_string(),
            rest: rest.to_string(),
            entry,
        }
    }

    fn state() -> SharedState {
        state_for_tests("relay-a")
    }

    fn location(response: &Response) -> String {
        response
            .headers()
            .get(header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string()
    }

    #[test]
    fn a_public_device_is_forwarded_without_a_session() {
        let state = state();
        let record = device(&state, None, DeviceAccess::Public);

        assert!(guard(
            &state,
            &HeaderMap::new(),
            Some(&record),
            &target(&record.id, "", DeviceEntry::Path),
            None
        )
        .is_none());
    }

    /// A device announced by a downstream relay has no row here, and its policy is that relay's.
    #[test]
    fn a_device_without_a_row_is_treated_as_public() {
        let state = state();

        assert!(guard(
            &state,
            &HeaderMap::new(),
            None,
            &target("announced", "", DeviceEntry::Path),
            None
        )
        .is_none());
    }

    #[test]
    fn a_restricted_device_sends_a_stranger_to_the_login_page_with_a_way_back() {
        let state = state();
        let record = device(&state, None, DeviceAccess::RelayLogin);

        let response = guard(
            &state,
            &HeaderMap::new(),
            Some(&record),
            &target(&record.id, "assets/main.js", DeviceEntry::Path),
            Some("v=1"),
        )
        .expect("it should be refused");

        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(
            location(&response),
            format!(
                "/console/login?next=%2Fd%2F{}%2Fassets%2Fmain.js%3Fv%3D1",
                record.id
            )
        );
    }

    /// The target is percent-encoded, so nothing in a crafted path can become a second header.
    #[test]
    fn a_crafted_request_path_cannot_escape_the_redirect_target() {
        let encoded = percent_encode("/d/abc/\r\nSet-Cookie: a=b");

        assert!(!encoded.contains('\r') && !encoded.contains('\n'));
        assert!(!encoded.contains(' '));
        assert_eq!(percent_encode("/d/abc/"), "%2Fd%2Fabc%2F");
    }

    #[test]
    fn a_signed_in_stranger_is_told_why_rather_than_sent_round_the_login_loop() {
        let state = state();
        let owner = user(&state, "alice", UserRole::User);
        let intruder = user(&state, "mallory", UserRole::User);
        let record = device(&state, Some(&owner.id), DeviceAccess::RelayLogin);

        let response = guard(
            &state,
            &cookies(&state, &intruder.id),
            Some(&record),
            &target(&record.id, "", DeviceEntry::Path),
            None,
        )
        .expect("it should be refused");

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn the_owner_and_an_administrator_both_get_through() {
        let state = state();
        let owner = user(&state, "alice", UserRole::User);
        let admin = user(&state, "root", UserRole::Admin);
        let record = device(&state, Some(&owner.id), DeviceAccess::RelayLogin);

        for user_id in [&owner.id, &admin.id] {
            assert!(
                guard(
                    &state,
                    &cookies(&state, user_id),
                    Some(&record),
                    &target(&record.id, "ws", DeviceEntry::Path),
                    None
                )
                .is_none(),
                "{user_id} 应当被放行"
            );
        }
    }

    /// The session cookie never reaches a device subdomain, so that entry is answered with the
    /// path form, which the browser can be authenticated on.
    #[test]
    fn a_restricted_device_on_its_subdomain_is_sent_to_the_path_form() {
        let state = state();
        let owner = user(&state, "alice", UserRole::User);
        let record = device(&state, Some(&owner.id), DeviceAccess::RelayLogin);

        let response = guard(
            &state,
            &cookies(&state, &owner.id),
            Some(&record),
            &target(&record.id, "ws", DeviceEntry::Subdomain),
            Some("v=1"),
        )
        .expect("it should be redirected");

        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(
            location(&response),
            format!("https://relay.example.com/d/{}/ws?v=1", record.id)
        );
    }
}
