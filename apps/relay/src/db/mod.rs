//! SQLite persistence for the relay.
//!
//! The migration strategy is the desktop app's: every file in `migrations/` is executed in full on
//! every start, so every statement has to be idempotent and there is no version table to keep in
//! sync. Shape fixes that SQL cannot express guarded run as Rust functions afterwards and must
//! tolerate being re-applied.

mod audit;
mod devices;
mod enrollments;
mod sessions;
mod users;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use termexo_relay_protocol::secret::random_base64url;
use thiserror::Error;

pub use audit::{AuditQuery, AuditRecord, MAX_AUDIT_PAGE};
pub use devices::{device_kind_label, DeviceRecord, DeviceUpdate, NewDevice};
pub use enrollments::{EnrollmentRecord, EnrollmentStatus, NewEnrollment};
pub use sessions::SessionRecord;
pub use users::{UserRecord, UserRole, UserUpdate};

const INITIAL_MIGRATION: &str = include_str!("../../migrations/0001_initial.sql");

/// The database file inside the data directory.
pub const DATABASE_FILE: &str = "relay.db";

/// `relay_settings` keys.
pub const SETTING_RELAY_ID: &str = "relay_id";
pub const SETTING_PUBLIC_URL: &str = "public_url";

/// 128 bits, rendered base64url: enough that two independently created rows never collide, short
/// enough to sit in a URL path without wrapping.
const IDENTIFIER_BYTES: usize = 16;

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("数据库访问失败：{0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("无法生成标识符：{0}")]
    Random(String),
    #[error("数据库中的 {field} 值无法识别：{value}")]
    UnknownValue { field: &'static str, value: String },
    #[error("用户名已被占用。")]
    UsernameTaken,
}

/// Milliseconds since the Unix epoch, the only timestamp shape the relay stores or serves.
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

/// A fresh random identifier for a row the relay creates.
pub fn new_identifier() -> Result<String, DatabaseError> {
    random_base64url(IDENTIFIER_BYTES).map_err(DatabaseError::Random)
}

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    /// Opens the database inside `data_directory`, creating and migrating it as needed.
    pub fn open(data_directory: &Path) -> Result<Self, DatabaseError> {
        let connection = Connection::open(data_directory.join(DATABASE_FILE))?;
        // Foreign keys are off by default in SQLite; `devices.owner_user_id` is only useful as a
        // constraint if they are on.
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        connection.execute_batch(INITIAL_MIGRATION)?;
        ensure_column(&connection, "enrollment_codes", "cancelled_at", "INTEGER")?;
        ensure_column(
            &connection,
            "enrollment_codes",
            "created_at",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// Opens a database that lives only in memory, for tests.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, DatabaseError> {
        let connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        connection.execute_batch(INITIAL_MIGRATION)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn read_setting(&self, key: &str) -> Result<Option<String>, DatabaseError> {
        let connection = self.connection();
        let mut statement =
            connection.prepare("SELECT value FROM relay_settings WHERE key = ?1")?;
        let mut rows = statement.query_map(params![key], |row| row.get::<_, String>(0))?;
        rows.next().transpose().map_err(DatabaseError::from)
    }

    pub fn write_setting(&self, key: &str, value: &str) -> Result<(), DatabaseError> {
        self.connection().execute(
            "INSERT INTO relay_settings (key, value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now_millis()],
        )?;
        Ok(())
    }

    /// Reads a setting, writing `fallback` the first time it is missing.
    ///
    /// This is how the relay id survives a restart: it is generated once and then read back for the
    /// life of the data directory, because devices and downstream relays remember it.
    pub fn read_or_initialize_setting(
        &self,
        key: &str,
        fallback: impl FnOnce() -> Result<String, DatabaseError>,
    ) -> Result<String, DatabaseError> {
        if let Some(value) = self.read_setting(key)? {
            return Ok(value);
        }
        let value = fallback()?;
        self.write_setting(key, &value)?;
        Ok(value)
    }

    /// Recovering from poisoning keeps one panicking request from taking the whole relay down with
    /// it; SQLite itself is still consistent, because a panic cannot leave a statement half-run.
    fn connection(&self) -> MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Adds a column when it is missing, which is the guarded `ALTER` the migration files cannot write.
fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    declaration: &str,
) -> Result<(), DatabaseError> {
    let existing: Vec<String> = connection
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<_, _>>()?;
    if existing.iter().any(|name| name == column) {
        return Ok(());
    }
    connection.execute_batch(&format!(
        "ALTER TABLE {table} ADD COLUMN {column} {declaration}"
    ))?;
    Ok(())
}

/// Turns a nullable text column into an owned option, dropping values that are present but empty.
///
/// A blank note and an absent note mean the same thing to every reader, and collapsing them here
/// keeps each call site from repeating the check.
fn optional_text(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_setting_round_trips_and_overwrites() {
        let database = Database::open_in_memory().expect("the database should open");

        assert_eq!(database.read_setting(SETTING_RELAY_ID).expect("read"), None);
        database
            .write_setting(SETTING_RELAY_ID, "first")
            .expect("write");
        database
            .write_setting(SETTING_RELAY_ID, "second")
            .expect("write");

        assert_eq!(
            database.read_setting(SETTING_RELAY_ID).expect("read"),
            Some("second".to_string())
        );
    }

    #[test]
    fn a_setting_is_initialized_once_and_then_read_back() {
        let database = Database::open_in_memory().expect("the database should open");

        let first = database
            .read_or_initialize_setting(SETTING_RELAY_ID, || Ok("generated".into()))
            .expect("it should initialize");
        let second = database
            .read_or_initialize_setting(SETTING_RELAY_ID, || {
                panic!("the stored value should have been reused")
            })
            .expect("it should read back");

        assert_eq!(first, "generated");
        assert_eq!(second, "generated");
    }

    #[test]
    fn adding_an_existing_column_is_a_no_op() {
        let database = Database::open_in_memory().expect("the database should open");
        let connection = database.connection();

        // Re-applying the guarded migration is exactly what every restart does.
        ensure_column(&connection, "enrollment_codes", "cancelled_at", "INTEGER")
            .expect("the first call should succeed");
        ensure_column(&connection, "enrollment_codes", "cancelled_at", "INTEGER")
            .expect("the second call should be a no-op");
    }

    #[test]
    fn generated_identifiers_are_unique() {
        assert_ne!(
            new_identifier().expect("an id"),
            new_identifier().expect("an id")
        );
    }
}
