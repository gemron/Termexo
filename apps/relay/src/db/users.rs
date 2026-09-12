//! Console accounts: the administrators and users that log in to the relay.

use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};

use super::{new_identifier, now_millis, Database, DatabaseError};

const ADMIN_ROLE: &str = "admin";
const USER_ROLE: &str = "user";

const USER_COLUMNS: &str =
    "id, username, password_hash, role, disabled, created_at, last_login_at FROM users";

/// What a console account is allowed to do. An `admin` manages everything; a `user` sees only their
/// own devices and their own password.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Admin,
    User,
}

impl UserRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Admin => ADMIN_ROLE,
            Self::User => USER_ROLE,
        }
    }

    pub fn is_admin(self) -> bool {
        matches!(self, Self::Admin)
    }

    fn parse(value: &str) -> Result<Self, DatabaseError> {
        match value {
            ADMIN_ROLE => Ok(Self::Admin),
            USER_ROLE => Ok(Self::User),
            other => Err(DatabaseError::UnknownValue {
                field: "users.role",
                value: other.to_string(),
            }),
        }
    }
}

#[derive(Debug, Clone)]
pub struct UserRecord {
    pub id: String,
    pub username: String,
    pub password_hash: String,
    pub role: UserRole,
    pub disabled: bool,
    pub created_at: i64,
    pub last_login_at: Option<i64>,
}

/// Which fields of a user a `PATCH` changes. Every field is optional so an untouched one keeps its
/// stored value instead of being overwritten with a default.
#[derive(Debug, Default)]
pub struct UserUpdate {
    pub disabled: Option<bool>,
    pub role: Option<UserRole>,
    pub password_hash: Option<String>,
}

impl UserUpdate {
    pub fn is_empty(&self) -> bool {
        self.disabled.is_none() && self.role.is_none() && self.password_hash.is_none()
    }
}

impl Database {
    pub fn count_users(&self) -> Result<i64, DatabaseError> {
        let count = self
            .connection()
            .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
        Ok(count)
    }

    pub fn create_user(
        &self,
        username: &str,
        password_hash: &str,
        role: UserRole,
    ) -> Result<UserRecord, DatabaseError> {
        let record = UserRecord {
            id: new_identifier()?,
            username: username.to_string(),
            password_hash: password_hash.to_string(),
            role,
            disabled: false,
            created_at: now_millis(),
            last_login_at: None,
        };
        self.connection()
            .execute(
                "INSERT INTO users (id, username, password_hash, role, disabled, created_at, last_login_at)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, NULL)",
                params![
                    record.id,
                    record.username,
                    record.password_hash,
                    record.role.as_str(),
                    record.created_at
                ],
            )
            .map_err(map_username_conflict)?;
        Ok(record)
    }

    pub fn find_user(&self, id: &str) -> Result<Option<UserRecord>, DatabaseError> {
        self.read_user("SELECT ".to_string() + USER_COLUMNS + " WHERE id = ?1", id)
    }

    pub fn find_user_by_username(
        &self,
        username: &str,
    ) -> Result<Option<UserRecord>, DatabaseError> {
        self.read_user(
            "SELECT ".to_string() + USER_COLUMNS + " WHERE username = ?1",
            username,
        )
    }

    pub fn list_users(&self) -> Result<Vec<UserRecord>, DatabaseError> {
        let connection = self.connection();
        let mut statement =
            connection.prepare(&("SELECT ".to_string() + USER_COLUMNS + " ORDER BY created_at"))?;
        let rows = statement.query_map([], read_user_row)?;
        rows.collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .collect::<Result<Vec<_>, _>>()
    }

    pub fn update_user(&self, id: &str, update: &UserUpdate) -> Result<(), DatabaseError> {
        let connection = self.connection();
        // Written as independent statements rather than one assembled `SET` list: three short
        // updates are easier to read than dynamic SQL, and a console patch is not a hot path.
        if let Some(disabled) = update.disabled {
            connection.execute(
                "UPDATE users SET disabled = ?2 WHERE id = ?1",
                params![id, i64::from(disabled)],
            )?;
        }
        if let Some(role) = update.role {
            connection.execute(
                "UPDATE users SET role = ?2 WHERE id = ?1",
                params![id, role.as_str()],
            )?;
        }
        if let Some(password_hash) = &update.password_hash {
            connection.execute(
                "UPDATE users SET password_hash = ?2 WHERE id = ?1",
                params![id, password_hash],
            )?;
        }
        Ok(())
    }

