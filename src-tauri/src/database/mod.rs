use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::agent::AgentSession;
use crate::config::{AccountProfile, McpProfile, ModelProfile, NetworkProfile};
use crate::hooks::AgentEvent;

const INITIAL_MIGRATION: &str = include_str!("../../migrations/0001_initial.sql");
const AGENT_MIGRATION: &str = include_str!("../../migrations/0002_agent_sessions.sql");
const NETWORK_MIGRATION: &str = include_str!("../../migrations/0003_network_profiles.sql");
const ACCOUNT_MIGRATION: &str = include_str!("../../migrations/0004_account_profiles.sql");
const API_PROTOCOL_MIGRATION: &str = include_str!("../../migrations/0005_api_protocol.sql");
const PROVIDER_PROFILE_MIGRATION: &str =
    include_str!("../../migrations/0006_provider_profiles.sql");
const PROVIDER_PLAN_MIGRATION: &str = include_str!("../../migrations/0007_provider_plans.sql");
const V05_ASSETS_MIGRATION: &str = include_str!("../../migrations/0008_v05_assets.sql");
const LEGACY_MINIMAX_M3_MODEL: &str = "MiniMax-M3[1m]";
const MINIMAX_M3_MODEL: &str = "MiniMax-M3";

fn default_grid_dimension() -> u8 {
    2
}

