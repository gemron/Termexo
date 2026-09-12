//! Storage for the audit trail. What gets written and under which action name is decided in
//! `crate::audit`; this module only reads and writes rows.

use rusqlite::{params, Row};

use super::{optional_text, Database, DatabaseError};

const AUDIT_COLUMNS: &str =
    "id, at, actor_kind, actor_id, action, target_kind, target_id, ip, detail FROM audit_events";

/// Upper bound on one page of the audit list, so a console bug cannot ask for the whole table.
pub const MAX_AUDIT_PAGE: u32 = 500;

#[derive(Debug, Clone)]
pub struct AuditRecord {
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

/// How the console narrows the audit list: a page size, a cursor and an object filter.
#[derive(Debug, Default)]
pub struct AuditQuery {
    pub limit: u32,
    /// Only events older than this id, which is how the console pages backwards in time.
    pub before_id: Option<i64>,
    pub target_id: Option<String>,
}

impl Database {
    pub fn write_audit(&self, record: &AuditRecord) -> Result<(), DatabaseError> {
        self.connection().execute(
            "INSERT INTO audit_events (at, actor_kind, actor_id, action, target_kind, target_id, ip, detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                record.at,
                record.actor_kind,
                record.actor_id,
                record.action,
                record.target_kind,
                record.target_id,
                record.ip,
                record.detail
            ],
        )?;
        Ok(())
    }

    pub fn list_audit(&self, query: &AuditQuery) -> Result<Vec<AuditRecord>, DatabaseError> {
        let limit = query.limit.clamp(1, MAX_AUDIT_PAGE);
        let connection = self.connection();
        // Both filters are expressed as always-true comparisons when absent, so one statement
        // covers every combination instead of four assembled variants.
        let mut statement = connection.prepare(
            &("SELECT ".to_string()
                + AUDIT_COLUMNS
                + " WHERE (?1 IS NULL OR id < ?1) AND (?2 IS NULL OR target_id = ?2)
                   ORDER BY id DESC LIMIT ?3"),
        )?;
        let rows = statement.query_map(
            params![query.before_id, query.target_id, limit],
            read_audit_row,
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(DatabaseError::from)
    }
}

fn read_audit_row(row: &Row<'_>) -> rusqlite::Result<AuditRecord> {
    Ok(AuditRecord {
        id: row.get(0)?,
        at: row.get(1)?,
        actor_kind: row.get(2)?,
        actor_id: optional_text(row.get(3)?),
        action: row.get(4)?,
        target_kind: optional_text(row.get(5)?),
        target_id: optional_text(row.get(6)?),
        ip: optional_text(row.get(7)?),
        detail: optional_text(row.get(8)?),
    })
}

#[cfg(test)]
mod tests {
    use super::super::now_millis;
    use super::*;

    fn record(action: &str, target: Option<&str>) -> AuditRecord {
        AuditRecord {
            id: 0,
            at: now_millis(),
            actor_kind: "user".into(),
            actor_id: Some("user-1".into()),
            action: action.into(),
            target_kind: target.map(|_| "device".to_string()),
            target_id: target.map(str::to_string),
            ip: Some("203.0.113.5".into()),
            detail: None,
        }
    }

    fn database() -> Database {
        Database::open_in_memory().expect("the database should open")
    }

    #[test]
    fn events_come_back_newest_first() {
        let database = database();
        database.write_audit(&record("login", None)).expect("write");
        database
            .write_audit(&record("device-revoked", Some("device-a")))
            .expect("write");

        let events = database
            .list_audit(&AuditQuery {
                limit: 10,
                ..AuditQuery::default()
            })
            .expect("the list should work");

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].action, "device-revoked");
        assert_eq!(events[1].action, "login");
    }

    #[test]
    fn the_cursor_and_the_object_filter_narrow_the_page() {
        let database = database();
        for _ in 0..3 {
            database
                .write_audit(&record("device-revoked", Some("device-a")))
                .expect("write");
            database.write_audit(&record("login", None)).expect("write");
        }

        let first_page = database
            .list_audit(&AuditQuery {
                limit: 2,
                ..AuditQuery::default()
            })
            .expect("the list should work");
        let next_page = database
            .list_audit(&AuditQuery {
                limit: 2,
                before_id: Some(first_page[1].id),
                ..AuditQuery::default()
            })
            .expect("the list should work");
        let for_device = database
            .list_audit(&AuditQuery {
                limit: 10,
                target_id: Some("device-a".into()),
                ..AuditQuery::default()
            })
            .expect("the list should work");

        assert_eq!(first_page.len(), 2);
        assert!(next_page[0].id < first_page[1].id);
        assert_eq!(for_device.len(), 3);
        assert!(for_device
            .iter()
            .all(|event| event.target_id.as_deref() == Some("device-a")));
    }

    #[test]
    fn the_page_size_is_clamped_to_the_maximum() {
        let database = database();
        database.write_audit(&record("login", None)).expect("write");

        // A limit of zero would otherwise return nothing at all, which reads as "no events".
        let events = database
            .list_audit(&AuditQuery {
                limit: 0,
                ..AuditQuery::default()
            })
            .expect("the list should work");

        assert_eq!(events.len(), 1);
    }
}
