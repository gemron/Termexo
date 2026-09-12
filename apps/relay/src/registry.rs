//! The in-memory routing table: which devices are reachable right now and over which tunnel.
//!
//! Nothing here is persisted. Online state is a property of a live WebSocket, so a restart starts
//! with an empty table and every device reconnects into it; only `devices.last_seen_at` survives.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use termexo_relay_protocol::frames::{AnnouncedDevice, DeviceKind};
use termexo_relay_protocol::preface::MAX_HOPS;

use crate::db::now_millis;
use crate::tunnel::TunnelHandle;

/// How a stream to one device is opened.
#[derive(Clone)]
pub enum Route {
    /// The device holds a tunnel to this relay.
    Direct(TunnelHandle),
    /// The device is behind a downstream relay; the stream is opened on that relay's tunnel and
    /// carries the target device id in its preface.
    Via {
        link: TunnelHandle,
        /// The relays the announcement crossed, nearest announcer first.
        hops: Vec<String>,
    },
}

impl Route {
    /// The tunnel a stream is actually opened on.
    pub fn link(&self) -> &TunnelHandle {
        match self {
            Self::Direct(handle) => handle,
            Self::Via { link, .. } => link,
        }
    }

    pub fn hops(&self) -> &[String] {
        match self {
            Self::Direct(_) => &[],
            Self::Via { hops, .. } => hops,
        }
    }

    /// Shorter wins when the same device is reachable two ways.
    fn hop_count(&self) -> usize {
        self.hops().len()
    }
}

/// What a device told the relay when its tunnel came up.
pub struct DirectPresence {
    pub device_id: String,
    pub name: String,
    pub kind: DeviceKind,
    /// Only a downstream relay declares an id of its own.
    pub relay_id: Option<String>,
    pub ip: Option<String>,
    pub version: Option<String>,
    pub handle: TunnelHandle,
}

/// The result of registering a tunnel.
pub struct Registration {
    /// Identifies this connection, so a later disconnect cannot evict a newer one.
    pub serial: u64,
    /// The tunnel this one replaced, which the caller has to close.
    pub displaced: Option<TunnelHandle>,
}

/// One reachable device as the console and the proxy see it.
#[derive(Clone)]
pub struct OnlineDevice {
    pub device_id: String,
    pub name: String,
    pub kind: DeviceKind,
    pub connected_since: i64,
    pub ip: Option<String>,
    pub version: Option<String>,
    pub route: Route,
}

/// Where an entry came from, which is what scopes a removal.
#[derive(Clone, PartialEq, Eq)]
enum Origin {
    Direct { serial: u64 },
    Announced { link_device_id: String },
}

#[derive(Clone)]
struct Entry {
    device: OnlineDevice,
    origin: Origin,
    /// Monotonic sequence number of the announcement that installed this entry, so that two routes
    /// of equal length are decided by "the most recent one wins".
    sequence: u64,
}

#[derive(Default)]
struct RegistryState {
    entries: HashMap<String, Entry>,
    /// Relay id to the device id of the downstream link that declared it, so an announced route's
    /// hops can be rendered with names instead of opaque ids.
    relay_links: HashMap<String, String>,
}

pub struct Registry {
    /// This relay's own id, needed for the loop guard on incoming announcements.
    relay_id: String,
    state: Mutex<RegistryState>,
    sequence: AtomicU64,
}

impl Registry {
    pub fn new(relay_id: String) -> Self {
        Self {
            relay_id,
            state: Mutex::new(RegistryState::default()),
            sequence: AtomicU64::new(0),
        }
    }

    /// Registers a live tunnel, displacing whatever route the device had.
    ///
    /// A direct tunnel always wins: it is the shortest possible path and the only one whose
    /// credential this relay checked itself.
    pub fn connect(&self, presence: DirectPresence) -> Registration {
        let serial = self.next_sequence();
        let mut state = self.state();
        if let (Some(relay_id), DeviceKind::Relay) = (&presence.relay_id, presence.kind) {
            state
                .relay_links
                .insert(relay_id.clone(), presence.device_id.clone());
        }
        let entry = Entry {
            device: OnlineDevice {
                device_id: presence.device_id.clone(),
                name: presence.name,
                kind: presence.kind,
                connected_since: now_millis(),
                ip: presence.ip,
                version: presence.version,
                route: Route::Direct(presence.handle),
            },
            origin: Origin::Direct { serial },
            sequence: serial,
        };
        let displaced = state
            .entries
            .insert(presence.device_id, entry)
            .and_then(|previous| match previous.origin {
                // Only a displaced *direct* tunnel has to be closed; an announced entry is just a
                // routing hint that the downstream relay still owns.
                Origin::Direct { .. } => Some(previous.device.route.link().clone()),
                Origin::Announced { .. } => None,
            });
        Registration { serial, displaced }
    }

