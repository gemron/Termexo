//! How a device's public address is formed, in both routing modes, and how one is read back.
//!
//! A relay hands out `https://<relay>/d/<deviceId>/` by default, and
//! `https://<deviceId>.<base>/` once `--subdomain-base` is configured. Both entries stay live on
//! the same relay — a link that was handed out yesterday must not stop working because the
//! operator added a wildcard domain today — so every place that builds an address or reads one
//! back goes through this one type instead of concatenating a prefix of its own.

use termexo_relay_protocol::credential::DeviceId;
use termexo_relay_protocol::tunnel::DEVICE_PATH_PREFIX;

use crate::config::{PublicUrl, SubdomainBase};

/// The base a device's own router is told about when the browser used a device subdomain: the
/// whole host belongs to that device, so nothing has to be stripped from its paths.
const SUBDOMAIN_BASE_PATH: &str = "/";

const HOST_PORT_SEPARATOR: char = ':';
const HOST_ROOT_DOT: char = '.';

/// How the browser addressed a device, which decides the base path it is told about and where a
/// request that needs a console session is sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceEntry {
    /// `https://<relay>/d/<deviceId>/…`, the address every relay always answers on.
    Path,
    /// `https://<deviceId>.<base>/…`, available once a subdomain base is configured.
    Subdomain,
}

/// One browser request resolved to the device it is for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceTarget {
    pub device_id: String,
    /// The path inside the device, never starting with a slash.
    pub rest: String,
    pub entry: DeviceEntry,
}

impl DeviceTarget {
    /// The value of `X-Termexo-Base`: what the device has to prefix its own absolute links with.
    pub fn base_path(&self) -> String {
        match self.entry {
            DeviceEntry::Path => path_base(&self.device_id),
            DeviceEntry::Subdomain => SUBDOMAIN_BASE_PATH.to_string(),
        }
    }
}

/// `/d/<deviceId>/`, the base of the path form.
pub fn path_base(device_id: &str) -> String {
    format!("{DEVICE_PATH_PREFIX}{device_id}/")
}

/// Builds and recognises the addresses of this relay's devices.
#[derive(Debug, Clone)]
pub struct DeviceAddressing {
    public_url: PublicUrl,
    subdomain_base: Option<SubdomainBase>,
}

impl DeviceAddressing {
    pub fn new(public_url: PublicUrl, subdomain_base: Option<SubdomainBase>) -> Self {
        Self {
            public_url,
            subdomain_base,
        }
    }

    /// The address this relay advertises for a device: the subdomain form when one is configured,
    /// the path form otherwise.
    ///
    /// Only one address is advertised even though both work, because this is what the console
    /// copies and what a device shows in its panel; offering two spellings of the same workbench
    /// would be a choice nobody can make an informed decision about.
    pub fn device_url(&self, device_id: &str) -> String {
        match &self.subdomain_base {
            Some(base) => format!(
                "{}://{device_id}{HOST_ROOT_DOT}{}{}/",
                crate::forwarded::scheme(self.public_url.is_secure()),
                base.host(),
                self.public_url.port_suffix()
            ),
            None => format!("{}{}", self.public_url.origin(), path_base(device_id)),
        }
    }

    /// The path-form address of one request, absolute because it names a different host than the
    /// device subdomain the browser is on.
    pub fn path_form_url(&self, device_id: &str, rest: &str, query: Option<&str>) -> String {
        let query = query.map(|query| format!("?{query}")).unwrap_or_default();
        format!(
            "{}{}{rest}{query}",
            self.public_url.origin(),
            path_base(device_id)
        )
    }

    /// The device a `Host` header names, or `None` when the request is for the relay itself.
    ///
    /// The comparison folds case and drops the port because both are the browser's to choose, and
    /// the label has to be a well-formed device id: an unrelated name that happens to sit under
    /// the base domain falls through to the relay's own routes rather than becoming a lookup.
    pub fn device_from_host(&self, host: &str) -> Option<String> {
        let base = self.subdomain_base.as_ref()?;
        let normalized = normalize_host(host);
        let label = base.label_of(&normalized)?;
        DeviceId::parse(label).ok().map(|id| id.to_string())
    }

    pub fn public_url(&self) -> &PublicUrl {
        &self.public_url
    }

    /// The wildcard name a generated certificate needs to cover device subdomains.
    pub fn wildcard_name(&self) -> Option<String> {
        self.subdomain_base
            .as_ref()
            .map(SubdomainBase::wildcard_name)
    }
}

