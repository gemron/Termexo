//! Devices: desktop apps and downstream relays that hold a credential issued by this relay.

use std::str::FromStr;

use rusqlite::{params, Row};
use serde::Serialize;
use termexo_relay_protocol::frames::DeviceKind;

use super::{now_millis, optional_text, Database, DatabaseError};

const DESKTOP_KIND: &str = "desktop";
const RELAY_KIND: &str = "relay";

const PUBLIC_ACCESS: &str = "public";
const RELAY_LOGIN_ACCESS: &str = "relay-login";

const DEVICE_COLUMNS: &str = "id, kind, name, owner_user_id, secret_hash, note, created_at, \
     revoked_at, last_seen_at, last_ip, last_version, access FROM devices";

/// The stored spelling of a device kind. `DeviceKind` lives in the shared crate and serializes the
/// same way on the wire, so the two never drift.
pub fn device_kind_label(kind: DeviceKind) -> &'static str {
    match kind {
        DeviceKind::Desktop => DESKTOP_KIND,
        DeviceKind::Relay => RELAY_KIND,
    }
}

fn parse_device_kind(value: &str) -> Result<DeviceKind, DatabaseError> {
    match value {
        DESKTOP_KIND => Ok(DeviceKind::Desktop),
        RELAY_KIND => Ok(DeviceKind::Relay),
        other => Err(DatabaseError::UnknownValue {
            field: "devices.kind",
            value: other.to_string(),
        }),
    }
}

/// Who the relay lets through to `/d/<deviceId>/` at all.
///
/// It decides reachability only. Whether a browser that got through may *operate* the workbench is
/// still the desktop's access token's question — the two gates are deliberately independent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeviceAccess {
    /// Anyone who has the link reaches the device; the desktop's token is the only gate.
    #[default]
    Public,
    /// The browser must hold a console session that owns or administers this device.
    RelayLogin,
}

impl DeviceAccess {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Public => PUBLIC_ACCESS,
            Self::RelayLogin => RELAY_LOGIN_ACCESS,
        }
    }

    /// Whether reaching the device needs a console session at all.
    pub fn requires_console_session(self) -> bool {
        matches!(self, Self::RelayLogin)
    }
}

/// The one sentence an unrecognised value is reported with, wherever it came from.
pub const UNKNOWN_ACCESS_MESSAGE: &str = "设备访问策略只能是 public 或 relay-login。";

impl FromStr for DeviceAccess {
    type Err = &'static str;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim() {
            PUBLIC_ACCESS => Ok(Self::Public),
            RELAY_LOGIN_ACCESS => Ok(Self::RelayLogin),
            _ => Err(UNKNOWN_ACCESS_MESSAGE),
        }
    }
}

#[derive(Debug, Clone)]
pub struct DeviceRecord {
    pub id: String,
    pub kind: DeviceKind,
    pub name: String,
    pub owner_user_id: Option<String>,
    pub secret_hash: String,
    pub note: Option<String>,
    pub created_at: i64,
    pub revoked_at: Option<i64>,
    pub last_seen_at: Option<i64>,
    pub last_ip: Option<String>,
    pub last_version: Option<String>,
    pub access: DeviceAccess,
}

impl DeviceRecord {
    pub fn is_revoked(&self) -> bool {
        self.revoked_at.is_some()
    }

    /// Whether one console account may reach this device when it is not public.
    ///
    /// Ownership is what the relay knows about a device; an administrator runs the relay and can
    /// revoke the device outright, so withholding the page from them would protect nothing.
    pub fn is_reachable_by(&self, user_id: &str, is_admin: bool) -> bool {
        is_admin || self.owner_user_id.as_deref() == Some(user_id)
    }
}

/// What the console may change about a device. Identity, ownership and the secret are decided at
/// enrollment and never edited.
#[derive(Debug, Default)]
pub struct DeviceUpdate {
    pub name: Option<String>,
    pub note: Option<String>,
    pub access: Option<DeviceAccess>,
}