    /// Removes a tunnel, but only if it is still the registered one.
    ///
    /// A device that reconnects faster than its previous tunnel task can finish tearing down would
    /// otherwise be evicted by the old task's cleanup.
    pub fn disconnect(&self, device_id: &str, serial: u64) -> bool {
        let mut state = self.state();
        let matches = state
            .entries
            .get(device_id)
            .is_some_and(|entry| entry.origin == Origin::Direct { serial });
        if !matches {
            return false;
        }
        state.entries.remove(device_id);
        state
            .relay_links
            .retain(|_, link_device_id| link_device_id != device_id);
        // Everything this link announced is unreachable the moment the link is gone.
        state.entries.retain(|_, entry| {
            !matches!(&entry.origin, Origin::Announced { link_device_id } if link_device_id == device_id)
        });
        true
    }

    pub fn route(&self, device_id: &str) -> Option<Route> {
        self.state()
            .entries
            .get(device_id)
            .map(|entry| entry.device.route.clone())
    }

    pub fn is_online(&self, device_id: &str) -> bool {
        self.state().entries.contains_key(device_id)
    }

    /// Replaces everything one downstream relay had announced with a fresh snapshot.
    pub fn apply_announcement(
        &self,
        link_device_id: &str,
        link: &TunnelHandle,
        devices: Vec<AnnouncedDevice>,
    ) {
        {
            let mut state = self.state();
            Self::drop_announcements_from(&mut state, link_device_id);
        }
        for device in devices {
            if !device.online {
                continue;
            }
            self.announce_device(link_device_id, link, device);
        }
    }

    /// Installs or refreshes one announced device.
    ///
    /// Returns whether the announcement was accepted; a rejected one is either a loop or a chain
    /// longer than a stream is allowed to cross.
    pub fn announce_device(
        &self,
        link_device_id: &str,
        link: &TunnelHandle,
        device: AnnouncedDevice,
    ) -> bool {
        if !self.is_announcement_routable(&device.via) {
            tracing::debug!(
                device = %device.id,
                via = ?device.via,
                "丢弃无法路由的设备通告"
            );
            return false;
        }
        let sequence = self.next_sequence();
        let route = Route::Via {
            link: link.clone(),
            hops: device.via,
        };
        let mut state = self.state();
        if let Some(existing) = state.entries.get(&device.id) {
            if !replaces(&existing.device.route, existing.sequence, &route, sequence) {
                return false;
            }
        }
        state.entries.insert(
            device.id.clone(),
            Entry {
                device: OnlineDevice {
                    device_id: device.id,
                    name: device.name,
                    kind: DeviceKind::Desktop,
                    connected_since: now_millis(),
                    ip: None,
                    version: None,
                    route,
                },
                origin: Origin::Announced {
                    link_device_id: link_device_id.to_string(),
                },
                sequence,
            },
        );
        true
    }

    /// Withdraws one announced device, ignoring a withdrawal for a route another link owns.
    pub fn withdraw_device(&self, link_device_id: &str, device_id: &str) {
        let mut state = self.state();
        let owned = state.entries.get(device_id).is_some_and(
            |entry| matches!(&entry.origin, Origin::Announced { link_device_id: owner } if owner == link_device_id),
        );
        if owned {
            state.entries.remove(device_id);
        }
    }

    /// Every reachable device, for the console's device list.
    pub fn snapshot(&self) -> Vec<OnlineDevice> {
        self.state()
            .entries
            .values()
            .map(|entry| entry.device.clone())
            .collect()
    }

    /// Resolves relay ids in a route's hops to the names of the downstream links that carry them.
    pub fn hop_names(&self, hops: &[String]) -> Vec<String> {
        let state = self.state();
        hops.iter()
            .map(|relay_id| {
                state
                    .relay_links
                    .get(relay_id)
                    .and_then(|device_id| state.entries.get(device_id))
                    .map(|entry| entry.device.name.clone())
                    // An unknown id is shown as itself: a name the relay never learned is still
                    // more useful than an empty slot.
                    .unwrap_or_else(|| relay_id.clone())
            })
            .collect()
    }

