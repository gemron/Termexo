use std::cmp::Reverse;
use std::env;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use thiserror::Error;

use super::{AgentAdapter, AgentInstallation, AgentLaunchSpec, AgentSession, ClaudeLaunchOptions};

const AGENT_TYPE: &str = "claude";
const SESSION_STATUS: &str = "HISTORICAL";
const MAX_TITLE_LENGTH: usize = 96;
const CLAUDE_PATH_ENV: &str = "TERMEXO_CLAUDE_PATH";
const LEGACY_CLAUDE_PATH_ENV: &str = "AGENTDOCK_CLAUDE_PATH";

#[derive(Debug, Error)]
pub enum ClaudeError {
    #[error("Claude Code is not installed")]
    NotInstalled,
    #[error("Claude session access failed for {path}: {source}")]
    SessionIo {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

#[derive(Debug, Default)]
pub struct ClaudeCodeAdapter;

impl ClaudeCodeAdapter {
    pub fn new() -> Self {
        Self
    }

    fn find_executable(&self) -> Option<PathBuf> {
        let mut candidates = Vec::new();

        if let Some(configured) =
            env::var_os(CLAUDE_PATH_ENV).or_else(|| env::var_os(LEGACY_CLAUDE_PATH_ENV))
        {
            candidates.push(PathBuf::from(configured));
        }

        #[cfg(windows)]
        {
            candidates.extend(command_paths("claude.exe"));
            candidates.extend(command_paths("claude.cmd"));

            if let Some(app_data) = env::var_os("APPDATA") {
                candidates.push(PathBuf::from(app_data).join("npm").join("claude.cmd"));
            }
            if let Some(user_profile) = env::var_os("USERPROFILE") {
                candidates.push(
                    PathBuf::from(user_profile)
                        .join(".local")
                        .join("bin")
                        .join("claude.exe"),
                );
            }
        }

        #[cfg(not(windows))]
        {
            candidates.extend(command_paths("claude"));
        }

        candidates.into_iter().find(|path| path.is_file())
    }

    fn read_version(&self, executable: &Path) -> Option<String> {
        #[cfg(windows)]
        let output = if executable
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd"))
        {
            let mut command = command_without_window("cmd.exe");
            command
                .args(["/d", "/c", "call"])
                .arg(executable)
                .arg("--version");
            command.output().ok()?
        } else {
            let mut command = command_without_window(executable);
            command.arg("--version");
            command.output().ok()?
        };

        #[cfg(not(windows))]
        let output = {
            let mut command = command_without_window(executable);
            command.arg("--version");
            command.output().ok()?
        };

        if !output.status.success() {
            return None;
        }

        let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        (!version.is_empty()).then_some(version)
    }

    fn projects_directory(&self) -> PathBuf {
        if let Some(config_dir) = env::var_os("CLAUDE_CONFIG_DIR") {
            return PathBuf::from(config_dir).join("projects");
        }

        home_directory()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".claude")
            .join("projects")
    }

    fn scan_directory(
        &self,
        directory: &Path,
        project_path: Option<&str>,
    ) -> Result<Vec<AgentSession>, ClaudeError> {
        if !directory.exists() {
            return Ok(Vec::new());
        }

        let mut transcript_paths = Vec::new();
        collect_transcripts(directory, &mut transcript_paths)?;

        let mut sessions = transcript_paths
            .into_iter()
            .filter_map(|path| match parse_session(&path) {
                Ok(session) => Some(session),
                Err(error) => {
                    tracing::warn!(path = %path.display(), %error, "skipping Claude transcript");
                    None
                }
            })
            .filter(|session| match project_path {
                Some(expected) => session
                    .project_path
                    .as_deref()
                    .is_some_and(|actual| paths_equal(actual, expected)),
                None => true,
            })
            .collect::<Vec<_>>();

        sessions.sort_by_key(|session| Reverse(session.last_used_at));
        Ok(sessions)
    }
}

impl AgentAdapter for ClaudeCodeAdapter {
    type Error = ClaudeError;

