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

/// The relay's own version, reported by `/api/health` and recorded in the console's settings page.
pub const RELAY_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct RelayState {
    pub database: Database,
    /// Shared with the proxy's connector, which must not hold the whole state back.
    pub registry: Arc<Registry>,
    pub proxy: Proxy,
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
