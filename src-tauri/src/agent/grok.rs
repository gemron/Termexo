use std::cmp::Reverse;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, UNIX_EPOCH};

use serde_json::Value;
use thiserror::Error;

use super::{AgentAdapter, AgentInstallation, AgentLaunchSpec, AgentSession, GrokLaunchOptions};
use crate::process::{hidden_command, run_with_timeout};

const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const GROK_PATH_ENV: &str = "TERMEXO_GROK_PATH";

#[derive(Debug, Error)]
pub enum GrokError {
    #[error("未安装 Grok Build")]
    NotInstalled,
    #[error("无法读取 Grok Build 会话：{0}")]
    SessionIo(#[from] std::io::Error),
}

#[derive(Debug, Default)]
pub struct GrokBuildAdapter {
    executable_override: Option<PathBuf>,
    home_override: Option<PathBuf>,
}

impl GrokBuildAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    fn with_paths(executable: PathBuf, home: PathBuf) -> Self {
        Self {
            executable_override: Some(executable),
            home_override: Some(home),
        }
    }

    fn find_executable(&self) -> Option<PathBuf> {
        if let Some(executable) = &self.executable_override {
            return executable.is_file().then(|| executable.clone());
        }
        let mut candidates = Vec::new();
        if let Some(configured) = env::var_os(GROK_PATH_ENV) {
            candidates.push(PathBuf::from(configured));
        }
        #[cfg(windows)]
        {
            candidates.extend(command_paths("grok.exe"));
            candidates.extend(command_paths("grok.cmd"));
            if let Some(user_profile) = env::var_os("USERPROFILE") {
                candidates.push(PathBuf::from(&user_profile).join(".grok/bin/grok.exe"));
                candidates.push(PathBuf::from(user_profile).join("AppData/Roaming/npm/grok.cmd"));
            }
        }
        #[cfg(not(windows))]
        candidates.extend(command_paths("grok"));
        candidates.into_iter().find(|path| path.is_file())
    }

    fn home(&self) -> Option<PathBuf> {
        self.home_override.clone().or_else(|| {
            env::var_os("GROK_HOME").map(PathBuf::from).or_else(|| {
                env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                    .map(|path| PathBuf::from(path).join(".grok"))
            })
        })
    }

    fn version(&self, executable: &Path) -> Option<String> {
        let mut command = query_command(executable);
        command.arg("version");
        let output = run_with_timeout(&mut command, VERSION_TIMEOUT).ok()?;
        if !output.status.success() {
            return None;
        }
        let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        (!version.is_empty()).then_some(version)
    }
}

impl AgentAdapter for GrokBuildAdapter {
    type Error = GrokError;
    type LaunchOptions = GrokLaunchOptions;

    fn detect(&self) -> Result<AgentInstallation, Self::Error> {
        let Some(executable) = self.find_executable() else {
            return Ok(AgentInstallation {
                agent_type: "grok".into(),
                installed: false,
                executable_path: None,
                version: None,
                healthy: false,
                diagnostic: "未检测到 Grok Build，请先安装后重试。".into(),
            });
        };
        let version = self.version(&executable);
        let healthy = version.is_some();
        Ok(AgentInstallation {
            agent_type: "grok".into(),
            installed: true,
            executable_path: Some(executable.to_string_lossy().into_owned()),
            version,
            healthy,
            diagnostic: if healthy {
                "Grok Build 可用".into()
            } else {
                "已找到 Grok Build，但版本检测失败。".into()
            },
        })
    }

    fn list_sessions(&self, project_path: Option<&str>) -> Result<Vec<AgentSession>, Self::Error> {
        let Some(home) = self.home() else {
            return Ok(Vec::new());
        };
        let root = home.join("sessions");
        if !root.is_dir() {
            return Ok(Vec::new());
        }
        let mut sessions = Vec::new();
        for group in fs::read_dir(root)?.flatten() {
            if !group.path().is_dir() {
                continue;
            }
            for entry in fs::read_dir(group.path())?.flatten() {
                let summary_path = entry.path().join("summary.json");
                let Ok(contents) = fs::read(&summary_path) else {
                    continue;
                };
                let Ok(summary) = serde_json::from_slice::<Value>(&contents) else {
                    continue;
                };
                let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
                    continue;
                };
                let cwd = summary
                    .pointer("/info/cwd")
                    .or_else(|| summary.pointer("/info/working_directory"))
                    .or_else(|| summary.get("cwd"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                if project_path.is_some_and(|expected| {
                    !cwd.as_deref()
                        .is_some_and(|actual| paths_equal(actual, expected))
                }) {
                    continue;
                }
                let modified = summary_path
                    .metadata()
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis() as i64)
                    .unwrap_or_default();
                let title = ["generated_title", "session_summary", "title"]
                    .iter()
                    .find_map(|key| summary.get(*key).and_then(Value::as_str))
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or("Grok Build session")
                    .to_owned();
                let timestamp = |key: &str| {
                    summary
                        .get(key)
                        .and_then(Value::as_i64)
                        .map(|value| {
                            if value < 10_000_000_000 {
                                value * 1000
                            } else {
                                value
                            }
                        })
                        .unwrap_or(modified)
                };
                sessions.push(AgentSession {
                    id: format!("grok:{id}"),
                    agent_type: "grok".into(),
                    native_session_id: id,
                    account_profile_id: None,
                    project_path: cwd,
                    model_name: summary
                        .get("current_model_id")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    title,
                    summary: summary
                        .get("session_summary")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    branch: None,
                    status: "HISTORICAL".into(),
                    message_count: summary
                        .get("num_chat_messages")
                        .and_then(Value::as_u64)
                        .unwrap_or_default() as u32,
                    transcript_path: entry
                        .path()
                        .join("updates.jsonl")
                        .to_string_lossy()
                        .into_owned(),
                    created_at: timestamp("created_at"),
                    last_used_at: timestamp("updated_at"),
                });
            }
        }
        sessions.sort_by_key(|session| Reverse(session.last_used_at));
        Ok(sessions)
    }