    fn detect(&self) -> Result<AgentInstallation, Self::Error> {
        let Some(executable) = self.find_executable() else {
            return Ok(AgentInstallation {
                agent_type: AGENT_TYPE.into(),
                installed: false,
                executable_path: None,
                version: None,
                healthy: false,
                diagnostic: "未检测到 Claude Code，请先安装后重试。".into(),
            });
        };

        let version = self.read_version(&executable);
        let healthy = version.is_some();
        let diagnostic = if healthy {
            "Claude Code 可用".into()
        } else {
            "已找到 Claude Code，但版本检测失败。".into()
        };

        Ok(AgentInstallation {
            agent_type: AGENT_TYPE.into(),
            installed: true,
            executable_path: Some(executable.to_string_lossy().into_owned()),
            version,
            healthy,
            diagnostic,
        })
    }

    fn list_sessions(&self, project_path: Option<&str>) -> Result<Vec<AgentSession>, Self::Error> {
        self.scan_directory(&self.projects_directory(), project_path)
    }

    fn build_launch_command(
        &self,
        options: &ClaudeLaunchOptions,
    ) -> Result<AgentLaunchSpec, Self::Error> {
        let executable = self.find_executable().ok_or(ClaudeError::NotInstalled)?;
        let mut command = format!("& {}", powershell_quote(&executable.to_string_lossy()));

        append_option(&mut command, "--name", options.name.as_deref());
        append_option(&mut command, "--model", options.model.as_deref());
        append_option(&mut command, "--settings", options.settings_path.as_deref());
        append_option(
            &mut command,
            "--mcp-config",
            options.mcp_config_path.as_deref(),
        );
        append_option(&mut command, "--resume", options.session_id.as_deref());

        Ok(AgentLaunchSpec {
            command,
            executable_path: executable.to_string_lossy().into_owned(),
        })
    }
}

fn command_paths(command: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut paths = env::current_dir()
            .ok()
            .map(|directory| vec![directory.join(command)])
            .unwrap_or_default();
        if let Some(search_path) = env::var_os("PATH") {
            paths.extend(env::split_paths(&search_path).map(|directory| directory.join(command)));
        }
        paths
    }

    #[cfg(not(windows))]
    {
        let output = command_without_window("which").arg(command).output();

        output
            .ok()
            .filter(|result| result.status.success())
            .map(|result| {
                String::from_utf8_lossy(&result.stdout)
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(PathBuf::from)
                    .collect()
            })
            .unwrap_or_default()
    }
}

fn command_without_window(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn home_directory() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn collect_transcripts(
    directory: &Path,
    transcripts: &mut Vec<PathBuf>,
) -> Result<(), ClaudeError> {
    let entries = fs::read_dir(directory).map_err(|source| ClaudeError::SessionIo {
        path: directory.display().to_string(),
        source,
    })?;

    for entry in entries {
        let entry = entry.map_err(|source| ClaudeError::SessionIo {
            path: directory.display().to_string(),
            source,
        })?;
        let path = entry.path();
        if path.is_dir() {
            collect_transcripts(&path, transcripts)?;
        } else if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("jsonl"))
        {
            transcripts.push(path);
        }
    }
    Ok(())
}

fn parse_session(path: &Path) -> Result<AgentSession, ClaudeError> {
    let file = File::open(path).map_err(|source| ClaudeError::SessionIo {
        path: path.display().to_string(),
        source,
    })?;
    let metadata = file.metadata().map_err(|source| ClaudeError::SessionIo {
        path: path.display().to_string(),
        source,
    })?;

    let native_session_id = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_owned();
    let mut project_path = None;
    let mut model_name = None;
    let mut title = None;
    let mut summary = None;
    let mut branch = None;
    let mut message_count = 0_u32;

    for line in BufReader::new(file).lines() {
        let Ok(line) = line else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        project_path = project_path.or_else(|| string_field(&value, "cwd"));
        branch = branch.or_else(|| string_field(&value, "gitBranch"));
        summary = summary.or_else(|| string_field(&value, "summary"));
        title = title
            .or_else(|| string_field(&value, "customTitle"))
            .or_else(|| string_field(&value, "name"));

        if matches!(
            value.get("type").and_then(Value::as_str),
            Some("user" | "assistant")
        ) {
            message_count = message_count.saturating_add(1);
        }

        if value.get("type").and_then(Value::as_str) == Some("assistant") {
            model_name = model_name.or_else(|| {
                value
                    .pointer("/message/model")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            });
        }

        if title.is_none() && value.get("type").and_then(Value::as_str) == Some("user") {
            title = value
                .get("message")
                .and_then(extract_message_text)
                .map(|text| truncate_title(&text));
        }
    }

    let created_at = metadata
        .created()
        .or_else(|_| metadata.modified())
        .map(system_time_millis)
        .unwrap_or_default();
    let last_used_at = metadata
        .modified()
        .map(system_time_millis)
        .unwrap_or(created_at);
    let title = title
        .or_else(|| summary.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("Claude 会话 {}", short_id(&native_session_id)));

    Ok(AgentSession {
        id: format!("claude:{native_session_id}"),
        agent_type: AGENT_TYPE.into(),
        native_session_id,
        project_path,
        model_name,
        title,
        summary,
        branch,
        status: SESSION_STATUS.into(),
        message_count,
        transcript_path: path.to_string_lossy().into_owned(),
        created_at,
        last_used_at,
    })
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
}