impl DeviceUpdate {
    pub fn is_empty(&self) -> bool {
        self.name.is_none() && self.note.is_none() && self.access.is_none()
    }
}

/// Everything a new device row needs, so the insert does not take seven positional arguments.
pub struct NewDevice<'a> {
    pub id: &'a str,
    pub kind: DeviceKind,
    pub name: &'a str,
    pub owner_user_id: Option<&'a str>,
    pub secret_hash: &'a str,
    pub note: Option<&'a str>,
}

impl Database {
    pub fn create_device(&self, device: NewDevice<'_>) -> Result<DeviceRecord, DatabaseError> {
        let record = DeviceRecord {
            id: device.id.to_string(),
            kind: device.kind,
            name: device.name.to_string(),
            owner_user_id: device.owner_user_id.map(str::to_string),
            secret_hash: device.secret_hash.to_string(),
            note: device.note.map(str::to_string),
            created_at: now_millis(),
            revoked_at: None,
            last_seen_at: None,
            last_ip: None,
            last_version: None,
            // Reachable by anyone holding the link, which is what the address was made for; an
            // operator tightens it afterwards on the device that needs it.
            access: DeviceAccess::default(),
        };
        self.connection().execute(
            "INSERT INTO devices (id, kind, name, owner_user_id, secret_hash, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                record.id,
                device_kind_label(record.kind),
                record.name,
                record.owner_user_id,
                record.secret_hash,
                record.note,
                record.created_at
            ],
        )?;
        Ok(record)
    }

    pub fn find_device(&self, id: &str) -> Result<Option<DeviceRecord>, DatabaseError> {
        let connection = self.connection();
        let mut statement =
            connection.prepare(&("SELECT ".to_string() + DEVICE_COLUMNS + " WHERE id = ?1"))?;
        let mut rows = statement.query_map(params![id], read_device_row)?;
        rows.next().transpose()?.transpose()
    }

    pub fn list_devices(&self) -> Result<Vec<DeviceRecord>, DatabaseError> {
        self.query_devices(
            &("SELECT ".to_string() + DEVICE_COLUMNS + " ORDER BY created_at DESC"),
            params![],
        )
    }

    pub fn list_devices_owned_by(&self, owner: &str) -> Result<Vec<DeviceRecord>, DatabaseError> {
        self.query_devices(
            &("SELECT ".to_string()
                + DEVICE_COLUMNS
                + " WHERE owner_user_id = ?1 ORDER BY created_at DESC"),
            params![owner],
        )
    }

    pub fn update_device(&self, id: &str, update: &DeviceUpdate) -> Result<(), DatabaseError> {
        let connection = self.connection();
        if let Some(name) = &update.name {
            connection.execute(
                "UPDATE devices SET name = ?2 WHERE id = ?1",
                params![id, name],
            )?;
        }
        if let Some(note) = &update.note {
            connection.execute(
                "UPDATE devices SET note = ?2 WHERE id = ?1",
                params![id, optional_text(Some(note.clone()))],
            )?;
        }
        if let Some(access) = update.access {
            connection.execute(
                "UPDATE devices SET access = ?2 WHERE id = ?1",
                params![id, access.as_str()],
            )?;
        }
        Ok(())
    }

    /// Marks a device revoked. Revocation is permanent, so a device that is already revoked keeps
    /// its original timestamp and the call reports that nothing changed.
    pub fn revoke_device(&self, id: &str) -> Result<bool, DatabaseError> {
        let changed = self.connection().execute(
            "UPDATE devices SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL",
            params![id, now_millis()],
        )?;
        Ok(changed > 0)
    }

    /// Revokes every device of one owner and reports which ones this call actually revoked, so the
    /// caller knows exactly which tunnels to close.
    pub fn revoke_devices_owned_by(&self, owner: &str) -> Result<Vec<String>, DatabaseError> {
        let revoked: Vec<String> = self
            .list_devices_owned_by(owner)?
            .into_iter()
            .filter(|device| !device.is_revoked())
            .map(|device| device.id)
            .collect();
        for id in &revoked {
            self.revoke_device(id)?;
        }
        Ok(revoked)
    }

    /// Detaches every device of one owner, keeping the rows themselves.
    ///
    /// Deleting an account must not delete the history of the devices it enrolled — the audit trail
    /// refers to them by id — and `devices.owner_user_id` is a foreign key, so the rows have to lose
    /// their owner before the account row can go.
    pub fn disown_devices_of(&self, owner: &str) -> Result<(), DatabaseError> {
        self.connection().execute(
            "UPDATE devices SET owner_user_id = NULL WHERE owner_user_id = ?1",
            params![owner],
        )?;
        Ok(())
    }

    /// Records what the relay learned from an accepted `hello`.
    pub fn record_device_connection(
        &self,
        id: &str,
        ip: &str,
        version: &str,
    ) -> Result<(), DatabaseError> {
        self.connection().execute(
            "UPDATE devices SET last_seen_at = ?2, last_ip = ?3, last_version = ?4 WHERE id = ?1",
            params![id, now_millis(), ip, version],
        )?;
        Ok(())
    }

    /// Online state itself lives in the registry; only the moment the tunnel ended is persisted, so
    /// the console can still say when a device was last reachable after a restart.
    pub fn record_device_disconnection(&self, id: &str) -> Result<(), DatabaseError> {
        self.connection().execute(
            "UPDATE devices SET last_seen_at = ?2 WHERE id = ?1",
            params![id, now_millis()],
        )?;
        Ok(())
    }

    fn query_devices(
        &self,
        sql: &str,
        arguments: impl rusqlite::Params,
    ) -> Result<Vec<DeviceRecord>, DatabaseError> {
        let connection = self.connection();
        let mut statement = connection.prepare(sql)?;
        let rows = statement.query_map(arguments, read_device_row)?;
        rows.collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .collect::<Result<Vec<_>, _>>()
    }
}