    /// The downstream relays currently linked, with how many devices each of them announced.
    pub fn downstream_links(&self) -> Vec<DownstreamLink> {
        let state = self.state();
        state
            .entries
            .values()
            .filter(|entry| entry.device.kind == DeviceKind::Relay)
            .map(|entry| DownstreamLink {
                device_id: entry.device.device_id.clone(),
                name: entry.device.name.clone(),
                device_count: state
                    .entries
                    .values()
                    .filter(|announced| {
                        matches!(&announced.origin, Origin::Announced { link_device_id }
                            if *link_device_id == entry.device.device_id)
                    })
                    .count(),
            })
            .collect()
    }

    /// Whether an announcement can be routed: it must not come back through this relay, and the
    /// chain it describes must stay inside the stream preface's hop budget.
    fn is_announcement_routable(&self, via: &[String]) -> bool {
        // The relay appends its own id when it forwards a stream, so the announced chain has to
        // leave room for that hop.
        via.len() < MAX_HOPS && !via.contains(&self.relay_id)
    }

    fn drop_announcements_from(state: &mut RegistryState, link_device_id: &str) {
        state.entries.retain(|_, entry| {
            !matches!(&entry.origin, Origin::Announced { link_device_id: owner } if owner == link_device_id)
        });
    }

    fn next_sequence(&self) -> u64 {
        self.sequence.fetch_add(1, Ordering::Relaxed)
    }

