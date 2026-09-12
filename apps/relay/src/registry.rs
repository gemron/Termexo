//! The in-memory routing table: which devices are reachable right now and over which tunnel.
//!
//! Nothing here is persisted. Online state is a property of a live WebSocket, so a restart starts
//! with an empty table and every device reconnects into it; only `devices.last_seen_at` survives.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use termexo_relay_protocol::frames::{AnnouncedDevice, DeviceKind};
use termexo_relay_protocol::preface::MAX_HOPS;
use tokio::sync::broadcast;

use crate::db::now_millis;
use crate::tunnel::TunnelHandle;

/// How far the upstream link may fall behind before it is told to resynchronize. Reachability
/// changes are rare — one per tunnel coming up or going down — so this is generous already.
const CHANGE_CAPACITY: usize = 256;

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

/// One change in what this relay can reach, in the shape an upstream is told about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryChange {
    Online(AnnouncedDevice),
    Offline { device_id: String },
}

/// A device a downstream relay announced and then withdrew.
///
/// An announced device has no row here — ownership belongs to the relay it enrolled with — so
/// without this the moment it goes offline its address turns into "no such device". Remembering it
/// for as long as the link that announced it stays up is what lets the proxy answer the honest
/// "device is offline" page instead, and it bounds the memory to one link's own session.
#[derive(Clone)]
pub struct KnownDevice {
    pub name: String,
    pub last_seen_at: i64,
}

#[derive(Clone)]
struct WithdrawnDevice {
    link_device_id: String,
    device: KnownDevice,
}

#[derive(Default)]
struct RegistryState {
    entries: HashMap<String, Entry>,
    /// Relay id to the device id of the downstream link that declared it, so an announced route's
    /// hops can be rendered with names instead of opaque ids.
    relay_links: HashMap<String, String>,
    withdrawn: HashMap<String, WithdrawnDevice>,
}

pub struct Registry {
    /// This relay's own id, needed for the loop guard on incoming announcements.
    relay_id: String,
    state: Mutex<RegistryState>,
    sequence: AtomicU64,
    /// Published after the table has been updated and its lock released, so a subscriber can never
    /// deadlock the routing table by reacting to a change from inside the update.
    changes: broadcast::Sender<RegistryChange>,
}

impl Registry {
    pub fn new(relay_id: String) -> Self {
        Self {
            relay_id,
            state: Mutex::new(RegistryState::default()),
            sequence: AtomicU64::new(0),
            changes: broadcast::channel(CHANGE_CAPACITY).0,
        }
    }

    /// Watches what this relay can reach, so the upstream link can pass changes on as they happen.
    pub fn subscribe(&self) -> broadcast::Receiver<RegistryChange> {
        self.changes.subscribe()
    }

    /// Everything this relay can offer an upstream right now, as a full announcement snapshot.
    pub fn announcements(&self) -> Vec<AnnouncedDevice> {
        let state = self.state();
        state
            .entries
            .values()
            .filter_map(|entry| self.announcement_of(entry))
            .collect()
    }

    /// How one entry is announced upward, or `None` when it is not a destination at all.
    ///
    /// The `via` chain is this relay's own id followed by the hops the entry already carries: an
    /// upstream reaches the device through us first, and through those relays after that.
    fn announcement_of(&self, entry: &Entry) -> Option<AnnouncedDevice> {
        // A downstream link is a hop, not a destination: announcing it would offer an address that
        // opens a relay rather than a workbench.
        if entry.device.kind == DeviceKind::Relay && matches!(entry.device.route, Route::Direct(_))
        {
            return None;
        }
        let mut via = Vec::with_capacity(entry.device.route.hops().len() + 1);
        via.push(self.relay_id.clone());
        via.extend(entry.device.route.hops().iter().cloned());
        Some(AnnouncedDevice {
            id: entry.device.device_id.clone(),
            name: entry.device.name.clone(),
            online: true,
            via,
        })
    }

