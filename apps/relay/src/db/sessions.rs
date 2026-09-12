//! Console sessions. The cookie value itself is never stored: `console_sessions.id` holds its
//! SHA-256, for the same reason `devices.secret_hash` does — a leaked database must not let anyone
//! resume a live console session.

use rusqlite::{params, Row};

use super::{optional_text, Database, DatabaseError};

const SESSION_COLUMNS: &str = "id, user_id, created_at, expires_at, ip FROM console_sessions";

#[derive(Debug, Clone)]
pub struct SessionRecord {
    /// The digest of the cookie value, not the value itself.
    pub id_hash: String,
    pub user_id: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub ip: Option<String>,
}

impl SessionRecord {
    pub fn is_expired(&self, now: i64) -> bool {
        now >= self.expires_at
    }
}

impl Database {
    pub fn create_session(&self, session: &SessionRecord) -> Result<(), DatabaseError> {
        self.connection().execute(
            "INSERT INTO console_sessions (id, user_id, created_at, expires_at, ip)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                session.id_hash,
                session.user_id,
                session.created_at,
                session.expires_at,
                session.ip
            ],
        )?;
        Ok(())
    }

    pub fn find_session(&self, id_hash: &str) -> Result<Option<SessionRecord>, DatabaseError> {
        let connection = self.connection();
        let mut statement =
            connection.prepare(&("SELECT ".to_string() + SESSION_COLUMNS + " WHERE id = ?1"))?;
        let mut rows = statement.query_map(params![id_hash], read_session_row)?;
        rows.next().transpose().map_err(DatabaseError::from)
    }

    pub fn extend_session(&self, id_hash: &str, expires_at: i64) -> Result<(), DatabaseError> {
        self.connection().execute(
            "UPDATE console_sessions SET expires_at = ?2 WHERE id = ?1",
            params![id_hash, expires_at],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, id_hash: &str) -> Result<(), DatabaseError> {
        self.connection().execute(
            "DELETE FROM console_sessions WHERE id = ?1",
            params![id_hash],
        )?;
        Ok(())
    }

    /// Drops every session of one account, which is what disabling or deleting a user has to do.
    pub fn delete_sessions_of_user(&self, user_id: &str) -> Result<(), DatabaseError> {
        self.connection().execute(
            "DELETE FROM console_sessions WHERE user_id = ?1",
            params![user_id],
        )?;
        Ok(())
    }

    /// Clears sessions that ran out. Called on start so an abandoned relay does not accumulate rows
    /// nobody will ever present again.
    pub fn delete_expired_sessions(&self, now: i64) -> Result<usize, DatabaseError> {
        let removed = self.connection().execute(
            "DELETE FROM console_sessions WHERE expires_at <= ?1",
            params![now],
        )?;
        Ok(removed)
    }
}

fn read_session_row(row: &Row<'_>) -> rusqlite::Result<SessionRecord> {
    Ok(SessionRecord {
        id_hash: row.get(0)?,
        user_id: row.get(1)?,
        created_at: row.get(2)?,
        expires_at: row.get(3)?,
        ip: optional_text(row.get(4)?),
    })
}

#[cfg(test)]
mod tests {
    use super::super::{now_millis, UserRole};
    use super::*;

    const DAY_MS: i64 = 24 * 60 * 60 * 1000;

    fn session(user_id: &str, expires_at: i64) -> SessionRecord {
        SessionRecord {
            id_hash: format!("digest-{expires_at}"),
            user_id: user_id.to_string(),
            created_at: now_millis(),
            expires_at,
            ip: Some("203.0.113.5".into()),
        }
    }

    fn database_with_user() -> (Database, String) {
        let database = Database::open_in_memory().expect("the database should open");
        let user = database
            .create_user("alice", "hash", UserRole::Admin)
            .expect("a user");
        (database, user.id)
    }

    #[test]
    fn a_session_round_trips_and_can_be_extended() {
        let (database, user_id) = database_with_user();
        let now = now_millis();
        let record = session(&user_id, now + DAY_MS);
        database.create_session(&record).expect("a session");

        database
            .extend_session(&record.id_hash, now + 2 * DAY_MS)
            .expect("the extension should apply");

        let found = database
            .find_session(&record.id_hash)
            .expect("the lookup should work")
            .expect("the session should exist");
        assert_eq!(found.user_id, user_id);
        assert_eq!(found.expires_at, now + 2 * DAY_MS);
        assert!(!found.is_expired(now));
        assert!(found.is_expired(now + 2 * DAY_MS));
    }

    #[test]
    fn disabling_a_user_can_drop_every_session_they_hold() {
        let (database, user_id) = database_with_user();
        let now = now_millis();
        database
            .create_session(&session(&user_id, now + DAY_MS))
            .expect("a session");
        database
            .create_session(&session(&user_id, now + 2 * DAY_MS))
            .expect("a second session");

        database
            .delete_sessions_of_user(&user_id)
            .expect("the cascade should run");

        assert!(database
            .find_session(&format!("digest-{}", now + DAY_MS))
            .expect("the lookup should work")
            .is_none());
    }

    #[test]
    fn expired_sessions_are_swept() {
        let (database, user_id) = database_with_user();
        let now = now_millis();
        database
            .create_session(&session(&user_id, now - 1))
            .expect("an expired session");
        database
            .create_session(&session(&user_id, now + DAY_MS))
            .expect("a live session");

        assert_eq!(
            database.delete_expired_sessions(now).expect("a sweep"),
            1,
            "only the expired session should be removed"
        );
    }
}