fn read_device_row(row: &Row<'_>) -> rusqlite::Result<Result<DeviceRecord, DatabaseError>> {
    let id: String = row.get(0)?;
    let kind: String = row.get(1)?;
    let name: String = row.get(2)?;
    let owner_user_id: Option<String> = row.get(3)?;
    let secret_hash: String = row.get(4)?;
    let note: Option<String> = row.get(5)?;
    let created_at: i64 = row.get(6)?;
    let revoked_at: Option<i64> = row.get(7)?;
    let last_seen_at: Option<i64> = row.get(8)?;
    let last_ip: Option<String> = row.get(9)?;
    let last_version: Option<String> = row.get(10)?;
    let access: String = row.get(11)?;
    Ok(
        parse_device_row(&kind, &access).map(|(kind, access)| DeviceRecord {
            id,
            kind,
            name,
            owner_user_id,
            secret_hash,
            note: optional_text(note),
            created_at,
            revoked_at,
            last_seen_at,
            last_ip: optional_text(last_ip),
            last_version: optional_text(last_version),
            access,
        }),
    )
}

/// The two stored enumerations of one row, refused together so a corrupted value is reported once
/// rather than silently read as the permissive default.
fn parse_device_row(kind: &str, access: &str) -> Result<(DeviceKind, DeviceAccess), DatabaseError> {
    let kind = parse_device_kind(kind)?;
    let access = DeviceAccess::from_str(access).map_err(|_| DatabaseError::UnknownValue {
        field: "devices.access",
        value: access.to_string(),
    })?;
    Ok((kind, access))
}

#[cfg(test)]
mod tests {
    use termexo_relay_protocol::credential::DeviceCredential;

    use super::super::UserRole;
    use super::*;

    fn database() -> Database {
        Database::open_in_memory().expect("the database should open")
    }

