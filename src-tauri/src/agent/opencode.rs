use std::cmp::Reverse;
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;

use super::{
    AgentAdapter, AgentInstallation, AgentLaunchSpec, AgentSession, OpenCodeLaunchOptions,
};
use crate::process::{hidden_command, run_with_timeout};

const AGENT_TYPE: &str = "opencode";
const SESSION_STATUS: &str = "HISTORICAL";
const OPENCODE_PATH_ENV: &str = "TERMEXO_OPENCODE_PATH";
/// Auto-approves every permission OpenCode does not explicitly deny.
const AUTO_CONFIRM_FLAG: &str = "--auto";
/// Keeps a probe from loading the external plugins a user's own OpenCode config may install,
/// including the one Termexo writes for a terminal.
const PURE_MODE_FLAG: &str = "--pure";
/// Version probes run while the user waits on agent detection at startup.
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
/// The session list is read from the CLI rather than from files, so it needs its own ceiling.
const SESSION_LIST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Error)]
pub enum OpenCodeError {
    #[error("未安装 OpenCode")]
    NotInstalled,
    #[error("无法读取 OpenCode 会话：{0}")]
    SessionCommand(String),
    #[error("无法解析 OpenCode 会话：{0}")]
    SessionJson(#[from] serde_json::Error),
    #[error("无法执行 OpenCode 命令：{0}")]
    CommandFailed(String),
}

#[derive(Debug, Default)]
pub struct OpenCodeAdapter {
    executable_override: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeSession {
    id: String,
    title: String,
    updated: i64,
    created: i64,
    directory: String,
}

impl OpenCodeAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    fn with_executable(executable: PathBuf) -> Self {
        Self {
            executable_override: Some(executable),
        }
    }

    fn find_executable(&self) -> Option<PathBuf> {
        if let Some(executable) = self.executable_override.as_ref() {
            return executable.is_file().then(|| executable.clone());
        }

        let mut candidates = Vec::new();
        if let Some(configured) = env::var_os(OPENCODE_PATH_ENV) {
            candidates.push(PathBuf::from(configured));
        }

        #[cfg(windows)]
        {
            candidates.extend(command_paths("opencode.exe"));
            candidates.extend(command_paths("opencode.cmd"));
            if let Some(app_data) = env::var_os("APPDATA") {
                candidates.push(PathBuf::from(app_data).join("npm").join("opencode.cmd"));
            }
            if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
                candidates.push(
                    PathBuf::from(local_app_data)
                        .join("opencode")
                        .join("bin")
                        .join("opencode.exe"),
                );
            }
            if let Some(user_profile) = env::var_os("USERPROFILE") {
                candidates.push(
                    PathBuf::from(user_profile)
                        .join(".opencode")
                        .join("bin")
                        .join("opencode.exe"),
                );
            }
        }

        #[cfg(not(windows))]
        candidates.extend(command_paths("opencode"));

        candidates.into_iter().find(|path| path.is_file())
    }

    /// Runs a read-only OpenCode query, bounded so a stuck CLI cannot hang the caller.
    fn run(&self, arguments: &[&str], timeout: Duration) -> Result<Output, OpenCodeError> {
        let executable = self.find_executable().ok_or(OpenCodeError::NotInstalled)?;
        let mut command = query_command(&executable);
        command.arg(PURE_MODE_FLAG).args(arguments);
        run_with_timeout(&mut command, timeout)
            .map_err(|error| OpenCodeError::CommandFailed(error.to_string()))
    }

    fn read_version(&self) -> Option<String> {
        let output = self.run(&["--version"], VERSION_TIMEOUT).ok()?;
        if !output.status.success() {
            return None;
        }
        let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        (!version.is_empty()).then_some(version)
    }
}

impl AgentAdapter for OpenCodeAdapter {
    type Error = OpenCodeError;
    type LaunchOptions = OpenCodeLaunchOptions;

