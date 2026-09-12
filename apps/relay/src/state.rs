//! The shared state every request handler is given.

use std::sync::Arc;

use ipnet::IpNet;
use termexo_relay_protocol::frames::RelayAddress;
use termexo_relay_protocol::tunnel::DEVICE_PATH_PREFIX;

use crate::auth::LockoutTable;
use crate::config::PublicUrl;
use crate::db::Database;
use crate::proxy::Proxy;
use crate::registry::Registry;
use crate::upstream::UpstreamLink;

/// The relay's own version, reported by `/api/health` and recorded in the console's settings page.
pub const RELAY_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct RelayState {
    pub database: Database,
    /// Shared with the proxy's connector, which must not hold the whole state back.
    pub registry: Arc<Registry>,
    pub proxy: Proxy,
    /// This relay's own outbound link, when it is a downstream of another relay.
    pub upstream: Arc<UpstreamLink>,
    pub lockout: LockoutTable,
    /// Stable for the life of the data directory: devices and downstream relays remember it.
    pub relay_id: String,
    pub public_url: PublicUrl,
    /// Reverse proxies whose forwarding headers may be believed; only consulted when the relay
    /// itself does not terminate TLS.
    pub trusted_proxies: Vec<IpNet>,
    pub tls_enabled: bool,
}

impl RelayState {
    /// The public address of one device, which is both what the console copies and what a device
    /// is told in its `welcome`.
    pub fn device_access_url(&self, device_id: &str) -> String {
        format!(
            "{}{DEVICE_PATH_PREFIX}{device_id}/",
            self.public_url.origin()
        )
    }

    /// This relay's own entry in a device's address list.
    pub fn relay_address(&self, device_id: &str) -> RelayAddress {
        RelayAddress {
            relay_id: self.relay_id.clone(),
            relay_name: self.public_url.host().to_string(),
            url: self.device_access_url(device_id),
            hops: 0,
        }
    }

    /// Every address one of this relay's devices can be opened at, across the whole chain: this
    /// relay first, then one entry per relay above it.
    pub fn device_addresses(&self, device_id: &str) -> Vec<RelayAddress> {
        let mut addresses = vec![self.relay_address(device_id)];
        addresses.extend(self.upstream.addresses_for(device_id));
        addresses
    }

    /// The upstream relay ids a device is told about, so it can spot a loop of its own.
    pub fn upstream_chain(&self) -> Vec<String> {
        self.upstream.chain()
    }

    /// Whether browsers reach this relay over https, which decides the `Secure` cookie attribute
    /// and the `X-Forwarded-Proto` the devices are told.
    pub fn is_public_secure(&self) -> bool {
        // The public URL wins over the listener: a relay behind Caddy serves plain HTTP itself and
        // is still an https origin as far as every browser is concerned.
        self.public_url.is_secure()
    }
}

/// The axum state type, so handler signatures stay short.
pub type SharedState = Arc<RelayState>;

#[cfg(test)]
pub mod tests {
    use super::*;

    use crate::db::Database;
    use crate::registry::Registry;

    /// A relay state backed by an in-memory database, shared by the unit tests that need one.
    pub fn state_for_tests(relay_id: &str) -> SharedState {
        state_behind_proxy(relay_id, Vec::new(), true)
    }

    /// The same state with the two knobs the forwarding rules are decided by.
    pub fn state_behind_proxy(
        relay_id: &str,
        trusted_proxies: Vec<IpNet>,
        tls_enabled: bool,
    ) -> SharedState {
        let registry = Arc::new(Registry::new(relay_id.to_string()));
        Arc::new(RelayState {
            database: Database::open_in_memory().expect("the database should open"),
            proxy: Proxy::new(registry.clone(), relay_id),
            registry,
            upstream: Arc::new(UpstreamLink::new()),
            lockout: LockoutTable::new(),
            relay_id: relay_id.to_string(),
            public_url: "https://relay.example.com".parse().expect("a public url"),
            trusted_proxies,
            tls_enabled,
        })
    }

    #[test]
    fn a_relay_without_an_upstream_offers_only_its_own_address() {
        let state = state_for_tests("relay-a");

        let addresses = state.device_addresses("device-a");

        assert_eq!(addresses.len(), 1);
        assert_eq!(addresses[0].hops, 0);
        assert_eq!(addresses[0].url, "https://relay.example.com/d/device-a/");
        assert!(state.upstream_chain().is_empty());
    }
}
