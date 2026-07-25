use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::agent::AgentSession;
use crate::config::{McpProfile, ModelProfile};
use crate::hooks::AgentEvent;

const INITIAL_MIGRATION: &str = include_str!("../../migrations/0001_initial.sql");
const AGENT_MIGRATION: &str = include_str!("../../migrations/0002_agent_sessions.sql");

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
        connection.execute_batch(AGENT_MIGRATION)?;
        ensure_default_profile(&connection)?;
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

    pub fn save_agent_sessions(&self, sessions: &[AgentSession]) -> Result<(), DatabaseError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let transaction = connection.transaction()?;

        {
            let mut statement = transaction.prepare(
                "INSERT INTO agent_sessions (
                     id, agent_type, native_session_id, project_path, model_name,
                     title, summary, branch, status, message_count, transcript_path,
                     created_at, last_used_at
                 )
                 VALUES (
                     ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
                 )
                 ON CONFLICT(agent_type, native_session_id) DO UPDATE SET
                     project_path = excluded.project_path,
                     model_name = excluded.model_name,
                     title = excluded.title,
                     summary = excluded.summary,
                     branch = excluded.branch,
                     status = excluded.status,
                     message_count = excluded.message_count,
                     transcript_path = excluded.transcript_path,
                     created_at = excluded.created_at,
                     last_used_at = excluded.last_used_at",
            )?;

            for session in sessions {
                statement.execute(params![
                    session.id,
                    session.agent_type,
                    session.native_session_id,
                    session.project_path,
                    session.model_name,
                    session.title,
                    session.summary,
                    session.branch,
                    session.status,
                    session.message_count,
                    session.transcript_path,
                    session.created_at,
                    session.last_used_at,
                ])?;
            }
        }

        transaction.commit()?;
        Ok(())
    }

    pub fn list_agent_sessions(&self) -> Result<Vec<AgentSession>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT
                 id, agent_type, native_session_id, project_path, model_name,
                 title, summary, branch, status, message_count, transcript_path,
                 created_at, last_used_at
             FROM agent_sessions
             ORDER BY last_used_at DESC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(AgentSession {
                id: row.get(0)?,
                agent_type: row.get(1)?,
                native_session_id: row.get(2)?,
                project_path: row.get(3)?,
                model_name: row.get(4)?,
                title: row.get(5)?,
                summary: row.get(6)?,
                branch: row.get(7)?,
                status: row.get(8)?,
                message_count: row.get(9)?,
                transcript_path: row.get(10)?,
                created_at: row.get(11)?,
                last_used_at: row.get(12)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(DatabaseError::from)
    }

    pub fn save_agent_events(&self, events: &[AgentEvent]) -> Result<(), DatabaseError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let transaction = connection.transaction()?;

        {
            let mut statement = transaction.prepare(
                "INSERT OR IGNORE INTO agent_events (
                     event_key, agent_type, native_session_id, terminal_id,
                     event_type, detail_json, created_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for event in events {
                statement.execute(params![
                    event.event_key,
                    event.agent_type,
                    event.native_session_id,
                    event.terminal_id,
                    event.event_type,
                    serde_json::to_string(&event.detail)?,
                    event.created_at,
                ])?;
            }
        }

        transaction.commit()?;
        Ok(())
    }

    pub fn list_agent_events(
        &self,
        terminal_id: Option<&str>,
    ) -> Result<Vec<AgentEvent>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let sql = if terminal_id.is_some() {
            "SELECT
                 event_key, agent_type, native_session_id, terminal_id,
                 event_type, detail_json, created_at
             FROM agent_events
             WHERE terminal_id = ?1
             ORDER BY created_at DESC
             LIMIT 100"
        } else {
            "SELECT
                 event_key, agent_type, native_session_id, terminal_id,
                 event_type, detail_json, created_at
             FROM agent_events
             ORDER BY created_at DESC
             LIMIT 100"
        };
        let mut statement = connection.prepare(sql)?;
        let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<AgentEvent> {
            let detail: String = row.get(5)?;
            Ok(AgentEvent {
                event_key: row.get(0)?,
                agent_type: row.get(1)?,
                native_session_id: row.get(2)?,
                terminal_id: row.get(3)?,
                event_type: row.get(4)?,
                detail: serde_json::from_str(&detail).unwrap_or(Value::Null),
                created_at: row.get(6)?,
            })
        };
        let events = match terminal_id {
            Some(terminal_id) => statement
                .query_map([terminal_id], map_row)?
                .collect::<Result<Vec<_>, _>>()?,
            None => statement
                .query_map([], map_row)?
                .collect::<Result<Vec<_>, _>>()?,
        };
        Ok(events)
    }

    pub fn list_model_profiles(&self) -> Result<Vec<ModelProfile>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT
                 id, name, provider, model, base_url, credential_target, is_default
             FROM model_profiles
             ORDER BY is_default DESC, name",
        )?;
        let rows = statement.query_map([], model_profile_from_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(DatabaseError::from)
    }

    pub fn find_model_profile(
        &self,
        profile_id: &str,
    ) -> Result<Option<ModelProfile>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT
                 id, name, provider, model, base_url, credential_target, is_default
             FROM model_profiles
             WHERE id = ?1",
        )?;
        let mut rows = statement.query_map([profile_id], model_profile_from_row)?;
        rows.next().transpose().map_err(DatabaseError::from)
    }

    pub fn save_model_profile(&self, profile: &ModelProfile) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let now = unix_timestamp_millis();
        if profile.is_default {
            connection.execute("UPDATE model_profiles SET is_default = 0", [])?;
        }
        connection.execute(
            "INSERT INTO model_profiles (
                 id, name, provider, model, base_url, credential_target,
                 is_default, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 provider = excluded.provider,
                 model = excluded.model,
                 base_url = excluded.base_url,
                 credential_target = excluded.credential_target,
                 is_default = excluded.is_default,
                 updated_at = excluded.updated_at",
            params![
                profile.id,
                profile.name,
                profile.provider,
                profile.model,
                profile.base_url,
                profile.credential_target,
                profile.is_default,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn delete_model_profile(&self, profile_id: &str) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        connection.execute("DELETE FROM model_profiles WHERE id = ?1", [profile_id])?;
        Ok(())
    }

    pub fn list_mcp_profiles(&self) -> Result<Vec<McpProfile>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement =
            connection.prepare("SELECT id, name, config_json FROM mcp_profiles ORDER BY name")?;
        let rows = statement.query_map([], |row| {
            Ok(McpProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                config_json: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(DatabaseError::from)
    }

    pub fn find_mcp_profile(&self, profile_id: &str) -> Result<Option<McpProfile>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement =
            connection.prepare("SELECT id, name, config_json FROM mcp_profiles WHERE id = ?1")?;
        let mut rows = statement.query_map([profile_id], |row| {
            Ok(McpProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                config_json: row.get(2)?,
            })
        })?;
        rows.next().transpose().map_err(DatabaseError::from)
    }

    pub fn save_mcp_profile(&self, profile: &McpProfile) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let now = unix_timestamp_millis();
        connection.execute(
            "INSERT INTO mcp_profiles (id, name, config_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 config_json = excluded.config_json,
                 updated_at = excluded.updated_at",
            params![profile.id, profile.name, profile.config_json, now],
        )?;
        Ok(())
    }

    pub fn delete_mcp_profile(&self, profile_id: &str) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        connection.execute("DELETE FROM mcp_profiles WHERE id = ?1", [profile_id])?;
        Ok(())
    }
}

