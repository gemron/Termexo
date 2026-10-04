//! Local MCP access to the desktop's existing business workflows.
mod agents;
mod proxy;
mod server;
mod tools;
pub(crate) use proxy::run_proxy_from_cli;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

use crate::config::CredentialStore;
use crate::database::WorkspaceDatabase;
use crate::remote::token::{generate_token, tokens_match};

const SETTINGS_KEY: &str = "mcp-server";
const CREDENTIAL_TARGET: &str = "mcp-server-token";
const REQUEST_EVENT: &str = "mcp-tool-request";
const MAIN_WINDOW: &str = "main";
const TOOL_TIMEOUT: Duration = Duration::from_secs(60);
const DEFAULT_PORT: u16 = 7421;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct McpSettings {
    pub enabled: bool,
    pub auto_connect_agents: bool,
    pub port: u16,
    pub terminal_access: bool,
    pub task_access: bool,
    pub settings_access: bool,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            auto_connect_agents: true,
            port: DEFAULT_PORT,
            terminal_access: true,
            task_access: true,
            settings_access: false,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub settings: McpSettings,
    pub running: bool,
    pub error: Option<String>,
    pub url: String,
    pub token: String,
}

type ToolResult = Result<Value, String>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolRequest {
    id: String,
    name: String,
    arguments: Value,
    deadline: u64,
}

pub struct McpManager {
    app: AppHandle,
    settings: RwLock<McpSettings>,
    token: RwLock<String>,
    error: RwLock<Option<String>>,
    running: AsyncMutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pending: Mutex<HashMap<String, oneshot::Sender<ToolResult>>>,
    /// Only one automation action enters the desktop at a time; this also bounds pending state.
    action: AsyncMutex<()>,
    changes: AsyncMutex<()>,
    ready: AtomicBool,
    agent_configs: Mutex<()>,
}

impl McpManager {
    pub fn new(app: AppHandle) -> Result<Arc<Self>, String> {
        let saved = app
            .state::<WorkspaceDatabase>()
            .read_app_setting(SETTINGS_KEY)
            .map_err(|e| e.to_string())?;
        let (settings, error) = match saved.map(|json| serde_json::from_str(&json)).transpose() {
            Ok(settings) => (settings.unwrap_or_default(), None),
            Err(error) => (
                McpSettings::default(),
                Some(format!("Invalid saved MCP settings: {error}")),
            ),
        };
        Ok(Arc::new(Self {
            app,
            settings: RwLock::new(settings),
            token: RwLock::new(String::new()),
            error: RwLock::new(error),
            running: AsyncMutex::new(None),
            pending: Mutex::new(HashMap::new()),
            action: AsyncMutex::new(()),
            changes: AsyncMutex::new(()),
            ready: AtomicBool::new(false),
            agent_configs: Mutex::new(()),
        }))
    }