fn default_workspace_theme_color() -> String {
    "#58c7a0".to_string()
}

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
    #[serde(default = "default_workspace_theme_color")]
    pub theme_color: String,
    #[serde(default)]
    pub sort_order: u32,
    pub project_path: String,
    pub project_type: String,
    pub active_branch: String,
    pub favorite: bool,
    pub last_opened_at: i64,
    pub layout: String,
    #[serde(default = "default_grid_dimension")]
    pub grid_columns: u8,
    #[serde(default = "default_grid_dimension")]
    pub grid_rows: u8,
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
    pub profile_id: Option<String>,
    pub mcp_profile_id: Option<String>,
    pub account_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PromptAsset {
    pub id: String,
    pub workspace_id: String,
    pub terminal_id: Option<String>,
    pub terminal_name: String,
    pub agent_type: String,
    pub kind: String,
    pub content: String,
    #[serde(default)]
    pub redacted: bool,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl PromptAsset {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty() || self.workspace_id.trim().is_empty() {
            return Err("Prompt asset is missing an ID or workspace.".into());
        }
        if !matches!(self.kind.as_str(), "draft" | "history") {
            return Err("Prompt asset kind is invalid.".into());
        }
        if self.content.len() > 256 * 1024 {
            return Err("Prompt asset exceeds the 256 KiB safety limit.".into());
        }
        if self.kind == "draft" && self.terminal_id.as_deref().unwrap_or("").is_empty() {
            return Err("A draft must be associated with a terminal.".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HandoffRecord {
    pub id: String,
    pub workspace_id: String,
    pub source_terminal_id: Option<String>,
    pub title: String,
    pub package_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl HandoffRecord {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty() || self.workspace_id.trim().is_empty() {
            return Err("Handoff package is missing an ID or workspace.".into());
        }
        if self.title.trim().is_empty() {
            return Err("Handoff package title cannot be empty.".into());
        }
        if self.package_json.len() > 2 * 1024 * 1024 {
            return Err("Handoff package exceeds the 2 MB safety limit.".into());
        }
        let parsed: serde_json::Value = serde_json::from_str(&self.package_json)
            .map_err(|error| format!("Handoff package JSON is invalid: {error}"))?;
        if !parsed.is_object() {
            return Err("Handoff package must be a JSON object.".into());
        }
        Ok(())
    }
}

pub struct WorkspaceDatabase {
    connection: Mutex<Connection>,
}

impl WorkspaceDatabase {
    pub fn open(path: PathBuf) -> Result<Self, DatabaseError> {
        let connection = Connection::open(path)?;
        connection.execute_batch(INITIAL_MIGRATION)?;
        connection.execute_batch(AGENT_MIGRATION)?;
        connection.execute_batch(NETWORK_MIGRATION)?;
        connection.execute_batch(ACCOUNT_MIGRATION)?;
        run_api_protocol_migration(&connection)?;
        run_provider_profile_migration(&connection)?;
        connection.execute_batch(V05_ASSETS_MIGRATION)?;
        split_legacy_single_protocol_profiles(&connection)?;
        migrate_legacy_minimax_m3_model(&connection)?;
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
             ORDER BY created_at ASC",
        )?;
        let snapshots = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        let mut workspaces = snapshots
            .into_iter()
            .map(|snapshot| serde_json::from_str(&snapshot).map_err(DatabaseError::from))
            .collect::<Result<Vec<Workspace>, DatabaseError>>()?;
        workspaces.sort_by_key(|workspace| workspace.sort_order);
        Ok(workspaces)
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

    pub fn delete_workspace(&self, workspace_id: &str) -> Result<(), DatabaseError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM prompt_assets WHERE workspace_id = ?1",
            [workspace_id],
        )?;
        transaction.execute(
            "DELETE FROM handoff_packages WHERE workspace_id = ?1",
            [workspace_id],
        )?;
        transaction.execute("DELETE FROM workspaces WHERE id = ?1", [workspace_id])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn list_prompt_assets(
        &self,
        workspace_id: Option<&str>,
    ) -> Result<Vec<PromptAsset>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT id, workspace_id, terminal_id, terminal_name, agent_type, kind, content,
                    redacted, favorite, pinned, created_at, updated_at
             FROM prompt_assets
             WHERE (?1 IS NULL OR workspace_id = ?1)
             ORDER BY pinned DESC, favorite DESC, updated_at DESC
             LIMIT 1000",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            Ok(PromptAsset {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                terminal_id: row.get(2)?,
                terminal_name: row.get(3)?,
                agent_type: row.get(4)?,
                kind: row.get(5)?,
                content: row.get(6)?,
                redacted: row.get(7)?,
                favorite: row.get(8)?,
                pinned: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(DatabaseError::from)
    }

    pub fn save_prompt_asset(&self, asset: &PromptAsset) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        connection.execute(
            "INSERT INTO prompt_assets (
                 id, workspace_id, terminal_id, terminal_name, agent_type, kind, content,
                 redacted, favorite, pinned, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                 workspace_id = excluded.workspace_id,
                 terminal_id = excluded.terminal_id,
                 terminal_name = excluded.terminal_name,
                 agent_type = excluded.agent_type,
                 kind = excluded.kind,
                 content = excluded.content,
                 redacted = excluded.redacted,
                 favorite = excluded.favorite,
                 pinned = excluded.pinned,
                 updated_at = excluded.updated_at",
            params![
                asset.id,
                asset.workspace_id,
                asset.terminal_id,
                asset.terminal_name,
                asset.agent_type,
                asset.kind,
                asset.content,
                asset.redacted,
                asset.favorite,
                asset.pinned,
                asset.created_at,
                asset.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_prompt_asset(&self, asset_id: &str) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        connection.execute("DELETE FROM prompt_assets WHERE id = ?1", [asset_id])?;
        Ok(())
    }

    pub fn list_handoff_packages(
        &self,
        workspace_id: Option<&str>,
    ) -> Result<Vec<HandoffRecord>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT id, workspace_id, source_terminal_id, title, package_json, created_at, updated_at
             FROM handoff_packages
             WHERE (?1 IS NULL OR workspace_id = ?1)
             ORDER BY updated_at DESC
             LIMIT 250",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            Ok(HandoffRecord {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                source_terminal_id: row.get(2)?,
                title: row.get(3)?,
                package_json: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(DatabaseError::from)
    }

    pub fn save_handoff_package(&self, record: &HandoffRecord) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        connection.execute(
            "INSERT INTO handoff_packages (
                 id, workspace_id, source_terminal_id, title, package_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                 workspace_id = excluded.workspace_id,
                 source_terminal_id = excluded.source_terminal_id,
                 title = excluded.title,
                 package_json = excluded.package_json,
                 updated_at = excluded.updated_at",
            params![
                record.id,
                record.workspace_id,
                record.source_terminal_id,
                record.title,
                record.package_json,
                record.created_at,
                record.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_handoff_package(&self, package_id: &str) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        connection.execute("DELETE FROM handoff_packages WHERE id = ?1", [package_id])?;
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
                account_profile_id: None,
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
             LIMIT 250"
        } else {
            "SELECT
                 event_key, agent_type, native_session_id, terminal_id,
                 event_type, detail_json, created_at
             FROM agent_events
             ORDER BY created_at DESC
             LIMIT 250"
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
        let mut statement = connection.prepare(&format!(
            "SELECT {MODEL_PROFILE_COLUMNS}
             FROM model_profiles
             ORDER BY is_default DESC, provider, name"
        ))?;
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
        let mut statement = connection.prepare(&format!(
            "SELECT {MODEL_PROFILE_COLUMNS}
             FROM model_profiles
             WHERE id = ?1"
        ))?;
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
        // The pre-split columns are still NOT NULL, so they keep mirroring whichever side is on.
        let (legacy_protocol, legacy_model, legacy_base_url) = if profile.claude_enabled {
            ("anthropic", &profile.claude_model, &profile.claude_base_url)
        } else {
            ("openai", &profile.codex_model, &profile.codex_base_url)
        };
        connection.execute(
            "INSERT INTO model_profiles (
                 id, name, provider, model, base_url, credential_target,
                 api_protocol, is_default, created_at, updated_at,
                 claude_enabled, claude_model, claude_base_url,
                 codex_enabled, codex_model, codex_base_url,
                 plan_alert_threshold
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 provider = excluded.provider,
                 model = excluded.model,
                 base_url = excluded.base_url,
                 credential_target = excluded.credential_target,
                 api_protocol = excluded.api_protocol,
                 is_default = excluded.is_default,
                 updated_at = excluded.updated_at,
                 claude_enabled = excluded.claude_enabled,
                 claude_model = excluded.claude_model,
                 claude_base_url = excluded.claude_base_url,
                 codex_enabled = excluded.codex_enabled,
                 codex_model = excluded.codex_model,
                 codex_base_url = excluded.codex_base_url,
                 plan_alert_threshold = excluded.plan_alert_threshold",
            params![
                profile.id,
                profile.name,
                profile.provider,
                legacy_model,
                legacy_base_url,
                profile.credential_target,
                legacy_protocol,
                profile.is_default,
                now,
                profile.claude_enabled,
                profile.claude_model,
                profile.claude_base_url,
                profile.codex_enabled,
                profile.codex_model,
                profile.codex_base_url,
                profile.plan_alert_threshold,
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

    pub fn list_network_profiles(&self) -> Result<Vec<NetworkProfile>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT
                 id, name, scope, workspace_id, enabled, is_default,
                 http_proxy, https_proxy, all_proxy, no_proxy,
                 npm_registry, npm_proxy, npm_https_proxy, npm_strict_ssl,
                 npm_ca_path, proxy_username, credential_target
             FROM network_profiles
             ORDER BY is_default DESC, scope, name",
        )?;
        let rows = statement.query_map([], network_profile_from_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(DatabaseError::from)
    }

    pub fn find_network_profile(
        &self,
        profile_id: &str,
    ) -> Result<Option<NetworkProfile>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT
                 id, name, scope, workspace_id, enabled, is_default,
                 http_proxy, https_proxy, all_proxy, no_proxy,
                 npm_registry, npm_proxy, npm_https_proxy, npm_strict_ssl,
                 npm_ca_path, proxy_username, credential_target
             FROM network_profiles
             WHERE id = ?1",
        )?;
        let mut rows = statement.query_map([profile_id], network_profile_from_row)?;
        rows.next().transpose().map_err(DatabaseError::from)
    }

    pub fn find_effective_network_profile(
        &self,
        workspace_id: Option<&str>,
    ) -> Result<Option<NetworkProfile>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT
                 id, name, scope, workspace_id, enabled, is_default,
                 http_proxy, https_proxy, all_proxy, no_proxy,
                 npm_registry, npm_proxy, npm_https_proxy, npm_strict_ssl,
                 npm_ca_path, proxy_username, credential_target
             FROM network_profiles
             WHERE enabled = 1
               AND is_default = 1
               AND (
                   scope = 'global'
                   OR (scope = 'workspace' AND workspace_id = ?1)
               )
             ORDER BY
                 CASE
                     WHEN scope = 'workspace' AND workspace_id = ?1 THEN 0
                     ELSE 1
                 END,
                 name
             LIMIT 1",
        )?;
        let mut rows = statement.query_map([workspace_id], network_profile_from_row)?;
        rows.next().transpose().map_err(DatabaseError::from)
    }

    pub fn save_network_profile(&self, profile: &NetworkProfile) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let now = unix_timestamp_millis();
        if profile.is_default {
            if profile.scope == "workspace" {
                connection.execute(
                    "UPDATE network_profiles
                     SET is_default = 0
                     WHERE scope = 'workspace' AND workspace_id = ?1",
                    [profile.workspace_id.as_deref()],
                )?;
            } else {
                connection.execute(
                    "UPDATE network_profiles SET is_default = 0 WHERE scope = 'global'",
                    [],
                )?;
            }
        }
        connection.execute(
            "INSERT INTO network_profiles (
                 id, name, scope, workspace_id, enabled, is_default,
                 http_proxy, https_proxy, all_proxy, no_proxy,
                 npm_registry, npm_proxy, npm_https_proxy, npm_strict_ssl,
                 npm_ca_path, proxy_username, credential_target, created_at, updated_at
             )
             VALUES (
                 ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                 ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18
             )
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 scope = excluded.scope,
                 workspace_id = excluded.workspace_id,
                 enabled = excluded.enabled,
                 is_default = excluded.is_default,
                 http_proxy = excluded.http_proxy,
                 https_proxy = excluded.https_proxy,
                 all_proxy = excluded.all_proxy,
                 no_proxy = excluded.no_proxy,
                 npm_registry = excluded.npm_registry,
                 npm_proxy = excluded.npm_proxy,
                 npm_https_proxy = excluded.npm_https_proxy,
                 npm_strict_ssl = excluded.npm_strict_ssl,
                 npm_ca_path = excluded.npm_ca_path,
                 proxy_username = excluded.proxy_username,
                 credential_target = excluded.credential_target,
                 updated_at = excluded.updated_at",
            params![
                profile.id,
                profile.name,
                profile.scope,
                profile.workspace_id,
                profile.enabled,
                profile.is_default,
                profile.http_proxy,
                profile.https_proxy,
                profile.all_proxy,
                profile.no_proxy,
                profile.npm_registry,
                profile.npm_proxy,
                profile.npm_https_proxy,
                profile.npm_strict_ssl,
                profile.npm_ca_path,
                profile.proxy_username,
                profile.credential_target,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn delete_network_profile(&self, profile_id: &str) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        connection.execute("DELETE FROM network_profiles WHERE id = ?1", [profile_id])?;
        Ok(())
    }

    pub fn list_account_profiles(&self) -> Result<Vec<AccountProfile>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT id, name, agent_type, config_dir, is_default, is_system
             FROM account_profiles
             ORDER BY agent_type, is_default DESC, is_system DESC, name",
        )?;
        let rows = statement.query_map([], account_profile_from_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(DatabaseError::from)
    }

    pub fn find_account_profile(
        &self,
        profile_id: &str,
    ) -> Result<Option<AccountProfile>, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT id, name, agent_type, config_dir, is_default, is_system
             FROM account_profiles
             WHERE id = ?1",
        )?;
        let mut rows = statement.query_map([profile_id], account_profile_from_row)?;
        rows.next().transpose().map_err(DatabaseError::from)
    }

    pub fn save_account_profile(&self, profile: &AccountProfile) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        let now = unix_timestamp_millis();
        if profile.is_default {
            connection.execute(
                "UPDATE account_profiles SET is_default = 0 WHERE agent_type = ?1",
                [&profile.agent_type],
            )?;
        }
        connection.execute(
            "INSERT INTO account_profiles (
                 id, name, agent_type, config_dir, is_default, is_system, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 agent_type = excluded.agent_type,
                 config_dir = excluded.config_dir,
                 is_default = excluded.is_default,
                 updated_at = excluded.updated_at",
            params![
                profile.id,
                profile.name,
                profile.agent_type,
                profile.config_dir,
                profile.is_default,
                profile.is_system,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn delete_account_profile(&self, profile_id: &str) -> Result<(), DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        connection.execute(
            "DELETE FROM account_profiles WHERE id = ?1 AND is_system = 0",
            [profile_id],
        )?;
        Ok(())
    }
}