fn ensure_default_profile(connection: &Connection) -> Result<(), DatabaseError> {
    let profile_count: i64 =
        connection.query_row("SELECT COUNT(*) FROM model_profiles", [], |row| row.get(0))?;
    if profile_count == 0 {
        let now = unix_timestamp_millis();
        connection.execute(
            "INSERT INTO model_profiles (
                 id, name, provider, model, is_default, created_at, updated_at
             )
             VALUES ('claude-default', 'Claude Sonnet', 'Anthropic', 'sonnet', 1, ?1, ?1)",
            [now],
        )?;
    }
    Ok(())
}

fn model_profile_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModelProfile> {
    let credential_target: Option<String> = row.get(5)?;
    Ok(ModelProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        provider: row.get(2)?,
        model: row.get(3)?,
        base_url: row.get(4)?,
        has_credential: credential_target.is_some(),
        credential_target,
        is_default: row.get(6)?,
    })
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
            .execute_batch(&format!("{INITIAL_MIGRATION}\n{AGENT_MIGRATION}"))
            .unwrap();

        let workspace = Workspace {
            id: "workspace-1".into(),
            name: "Termexo".into(),
            project_path: "D:\\dev\\termexo".into(),
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

    #[test]
    fn upserts_agent_sessions() {
        let database = WorkspaceDatabase {
            connection: Mutex::new(Connection::open_in_memory().unwrap()),
        };
        database
            .connection
            .lock()
            .unwrap()
            .execute_batch(&format!("{INITIAL_MIGRATION}\n{AGENT_MIGRATION}"))
            .unwrap();
        let session = AgentSession {
            id: "claude:session-1".into(),
            agent_type: "claude".into(),
            native_session_id: "session-1".into(),
            project_path: Some("D:\\dev\\Termexo".into()),
            model_name: Some("sonnet".into()),
            title: "Implement restore".into(),
            summary: None,
            branch: Some("main".into()),
            status: "HISTORICAL".into(),
            message_count: 4,
            transcript_path: "session-1.jsonl".into(),
            created_at: 1,
            last_used_at: 2,
        };

        database
            .save_agent_sessions(std::slice::from_ref(&session))
            .unwrap();
        database
            .save_agent_sessions(std::slice::from_ref(&session))
            .unwrap();
        let stored = database.list_agent_sessions().unwrap();

        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].native_session_id, session.native_session_id);
    }

    #[test]
    fn saves_model_and_mcp_profiles() {
        let database = WorkspaceDatabase {
            connection: Mutex::new(Connection::open_in_memory().unwrap()),
        };
        database
            .connection
            .lock()
            .unwrap()
            .execute_batch(&format!("{INITIAL_MIGRATION}\n{AGENT_MIGRATION}"))
            .unwrap();
        let model = ModelProfile {
            id: "profile-1".into(),
            name: "Gateway Sonnet".into(),
            provider: "Anthropic".into(),
            model: "sonnet".into(),
            base_url: Some("https://gateway.example.com".into()),
            credential_target: Some("model-profile:profile-1".into()),
            is_default: true,
            has_credential: true,
        };
        let mcp = McpProfile {
            id: "mcp-1".into(),
            name: "Local tools".into(),
            config_json: r#"{"mcpServers":{}}"#.into(),
        };

        database.save_model_profile(&model).unwrap();
        database.save_mcp_profile(&mcp).unwrap();

        assert_eq!(database.list_model_profiles().unwrap().len(), 1);
        assert_eq!(database.list_mcp_profiles().unwrap().len(), 1);
        assert!(
            database
                .find_model_profile("profile-1")
                .unwrap()
                .unwrap()
                .has_credential
        );
    }
}
