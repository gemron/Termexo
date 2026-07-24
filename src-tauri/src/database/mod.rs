use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const INITIAL_MIGRATION: &str = include_str!("../../migrations/0001_initial.sql");

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("database access failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("workspace snapshot is invalid: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("workspace database lock is poisoned")]
    LockPoisoned,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub project_type: String,
    pub active_branch: String,
    pub favorite: bool,
    pub last_opened_at: i64,
    pub layout: String,
    pub terminals: Vec<TerminalSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub name: String,
    pub working_directory: String,
    pub shell: String,
    pub agent_type: String,
    pub status: String,
    pub model: String,
    pub branch: String,
    pub command: Option<String>,
    pub native_session_id: Option<String>,
}

pub struct WorkspaceDatabase {
    connection: Mutex<Connection>,
}

impl WorkspaceDatabase {
    pub fn open(path: PathBuf) -> Result<Self, DatabaseError> {
        let connection = Connection::open(path)?;
        connection.execute_batch(INITIAL_MIGRATION)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn list(&self) -> Result<Vec<Workspace>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT layout_json
             FROM workspaces
             ORDER BY last_opened_at DESC",
        )?;
        let snapshots = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        snapshots
            .into_iter()
            .map(|snapshot| serde_json::from_str(&snapshot).map_err(DatabaseError::from))
            .collect()
    }

    pub fn save(&self, workspace: &Workspace) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let snapshot = serde_json::to_string(workspace)?;
        let now = unix_timestamp_millis();

        connection.execute(
            "INSERT INTO workspaces (
                 id, name, project_path, project_type, active_branch,
                 layout_json, created_at, updated_at, last_opened_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 project_path = excluded.project_path,
                 project_type = excluded.project_type,
                 active_branch = excluded.active_branch,
                 layout_json = excluded.layout_json,
                 updated_at = excluded.updated_at,
                 last_opened_at = excluded.last_opened_at",
            params![
                workspace.id,
                workspace.name,
                workspace.project_path,
                workspace.project_type,
                workspace.active_branch,
                snapshot,
                now,
                workspace.last_opened_at,
            ],
        )?;
        Ok(())
    }
}

fn unix_timestamp_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_lists_workspace_snapshots() {
        let database = WorkspaceDatabase {
            connection: Mutex::new(Connection::open_in_memory().unwrap()),
        };
        database
            .connection
            .lock()
            .unwrap()
            .execute_batch(INITIAL_MIGRATION)
            .unwrap();

        let workspace = Workspace {
            id: "workspace-1".into(),
            name: "AgentDock".into(),
            project_path: "D:\\dev\\agentdock".into(),
            project_type: "Angular + Rust".into(),
            active_branch: "main".into(),
            favorite: true,
            last_opened_at: 10,
            layout: "columns".into(),
            terminals: vec![],
        };

        database.save(&workspace).unwrap();
        let stored = database.list().unwrap();

        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].name, workspace.name);
        assert_eq!(stored[0].layout, workspace.layout);
    }
}