    pub fn delete_user(&self, id: &str) -> Result<(), DatabaseError> {
        self.connection()
            .execute("DELETE FROM users WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn record_user_login(&self, id: &str) -> Result<(), DatabaseError> {
        self.connection().execute(
            "UPDATE users SET last_login_at = ?2 WHERE id = ?1",
            params![id, now_millis()],
        )?;
        Ok(())
    }

    fn read_user(&self, sql: String, key: &str) -> Result<Option<UserRecord>, DatabaseError> {
        let connection = self.connection();
        let mut statement = connection.prepare(&sql)?;
        let mut rows = statement.query_map(params![key], read_user_row)?;
        rows.next().transpose()?.transpose()
    }
}

/// The row mapper yields a nested `Result` because a role the relay does not know is a data error,
/// not a SQLite one; the outer layer unwraps both.
fn read_user_row(row: &Row<'_>) -> rusqlite::Result<Result<UserRecord, DatabaseError>> {
    let id: String = row.get(0)?;
    let username: String = row.get(1)?;
    let password_hash: String = row.get(2)?;
    let role: String = row.get(3)?;
    let disabled: i64 = row.get(4)?;
    let created_at: i64 = row.get(5)?;
    let last_login_at: Option<i64> = row.get(6)?;
    Ok(UserRole::parse(&role).map(|role| UserRecord {
        id,
        username,
        password_hash,
        role,
        disabled: disabled != 0,
        created_at,
        last_login_at,
    }))
}

/// The unique index on `username` is the only constraint `users` can violate, so a constraint
/// failure here always means the name is taken.
fn map_username_conflict(error: rusqlite::Error) -> DatabaseError {
    match &error {
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            DatabaseError::UsernameTaken
        }
        _ => DatabaseError::Sqlite(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Database {
        Database::open_in_memory().expect("the database should open")
    }

    #[test]
    fn a_created_user_is_found_by_id_and_by_name() {
        let database = database();

        let created = database
            .create_user("alice", "hash", UserRole::Admin)
            .expect("the user should be created");

        let by_id = database
            .find_user(&created.id)
            .expect("the lookup should work")
            .expect("the user should exist");
        let by_name = database
            .find_user_by_username("alice")
            .expect("the lookup should work")
            .expect("the user should exist");

        assert_eq!(by_id.id, created.id);
        assert_eq!(by_name.id, created.id);
        assert_eq!(by_id.role, UserRole::Admin);
        assert!(!by_id.disabled);
        assert_eq!(database.count_users().expect("a count"), 1);
    }

    #[test]
    fn a_duplicate_username_is_refused() {
        let database = database();
        database
            .create_user("alice", "hash", UserRole::User)
            .expect("the first user should be created");

        assert!(matches!(
            database.create_user("alice", "other", UserRole::User),
            Err(DatabaseError::UsernameTaken)
        ));
    }

    #[test]
    fn an_update_only_touches_the_fields_it_carries() {
        let database = database();
        let created = database
            .create_user("alice", "hash", UserRole::User)
            .expect("the user should be created");

        database
            .update_user(
                &created.id,
                &UserUpdate {
                    disabled: Some(true),
                    ..UserUpdate::default()
                },
            )
            .expect("the update should apply");

        let updated = database
            .find_user(&created.id)
            .expect("the lookup should work")
            .expect("the user should exist");
        assert!(updated.disabled);
        assert_eq!(updated.role, UserRole::User);
        assert_eq!(updated.password_hash, "hash");
    }

    #[test]
    fn a_login_is_recorded_and_a_deleted_user_is_gone() {
        let database = database();
        let created = database
            .create_user("alice", "hash", UserRole::User)
            .expect("the user should be created");

        database
            .record_user_login(&created.id)
            .expect("the login should be recorded");
        assert!(database
            .find_user(&created.id)
            .expect("the lookup should work")
            .expect("the user should exist")
            .last_login_at
            .is_some());

        database
            .delete_user(&created.id)
            .expect("the user should be deleted");
        assert!(database
            .find_user(&created.id)
            .expect("the lookup should work")
            .is_none());
    }
}
