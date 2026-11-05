//! Optional Codex plugin; One Ring owns tasks, Termexo presents Workers using existing PTYs.
mod bridge;
mod install;
pub mod settings;

use crate::agent::codex_config::append_overrides;
use crate::commands::terminal::TerminalStartRequest;
use crate::database::WorkspaceDatabase;
use serde_json::{json, Value};
use settings::{Settings, PLUGIN_ID};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

type Completion = tokio::sync::oneshot::Sender<Result<(), String>>;

pub struct OneRingManager {
    app: AppHandle,
    url: String,
    hosts: Mutex<HashMap<String, bridge::Host>>,
    pending: Mutex<HashMap<String, Completion>>,
    installations: Mutex<HashMap<PathBuf, install::Installation>>,
}

impl OneRingManager {
    pub fn new(app: AppHandle) -> Result<Arc<Self>, String> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let manager = Arc::new(Self {
            app,
            url: format!(
                "http://127.0.0.1:{}/worker",
                listener.local_addr().map_err(|e| e.to_string())?.port()
            ),
            hosts: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            installations: Mutex::new(HashMap::new()),
        });
        let state = manager.clone();
        tauri::async_runtime::spawn(async move {
            let result = async {
                axum::serve(
                    tokio::net::TcpListener::from_std(listener)?,
                    bridge::router(state),
                )
                .await
            }
            .await;
            if let Err(error) = result {
                tracing::error!(%error, "One Ring 终端连接服务退出");
            }
        });
        Ok(manager)
    }

    fn state_directory(&self) -> PathBuf {
        self.app
            .state::<crate::storage::DataDirectories>()
            .active
            .join("plugins/one-ring/state")
    }

    pub fn prepare_agent_launch(
        &self,
        request: &mut TerminalStartRequest,
        environment: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        if request.account_login || request.agent_type.as_deref() != Some("codex") {
            return Ok(());
        }
        let Some(command) = request.command.as_mut() else {
            return Ok(());
        };
        let database = self.app.state::<WorkspaceDatabase>();
        let settings = Settings::load(&database)?;
        if !settings.enabled {
            if install::managed(&database, environment)? {
                append_overrides(
                    command,
                    &[
                        format!("plugins.\"{PLUGIN_ID}\".enabled=false"),
                        "mcp_servers.one_ring.enabled=false".into(),
                    ],
                );
            }
            return Ok(());
        }
        settings.validate()?;
        let workspace_id = request
            .workspace_id
            .clone()
            .ok_or("One Ring Host 必须属于一个工作区。")?;
        let installation = {
            let mut cache = self.installations.lock().map_err(|e| e.to_string())?;
            install::ensure(&settings, environment, &database, &mut cache)?
        };
        // Two viewers may prepare the same PTY concurrently. Keep its token stable so the losing
        // attach cannot revoke the MCP connection of the process that actually starts.
        let token = {
            let mut hosts = self.hosts.lock().map_err(|e| e.to_string())?;
            hosts
                .entry(request.terminal_id.clone())
                .or_insert(bridge::Host {
                    token: crate::remote::token::generate_token().map_err(|e| e.to_string())?,
                    workspace_id,
                })
                .token
                .clone()
        };
        let state = self.state_directory();
        std::fs::create_dir_all(&state).map_err(|e| e.to_string())?;
        let transport = json!({"command": settings.node_path, "args": [installation.runtime], "enabled": true,
            "env_vars": ["CODEX_HOME", "OPENAI_API_KEY", "OPENAI_BASE_URL", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY"],
            "env": {"PATH": installation.path, "ONE_RING_TERMINAL_BRIDGE_URL": self.url, "ONE_RING_TERMINAL_BRIDGE_TOKEN": token, "ONE_RING_STATE_DIR": state}});
        append_overrides(
            command,
            &[
                "features.plugins=true".into(),
                format!("plugins.\"{PLUGIN_ID}\".enabled=true"),
                format!("mcp_servers.one_ring={}", inline_toml(&transport)?),
            ],
        );
        Ok(())
    }

    pub fn complete(&self, id: &str, error: Option<String>) -> Result<(), String> {
        self.pending
            .lock()
            .map_err(|e| e.to_string())?
            .remove(id)
            .ok_or("One Ring 终端请求已过期。")?
            .send(error.map_or(Ok(()), Err))
            .map_err(|_| "One Ring 终端请求已断开。".into())
    }
}

fn inline_toml(value: &Value) -> Result<String, String> {
    match value {
        Value::String(text) => crate::hooks::toml_literal(text).map_err(|e| e.to_string()),
        Value::Bool(value) => Ok(value.to_string()),
        Value::Array(values) => Ok(format!(
            "[{}]",
            values
                .iter()
                .map(inline_toml)
                .collect::<Result<Vec<_>, _>>()?
                .join(",")
        )),
        Value::Object(values) => Ok(format!(
            "{{{}}}",
            values
                .iter()
                .map(|(key, value)| Ok(format!(
                    "{}={}",
                    serde_json::to_string(key).map_err(|e| e.to_string())?,
                    inline_toml(value)?
                )))
                .collect::<Result<Vec<_>, String>>()?
                .join(",")
        )),
        _ => Err("不支持的 One Ring 配置值。".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plugin_transport_roundtrips_paths_and_quoted_values() {
        let expected = json!({"command":"/Node dir/node", "args":["/plugin's/server.mjs"], "enabled":true, "env":{"ONE_RING_STATE_DIR":"/data dir"}});
        let parsed: toml::Value =
            toml::from_str(&format!("server={}", inline_toml(&expected).unwrap())).unwrap();
        assert_eq!(serde_json::to_value(&parsed["server"]).unwrap(), expected);
    }
    #[test]
    fn default_settings_keep_the_plugin_disabled() {
        assert!(!Settings::default().enabled);
    }
}