    fn detect(&self) -> Result<AgentInstallation, Self::Error> {
        let Some(executable) = self.find_executable() else {
            return Ok(AgentInstallation {
                agent_type: AGENT_TYPE.into(),
                installed: false,
                executable_path: None,
                version: None,
                healthy: false,
                diagnostic: "未检测到 OpenCode，请先安装后重试。".into(),
            });
        };
        let version = self.read_version();
        let healthy = version.is_some();
        Ok(AgentInstallation {
            agent_type: AGENT_TYPE.into(),
            installed: true,
            executable_path: Some(executable.to_string_lossy().into_owned()),
            version,
            healthy,
            diagnostic: if healthy {
                "OpenCode 可用".into()
            } else {
                "已找到 OpenCode，但版本检测失败。".into()
            },
        })
    }

    fn list_sessions(&self, project_path: Option<&str>) -> Result<Vec<AgentSession>, Self::Error> {
        let output = self.run(&["session", "list", "--format", "json"], SESSION_LIST_TIMEOUT)?;
        if !output.status.success() {
            return Err(OpenCodeError::SessionCommand(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        parse_sessions(&stdout, project_path)
    }

    fn build_launch_command(
        &self,
        options: &OpenCodeLaunchOptions,
    ) -> Result<AgentLaunchSpec, Self::Error> {
        let executable = self.find_executable().ok_or(OpenCodeError::NotInstalled)?;
        let mut command = format!("& {}", powershell_quote(&executable.to_string_lossy()));
        append_option(&mut command, "--session", options.session_id.as_deref());
        if options.continue_last && options.session_id.as_deref().map_or(true, str::is_empty) {
            command.push_str(" --continue");
        }
        append_option(&mut command, "--model", options.model.as_deref());
        if options.auto_confirm {
            command.push(' ');
            command.push_str(AUTO_CONFIRM_FLAG);
        }
        Ok(AgentLaunchSpec {
            command,
            executable_path: executable.to_string_lossy().into_owned(),
        })
    }
}

fn parse_sessions(
    value: &str,
    project_path: Option<&str>,
) -> Result<Vec<AgentSession>, OpenCodeError> {
    if value.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut sessions = serde_json::from_str::<Vec<Value>>(value)?
        .into_iter()
        // A record Termexo cannot read is dropped on its own rather than failing the whole list,
        // so one unexpected entry cannot hide every other session the user has.
        .filter_map(|record| serde_json::from_value::<OpenCodeSession>(record).ok())
        .filter(|session| match project_path {
            Some(expected) => paths_equal(&session.directory, expected),
            None => true,
        })
        .map(|session| AgentSession {
            id: format!("opencode:{}", session.id),
            agent_type: AGENT_TYPE.into(),
            native_session_id: session.id.clone(),
            account_profile_id: None,
            project_path: Some(session.directory),
            model_name: None,
            title: session.title,
            summary: None,
            branch: None,
            status: SESSION_STATUS.into(),
            message_count: 0,
            transcript_path: format!("opencode://session/{}", session.id),
            created_at: session.created,
            last_used_at: session.updated,
        })
        .collect::<Vec<_>>();
    sessions.sort_by_key(|session| Reverse(session.last_used_at));
    Ok(sessions)
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

fn command_paths(command: &str) -> Vec<PathBuf> {
    let mut paths = env::current_dir()
        .ok()
        .map(|directory| vec![directory.join(command)])
        .unwrap_or_default();
    if let Some(search_path) = env::var_os("PATH") {
        paths.extend(env::split_paths(&search_path).map(|directory| directory.join(command)));
    }
    paths
}

/// Builds a query command, routing a Windows `.cmd` shim through `cmd.exe` so it can run at all.
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

fn append_option(command: &mut String, flag: &str, value: Option<&str>) {
    if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
        command.push(' ');
        command.push_str(flag);
        command.push(' ');
        command.push_str(&powershell_quote(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_executable() -> (PathBuf, PathBuf) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = env::temp_dir().join(format!("termexo-opencode-{unique}"));
        fs::create_dir_all(&directory).unwrap();
        let executable = directory.join(if cfg!(windows) {
            "opencode.cmd"
        } else {
            "opencode"
        });
        fs::write(&executable, "").unwrap();
        (directory, executable)
    }

    #[test]
    fn parses_and_filters_official_session_json() {
        let value = r#"[
          {"id":"ses_new","title":"New","updated":2000,"created":1000,"projectId":"p1","directory":"D:\\dev\\Termexo"},
          {"id":"ses_old","title":"Old","updated":1000,"created":500,"projectId":"p2","directory":"D:\\dev\\Other"}
        ]"#;
        let sessions = parse_sessions(value, Some("D:/dev/Termexo")).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].native_session_id, "ses_new");
        assert_eq!(sessions[0].title, "New");
        assert_eq!(sessions[0].last_used_at, 2000);
    }

    #[test]
    fn builds_new_and_resume_commands() {
        let (directory, executable) = test_executable();
        let adapter = OpenCodeAdapter::with_executable(executable);
        let fresh = adapter
            .build_launch_command(&OpenCodeLaunchOptions {
                session_id: None,
                model: Some("anthropic/claude-sonnet-4-5".into()),
                continue_last: false,
                auto_confirm: false,
            })
            .unwrap();
        assert!(fresh
            .command
            .contains("--model 'anthropic/claude-sonnet-4-5'"));
        let resumed = adapter
            .build_launch_command(&OpenCodeLaunchOptions {
                session_id: Some("ses_123".into()),
                model: None,
                continue_last: false,
                auto_confirm: false,
            })
            .unwrap();
        assert!(resumed.command.contains("--session 'ses_123'"));
        let continued = adapter
            .build_launch_command(&OpenCodeLaunchOptions {
                session_id: None,
                model: None,
                continue_last: true,
                auto_confirm: false,
            })
            .unwrap();
        assert!(continued.command.ends_with(" --continue"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn adds_the_auto_approve_flag_only_when_asked() {
        let (directory, executable) = test_executable();
        let adapter = OpenCodeAdapter::with_executable(executable);
        let automatic = adapter
            .build_launch_command(&OpenCodeLaunchOptions {
                session_id: None,
                model: None,
                continue_last: false,
                auto_confirm: true,
            })
            .unwrap();
        assert!(automatic.command.ends_with(" --auto"), "{}", automatic.command);
        let manual = adapter
            .build_launch_command(&OpenCodeLaunchOptions {
                session_id: None,
                model: None,
                continue_last: false,
                auto_confirm: false,
            })
            .unwrap();
        assert!(!manual.command.contains("--auto"), "{}", manual.command);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn keeps_readable_sessions_when_one_record_is_malformed() {
        let value = r#"[
          {"id":"ses_ok","title":"Readable","updated":2000,"created":1000,"directory":"/srv/termexo"},
          {"id":"ses_broken","title":"No directory","updated":3000,"created":1000},
          "not-an-object"
        ]"#;
        let sessions = parse_sessions(value, None).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].native_session_id, "ses_ok");
    }

    /// Exercises the real CLI rather than a fixture.
    ///
    /// Ignored by default because it needs OpenCode on the machine. Point `TERMEXO_OPENCODE_PATH`
    /// at an executable and run `cargo test -- --ignored` to check the flags and the JSON shape
    /// this adapter depends on against the version actually installed.
    #[test]
    #[ignore]
    fn talks_to_a_real_opencode_installation() {
        let adapter = OpenCodeAdapter::new();
        let installation = adapter.detect().unwrap();
        assert!(installation.installed, "{}", installation.diagnostic);
        assert!(installation.healthy, "{}", installation.diagnostic);
        assert!(installation.version.is_some());

        // Must parse whether or not this machine has any sessions: an empty list is a valid answer,
        // an error here means the command or the JSON shape has moved.
        let sessions = adapter.list_sessions(None).unwrap();
        for session in &sessions {
            assert_eq!(session.agent_type, AGENT_TYPE);
            assert!(!session.native_session_id.is_empty());
        }

        // The launch command has to name a real executable and carry the documented flags.
        let spec = adapter
            .build_launch_command(&OpenCodeLaunchOptions {
                session_id: None,
                model: None,
                continue_last: true,
                auto_confirm: true,
            })
            .unwrap();
        assert!(spec.command.contains("--continue"), "{}", spec.command);
        assert!(spec.command.contains("--auto"), "{}", spec.command);
        assert!(Path::new(&spec.executable_path).is_file());
    }

    #[test]
    fn reports_a_missing_executable_rather_than_hanging() {
        let adapter = OpenCodeAdapter::with_executable(PathBuf::from("no-such-opencode.cmd"));
        let error = adapter
            .list_sessions(None)
            .expect_err("a missing executable cannot list sessions");
        assert!(matches!(error, OpenCodeError::NotInstalled));
    }
}