fn ensure_default_profile(connection: &Connection) -> Result<(), DatabaseError> {
    let profile_count: i64 =
        connection.query_row("SELECT COUNT(*) FROM model_profiles", [], |row| row.get(0))?;
    if profile_count == 0 {
        let now = unix_timestamp_millis();
        // The two official endpoints each serve one agent, so neither profile enables the other.
        connection.execute(
            "INSERT INTO model_profiles (
                 id, name, provider, model, api_protocol, is_default, created_at, updated_at,
                 claude_enabled, claude_model, codex_enabled, codex_model
             )
             VALUES ('claude-default', 'Claude Sonnet', 'Anthropic', 'sonnet',
                     'anthropic', 1, ?1, ?1, 1, 'sonnet', 0, '')",
            [now],
        )?;
        connection.execute(
            "INSERT INTO model_profiles (
                 id, name, provider, model, api_protocol, is_default, created_at, updated_at,
                 claude_enabled, claude_model, codex_enabled, codex_model
             )
             VALUES ('codex-default', 'GPT-5.6 Sol', 'OpenAI', 'gpt-5.6-sol',
                     'openai', 0, ?1, ?1, 0, '', 1, 'gpt-5.6-sol')",
            [now],
        )?;
    }
    Ok(())
}

fn migrate_legacy_minimax_m3_model(connection: &Connection) -> Result<(), DatabaseError> {
    let now = unix_timestamp_millis();
    connection.execute(
        "UPDATE model_profiles
         SET model = ?1, updated_at = ?2
         WHERE provider COLLATE NOCASE = 'MiniMax' AND model = ?3",
        params![MINIMAX_M3_MODEL, now, LEGACY_MINIMAX_M3_MODEL],
    )?;
    connection.execute(
        "UPDATE model_profiles
         SET claude_model = ?1, updated_at = ?2
         WHERE provider COLLATE NOCASE = 'MiniMax' AND claude_model = ?3",
        params![MINIMAX_M3_MODEL, now, LEGACY_MINIMAX_M3_MODEL],
    )?;
    connection.execute(
        "UPDATE workspaces
         SET layout_json = replace(layout_json, ?1, ?2), updated_at = ?3
         WHERE instr(layout_json, ?1) > 0",
        params![LEGACY_MINIMAX_M3_MODEL, MINIMAX_M3_MODEL, now],
    )?;
    Ok(())
}

