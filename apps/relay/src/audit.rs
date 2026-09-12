//! The audit trail: which action names exist and how a row is written.
//!
//! Auditing is a side effect of a request, never its purpose, so a failed write is logged and
//! swallowed instead of turning a successful revocation into a 500. `detail` carries a compact JSON
//! object and must never hold a password, a credential, an enrollment code or a cookie.

use std::net::IpAddr;

use serde_json::{Map, Value};

use crate::db::{now_millis, AuditRecord, Database};

/// Action names. They are part of the console's contract, so they are spelled once here.
pub mod action {
    pub const LOGIN: &str = "login";
    pub const LOGIN_FAILED: &str = "login-failed";
    pub const ENROLL: &str = "enroll";
    pub const ENROLL_FAILED: &str = "enroll-failed";
    pub const DEVICE_REVOKED: &str = "device-revoked";
    pub const DEVICE_DISCONNECTED: &str = "device-disconnected";
    pub const DEVICE_UPDATED: &str = "device-updated";
    /// Who may reach a device through the relay changed: `public` ⇄ `relay-login`.
    pub const DEVICE_ACCESS_CHANGED: &str = "device-access-changed";
    pub const TUNNEL_CONNECTED: &str = "tunnel-connected";
    pub const TUNNEL_DISCONNECTED: &str = "tunnel-disconnected";
    pub const TUNNEL_REJECTED: &str = "tunnel-rejected";
    pub const USER_CREATED: &str = "user-created";
    pub const USER_UPDATED: &str = "user-updated";
    pub const USER_DELETED: &str = "user-deleted";
    pub const ENROLLMENT_CREATED: &str = "enrollment-created";
    pub const ENROLLMENT_CANCELLED: &str = "enrollment-cancelled";
    pub const BOOTSTRAP_ADMIN: &str = "bootstrap-admin";
    /// An operator configured an upstream; the credential exchange had already succeeded.
    pub const UPSTREAM_LINKED: &str = "upstream-linked";
    pub const UPSTREAM_UNLINKED: &str = "upstream-unlinked";
    pub const UPSTREAM_CONNECTED: &str = "upstream-connected";
    pub const UPSTREAM_DISCONNECTED: &str = "upstream-disconnected";
    /// The upstream's chain already contained this relay, so joining it would have made a loop.
    pub const UPSTREAM_LOOP_REFUSED: &str = "upstream-loop-refused";
    /// The upstream withdrew this relay's access; the stored credential was dropped with it.
    pub const UPSTREAM_REVOKED: &str = "upstream-revoked";
}

/// Target kinds, for the console's object filter.
pub mod target {
    pub const USER: &str = "user";
    pub const DEVICE: &str = "device";
    pub const ENROLLMENT: &str = "enrollment";
    /// Another relay, named by its relay id rather than by a device row of this relay's.
    pub const RELAY: &str = "relay";
}

const ACTOR_USER: &str = "user";
const ACTOR_DEVICE: &str = "device";
const ACTOR_SYSTEM: &str = "system";

/// Who caused the event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActorKind {
    /// A logged-in console account.
    User,
    /// A device presenting its credential.
    Device,
    /// The relay itself, with nobody to attribute it to.
    System,
}

impl ActorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => ACTOR_USER,
            Self::Device => ACTOR_DEVICE,
            Self::System => ACTOR_SYSTEM,
        }
    }
}

/// One event, built with the chained setters so a call site only names what it actually knows.
#[derive(Debug, Clone)]
pub struct AuditEntry {
    actor_kind: ActorKind,
    actor_id: Option<String>,
    action: &'static str,
    target_kind: Option<&'static str>,
    target_id: Option<String>,
    ip: Option<String>,
    detail: Map<String, Value>,
}

impl AuditEntry {
    pub fn new(actor_kind: ActorKind, action: &'static str) -> Self {
        Self {
            actor_kind,
            actor_id: None,
            action,
            target_kind: None,
            target_id: None,
            ip: None,
            detail: Map::new(),
        }
    }

