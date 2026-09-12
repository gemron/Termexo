//! Works out who the caller really is when the relay sits behind another proxy.
//!
//! Forwarding headers are only believed when the relay does not terminate TLS itself *and* the
//! connection comes from a configured network. A relay that owns its own TLS is talking to the
//! browser directly, so a `X-Forwarded-For` on such a connection is the client inventing one.

use std::net::{IpAddr, SocketAddr};

use axum::http::{header, HeaderMap};
use termexo_relay_protocol::tunnel::{
    HEADER_FORWARDED_FOR, HEADER_FORWARDED_HOST, HEADER_FORWARDED_PROTO,
};

use crate::config::is_trusted_proxy;
use crate::state::RelayState;

const HTTPS_PROTO: &str = "https";
const HTTP_PROTO: &str = "http";

/// What the relay believes about the browser at the other end of a request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientContext {
    /// The address failures are counted against and that the device is told about.
    pub ip: IpAddr,
    /// `http` or `https`, as seen by the browser.
    pub proto: String,
    /// The `Host` the browser asked for, which is what makes generated links absolute.
    pub host: String,
}

pub fn resolve(state: &RelayState, headers: &HeaderMap, peer: SocketAddr) -> ClientContext {
    let trusted = !state.tls_enabled && is_trusted_proxy(&state.trusted_proxies, peer.ip());
    let fallback_host = header_value(headers, header::HOST.as_str())
        .unwrap_or_else(|| state.public_url.host())
        .to_string();
    if !trusted {
        return ClientContext {
            ip: peer.ip(),
            proto: scheme(state.is_public_secure()).to_string(),
            host: fallback_host,
        };
    }

    ClientContext {
        ip: header_value(headers, HEADER_FORWARDED_FOR)
            .and_then(first_forwarded_address)
            .unwrap_or_else(|| peer.ip()),
        proto: header_value(headers, HEADER_FORWARDED_PROTO)
            .unwrap_or_else(|| scheme(state.is_public_secure()))
            .to_string(),
        host: header_value(headers, HEADER_FORWARDED_HOST)
            .map(str::to_string)
            .unwrap_or(fallback_host),
    }
}

pub fn scheme(secure: bool) -> &'static str {
    if secure {
        HTTPS_PROTO
    } else {
        HTTP_PROTO
    }
}

/// The client address out of an `X-Forwarded-For` chain.
///
/// The list is appended to by each proxy, so the leftmost entry is the original client. Trusting it
/// is only sound because the whole header was already gated on a trusted peer.
fn first_forwarded_address(value: &str) -> Option<IpAddr> {
    value
        .split(',')
        .next()
        .map(str::trim)
        // A proxy may render an IPv6 address in brackets, with or without a port.
        .map(|entry| entry.trim_start_matches('[').trim_end_matches(']'))
        .and_then(|entry| entry.parse().ok())
}

fn header_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use axum::http::{HeaderName, HeaderValue};

    use super::*;
    use crate::state::tests::state_behind_proxy;
    use crate::state::SharedState;

    const PROXY: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)), 40000);
    const STRANGER: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(203, 0, 113, 9)), 40000);

    fn state(tls_enabled: bool) -> SharedState {
        state_behind_proxy(
            "relay-a",
            vec!["10.0.0.0/8".parse().expect("a network")],
            tls_enabled,
        )
    }

    fn headers(entries: &[(&str, &str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in entries {
            headers.insert(
                HeaderName::from_bytes(name.as_bytes()).expect("a header name"),
                HeaderValue::from_str(value).expect("a header value"),
            );
        }
        headers
    }

    #[test]
    fn a_trusted_proxy_speaks_for_its_client() {
        let resolved = resolve(
            &state(false),
            &headers(&[
                (HEADER_FORWARDED_FOR, "203.0.113.5, 10.0.0.1"),
                (HEADER_FORWARDED_PROTO, "https"),
                (HEADER_FORWARDED_HOST, "relay.example.com"),
            ]),
            PROXY,
        );

        assert_eq!(resolved.ip, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 5)));
        assert_eq!(resolved.proto, "https");
        assert_eq!(resolved.host, "relay.example.com");
    }

    #[test]
    fn an_untrusted_source_cannot_forge_its_address() {
        let resolved = resolve(
            &state(false),
            &headers(&[(HEADER_FORWARDED_FOR, "10.0.0.9")]),
            STRANGER,
        );

        assert_eq!(resolved.ip, STRANGER.ip());
    }

    #[test]
    fn forwarding_headers_are_ignored_when_the_relay_terminates_tls_itself() {
        let resolved = resolve(
            &state(true),
            &headers(&[
                (HEADER_FORWARDED_FOR, "203.0.113.5"),
                (HEADER_FORWARDED_PROTO, "http"),
            ]),
            PROXY,
        );

        assert_eq!(resolved.ip, PROXY.ip());
        assert_eq!(resolved.proto, "https");
    }

    #[test]
    fn the_host_falls_back_to_the_request_and_then_to_the_public_url() {
        let from_request = resolve(
            &state(true),
            &headers(&[("host", "192.168.1.20:8443")]),
            PROXY,
        );
        let from_configuration = resolve(&state(true), &HeaderMap::new(), PROXY);

        assert_eq!(from_request.host, "192.168.1.20:8443");
        assert_eq!(from_configuration.host, "relay.example.com");
    }

    #[test]
    fn a_bracketed_or_malformed_forwarded_address_degrades_to_the_peer() {
        let bracketed = resolve(
            &state(false),
            &headers(&[(HEADER_FORWARDED_FOR, "[2001:db8::1]")]),
            PROXY,
        );
        let nonsense = resolve(
            &state(false),
            &headers(&[(HEADER_FORWARDED_FOR, "unknown")]),
            PROXY,
        );

        assert_eq!(
            bracketed.ip,
            "2001:db8::1".parse::<IpAddr>().expect("valid")
        );
        assert_eq!(nonsense.ip, PROXY.ip());
    }
}