    /// Turns "what this device looked like before and after an update" into the change to publish.
    fn transition(
        &self,
        device_id: &str,
        previous: Option<&Entry>,
        current: Option<&Entry>,
    ) -> Option<RegistryChange> {
        if let Some(announcement) = current.and_then(|entry| self.announcement_of(entry)) {
            return Some(RegistryChange::Online(announcement));
        }
        let was_announced = previous
            .and_then(|entry| self.announcement_of(entry))
            .is_some();
        was_announced.then(|| RegistryChange::Offline {
            device_id: device_id.to_string(),
        })
    }

    /// Publishes changes once the routing table's lock is gone. An error only means nothing is
    /// subscribed, which is the normal state of a relay without an upstream.
    fn publish(&self, changes: Vec<RegistryChange>) {
        for change in changes {
            let _ = self.changes.send(change);
        }
    }

    /// Registers a live tunnel, displacing whatever route the device had.
    ///
    /// A direct tunnel always wins: it is the shortest possible path and the only one whose
    /// credential this relay checked itself.
    pub fn connect(&self, presence: DirectPresence) -> Registration {
        let serial = self.next_sequence();
        let device_id = presence.device_id.clone();
        let (registration, change) = {
            let mut state = self.state();
            if let (Some(relay_id), DeviceKind::Relay) = (&presence.relay_id, presence.kind) {
                state
                    .relay_links
                    .insert(relay_id.clone(), device_id.clone());
            }
            let entry = Entry {
                device: OnlineDevice {
                    device_id: device_id.clone(),
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
            state.withdrawn.remove(&device_id);
            let previous = state.entries.insert(device_id.clone(), entry);
            let change =
                self.transition(&device_id, previous.as_ref(), state.entries.get(&device_id));
            let displaced = previous.and_then(|previous| match previous.origin {
                // Only a displaced *direct* tunnel has to be closed; an announced entry is just a
                // routing hint that the downstream relay still owns.
                Origin::Direct { .. } => Some(previous.device.route.link().clone()),
                Origin::Announced { .. } => None,
            });
            (Registration { serial, displaced }, change)
        };
        self.publish(change.into_iter().collect());
        registration
    }

    /// Removes a tunnel, but only if it is still the registered one.
    ///
    /// A device that reconnects faster than its previous tunnel task can finish tearing down would
    /// otherwise be evicted by the old task's cleanup.
    pub fn disconnect(&self, device_id: &str, serial: u64) -> bool {
        let changes = {
            let mut state = self.state();
            let matches = state
                .entries
                .get(device_id)
                .is_some_and(|entry| entry.origin == Origin::Direct { serial });
            if !matches {
                return false;
            }
            state
                .relay_links
                .retain(|_, link_device_id| link_device_id != device_id);
            // Nothing this link said is worth remembering once it is gone: the relay can no longer
            // tell an offline device from one that was never behind this link at all.
            state
                .withdrawn
                .retain(|_, withdrawn| withdrawn.link_device_id != device_id);
            // Everything this link announced is unreachable the moment the link is gone.
            let mut gone = vec![device_id.to_string()];
            gone.extend(Self::announced_ids_of(&state, device_id));
            gone.into_iter()
                .filter_map(|id| {
                    let entry = state.entries.remove(&id)?;
                    self.transition(&id, Some(&entry), None)
                })
                .collect()
        };
        self.publish(changes);
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

    /// What this relay remembers about a device it can no longer route to, for the offline page.
    pub fn last_known(&self, device_id: &str) -> Option<KnownDevice> {
        self.state()
            .withdrawn
            .get(device_id)
            .map(|withdrawn| withdrawn.device.clone())
    }

    /// Replaces everything one downstream relay had announced with a fresh snapshot.
    ///
    /// Installing first and withdrawing the leftovers afterwards is what keeps a device that is in
    /// both snapshots from flickering offline and back for everyone further up the chain.
    pub fn apply_announcement(
        &self,
        link_device_id: &str,
        link: &TunnelHandle,
        devices: Vec<AnnouncedDevice>,
    ) {
        let previous = Self::announced_ids_of(&self.state(), link_device_id);
        let mut installed = HashSet::new();
        for device in devices {
            if !device.online {
                continue;
            }
            let device_id = device.id.clone();
            if self.announce_device(link_device_id, link, device) {
                installed.insert(device_id);
            }
        }
        for stale in previous.into_iter().filter(|id| !installed.contains(id)) {
            self.withdraw_device(link_device_id, &stale);
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
        let device_id = device.id.clone();
        let route = Route::Via {
            link: link.clone(),
            hops: device.via,
        };
        let change = {
            let mut state = self.state();
            if let Some(existing) = state.entries.get(&device_id) {
                if !replaces(&existing.device.route, existing.sequence, &route, sequence) {
                    return false;
                }
            }
            state.withdrawn.remove(&device_id);
            let previous = state.entries.insert(
                device_id.clone(),
                Entry {
                    device: OnlineDevice {
                        device_id: device_id.clone(),
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
            self.transition(&device_id, previous.as_ref(), state.entries.get(&device_id))
        };
        self.publish(change.into_iter().collect());
        true
    }

    /// Withdraws one announced device, ignoring a withdrawal for a route another link owns.
    pub fn withdraw_device(&self, link_device_id: &str, device_id: &str) {
        let change = {
            let mut state = self.state();
            let owned = state.entries.get(device_id).is_some_and(
                |entry| matches!(&entry.origin, Origin::Announced { link_device_id: owner } if owner == link_device_id),
            );
            if !owned {
                return;
            }
            let removed = state.entries.remove(device_id);
            if let Some(entry) = &removed {
                state.withdrawn.insert(
                    device_id.to_string(),
                    WithdrawnDevice {
                        link_device_id: link_device_id.to_string(),
                        device: KnownDevice {
                            name: entry.device.name.clone(),
                            last_seen_at: now_millis(),
                        },
                    },
                );
            }
            removed.and_then(|entry| self.transition(device_id, Some(&entry), None))
        };
        self.publish(change.into_iter().collect());
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

    /// The devices one downstream link is currently the source of.
    fn announced_ids_of(state: &RegistryState, link_device_id: &str) -> Vec<String> {
        state
            .entries
            .iter()
            .filter(|(_, entry)| {
                matches!(&entry.origin, Origin::Announced { link_device_id: owner } if owner == link_device_id)
            })
            .map(|(device_id, _)| device_id.clone())
            .collect()
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

    /// What an upstream is offered: every destination, reached through this relay first. The link
    /// itself is a hop rather than a destination, so it is left out.
    #[test]
    fn an_announcement_names_this_relay_first_and_leaves_the_links_out() {
        let registry = registry();
        let link = presence("relay-link", DeviceKind::Relay, Some("relay-b"));
        let handle = link.handle.clone();
        registry.connect(link);
        registry.connect(presence("device-a", DeviceKind::Desktop, None));
        registry.apply_announcement(
            "relay-link",
            &handle,
            vec![announced("device-b", &["relay-b"])],
        );

        let mut announcements = registry.announcements();
        announcements.sort_by(|left, right| left.id.cmp(&right.id));

        assert_eq!(announcements.len(), 2, "下游链接本身不作为设备通告");
        assert_eq!(announcements[0].id, "device-a");
        assert_eq!(announcements[0].via, [RELAY_ID]);
        assert_eq!(announcements[1].id, "device-b");
        assert_eq!(announcements[1].via, [RELAY_ID, "relay-b"]);
        assert!(announcements.iter().all(|device| device.online));
    }

    #[test]
    fn a_tunnel_coming_up_and_going_down_is_published_to_subscribers() {
        let registry = registry();
        let mut changes = registry.subscribe();

        let registration = registry.connect(presence("device-a", DeviceKind::Desktop, None));
        registry.disconnect("device-a", registration.serial);

        assert!(matches!(
            changes.try_recv().expect("上线事件"),
            RegistryChange::Online(device) if device.id == "device-a" && device.via == [RELAY_ID]
        ));
        assert!(matches!(
            changes.try_recv().expect("下线事件"),
            RegistryChange::Offline { device_id } if device_id == "device-a"
        ));
    }

    /// Losing a link takes every device behind it offline, and the link is not itself announced.
    #[test]
    fn losing_a_link_publishes_a_withdrawal_for_everything_it_carried() {
        let registry = registry();
        let link = presence("relay-link", DeviceKind::Relay, Some("relay-b"));
        let handle = link.handle.clone();
        let registration = registry.connect(link);
        registry.apply_announcement(
            "relay-link",
            &handle,
            vec![announced("device-b", &["relay-b"])],
        );
        let mut changes = registry.subscribe();

        registry.disconnect("relay-link", registration.serial);

        let withdrawn: Vec<String> = std::iter::from_fn(|| changes.try_recv().ok())
            .map(|change| match change {
                RegistryChange::Offline { device_id } => device_id,
                RegistryChange::Online(device) => panic!("断开不应产生上线事件：{}", device.id),
            })
            .collect();
        assert_eq!(withdrawn, ["device-b"]);
    }

    /// An announced device has no row on this relay, so without this memory its address would turn
    /// from "offline" into "no such device" the moment the desktop behind it went away.
    #[test]
    fn a_withdrawn_device_is_remembered_while_its_link_is_up() {
        let registry = registry();
        let link = presence("relay-link", DeviceKind::Relay, Some("relay-b"));
        let handle = link.handle.clone();
        let registration = registry.connect(link);
        registry.announce_device("relay-link", &handle, announced("device-b", &["relay-b"]));

        registry.withdraw_device("relay-link", "device-b");

        let known = registry.last_known("device-b").expect("设备应当被记住");
        assert_eq!(known.name, "设备 device-b");
        assert!(known.last_seen_at > 0);
        assert!(registry.last_known("never-announced").is_none());

        // Coming back replaces the memory with a live route again.
        registry.announce_device("relay-link", &handle, announced("device-b", &["relay-b"]));
        assert!(registry.last_known("device-b").is_none());

        // And once the link is gone the relay can no longer vouch for anything it said.
        registry.withdraw_device("relay-link", "device-b");
        registry.disconnect("relay-link", registration.serial);
        assert!(registry.last_known("device-b").is_none());
    }

    /// A device present in two consecutive snapshots must not flicker: a withdrawal would take it
    /// offline for everyone further up the chain for no reason.
    #[test]
    fn a_repeated_snapshot_publishes_no_withdrawal_for_a_device_that_stayed() {
        let registry = registry();
        let handle = TunnelHandle::disconnected("relay-link");
        let snapshot = || {
            vec![
                announced("device-b", &["relay-b"]),
                announced("device-c", &["relay-b"]),
            ]
        };
        registry.apply_announcement("relay-link", &handle, snapshot());
        let mut changes = registry.subscribe();

        registry.apply_announcement("relay-link", &handle, snapshot());
        registry.apply_announcement(
            "relay-link",
            &handle,
            vec![announced("device-c", &["relay-b"])],
        );

        let published: Vec<RegistryChange> =
            std::iter::from_fn(|| changes.try_recv().ok()).collect();
        assert!(
            !published.iter().any(|change| matches!(
                change,
                RegistryChange::Offline { device_id } if device_id == "device-c"
            )),
            "两次快照都包含的设备不应被撤回：{published:?}"
        );
        assert!(published.iter().any(|change| matches!(
            change,
            RegistryChange::Offline { device_id } if device_id == "device-b"
        )));
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