    pub fn settings(&self) -> McpSettings {
        self.settings
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn authorized(&self, token: &str) -> bool {
        let expected = self.token.read().unwrap_or_else(|e| e.into_inner());
        !expected.is_empty() && tokens_match(&expected, token)
    }

    pub async fn status(&self) -> McpStatus {
        let settings = self.settings();
        let running = self
            .running
            .lock()
            .await
            .as_ref()
            .is_some_and(|task| !task.inner().is_finished());
        McpStatus {
            url: format!("http://127.0.0.1:{}/mcp", settings.port),
            settings,
            running,
            token: self.token.read().unwrap_or_else(|e| e.into_inner()).clone(),
            error: self.error.read().unwrap_or_else(|e| e.into_inner()).clone(),
        }
    }

    pub async fn start_if_enabled(self: &Arc<Self>) {
        let _changes = self.changes.lock().await;
        if let Err(error) = self.restart().await {
            *self.error.write().unwrap_or_else(|e| e.into_inner()) = Some(error);
        }
    }

    /// Run at the actual PTY spawn, so restores and task launches get current settings too.
    pub fn prepare_agent_launch(
        &self,
        request: &mut crate::commands::terminal::TerminalStartRequest,
        environment: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        let _configs = self.agent_configs.lock().unwrap_or_else(|e| e.into_inner());
        let settings = self.settings();
        if !settings.enabled || !settings.auto_connect_agents {
            return Ok(());
        }
        if !matches!(
            request.agent_type.as_deref(),
            Some("claude" | "codex" | "opencode" | "grok" | "antigravity")
        ) || request.command.is_none()
        {
            return Ok(());
        }
        if !self.ready.load(Ordering::Acquire) {
            return Err("Termexo MCP 服务尚未启动，请检查 AI 操控（MCP）设置后重试。".into());
        }
        let database = self
            .app
            .state::<crate::storage::DataDirectories>()
            .active
            .join("agentdock.db");
        agents::inject(
            request,
            environment,
            &std::env::current_exe().map_err(|e| e.to_string())?,
            &database,
        )
    }

    pub async fn update(self: &Arc<Self>, settings: McpSettings) -> Result<McpStatus, String> {
        let _changes = self.changes.lock().await;
        if settings.port == 0 {
            return Err("MCP port must be between 1 and 65535".into());
        }
        self.app
            .state::<WorkspaceDatabase>()
            .write_app_setting(
                SETTINGS_KEY,
                &serde_json::to_string(&settings).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        *self.settings.write().unwrap_or_else(|e| e.into_inner()) = settings;
        if let Err(error) = self.restart().await {
            *self.error.write().unwrap_or_else(|e| e.into_inner()) = Some(error);
        }
        Ok(self.status().await)
    }

    pub async fn regenerate_token(&self) -> Result<McpStatus, String> {
        let _changes = self.changes.lock().await;
        let token = generate_token().map_err(|e| e.to_string())?;
        self.app
            .state::<CredentialStore>()
            .set(CREDENTIAL_TARGET, &token)
            .map_err(|e| e.to_string())?;
        *self.token.write().unwrap_or_else(|e| e.into_inner()) = token;
        Ok(self.status().await)
    }

    async fn restart(self: &Arc<Self>) -> Result<(), String> {
        self.ready.store(false, Ordering::Release);
        let mut running = self.running.lock().await;
        if let Some(task) = running.take() {
            task.abort();
            let _ = task.await;
        }
        *self.error.write().unwrap_or_else(|e| e.into_inner()) = None;
        if !self.settings().enabled || !self.settings().auto_connect_agents {
            let _configs = self.agent_configs.lock().unwrap_or_else(|e| e.into_inner());
            let database = self
                .app
                .state::<crate::storage::DataDirectories>()
                .active
                .join("agentdock.db");
            if let Err(error) = agents::remove_global_configs(&database) {
                *self.error.write().unwrap_or_else(|e| e.into_inner()) = Some(error);
            }
        }
        if !self.settings().enabled {
            return Ok(());
        }
        let credentials = self.app.state::<CredentialStore>();
        let token = match credentials
            .get_optional(CREDENTIAL_TARGET)
            .map_err(|e| e.to_string())?
        {
            Some(token) => token,
            None => {
                let token = generate_token().map_err(|e| e.to_string())?;
                credentials
                    .set(CREDENTIAL_TARGET, &token)
                    .map_err(|e| e.to_string())?;
                token
            }
        };
        *self.token.write().unwrap_or_else(|e| e.into_inner()) = token;
        let listener =
            tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, self.settings().port))
                .await
                .map_err(|e| format!("Cannot start local MCP server: {e}"))?;
        let manager = self.clone();
        *running = Some(tauri::async_runtime::spawn(async move {
            if let Err(error) = axum::serve(listener, server::router(manager.clone())).await {
                manager.ready.store(false, Ordering::Release);
                *manager.error.write().unwrap_or_else(|e| e.into_inner()) =
                    Some(format!("MCP server stopped: {error}"));
            }
        }));
        self.ready.store(true, Ordering::Release);
        Ok(())
    }

    pub async fn call(self: &Arc<Self>, name: &str, arguments: Value) -> ToolResult {
        let tool = tools::catalog()
            .into_iter()
            .find(|tool| tool["name"] == name)
            .ok_or("Unknown MCP tool")?;
        tools::validate_arguments(&tool["inputSchema"], &arguments)?;
        let _action = self
            .action
            .try_lock()
            .map_err(|_| "Another MCP action is in progress; try again when it finishes")?;
        let settings = self.settings();
        if !settings.enabled || !tools::allowed(&tool, &settings) {
            return Err("MCP access to this tool is disabled".into());
        }
        let id = generate_token().map_err(|e| e.to_string())?;
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.clone(), sender);
        let _pending = PendingRequest {
            manager: self.clone(),
            id: id.clone(),
        };
        let deadline = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
            + TOOL_TIMEOUT.as_millis() as u64;
        self.app
            .emit_to(
                MAIN_WINDOW,
                REQUEST_EVENT,
                ToolRequest {
                    id,
                    name: name.into(),
                    arguments,
                    deadline,
                },
            )
            .map_err(|e| e.to_string())?;
        let result = tokio::time::timeout(TOOL_TIMEOUT, receiver).await.map_err(|_| "Desktop MCP action timed out. It may have started; check its state before retrying.")?.map_err(|_| "Desktop MCP responder disconnected")?;
        // Arguments, terminal contents and credentials are deliberately never logged.
        tracing::info!(
            tool = name,
            success = result.is_ok(),
            "MCP desktop action finished"
        );
        result
    }

    pub fn complete(&self, id: &str, result: ToolResult) -> Result<(), String> {
        let sender = self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id)
            .ok_or("MCP request expired or was already completed")?;
        sender
            .send(result)
            .map_err(|_| "MCP caller disconnected".into())
    }
}

struct PendingRequest {
    manager: Arc<McpManager>,
    id: String,
}
impl Drop for PendingRequest {
    fn drop(&mut self) {
        self.manager
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
    }
}