/// Column order every model profile query selects, so the row mapper can index it positionally.
const MODEL_PROFILE_COLUMNS: &str = "id, name, provider, credential_target, is_default, \
     claude_enabled, claude_model, claude_base_url, \
     codex_enabled, codex_model, codex_base_url, plan_alert_threshold";

fn model_profile_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModelProfile> {
    let credential_target: Option<String> = row.get(3)?;
    Ok(ModelProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        provider: row.get(2)?,
        has_credential: credential_target.is_some(),
        credential_target,
        is_default: row.get(4)?,
        claude_enabled: row.get(5)?,
        claude_model: row.get(6)?,
        claude_base_url: row.get(7)?,
        codex_enabled: row.get(8)?,
        codex_model: row.get(9)?,
        codex_base_url: row.get(10)?,
        plan_alert_threshold: row.get(11)?,
    })
}

fn network_profile_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NetworkProfile> {
    let credential_target: Option<String> = row.get(16)?;
    Ok(NetworkProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        scope: row.get(2)?,
        workspace_id: row.get(3)?,
        enabled: row.get(4)?,
        is_default: row.get(5)?,
        http_proxy: row.get(6)?,
        https_proxy: row.get(7)?,
        all_proxy: row.get(8)?,
        no_proxy: row.get(9)?,
        npm_registry: row.get(10)?,
        npm_proxy: row.get(11)?,
        npm_https_proxy: row.get(12)?,
        npm_strict_ssl: row.get(13)?,
        npm_ca_path: row.get(14)?,
        proxy_username: row.get(15)?,
        has_credential: credential_target.is_some(),
        credential_target,
    })
}