    fn build_launch_command(
        &self,
        options: &GrokLaunchOptions,
    ) -> Result<AgentLaunchSpec, Self::Error> {
        let executable = self.find_executable().ok_or(GrokError::NotInstalled)?;
        let mut command = format!("& {}", powershell_quote(&executable.to_string_lossy()));
        if let Some(session_id) = options
            .session_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            command.push_str(" --resume ");
            command.push_str(&powershell_quote(session_id));
        } else if options.continue_last {
            command.push_str(" --continue");
        } else if let Some(new_session_id) = options
            .new_session_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            command.push_str(" --session-id ");
            command.push_str(&powershell_quote(new_session_id));
        }
        if let Some(model) = options
            .model
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            command.push_str(" --model ");
            command.push_str(&powershell_quote(model));
        }
        if options.auto_confirm {
            command.push_str(" --always-approve");
        }
        Ok(AgentLaunchSpec {
            command,
            executable_path: executable.to_string_lossy().into_owned(),
        })
    }
}

fn command_paths(command: &str) -> Vec<PathBuf> {
    env::var_os("PATH")
        .map(|value| {
            env::split_paths(&value)
                .map(|dir| dir.join(command))
                .collect()
        })
        .unwrap_or_default()
}

fn query_command(executable: &Path) -> Command {
    #[cfg(windows)]
    if executable
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd"))
    {
        let mut command = hidden_command("cmd.exe");
        command.args(["/d", "/c", "call"]).arg(executable);
        return command;
    }
    hidden_command(executable)
}

fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn paths_equal(left: &str, right: &str) -> bool {
    let normalize = |value: &str| {
        value
            .trim_end_matches(['\\', '/'])
            .replace('/', "\\")
            .to_lowercase()
    };
    normalize(left) == normalize(right)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn builds_documented_launch_flags_and_reads_session_summary() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("termexo-grok-{unique}"));
        let executable = root.join("grok.exe");
        let session_dir = root.join("home/sessions/group/123e4567-e89b-12d3-a456-426614174000");
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(&executable, "").unwrap();
        fs::write(session_dir.join("summary.json"), r#"{"info":{"cwd":"D:\\dev\\Termexo"},"generated_title":"A Grok task","current_model_id":"grok-build","num_chat_messages":4,"created_at":1000,"updated_at":2000}"#).unwrap();
        let adapter = GrokBuildAdapter::with_paths(executable, root.join("home"));
        let launch = adapter
            .build_launch_command(&GrokLaunchOptions {
                session_id: Some("id'quoted".into()),
                new_session_id: None,
                model: Some("grok-build".into()),
                continue_last: true,
                auto_confirm: true,
            })
            .unwrap();
        assert!(launch.command.contains("--resume 'id''quoted'"));
        assert!(!launch.command.contains("--continue"));
        assert!(launch
            .command
            .contains("--model 'grok-build' --always-approve"));
        let fresh = adapter
            .build_launch_command(&GrokLaunchOptions {
                session_id: None,
                new_session_id: Some("123e4567-e89b-12d3-a456-426614174000".into()),
                model: None,
                continue_last: false,
                auto_confirm: false,
            })
            .unwrap();
        assert!(fresh
            .command
            .contains("--session-id '123e4567-e89b-12d3-a456-426614174000'"));
        let sessions = adapter.list_sessions(Some("D:/dev/Termexo")).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "A Grok task");
        assert_eq!(sessions[0].last_used_at, 2_000_000);
        fs::remove_dir_all(root).unwrap();
    }
}