fn extract_message_text(message: &Value) -> Option<String> {
    let content = message.get("content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_owned());
    }

    content.as_array()?.iter().find_map(|item| {
        (item.get("type").and_then(Value::as_str) == Some("text"))
            .then(|| item.get("text").and_then(Value::as_str).map(str::to_owned))
            .flatten()
    })
}

fn truncate_title(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut characters = normalized.chars();
    let title = characters
        .by_ref()
        .take(MAX_TITLE_LENGTH)
        .collect::<String>();
    if characters.next().is_some() {
        format!("{title}…")
    } else {
        title
    }
}

fn short_id(session_id: &str) -> &str {
    session_id.get(..8).unwrap_or(session_id)
}

fn system_time_millis(value: SystemTime) -> i64 {
    value
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
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
    use std::io::Write;

    fn test_directory(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("termexo-{name}-{unique}"))
    }

    #[test]
    fn scans_claude_transcripts_without_modifying_them() {
        let directory = test_directory("sessions");
        fs::create_dir_all(&directory).unwrap();
        let transcript = directory.join("12345678-abcd.jsonl");
        let mut file = File::create(&transcript).unwrap();
        writeln!(
            file,
            r#"{{"type":"user","cwd":"D:\\dev\\Termexo","gitBranch":"main","message":{{"content":"Implement session restore"}}}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"assistant","message":{{"model":"claude-sonnet-4-6","content":[]}}}}"#
        )
        .unwrap();
        let original = fs::read_to_string(&transcript).unwrap();

        let sessions = ClaudeCodeAdapter::new()
            .scan_directory(&directory, Some("D:/dev/Termexo"))
            .unwrap();

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].native_session_id, "12345678-abcd");
        assert_eq!(sessions[0].title, "Implement session restore");
        assert_eq!(sessions[0].message_count, 2);
        assert_eq!(sessions[0].model_name.as_deref(), Some("claude-sonnet-4-6"));
        assert_eq!(fs::read_to_string(&transcript).unwrap(), original);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn builds_a_quoted_resume_command() {
        let command = format!(
            "& {} --name {} --model {} --resume {}",
            powershell_quote("C:\\Tools\\Claude Code\\claude.cmd"),
            powershell_quote("Auth refactor"),
            powershell_quote("sonnet"),
            powershell_quote("session-1")
        );

        assert_eq!(
            command,
            "& 'C:\\Tools\\Claude Code\\claude.cmd' --name 'Auth refactor' --model 'sonnet' --resume 'session-1'"
        );
    }

    #[cfg(windows)]
    #[test]
    fn reads_versions_from_windows_command_shims() {
        let directory = test_directory("version-shim");
        fs::create_dir_all(&directory).unwrap();
        let shim = directory.join("claude.cmd");
        fs::write(&shim, "@echo off\r\necho 9.9.9 (Claude Code)\r\n").unwrap();

        let version = ClaudeCodeAdapter::new().read_version(&shim);

        assert_eq!(version.as_deref(), Some("9.9.9 (Claude Code)"));
        fs::remove_dir_all(directory).unwrap();
    }
}