fn account_profile_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AccountProfile> {
    Ok(AccountProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        agent_type: row.get(2)?,
        config_dir: row.get(3)?,
        is_default: row.get(4)?,
        is_system: row.get(5)?,
        authenticated: false,
        diagnostic: String::new(),
    })
}

fn unix_timestamp_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn run_api_protocol_migration(connection: &Connection) -> Result<(), DatabaseError> {
    if let Err(error) = connection.execute_batch(API_PROTOCOL_MIGRATION) {
        match error {
            rusqlite::Error::SqliteFailure(_, Some(ref message))
                if message.contains("duplicate column") =>
            {
                // Column already exists — migration is a no-op
            }
            other => return Err(other.into()),
        }
    }
    Ok(())
}

/// Adds the per-agent columns, one statement at a time.
///
/// `execute_batch` abandons the rest of the batch at the first error, so a run interrupted partway
/// would leave the remaining columns missing forever. Applying each `ALTER` on its own and
/// swallowing only "duplicate column" lets a half-applied migration finish on the next startup.
fn run_provider_profile_migration(connection: &Connection) -> Result<(), DatabaseError> {
    for migration in [PROVIDER_PROFILE_MIGRATION, PROVIDER_PLAN_MIGRATION] {
        let sql: String = migration
            .lines()
            .filter(|line| !line.trim_start().starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");
        for statement in sql
            .split(';')
            .map(str::trim)
            .filter(|statement| !statement.is_empty())
        {
            match connection.execute(statement, []) {
                Ok(_) => {}
                Err(rusqlite::Error::SqliteFailure(_, Some(ref message)))
                    if message.contains("duplicate column") => {}
                Err(other) => return Err(other.into()),
            }
        }
    }
    Ok(())
}

/// Moves a pre-split profile onto the side its protocol served.
///
/// Those profiles carry one endpoint, so only the matching agent can reach the provider — turning
/// the other side on would hand it a base URL that answers a different protocol. Rows already
/// carrying a model on either side are left alone, which is what makes this safe to re-run.
fn split_legacy_single_protocol_profiles(connection: &Connection) -> Result<(), DatabaseError> {
    connection.execute(
        "UPDATE model_profiles
         SET claude_model = model,
             claude_base_url = base_url,
             claude_enabled = 1,
             codex_enabled = 0
         WHERE api_protocol = 'anthropic' AND claude_model = '' AND codex_model = ''",
        [],
    )?;
    connection.execute(
        "UPDATE model_profiles
         SET codex_model = model,
             codex_base_url = base_url,
             codex_enabled = 1,
             claude_enabled = 0
         WHERE api_protocol = 'openai' AND claude_model = '' AND codex_model = ''",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset_database() -> WorkspaceDatabase {
        let database = WorkspaceDatabase {
            connection: Mutex::new(Connection::open_in_memory().unwrap()),
        };
        database
            .connection
            .lock()
            .unwrap()
            .execute_batch(V05_ASSETS_MIGRATION)
            .unwrap();
        database
    }

    #[test]
    fn upserts_one_live_draft_per_terminal_and_keeps_history() {
        let database = asset_database();
        let mut draft = PromptAsset {
            id: "draft:terminal-1".into(),
            workspace_id: "workspace-1".into(),
            terminal_id: Some("terminal-1".into()),
            terminal_name: "Claude 1".into(),
            agent_type: "claude".into(),
            kind: "draft".into(),
            content: "first draft".into(),
            redacted: false,
            favorite: false,
            pinned: false,
            created_at: 1,
            updated_at: 1,
        };
        database.save_prompt_asset(&draft).unwrap();
        draft.content = "latest draft".into();
        draft.updated_at = 2;
        database.save_prompt_asset(&draft).unwrap();

        let mut history = draft.clone();
        history.id = "prompt:1".into();
        history.kind = "history".into();
        history.content = "submitted".into();
        database.save_prompt_asset(&history).unwrap();

        let stored = database.list_prompt_assets(Some("workspace-1")).unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(
            stored
                .iter()
                .find(|item| item.kind == "draft")
                .unwrap()
                .content,
            "latest draft"
        );

        database.delete_prompt_asset(&draft.id).unwrap();
        let stored = database.list_prompt_assets(Some("workspace-1")).unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].kind, "history");
    }

    #[test]
    fn saves_and_deletes_handoff_packages_by_workspace() {
        let database = asset_database();
        let record = HandoffRecord {
            id: "handoff-1".into(),
            workspace_id: "workspace-1".into(),
            source_terminal_id: Some("terminal-1".into()),
            title: "Termexo handoff".into(),
            package_json: r#"{"format":"termexo-handoff","version":1}"#.into(),
            created_at: 1,
            updated_at: 2,
        };
        record.validate().unwrap();
        database.save_handoff_package(&record).unwrap();

        let stored = database.list_handoff_packages(Some("workspace-1")).unwrap();
        assert_eq!(stored, vec![record.clone()]);

        database.delete_handoff_package(&record.id).unwrap();
        assert!(database.list_handoff_packages(None).unwrap().is_empty());
    }

    #[test]
    fn validates_prompt_and_handoff_storage_limits() {
        let invalid_draft = PromptAsset {
            id: "draft:missing-terminal".into(),
            workspace_id: "workspace-1".into(),
            terminal_id: None,
            terminal_name: "Claude".into(),
            agent_type: "claude".into(),
            kind: "draft".into(),
            content: "work".into(),
            redacted: false,
            favorite: false,
            pinned: false,
            created_at: 1,
            updated_at: 1,
        };
        assert!(invalid_draft.validate().is_err());

        let invalid_handoff = HandoffRecord {
            id: "handoff-1".into(),
            workspace_id: "workspace-1".into(),
            source_terminal_id: None,
            title: "Invalid".into(),
            package_json: "[]".into(),
            created_at: 1,
            updated_at: 1,
        };
        assert!(invalid_handoff.validate().is_err());
    }

    #[test]
    fn saves_and_lists_workspace_snapshots() {
        let database = WorkspaceDatabase {
            connection: Mutex::new(Connection::open_in_memory().unwrap()),
        };
        database
            .connection
            .lock()
            .unwrap()
            .execute_batch(&format!(
                "{INITIAL_MIGRATION}\n{AGENT_MIGRATION}\n{NETWORK_MIGRATION}\n{ACCOUNT_MIGRATION}\n{V05_ASSETS_MIGRATION}"
            ))
            .unwrap();

        let workspace = Workspace {
            id: "workspace-1".into(),
            name: "Termexo".into(),
            theme_color: "#58c7a0".into(),
            sort_order: 1,
            project_path: "D:\\dev\\termexo".into(),
            project_type: "Angular + Rust".into(),
            active_branch: "main".into(),
            favorite: true,
            last_opened_at: 10,
            layout: "columns".into(),
            grid_columns: 2,
            grid_rows: 2,
            terminals: vec![],
        };

        let mut first_workspace = workspace.clone();
        first_workspace.id = "workspace-2".into();
        first_workspace.name = "Pinned first".into();
        first_workspace.sort_order = 0;
        first_workspace.last_opened_at = 1;

        database.save(&workspace).unwrap();
        database.save(&first_workspace).unwrap();
        let stored = database.list().unwrap();

        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].name, first_workspace.name);
        assert_eq!(stored[1].name, workspace.name);
        assert_eq!(stored[1].layout, workspace.layout);

        database.delete_workspace(&workspace.id).unwrap();
        let stored_after_delete = database.list().unwrap();
        assert_eq!(stored_after_delete.len(), 1);
        assert_eq!(stored_after_delete[0].id, first_workspace.id);
    }

    #[test]
    fn keeps_terminal_launch_profiles_across_snapshots() {
        let database = WorkspaceDatabase {
            connection: Mutex::new(Connection::open_in_memory().unwrap()),
        };
        database
            .connection
            .lock()
            .unwrap()
            .execute_batch(&format!(
                "{INITIAL_MIGRATION}\n{AGENT_MIGRATION}\n{NETWORK_MIGRATION}\n{ACCOUNT_MIGRATION}"
            ))
            .unwrap();

        let workspace = Workspace {
            id: "workspace-1".into(),
            name: "Termexo".into(),
            theme_color: "#58c7a0".into(),
            sort_order: 0,
            project_path: "D:\\dev\\termexo".into(),
            project_type: "Angular + Rust".into(),
            active_branch: "main".into(),
            favorite: false,
            last_opened_at: 10,
            layout: "single".into(),
            grid_columns: 2,
            grid_rows: 2,
            terminals: vec![TerminalSession {
                id: "terminal-1".into(),
                name: "Claude 1".into(),
                working_directory: "D:\\dev\\termexo".into(),
                shell: "powershell".into(),
                agent_type: "claude".into(),
                status: "RUNNING".into(),
                model: "GLM 4.6".into(),
                branch: "main".into(),
                command: Some("claude".into()),
                native_session_id: Some("session-1".into()),
                profile_id: Some("glm-4-6".into()),
                mcp_profile_id: Some("mcp-1".into()),
                account_profile_id: Some("account-1".into()),
            }],
        };

        database.save(&workspace).unwrap();
        let stored = database.list().unwrap();

        assert_eq!(
            stored[0].terminals[0].profile_id.as_deref(),
            Some("glm-4-6")
        );
        assert_eq!(
            stored[0].terminals[0].mcp_profile_id.as_deref(),
            Some("mcp-1")
        );
    }

    #[test]
    fn restores_legacy_workspace_grid_defaults() {
        let workspace: Workspace = serde_json::from_str(
            r#"{
                "id": "workspace-legacy",
                "name": "Legacy",
                "projectPath": "D:\\dev\\legacy",
                "projectType": "Local project",
                "activeBranch": "main",
                "favorite": false,
                "lastOpenedAt": 10,
                "layout": "grid",
                "terminals": []
            }"#,
        )
        .unwrap();

        assert_eq!(workspace.grid_columns, 2);
        assert_eq!(workspace.grid_rows, 2);
        assert_eq!(workspace.theme_color, "#58c7a0");
        assert_eq!(workspace.sort_order, 0);
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
            .execute_batch(&format!(
                "{INITIAL_MIGRATION}\n{AGENT_MIGRATION}\n{NETWORK_MIGRATION}\n{ACCOUNT_MIGRATION}"
            ))
            .unwrap();
        let session = AgentSession {
            id: "claude:session-1".into(),
            agent_type: "claude".into(),
            native_session_id: "session-1".into(),
            account_profile_id: None,
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
            .execute_batch(&format!(
                "{INITIAL_MIGRATION}\n{AGENT_MIGRATION}\n{NETWORK_MIGRATION}\n{ACCOUNT_MIGRATION}"
            ))
            .unwrap();
        run_provider_profile_migration(&database.connection.lock().unwrap()).unwrap();
        let model = ModelProfile {
            id: "profile-1".into(),
            name: "Gateway Sonnet".into(),
            provider: "Anthropic".into(),
            credential_target: Some("model-profile:profile-1".into()),
            is_default: true,
            has_credential: true,
            claude_enabled: true,
            claude_model: "sonnet".into(),
            claude_base_url: Some("https://gateway.example.com/anthropic".into()),
            codex_enabled: true,
            codex_model: "gpt-5.6-sol".into(),
            codex_base_url: Some("https://gateway.example.com/v1".into()),
            plan_alert_threshold: 80,
        };
        let mcp = McpProfile {
            id: "mcp-1".into(),
            name: "Local tools".into(),
            config_json: r#"{"mcpServers":{}}"#.into(),
        };

        database.save_model_profile(&model).unwrap();
        database.save_mcp_profile(&mcp).unwrap();

        let profiles = database.list_model_profiles().unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].plan_alert_threshold, 80);
        assert_eq!(database.list_mcp_profiles().unwrap().len(), 1);
        assert!(
            database
                .find_model_profile("profile-1")
                .unwrap()
                .unwrap()
                .has_credential
        );
    }

    #[test]
    fn migrates_legacy_minimax_m3_profiles_and_resume_commands() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(&format!(
                "{INITIAL_MIGRATION}\n{AGENT_MIGRATION}\n{NETWORK_MIGRATION}\n{ACCOUNT_MIGRATION}"
            ))
            .unwrap();
        connection
            .execute(
                "INSERT INTO model_profiles (
                     id, name, provider, model, base_url, is_default, created_at, updated_at
                 ) VALUES ('minimax', 'MiniMax M3', 'MiniMax', ?1,
                     'https://api.minimaxi.com/anthropic', 1, 1, 1)",
                [LEGACY_MINIMAX_M3_MODEL],
            )
            .unwrap();
        run_provider_profile_migration(&connection).unwrap();
        split_legacy_single_protocol_profiles(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO workspaces (
                     id, name, project_path, project_type, active_branch,
                     layout_json, created_at, updated_at, last_opened_at
                 ) VALUES ('workspace-1', 'Workspace', 'D:\\dev', 'Local', 'main', ?1, 1, 1, 1)",
                [format!(
                    r#"{{"terminals":[{{"command":"claude --model '{}' --resume session-1"}}]}}"#,
                    LEGACY_MINIMAX_M3_MODEL
                )],
            )
            .unwrap();

        migrate_legacy_minimax_m3_model(&connection).unwrap();

        let model: String = connection
            .query_row(
                "SELECT model FROM model_profiles WHERE id = 'minimax'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let layout_json: String = connection
            .query_row(
                "SELECT layout_json FROM workspaces WHERE id = 'workspace-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let claude_model: String = connection
            .query_row(
                "SELECT claude_model FROM model_profiles WHERE id = 'minimax'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(model, MINIMAX_M3_MODEL);
        assert_eq!(claude_model, MINIMAX_M3_MODEL);
        assert!(layout_json.contains(MINIMAX_M3_MODEL));
        assert!(!layout_json.contains(LEGACY_MINIMAX_M3_MODEL));
    }

    #[test]
    fn moves_a_pre_split_profile_onto_the_side_its_protocol_served() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(&format!(
                "{INITIAL_MIGRATION}\n{AGENT_MIGRATION}\n{NETWORK_MIGRATION}\n{ACCOUNT_MIGRATION}"
            ))
            .unwrap();
        connection
            .execute(
                "INSERT INTO model_profiles (
                     id, name, provider, model, base_url, api_protocol,
                     is_default, created_at, updated_at
                 ) VALUES ('glm', 'GLM', 'GLM', 'glm-5.2',
                     'https://open.bigmodel.cn/api/paas/v4', 'openai', 0, 1, 1)",
                [],
            )
            .unwrap();
        run_provider_profile_migration(&connection).unwrap();

        split_legacy_single_protocol_profiles(&connection).unwrap();
        // Re-running must not disturb the result, since every migration replays on each startup.
        split_legacy_single_protocol_profiles(&connection).unwrap();

        let (claude_enabled, codex_enabled, codex_model, codex_base_url): (
            bool,
            bool,
            String,
            String,
        ) = connection
            .query_row(
                "SELECT claude_enabled, codex_enabled, codex_model, codex_base_url
                 FROM model_profiles WHERE id = 'glm'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();

        assert!(codex_enabled);
        assert_eq!(codex_model, "glm-5.2");
        assert_eq!(codex_base_url, "https://open.bigmodel.cn/api/paas/v4");
        // The Claude side has no endpoint of its own, so it stays off rather than borrowing one.
        assert!(!claude_enabled);
    }

    #[test]
    fn resolves_workspace_network_profile_before_global_default() {
        let database = WorkspaceDatabase {
            connection: Mutex::new(Connection::open_in_memory().unwrap()),
        };
        database
            .connection
            .lock()
            .unwrap()
            .execute_batch(&format!(
                "{INITIAL_MIGRATION}\n{AGENT_MIGRATION}\n{NETWORK_MIGRATION}\n{ACCOUNT_MIGRATION}"
            ))
            .unwrap();
        let global = test_network_profile("global", "global", None);
        let workspace = test_network_profile("workspace", "workspace", Some("workspace-1"));

        database.save_network_profile(&global).unwrap();
        database.save_network_profile(&workspace).unwrap();

        assert_eq!(
            database
                .find_effective_network_profile(Some("workspace-1"))
                .unwrap()
                .unwrap()
                .id,
            "workspace"
        );
        assert_eq!(
            database
                .find_effective_network_profile(Some("workspace-2"))
                .unwrap()
                .unwrap()
                .id,
            "global"
        );
        assert_eq!(database.list_network_profiles().unwrap().len(), 2);
    }

    #[test]
    fn saves_isolated_account_profiles_and_keeps_one_default_per_agent() {
        let database = WorkspaceDatabase {
            connection: Mutex::new(Connection::open_in_memory().unwrap()),
        };
        database
            .connection
            .lock()
            .unwrap()
            .execute_batch(&format!(
                "{INITIAL_MIGRATION}\n{AGENT_MIGRATION}\n{NETWORK_MIGRATION}\n{ACCOUNT_MIGRATION}"
            ))
            .unwrap();
        let first = AccountProfile {
            id: "claude-one".into(),
            name: "Claude One".into(),
            agent_type: "claude".into(),
            config_dir: Some("C:\\accounts\\claude-one".into()),
            is_default: true,
            is_system: false,
            authenticated: false,
            diagnostic: String::new(),
        };
        let second = AccountProfile {
            id: "claude-two".into(),
            name: "Claude Two".into(),
            config_dir: Some("C:\\accounts\\claude-two".into()),
            ..first.clone()
        };

        database.save_account_profile(&first).unwrap();
        database.save_account_profile(&second).unwrap();

        let profiles = database.list_account_profiles().unwrap();
        assert!(profiles
            .iter()
            .any(|profile| profile.id == second.id && profile.is_default));
        assert!(profiles
            .iter()
            .any(|profile| profile.id == first.id && !profile.is_default));
        assert_eq!(
            database
                .find_account_profile(&second.id)
                .unwrap()
                .unwrap()
                .config_dir,
            second.config_dir
        );
    }

    fn test_network_profile(id: &str, scope: &str, workspace_id: Option<&str>) -> NetworkProfile {
        NetworkProfile {
            id: id.into(),
            name: id.into(),
            scope: scope.into(),
            workspace_id: workspace_id.map(str::to_owned),
            enabled: true,
            is_default: true,
            http_proxy: None,
            https_proxy: Some("http://127.0.0.1:8080".into()),
            all_proxy: None,
            no_proxy: Some("localhost".into()),
            npm_registry: Some("https://registry.npmjs.org/".into()),
            npm_proxy: None,
            npm_https_proxy: None,
            npm_strict_ssl: true,
            npm_ca_path: None,
            proxy_username: None,
            credential_target: None,
            has_credential: false,
        }
    }
}
