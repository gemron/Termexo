//! The addresses a device gains by this relay having an upstream.
//!
//! A device's address list is computed by the relay it is attached to: this relay's own address at
//! zero hops, then one entry per relay further up the chain with the hop count raised by one. The
//! upstream describes those relays in the `welcome` it sends *this* relay as one of its devices,
//! so every url there points at this relay's own link device. Swapping that trailing
//! `/d/<linkDeviceId>/` for `/d/<deviceId>/` is what turns them into addresses for a device of
//! ours — the shape of a public address is fixed by the protocol, so the rewrite is exact.

use termexo_relay_protocol::frames::RelayAddress;
use termexo_relay_protocol::tunnel::DEVICE_PATH_PREFIX;

/// One relay of the upstream chain, reduced to what building an address for any device needs.
#[derive(Debug, Clone, PartialEq, Eq)]
struct UpstreamRelay {
    relay_id: String,
    relay_name: String,
    /// The origin the relay serves device addresses under, without a trailing slash.
    origin: String,
    /// Already counted from this relay: the upstream's own zero becomes one here.
    hops: u32,
}

/// Everything the upstream chain contributes: the addresses it can be reached at and the relay ids
/// it is made of.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct UpstreamReach {
    relays: Vec<UpstreamRelay>,
    chain: Vec<String>,
}

impl UpstreamReach {
    /// Reads the chain out of what the upstream told this relay when its tunnel came up.
    ///
    /// `link_device_id` is this relay's device id *on the upstream*, which is what every url in
    /// `addresses` ends with.
    pub fn from_welcome(
        link_device_id: &str,
        upstream_relay_id: &str,
        addresses: &[RelayAddress],
        chain: &[String],
    ) -> Self {
        let suffix = device_path(link_device_id);
        let relays = addresses
            .iter()
            .filter_map(|address| {
                Some(UpstreamRelay {
                    relay_id: address.relay_id.clone(),
                    relay_name: address.relay_name.clone(),
                    origin: address.url.strip_suffix(&suffix)?.to_string(),
                    hops: address.hops.saturating_add(1),
                })
            })
            .collect();
        let mut full_chain = Vec::with_capacity(chain.len() + 1);
        full_chain.push(upstream_relay_id.to_string());
        full_chain.extend(chain.iter().cloned());
        Self {
            relays,
            chain: full_chain,
        }
    }

    /// Rebuilds the chain's addresses for one of this relay's own devices.
    pub fn addresses_for(&self, device_id: &str) -> Vec<RelayAddress> {
        let path = device_path(device_id);
        self.relays
            .iter()
            .map(|relay| RelayAddress {
                relay_id: relay.relay_id.clone(),
                relay_name: relay.relay_name.clone(),
                url: format!("{}{path}", relay.origin),
                hops: relay.hops,
            })
            .collect()
    }

    /// The upstream relay ids, nearest first, as a device's `welcome` carries them.
    pub fn chain(&self) -> &[String] {
        &self.chain
    }
}

fn device_path(device_id: &str) -> String {
    format!("{DEVICE_PATH_PREFIX}{device_id}/")
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINK_DEVICE_ID: &str = "linkdeviceidaaaaaaaaaaaaaa";
    const DEVICE_ID: &str = "officedesktopbbbbbbbbbbbbb";

    fn address(relay_id: &str, origin: &str, hops: u32) -> RelayAddress {
        RelayAddress {
            relay_id: relay_id.to_string(),
            relay_name: format!("{relay_id} 名称"),
            url: format!("{origin}/d/{LINK_DEVICE_ID}/"),
            hops,
        }
    }

    #[test]
    fn an_upstream_address_becomes_this_relays_device_address_one_hop_further_out() {
        let reach = UpstreamReach::from_welcome(
            LINK_DEVICE_ID,
            "relay-a",
            &[address("relay-a", "https://relay-a.example.com", 0)],
            &[],
        );

        let addresses = reach.addresses_for(DEVICE_ID);

        assert_eq!(addresses.len(), 1);
        assert_eq!(
            addresses[0].url,
            format!("https://relay-a.example.com/d/{DEVICE_ID}/")
        );
        assert_eq!(addresses[0].hops, 1, "上游的 0 跳对本中继的设备是 1 跳");
        assert_eq!(addresses[0].relay_id, "relay-a");
        assert_eq!(addresses[0].relay_name, "relay-a 名称");
    }

    /// Three relays deep: what the top one contributes is two hops away from a device here.
    #[test]
    fn every_relay_of_the_chain_is_carried_with_its_hop_count_raised() {
        let reach = UpstreamReach::from_welcome(
            LINK_DEVICE_ID,
            "relay-a",
            &[
                address("relay-a", "https://relay-a.example.com", 0),
                address("relay-c", "https://relay-c.example.com", 1),
            ],
            &["relay-c".to_string()],
        );

        let hops: Vec<u32> = reach
            .addresses_for(DEVICE_ID)
            .into_iter()
            .map(|address| address.hops)
            .collect();

        assert_eq!(hops, vec![1, 2]);
        assert_eq!(reach.chain(), ["relay-a", "relay-c"]);
    }

    #[test]
    fn the_chain_starts_with_the_upstream_itself() {
        let reach = UpstreamReach::from_welcome(LINK_DEVICE_ID, "relay-a", &[], &[]);

        assert_eq!(reach.chain(), ["relay-a"]);
        assert!(reach.addresses_for(DEVICE_ID).is_empty());
    }

    /// An address for some other device cannot be rewritten safely, so it is left out rather than
    /// turned into a url that would open the wrong workbench.
    #[test]
    fn an_address_that_is_not_this_links_own_is_dropped() {
        let mut foreign = address("relay-a", "https://relay-a.example.com", 0);
        foreign.url = "https://relay-a.example.com/d/someoneelse/".into();

        let reach = UpstreamReach::from_welcome(LINK_DEVICE_ID, "relay-a", &[foreign], &[]);

        assert!(reach.addresses_for(DEVICE_ID).is_empty());
    }

    #[test]
    fn a_relay_without_an_upstream_contributes_nothing() {
        let reach = UpstreamReach::default();

        assert!(reach.addresses_for(DEVICE_ID).is_empty());
        assert!(reach.chain().is_empty());
    }
}
