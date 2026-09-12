//! One-time enrollment codes. Only the code's SHA-256 is stored, so the database cannot hand out a
//! code that was issued and never used.

use rusqlite::{params, Row};
use serde::Serialize;
use termexo_relay_protocol::frames::DeviceKind;

use super::devices::device_kind_label;
use super::{new_identifier, now_millis, optional_text, Database, DatabaseError};

const ENROLLMENT_COLUMNS: &str = "id, code_hash, kind, owner_user_id, created_by, note, \
     created_at, expires_at, used_at, used_by_device_id, cancelled_at FROM enrollment_codes";

const DESKTOP_KIND: &str = "desktop";
const RELAY_KIND: &str = "relay";

/// What the console shows for a code. The four states are mutually exclusive and derived rather
/// than stored, so a code that simply ran out of time never needs a write to become expired.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EnrollmentStatus {
    Pending,
    Used,
    Expired,
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct EnrollmentRecord {
    pub id: String,
    pub code_hash: String,
    pub kind: DeviceKind,
    pub owner_user_id: Option<String>,
    pub created_by: String,
    pub note: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
    pub used_at: Option<i64>,
    pub used_by_device_id: Option<String>,
    pub cancelled_at: Option<i64>,
}

impl EnrollmentRecord {
    pub fn status(&self, now: i64) -> EnrollmentStatus {
        // Order matters: a code that was used and then ran out of time is still "used", because
        // that is the fact an administrator is looking for.
        if self.used_at.is_some() {
            return EnrollmentStatus::Used;
        }
        if self.cancelled_at.is_some() {
            return EnrollmentStatus::Cancelled;
        }
        if now >= self.expires_at {
            return EnrollmentStatus::Expired;
        }
        EnrollmentStatus::Pending
    }

    /// Whether the code may still be redeemed.
    pub fn is_redeemable(&self, now: i64) -> bool {
        matches!(self.status(now), EnrollmentStatus::Pending)
    }
}

pub struct NewEnrollment<'a> {
    pub code_hash: &'a str,
    pub kind: DeviceKind,
    pub owner_user_id: Option<&'a str>,
    pub created_by: &'a str,
    pub note: Option<&'a str>,
    pub expires_at: i64,
}

impl Database {
    pub fn create_enrollment(
        &self,
        enrollment: NewEnrollment<'_>,
    ) -> Result<EnrollmentRecord, DatabaseError> {
        let record = EnrollmentRecord {
            id: new_identifier()?,
            code_hash: enrollment.code_hash.to_string(),
            kind: enrollment.kind,
            owner_user_id: enrollment.owner_user_id.map(str::to_string),
            created_by: enrollment.created_by.to_string(),
            note: enrollment.note.map(str::to_string),
            created_at: now_millis(),
            expires_at: enrollment.expires_at,
            used_at: None,
            used_by_device_id: None,
            cancelled_at: None,
        };
        self.connection().execute(
            "INSERT INTO enrollment_codes (id, code_hash, kind, owner_user_id, created_by, note, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                record.id,
                record.code_hash,
                device_kind_label(record.kind),
                record.owner_user_id,
                record.created_by,
                record.note,
                record.created_at,
                record.expires_at
            ],
        )?;
        Ok(record)
    }

    pub fn find_enrollment(&self, id: &str) -> Result<Option<EnrollmentRecord>, DatabaseError> {
        self.read_enrollment(
            &("SELECT ".to_string() + ENROLLMENT_COLUMNS + " WHERE id = ?1"),
            id,
        )
    }

    /// Looks a code up by its digest: the code itself is never stored, so this is the only way in.
    pub fn find_enrollment_by_hash(
        &self,
        code_hash: &str,
    ) -> Result<Option<EnrollmentRecord>, DatabaseError> {
        self.read_enrollment(
            &("SELECT ".to_string() + ENROLLMENT_COLUMNS + " WHERE code_hash = ?1"),
            code_hash,
        )
    }

    pub fn list_enrollments(&self) -> Result<Vec<EnrollmentRecord>, DatabaseError> {
        let connection = self.connection();
        let mut statement = connection
            .prepare(&("SELECT ".to_string() + ENROLLMENT_COLUMNS + " ORDER BY created_at DESC"))?;
        let rows = statement.query_map([], read_enrollment_row)?;
        rows.collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .collect::<Result<Vec<_>, _>>()
    }

    /// Burns a code. The `used_at IS NULL` guard is what makes a code one-time even when two
    /// devices redeem it at the same moment: only one update changes a row.
    pub fn mark_enrollment_used(&self, id: &str, device_id: &str) -> Result<bool, DatabaseError> {
        let changed = self.connection().execute(
            "UPDATE enrollment_codes SET used_at = ?2, used_by_device_id = ?3
             WHERE id = ?1 AND used_at IS NULL AND cancelled_at IS NULL",
            params![id, now_millis(), device_id],
        )?;
        Ok(changed > 0)
    }

    pub fn cancel_enrollment(&self, id: &str) -> Result<bool, DatabaseError> {
        let changed = self.connection().execute(
            "UPDATE enrollment_codes SET cancelled_at = ?2
             WHERE id = ?1 AND used_at IS NULL AND cancelled_at IS NULL",
            params![id, now_millis()],
        )?;
        Ok(changed > 0)
    }

    fn read_enrollment(
        &self,
        sql: &str,
        key: &str,
    ) -> Result<Option<EnrollmentRecord>, DatabaseError> {
        let connection = self.connection();
        let mut statement = connection.prepare(sql)?;
        let mut rows = statement.query_map(params![key], read_enrollment_row)?;
        rows.next().transpose()?.transpose()
    }
}