    fn insert(database: &Database, owner: Option<&str>) -> DeviceRecord {
        let credential = DeviceCredential::generate().expect("a credential");
        database
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
    fn a_created_device_is_read_back_with_its_kind() {
        let database = database();

        let created = insert(&database, None);
        let found = database
            .find_device(&created.id)
            .expect("the lookup should work")
            .expect("the device should exist");

        assert_eq!(found.kind, DeviceKind::Desktop);
        assert_eq!(found.name, "书房台式机");
        assert!(!found.is_revoked());
        assert_eq!(database.list_devices().expect("a list").len(), 1);
    }

    #[test]
    fn revoking_is_permanent_and_reported_once() {
        let database = database();
        let created = insert(&database, None);

        assert!(database.revoke_device(&created.id).expect("a revoke"));
        assert!(!database.revoke_device(&created.id).expect("a second one"));
        assert!(database
            .find_device(&created.id)
            .expect("the lookup should work")
            .expect("the device should exist")
            .is_revoked());
    }

    #[test]
    fn disabling_an_owner_revokes_only_their_live_devices() {
        let database = database();
        let owner = database
            .create_user("alice", "hash", UserRole::User)
            .expect("a user");
        let mine = insert(&database, Some(&owner.id));
        let already_revoked = insert(&database, Some(&owner.id));
        let someone_elses = insert(&database, None);
        database
            .revoke_device(&already_revoked.id)
            .expect("a revoke");

        let revoked = database
            .revoke_devices_owned_by(&owner.id)
            .expect("the cascade should run");

        assert_eq!(revoked, vec![mine.id]);
        assert!(!database
            .find_device(&someone_elses.id)
            .expect("the lookup should work")
            .expect("the device should exist")
            .is_revoked());
    }

    #[test]
    fn an_access_policy_reads_back_from_the_two_spellings_it_is_stored_under() {
        assert_eq!(DeviceAccess::from_str("public"), Ok(DeviceAccess::Public));
        assert_eq!(
            DeviceAccess::from_str("  relay-login "),
            Ok(DeviceAccess::RelayLogin)
        );
        assert_eq!(
            DeviceAccess::from_str("relayLogin"),
            Err(UNKNOWN_ACCESS_MESSAGE)
        );
        assert_eq!(DeviceAccess::default(), DeviceAccess::Public);
        assert_eq!(DeviceAccess::RelayLogin.as_str(), "relay-login");
        assert!(DeviceAccess::RelayLogin.requires_console_session());
        assert!(!DeviceAccess::Public.requires_console_session());
    }

    #[test]
    fn a_device_starts_public_and_keeps_whatever_the_console_set() {
        let database = database();
        let created = insert(&database, None);
        assert_eq!(created.access, DeviceAccess::Public);

        database
            .update_device(
                &created.id,
                &DeviceUpdate {
                    access: Some(DeviceAccess::RelayLogin),
                    ..Default::default()
                },
            )
            .expect("the update should apply");

        assert_eq!(
            database
                .find_device(&created.id)
                .expect("the lookup should work")
                .expect("the device should exist")
                .access,
            DeviceAccess::RelayLogin
        );
    }

    /// An administrator runs the relay and can revoke the device anyway, so the gate is about the
    /// owner; everybody else is kept out even when they hold a console session.
    #[test]
    fn a_restricted_device_is_reachable_by_its_owner_and_by_an_administrator() {
        let database = database();
        let owner = database
            .create_user("alice", "hash", UserRole::User)
            .expect("a user");
        let device = insert(&database, Some(&owner.id));

        assert!(device.is_reachable_by(&owner.id, false));
        assert!(device.is_reachable_by("someone-else", true));
        assert!(!device.is_reachable_by("someone-else", false));
        assert!(!insert(&database, None).is_reachable_by("someone-else", false));
    }

    #[test]
    fn a_connection_records_the_address_and_version() {
        let database = database();
        let created = insert(&database, None);

        database
            .record_device_connection(&created.id, "203.0.113.5", "0.9.0")
            .expect("the connection should be recorded");

        let found = database
            .find_device(&created.id)
            .expect("the lookup should work")
            .expect("the device should exist");
        assert_eq!(found.last_ip.as_deref(), Some("203.0.113.5"));
        assert_eq!(found.last_version.as_deref(), Some("0.9.0"));
        assert!(found.last_seen_at.is_some());
    }
}