/// A `Host` header reduced to the name the base is compared against.
fn normalize_host(host: &str) -> String {
    let host = host.trim();
    // An IPv6 literal keeps its brackets, so only a colon outside one is a port separator.
    let name = match host.rsplit_once(HOST_PORT_SEPARATOR) {
        Some((name, _)) if !host.ends_with(']') => name,
        _ => host,
    };
    name.trim_end_matches(HOST_ROOT_DOT).to_lowercase()
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;

    const DEVICE_ID: &str = "abcdefghijklmnopqrstuvwxyz";

    fn addressing(public_url: &str, base: Option<&str>) -> DeviceAddressing {
        DeviceAddressing::new(
            PublicUrl::from_str(public_url).expect("a public url"),
            base.map(|base| SubdomainBase::from_str(base).expect("a base")),
        )
    }

    #[test]
    fn without_a_base_a_device_is_advertised_under_the_path_prefix() {
        let addressing = addressing("https://relay.example.com", None);

        assert_eq!(
            addressing.device_url(DEVICE_ID),
            format!("https://relay.example.com/d/{DEVICE_ID}/")
        );
        assert_eq!(addressing.device_from_host("relay.example.com"), None);
        assert_eq!(addressing.wildcard_name(), None);
    }

    #[test]
    fn with_a_base_a_device_is_advertised_under_its_own_subdomain() {
        let addressing = addressing("https://relay.example.com", Some("relay.example.com"));

        assert_eq!(
            addressing.device_url(DEVICE_ID),
            format!("https://{DEVICE_ID}.relay.example.com/")
        );
        assert_eq!(
            addressing.wildcard_name().as_deref(),
            Some("*.relay.example.com")
        );
    }

    /// The two spellings have to reach the same listener, so a non-default port travels along.
    #[test]
    fn a_subdomain_address_keeps_the_relays_port() {
        let addressing = addressing("http://relay.test:8443", Some("relay.test"));

        assert_eq!(
            addressing.device_url(DEVICE_ID),
            format!("http://{DEVICE_ID}.relay.test:8443/")
        );
    }

    #[test]
    fn a_device_host_is_recognised_whatever_case_and_port_the_browser_used() {
        let addressing = addressing("https://relay.example.com", Some("relay.example.com"));
        let expected = Some(DEVICE_ID.to_string());

        assert_eq!(
            addressing.device_from_host(&format!("{DEVICE_ID}.relay.example.com")),
            expected
        );
        // DNS is case-insensitive, so a browser may send whichever case the address was typed in.
        assert_eq!(
            addressing.device_from_host(&format!(
                "{}.RELAY.Example.com:8443",
                DEVICE_ID.to_uppercase()
            )),
            expected
        );
        assert_eq!(
            addressing.device_from_host(&format!("{DEVICE_ID}.relay.example.com.")),
            expected
        );
    }

    #[test]
    fn a_host_that_is_not_exactly_one_valid_device_label_falls_back_to_the_relay() {
        let addressing = addressing("https://relay.example.com", Some("relay.example.com"));

        for host in [
            "relay.example.com",
            "console.relay.example.com",
            &format!("a.{DEVICE_ID}.relay.example.com"),
            &format!("{DEVICE_ID}.relay.example.com.evil.test"),
            "relay.example.com:8443",
            "",
        ] {
            assert_eq!(
                addressing.device_from_host(host),
                None,
                "{host} 不应当被当成设备地址"
            );
        }
    }

    #[test]
    fn the_base_header_follows_the_entry_the_browser_used() {
        let path = DeviceTarget {
            device_id: DEVICE_ID.into(),
            rest: "assets/main.js".into(),
            entry: DeviceEntry::Path,
        };
        let subdomain = DeviceTarget {
            entry: DeviceEntry::Subdomain,
            ..path.clone()
        };

        assert_eq!(path.base_path(), format!("/d/{DEVICE_ID}/"));
        assert_eq!(subdomain.base_path(), "/");
    }

    #[test]
    fn the_path_form_of_a_request_is_absolute_and_keeps_its_query() {
        let addressing = addressing("https://relay.example.com", Some("relay.example.com"));

        assert_eq!(
            addressing.path_form_url(DEVICE_ID, "ws", Some("v=1")),
            format!("https://relay.example.com/d/{DEVICE_ID}/ws?v=1")
        );
        assert_eq!(
            addressing.path_form_url(DEVICE_ID, "", None),
            format!("https://relay.example.com/d/{DEVICE_ID}/")
        );
    }
}
