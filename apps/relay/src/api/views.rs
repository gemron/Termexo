//! The JSON shapes the console reads. Field names are part of the contract with the console
//! application, so they are defined once here and never assembled ad hoc in a handler.

use std::collections::HashMap;

use serde::Serialize;
use termexo_relay_protocol::frames::DeviceKind;

use super::error::ApiResult;
use crate::db::{
    now_millis, AuditRecord, DeviceRecord, EnrollmentRecord, EnrollmentStatus, UserRecord, UserRole,
};
use crate::registry::OnlineDevice;
use crate::state::RelayState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserView {
    pub id: String,
    pub username: String,
    pub role: UserRole,
    pub disabled: bool,
    pub created_at: i64,
    pub last_login_at: Option<i64>,
    pub device_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub id: String,
    pub kind: DeviceKind,
    pub name: String,
    pub owner_user_id: Option<String>,
    pub owner_username: Option<String>,
    pub online: bool,
    pub connected_since: Option<i64>,
    pub last_seen_at: Option<i64>,
    pub last_ip: Option<String>,
    pub last_version: Option<String>,
    /// The relay ids a stream to this device crosses; empty for a directly attached one.
    pub via: Vec<String>,
    /// The same hops rendered with the downstream relays' names, for the console's table.
    pub via_names: Vec<String>,
    pub revoked_at: Option<i64>,
    pub note: Option<String>,
    pub access_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentView {
    pub id: String,
    pub kind: DeviceKind,
    pub owner_user_id: Option<String>,
    pub owner_username: Option<String>,
    pub note: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub used_at: Option<i64>,
    pub used_by_device_id: Option<String>,
    pub status: EnrollmentStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditView {
    pub id: i64,
    pub at: i64,
    pub actor_kind: String,
    pub actor_id: Option<String>,
    pub action: String,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub ip: Option<String>,
    pub detail: Option<String>,
}

impl From<AuditRecord> for AuditView {
    fn from(record: AuditRecord) -> Self {
        Self {
            id: record.id,
            at: record.at,
            actor_kind: record.actor_kind,
            actor_id: record.actor_id,
            action: record.action,
            target_kind: record.target_kind,
            target_id: record.target_id,
            ip: record.ip,
            detail: record.detail,
        }
    }
}

/// Everything a list of views needs that is not in the row itself: who owns what, and what is
/// online. Built once per request so a hundred devices do not mean a hundred lookups.
pub struct ViewContext<'a> {
    state: &'a RelayState,
    usernames: HashMap<String, String>,
    online: HashMap<String, OnlineDevice>,
}

impl<'a> ViewContext<'a> {
    pub fn build(state: &'a RelayState) -> ApiResult<Self> {
        let usernames = state
            .database
            .list_users()?
            .into_iter()
            .map(|user| (user.id, user.username))
            .collect();
        let online = state
            .registry
            .snapshot()
            .into_iter()
            .map(|device| (device.device_id.clone(), device))
            .collect();
        Ok(Self {
            state,
            usernames,
            online,
        })
    }

    pub fn user(&self, user: &UserRecord, device_count: usize) -> UserView {
        UserView {
            id: user.id.clone(),
            username: user.username.clone(),
            role: user.role,
            disabled: user.disabled,
            created_at: user.created_at,
            last_login_at: user.last_login_at,
            device_count,
        }
    }

    pub fn device(&self, record: &DeviceRecord) -> DeviceView {
        let live = self.online.get(&record.id);
        let hops: Vec<String> = live
            .map(|device| device.route.hops().to_vec())
            .unwrap_or_default();
        DeviceView {
            id: record.id.clone(),
            kind: record.kind,
            name: record.name.clone(),
            owner_user_id: record.owner_user_id.clone(),
            owner_username: self.username_of(record.owner_user_id.as_deref()),
            online: live.is_some(),
            connected_since: live.map(|device| device.connected_since),
            last_seen_at: record.last_seen_at,
            // While a device is connected the live address is the truthful one; the stored column
            // only catches up when the tunnel ends.
            last_ip: live
                .and_then(|device| device.ip.clone())
                .or_else(|| record.last_ip.clone()),
            last_version: live
                .and_then(|device| device.version.clone())
                .or_else(|| record.last_version.clone()),
            via_names: self.state.registry.hop_names(&hops),
            via: hops,
            revoked_at: record.revoked_at,
            note: record.note.clone(),
            access_url: self.state.device_access_url(&record.id),
        }
    }

    /// A device this relay only knows about because a downstream relay announced it.
    ///
    /// It has no row of its own: ownership and revocation belong to the relay the device actually
    /// enrolled with, and this relay is only allowed to route to it.
    pub fn announced_device(&self, device: &OnlineDevice) -> DeviceView {
        let hops = device.route.hops().to_vec();
        DeviceView {
            id: device.device_id.clone(),
            kind: device.kind,
            name: device.name.clone(),
            owner_user_id: None,
            owner_username: None,
            online: true,
            connected_since: Some(device.connected_since),
            last_seen_at: Some(device.connected_since),
            last_ip: None,
            last_version: None,
            via_names: self.state.registry.hop_names(&hops),
            via: hops,
            revoked_at: None,
            note: None,
            access_url: self.state.device_access_url(&device.device_id),
        }
    }

    /// Announced devices that have no row here, in the order the console shows them.
    pub fn announced_only(&self, known: &[DeviceRecord]) -> Vec<DeviceView> {
        let mut views: Vec<DeviceView> = self
            .online
            .values()
            .filter(|device| !device.route.hops().is_empty())
            .filter(|device| !known.iter().any(|record| record.id == device.device_id))
            .map(|device| self.announced_device(device))
            .collect();
        views.sort_by(|left, right| left.name.cmp(&right.name));
        views
    }

    pub fn enrollment(&self, record: &EnrollmentRecord) -> EnrollmentView {
        EnrollmentView {
            id: record.id.clone(),
            kind: record.kind,
            owner_user_id: record.owner_user_id.clone(),
            owner_username: self.username_of(record.owner_user_id.as_deref()),
            note: record.note.clone(),
            created_by: record.created_by.clone(),
            created_at: record.created_at,
            expires_at: record.expires_at,
            used_at: record.used_at,
            used_by_device_id: record.used_by_device_id.clone(),
            status: record.status(now_millis()),
        }
    }

    fn username_of(&self, user_id: Option<&str>) -> Option<String> {
        user_id.and_then(|id| self.usernames.get(id).cloned())
    }
}

/// How many live devices an account owns, for [`UserView::device_count`].
///
/// Revoked devices are left out: the number is meant to answer "what would disabling this account
/// take offline", and a revoked device is already offline.
pub fn live_device_count(devices: &[DeviceRecord]) -> usize {
    devices.iter().filter(|device| !device.is_revoked()).count()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use termexo_relay_protocol::credential::DeviceCredential;

    use super::*;
    use crate::auth::LockoutTable;
    use crate::db::{Database, NewDevice};
    use crate::proxy::Proxy;
    use crate::registry::{DirectPresence, Registry};
    use crate::tunnel::TunnelHandle;

    fn state() -> RelayState {
        let registry = Arc::new(Registry::new("relay-a".into()));
        RelayState {
            database: Database::open_in_memory().expect("the database should open"),
            proxy: Proxy::new(registry.clone(), "relay-a"),
            registry,
            lockout: LockoutTable::new(),
            relay_id: "relay-a".into(),
            public_url: "https://relay.example.com".parse().expect("a public url"),
            trusted_proxies: Vec::new(),
            tls_enabled: true,
        }
    }

    fn device(state: &RelayState, owner: Option<&str>) -> DeviceRecord {
        let credential = DeviceCredential::generate().expect("a credential");
        state
            .database
            .create_device(NewDevice {
                id: credential.device_id.as_str(),
                kind: DeviceKind::Desktop,
                name: "书房台式机",
                owner_user_id: owner,
                secret_hash: &credential.secret_hash(),
                note: None,
            })
            .expect("the device should be created")
    }

    #[test]
    fn a_device_view_carries_the_public_address_and_the_owner_name() {
        let state = state();
        let owner = state
            .database
            .create_user("alice", "hash", UserRole::User)
            .expect("a user");
        let record = device(&state, Some(&owner.id));

        let context = ViewContext::build(&state).expect("the context should build");
        let view = context.device(&record);

        assert_eq!(
            view.access_url,
            format!("https://relay.example.com/d/{}/", record.id)
        );
        assert_eq!(view.owner_username.as_deref(), Some("alice"));
        assert!(!view.online);
        assert!(view.via.is_empty());
    }

    #[test]
    fn a_connected_device_reports_the_live_address_and_no_hops() {
        let state = state();
        let record = device(&state, None);
        state.registry.connect(DirectPresence {
            device_id: record.id.clone(),
            name: record.name.clone(),
            kind: DeviceKind::Desktop,
            relay_id: None,
            ip: Some("203.0.113.5".into()),
            version: Some("0.9.0".into()),
            handle: TunnelHandle::disconnected(&record.id),
        });

        let context = ViewContext::build(&state).expect("the context should build");
        let view = context.device(&record);

        assert!(view.online);
        assert_eq!(view.last_ip.as_deref(), Some("203.0.113.5"));
        assert_eq!(view.last_version.as_deref(), Some("0.9.0"));
        assert!(view.connected_since.is_some());
    }

    #[test]
    fn an_announced_device_appears_only_when_it_has_no_row_of_its_own() {
        let state = state();
        let link = TunnelHandle::disconnected("relay-link");
        state.registry.announce_device(
            "relay-link",
            &link,
            termexo_relay_protocol::frames::AnnouncedDevice {
                id: "announced-device".into(),
                name: "办公室电脑".into(),
                online: true,
                via: vec!["relay-b".into()],
            },
        );
        let known = vec![device(&state, None)];

        let context = ViewContext::build(&state).expect("the context should build");
        let announced = context.announced_only(&known);

        assert_eq!(announced.len(), 1);
        assert_eq!(announced[0].id, "announced-device");
        assert_eq!(announced[0].via, vec!["relay-b".to_string()]);
        assert!(announced[0].owner_user_id.is_none());
        assert!(announced[0].online);
    }

    #[test]
    fn only_live_devices_count_towards_an_account() {
        let state = state();
        let owner = state
            .database
            .create_user("alice", "hash", UserRole::User)
            .expect("a user");
        let live = device(&state, Some(&owner.id));
        let revoked = device(&state, Some(&owner.id));
        state
            .database
            .revoke_device(&revoked.id)
            .expect("the revoke should apply");

        let devices = state
            .database
            .list_devices_owned_by(&owner.id)
            .expect("a list");

        assert_eq!(live_device_count(&devices), 1);
        assert!(devices.iter().any(|device| device.id == live.id));
    }
}