    fn state(&self) -> MutexGuard<'_, RegistryState> {
        // The table only holds routing hints, so a torn update from a panic elsewhere is repaired
        // by the next announcement rather than being worth taking the relay down for.
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// One downstream relay, for the console's relay page.
pub struct DownstreamLink {
    pub device_id: String,
    pub name: String,
    pub device_count: usize,
}

/// Whether a candidate route should take over from the one already installed.
fn replaces(existing: &Route, existing_sequence: u64, candidate: &Route, sequence: u64) -> bool {
    match existing {
        // A direct tunnel is the shortest path there is and the only one this relay authenticated.
        Route::Direct(_) => false,
        Route::Via { .. } => {
            candidate.hop_count() < existing.hop_count()
                || (candidate.hop_count() == existing.hop_count() && sequence > existing_sequence)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RELAY_ID: &str = "relay-a";

    fn registry() -> Registry {
        Registry::new(RELAY_ID.to_string())
    }

    fn presence(device_id: &str, kind: DeviceKind, relay_id: Option<&str>) -> DirectPresence {
        DirectPresence {
            device_id: device_id.to_string(),
            name: format!("设备 {device_id}"),
            kind,
            relay_id: relay_id.map(str::to_string),
            ip: Some("203.0.113.5".into()),
            version: Some("0.9.0".into()),
            handle: TunnelHandle::disconnected(device_id),
        }
    }

    fn announced(id: &str, via: &[&str]) -> AnnouncedDevice {
        AnnouncedDevice {
            id: id.to_string(),
            name: format!("设备 {id}"),
            online: true,
            via: via.iter().map(|hop| hop.to_string()).collect(),
        }
    }

    #[test]
    fn a_direct_tunnel_is_routable_and_removed_on_disconnect() {
        let registry = registry();

        let registration = registry.connect(presence("device-a", DeviceKind::Desktop, None));

        assert!(registry.is_online("device-a"));
        assert!(matches!(registry.route("device-a"), Some(Route::Direct(_))));
        assert!(registry
            .route("device-a")
            .expect("a route")
            .hops()
            .is_empty());
        assert!(registry.disconnect("device-a", registration.serial));
        assert!(registry.route("device-a").is_none());
    }

    #[test]
    fn reconnecting_displaces_the_previous_tunnel_and_its_stale_cleanup() {
        let registry = registry();
        let first = registry.connect(presence("device-a", DeviceKind::Desktop, None));

        let second = registry.connect(presence("device-a", DeviceKind::Desktop, None));

        assert!(
            second.displaced.is_some(),
            "the old tunnel has to be closed"
        );
        assert!(
            !registry.disconnect("device-a", first.serial),
            "the old task must not evict the new tunnel"
        );
        assert!(registry.is_online("device-a"));
        assert!(registry.disconnect("device-a", second.serial));
    }

    #[test]
    fn an_announced_device_routes_through_its_link() {
        let registry = registry();
        let link = presence("relay-link", DeviceKind::Relay, Some("relay-b"));
        let handle = link.handle.clone();
        registry.connect(link);

        registry.apply_announcement(
            "relay-link",
            &handle,
            vec![announced("device-b", &["relay-b"])],
        );

        let route = registry.route("device-b").expect("the device should route");
        assert_eq!(route.hops(), ["relay-b"]);
        assert_eq!(registry.hop_names(&["relay-b".into()]), ["设备 relay-link"]);
        let downstream = registry.downstream_links();
        assert_eq!(downstream.len(), 1);
        assert_eq!(downstream[0].device_count, 1);
    }

    #[test]
    fn losing_the_link_takes_everything_it_announced_with_it() {
        let registry = registry();
        let link = presence("relay-link", DeviceKind::Relay, Some("relay-b"));
        let handle = link.handle.clone();
        let registration = registry.connect(link);
        registry.apply_announcement(
            "relay-link",
            &handle,
            vec![announced("device-b", &["relay-b"])],
        );

        registry.disconnect("relay-link", registration.serial);

        assert!(registry.route("device-b").is_none());
        assert!(registry.downstream_links().is_empty());
    }

    #[test]
    fn an_announcement_that_loops_back_through_this_relay_is_dropped() {
        let registry = registry();
        let handle = TunnelHandle::disconnected("relay-link");

        assert!(!registry.announce_device(
            "relay-link",
            &handle,
            announced("device-b", &["relay-b", RELAY_ID])
        ));
        assert!(registry.route("device-b").is_none());
    }

    #[test]
    fn an_announcement_longer_than_the_hop_budget_is_dropped() {
        let registry = registry();
        let handle = TunnelHandle::disconnected("relay-link");
        let long: Vec<String> = (0..MAX_HOPS)
            .map(|index| format!("relay-{index}"))
            .collect();
        let borrowed: Vec<&str> = long.iter().map(String::as_str).collect();

        assert!(!registry.announce_device("relay-link", &handle, announced("device-b", &borrowed)));
        assert!(registry.announce_device(
            "relay-link",
            &handle,
            announced("device-b", &borrowed[..MAX_HOPS - 1])
        ));
    }

    #[test]
    fn the_shorter_route_wins_and_a_direct_tunnel_beats_both() {
        let registry = registry();
        let long_link = TunnelHandle::disconnected("relay-long");
        let short_link = TunnelHandle::disconnected("relay-short");

        registry.announce_device(
            "relay-long",
            &long_link,
            announced("device-b", &["relay-x", "relay-y"]),
        );
        assert!(registry.announce_device(
            "relay-short",
            &short_link,
            announced("device-b", &["relay-x"])
        ));
        assert_eq!(
            registry.route("device-b").expect("a route").hops(),
            ["relay-x"]
        );

        // A longer announcement must not take the route back.
        assert!(!registry.announce_device(
            "relay-long",
            &long_link,
            announced("device-b", &["relay-x", "relay-y"])
        ));

        registry.connect(presence("device-b", DeviceKind::Desktop, None));
        assert!(matches!(registry.route("device-b"), Some(Route::Direct(_))));
        assert!(!registry.announce_device(
            "relay-short",
            &short_link,
            announced("device-b", &["relay-x"])
        ));
    }

    #[test]
    fn a_later_announcement_of_equal_length_replaces_the_earlier_one() {
        let registry = registry();
        let first = TunnelHandle::disconnected("relay-first");
        let second = TunnelHandle::disconnected("relay-second");
        registry.announce_device("relay-first", &first, announced("device-b", &["relay-x"]));

        assert!(registry.announce_device(
            "relay-second",
            &second,
            announced("device-b", &["relay-z"])
        ));
        assert_eq!(
            registry.route("device-b").expect("a route").hops(),
            ["relay-z"]
        );
    }

    #[test]
    fn a_snapshot_replaces_what_a_link_announced_before() {
        let registry = registry();
        let handle = TunnelHandle::disconnected("relay-link");
        registry.apply_announcement(
            "relay-link",
            &handle,
            vec![
                announced("device-b", &["relay-b"]),
                announced("device-c", &["relay-b"]),
            ],
        );

        registry.apply_announcement(
            "relay-link",
            &handle,
            vec![announced("device-c", &["relay-b"])],
        );

        assert!(registry.route("device-b").is_none());
        assert!(registry.route("device-c").is_some());
    }

    #[test]
    fn an_offline_announcement_and_a_foreign_withdrawal_are_ignored() {
        let registry = registry();
        let handle = TunnelHandle::disconnected("relay-link");
        let mut offline = announced("device-b", &["relay-b"]);
        offline.online = false;
        registry.apply_announcement(
            "relay-link",
            &handle,
            vec![offline, announced("device-c", &["relay-b"])],
        );

        registry.withdraw_device("someone-else", "device-c");

        assert!(registry.route("device-b").is_none());
        assert!(registry.route("device-c").is_some());
        registry.withdraw_device("relay-link", "device-c");
        assert!(registry.route("device-c").is_none());
    }
}