    pub fn by_user(user_id: &str, action: &'static str) -> Self {
        Self::new(ActorKind::User, action).actor(user_id)
    }

    pub fn by_device(device_id: &str, action: &'static str) -> Self {
        Self::new(ActorKind::Device, action)
            .actor(device_id)
            .target(target::DEVICE, device_id)
    }

    pub fn by_system(action: &'static str) -> Self {
        Self::new(ActorKind::System, action)
    }

    pub fn actor(mut self, actor_id: &str) -> Self {
        self.actor_id = Some(actor_id.to_string());
        self
    }

    pub fn target(mut self, kind: &'static str, id: &str) -> Self {
        self.target_kind = Some(kind);
        self.target_id = Some(id.to_string());
        self
    }

    pub fn from_ip(mut self, ip: IpAddr) -> Self {
        self.ip = Some(ip.to_string());
        self
    }

    /// Adds one non-secret field to the event's detail object.
    pub fn detail(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.detail.insert(key.to_string(), value.into());
        self
    }

    fn into_record(self) -> AuditRecord {
        AuditRecord {
            // The column is `AUTOINCREMENT`, so the value here is ignored on insert.
            id: 0,
            at: now_millis(),
            actor_kind: self.actor_kind.as_str().to_string(),
            actor_id: self.actor_id,
            action: self.action.to_string(),
            target_kind: self.target_kind.map(str::to_string),
            target_id: self.target_id,
            ip: self.ip,
            detail: (!self.detail.is_empty()).then(|| Value::Object(self.detail).to_string()),
        }
    }
}

/// Writes one event, reporting a failure to the log instead of to the caller.
pub fn record(database: &Database, entry: AuditEntry) {
    let record = entry.into_record();
    if let Err(error) = database.write_audit(&record) {
        tracing::warn!(%error, action = %record.action, "审计事件写入失败");
    }
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use super::*;
    use crate::db::AuditQuery;

    #[test]
    fn an_entry_becomes_a_row_with_a_json_detail() {
        let database = Database::open_in_memory().expect("the database should open");

        record(
            &database,
            AuditEntry::by_user("user-1", action::USER_CREATED)
                .target(target::USER, "user-2")
                .from_ip(IpAddr::V4(Ipv4Addr::new(203, 0, 113, 5)))
                .detail("username", "alice"),
        );

        let events = database
            .list_audit(&AuditQuery {
                limit: 10,
                ..AuditQuery::default()
            })
            .expect("the list should work");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].actor_kind, "user");
        assert_eq!(events[0].actor_id.as_deref(), Some("user-1"));
        assert_eq!(events[0].target_kind.as_deref(), Some("user"));
        assert_eq!(events[0].ip.as_deref(), Some("203.0.113.5"));
        assert_eq!(events[0].detail.as_deref(), Some(r#"{"username":"alice"}"#));
    }

    #[test]
    fn an_entry_without_detail_stores_no_detail_at_all() {
        let database = Database::open_in_memory().expect("the database should open");

        record(&database, AuditEntry::by_system(action::BOOTSTRAP_ADMIN));

        let events = database
            .list_audit(&AuditQuery {
                limit: 10,
                ..AuditQuery::default()
            })
            .expect("the list should work");
        assert_eq!(events[0].detail, None);
        assert_eq!(events[0].actor_kind, "system");
    }

    #[test]
    fn a_device_entry_is_its_own_target() {
        let entry = AuditEntry::by_device("device-a", action::TUNNEL_CONNECTED).into_record();

        assert_eq!(entry.actor_id.as_deref(), Some("device-a"));
        assert_eq!(entry.target_id.as_deref(), Some("device-a"));
        assert_eq!(entry.target_kind.as_deref(), Some(target::DEVICE));
    }
}