fn read_enrollment_row(row: &Row<'_>) -> rusqlite::Result<Result<EnrollmentRecord, DatabaseError>> {
    let id: String = row.get(0)?;
    let code_hash: String = row.get(1)?;
    let kind: String = row.get(2)?;
    let owner_user_id: Option<String> = row.get(3)?;
    let created_by: String = row.get(4)?;
    let note: Option<String> = row.get(5)?;
    let created_at: i64 = row.get(6)?;
    let expires_at: i64 = row.get(7)?;
    let used_at: Option<i64> = row.get(8)?;
    let used_by_device_id: Option<String> = row.get(9)?;
    let cancelled_at: Option<i64> = row.get(10)?;
    Ok(parse_kind(&kind).map(|kind| EnrollmentRecord {
        id,
        code_hash,
        kind,
        owner_user_id,
        created_by,
        note: optional_text(note),
        created_at,
        expires_at,
        used_at,
        used_by_device_id,
        cancelled_at,
    }))
}

fn parse_kind(value: &str) -> Result<DeviceKind, DatabaseError> {
    match value {
        DESKTOP_KIND => Ok(DeviceKind::Desktop),
        RELAY_KIND => Ok(DeviceKind::Relay),
        other => Err(DatabaseError::UnknownValue {
            field: "enrollment_codes.kind",
            value: other.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR_MS: i64 = 60 * 60 * 1000;

    fn database() -> Database {
        Database::open_in_memory().expect("the database should open")
    }

    fn insert(database: &Database, code_hash: &str, expires_at: i64) -> EnrollmentRecord {
        database
            .create_enrollment(NewEnrollment {
                code_hash,
                kind: DeviceKind::Desktop,
                owner_user_id: None,
                created_by: "admin",
                note: Some("给同事"),
                expires_at,
            })
            .expect("the code should be created")
    }

    #[test]
    fn a_code_is_found_by_its_digest_and_starts_pending() {
        let database = database();
        let now = now_millis();

        let created = insert(&database, "digest", now + HOUR_MS);
        let found = database
            .find_enrollment_by_hash("digest")
            .expect("the lookup should work")
            .expect("the code should exist");

        assert_eq!(found.id, created.id);
        assert_eq!(found.status(now), EnrollmentStatus::Pending);
        assert!(found.is_redeemable(now));
        assert_eq!(found.note.as_deref(), Some("给同事"));
    }

    #[test]
    fn a_code_can_only_be_used_once() {
        let database = database();
        let created = insert(&database, "digest", now_millis() + HOUR_MS);

        assert!(database
            .mark_enrollment_used(&created.id, "device-a")
            .expect("the first redemption should apply"));
        assert!(!database
            .mark_enrollment_used(&created.id, "device-b")
            .expect("the second one should change nothing"));

        let found = database
            .find_enrollment(&created.id)
            .expect("the lookup should work")
            .expect("the code should exist");
        assert_eq!(found.used_by_device_id.as_deref(), Some("device-a"));
        assert_eq!(found.status(now_millis()), EnrollmentStatus::Used);
        assert!(!found.is_redeemable(now_millis()));
    }

    #[test]
    fn an_expired_code_reports_expired_without_a_write() {
        let database = database();
        let now = now_millis();
        let created = insert(&database, "digest", now - 1);

        assert_eq!(created.status(now), EnrollmentStatus::Expired);
        assert!(!created.is_redeemable(now));
    }

    #[test]
    fn cancelling_blocks_redemption_and_is_reported_once() {
        let database = database();
        let created = insert(&database, "digest", now_millis() + HOUR_MS);

        assert!(database
            .cancel_enrollment(&created.id)
            .expect("the cancellation should apply"));
        assert!(!database
            .cancel_enrollment(&created.id)
            .expect("a second one should change nothing"));

        let found = database
            .find_enrollment(&created.id)
            .expect("the lookup should work")
            .expect("the code should exist");
        assert_eq!(found.status(now_millis()), EnrollmentStatus::Cancelled);
        assert!(!database
            .mark_enrollment_used(&created.id, "device-a")
            .expect("a cancelled code must not be redeemable"));
    }

    #[test]
    fn a_used_code_stays_used_after_it_expires() {
        let database = database();
        let now = now_millis();
        let created = insert(&database, "digest", now + HOUR_MS);
        database
            .mark_enrollment_used(&created.id, "device-a")
            .expect("the redemption should apply");

        let found = database
            .find_enrollment(&created.id)
            .expect("the lookup should work")
            .expect("the code should exist");

        assert_eq!(found.status(now + 2 * HOUR_MS), EnrollmentStatus::Used);
    }
}
