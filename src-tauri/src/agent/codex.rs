use std::cmp::Reverse;
use std::collections::HashMap;
use std::env;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use thiserror::Error;

use super::{AgentAdapter, AgentInstallation, AgentLaunchSpec, AgentSession, CodexLaunchOptions};

const AGENT_TYPE: &str = "codex";
const SESSION_STATUS: &str = "HISTORICAL";
const MAX_TITLE_LENGTH: usize = 96;
const CODEX_PATH_ENV: &str = "TERMEXO_CODEX_PATH";
const LEGACY_CODEX_PATH_ENV: &str = "AGENTDOCK_CODEX_PATH";

#[derive(Debug, Error)]
pub enum CodexError {
    #[error("Codex CLI is not installed")]
    NotInstalled,
    #[error("Codex session access failed for {path}: {source}")]
    SessionIo {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

#[derive(Debug, Default)]
pub struct CodexCliAdapter {
    executable_override: Option<PathBuf>,
    codex_home_override: Option<PathBuf>,
}

impl CodexCliAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    fn with_paths(executable: PathBuf, codex_home: PathBuf) -> Self {
        Self {
            executable_override: Some(executable),
            codex_home_override: Some(codex_home),
        }
    }

    fn find_executable(&self) -> Option<PathBuf> {
        if let Some(executable) = self.executable_override.as_ref() {
            return executable.is_file().then(|| executable.clone());
        }

        let mut candidates = Vec::new();
        if let Some(configured) =
            env::var_os(CODEX_PATH_ENV).or_else(|| env::var_os(LEGACY_CODEX_PATH_ENV))
        {
            candidates.push(PathBuf::from(configured));
        }

        #[cfg(windows)]
        {
            candidates.extend(command_paths("codex.exe"));
            candidates.extend(command_paths("codex.cmd"));
            if let Some(app_data) = env::var_os("APPDATA") {
                candidates.push(PathBuf::from(app_data).join("npm").join("codex.cmd"));
            }
            if let Some(user_profile) = env::var_os("USERPROFILE") {
                candidates.push(
                    PathBuf::from(user_profile)
                        .join(".local")
                        .join("bin")
                        .join("codex.exe"),
                );
            }
        }

        #[cfg(not(windows))]
        {
            candidates.extend(command_paths("codex"));
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

    fn codex_home(&self) -> PathBuf {
        if let Some(home) = self.codex_home_override.as_ref() {
            return home.clone();
        }
        if let Some(configured) = env::var_os("CODEX_HOME") {
            return PathBuf::from(configured);
        }
        home_directory()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".codex")
    }

    fn scan_directory(
        &self,
        directory: &Path,
        project_path: Option<&str>,
    ) -> Result<Vec<AgentSession>, CodexError> {
        if !directory.exists() {
            return Ok(Vec::new());
        }

        let mut rollout_paths = Vec::new();
        collect_rollouts(directory, &mut rollout_paths)?;
        let titles = read_session_titles(&self.codex_home().join("session_index.jsonl"));
        let mut sessions = rollout_paths
            .into_iter()
            .filter_map(|path| match parse_session(&path, &titles) {
                Ok(Some(session)) => Some(session),
                Ok(None) => None,
                Err(error) => {
                    tracing::warn!(path = %path.display(), %error, "skipping Codex rollout");
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

impl AgentAdapter for CodexCliAdapter {
    type Error = CodexError;
    type LaunchOptions = CodexLaunchOptions;

    fn detect(&self) -> Result<AgentInstallation, Self::Error> {
        let Some(executable) = self.find_executable() else {
            return Ok(AgentInstallation {
                agent_type: AGENT_TYPE.into(),
                installed: false,
                executable_path: None,
                version: None,
                healthy: false,
                diagnostic: "未检测到 Codex CLI，请先安装后重试。".into(),
            });
        };

        let version = self.read_version(&executable);
        let healthy = version.is_some();
        Ok(AgentInstallation {
            agent_type: AGENT_TYPE.into(),
            installed: true,
            executable_path: Some(executable.to_string_lossy().into_owned()),
            version,
            healthy,
            diagnostic: if healthy {
                "Codex CLI 可用".into()
            } else {
                "已找到 Codex CLI，但版本检测失败。".into()
            },
        })
    }

    fn list_sessions(&self, project_path: Option<&str>) -> Result<Vec<AgentSession>, Self::Error> {
        self.scan_directory(&self.codex_home().join("sessions"), project_path)
    }

    fn build_launch_command(
        &self,
        options: &CodexLaunchOptions,
    ) -> Result<AgentLaunchSpec, Self::Error> {
        let executable = self.find_executable().ok_or(CodexError::NotInstalled)?;
        let mut command = format!("& {}", powershell_quote(&executable.to_string_lossy()));
        if let Some(session_id) = options
            .session_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            command.push_str(" resume ");
            command.push_str(&powershell_quote(session_id));
        }
        append_option(&mut command, "--model", options.model.as_deref());

        Ok(AgentLaunchSpec {
            command,
            executable_path: executable.to_string_lossy().into_owned(),
        })
    }
}

fn collect_rollouts(directory: &Path, output: &mut Vec<PathBuf>) -> Result<(), CodexError> {
    let entries = fs::read_dir(directory).map_err(|source| CodexError::SessionIo {
        path: directory.display().to_string(),
        source,
    })?;
    for entry in entries {
        let entry = entry.map_err(|source| CodexError::SessionIo {
            path: directory.display().to_string(),
            source,
        })?;
        let path = entry.path();
        if path.is_dir() {
            collect_rollouts(&path, output)?;
        } else if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("jsonl"))
        {
            output.push(path);
        }
    }
    Ok(())
}

fn read_session_titles(path: &Path) -> HashMap<String, String> {
    let Ok(file) = File::open(path) else {
        return HashMap::new();
    };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<Value>(&line).ok())
        .filter_map(|value| {
            let id = value.get("id")?.as_str()?.trim();
            let title = value.get("thread_name")?.as_str()?.trim();
            (!id.is_empty() && !title.is_empty()).then(|| (id.to_owned(), title.to_owned()))
        })
        .collect()
}

fn parse_session(
    path: &Path,
    titles: &HashMap<String, String>,
) -> Result<Option<AgentSession>, CodexError> {
    let file = File::open(path).map_err(|source| CodexError::SessionIo {
        path: path.display().to_string(),
        source,
    })?;
    let metadata = file.metadata().map_err(|source| CodexError::SessionIo {
        path: path.display().to_string(),
        source,
    })?;

    let mut native_session_id = None;
    let mut project_path = None;
    let mut model_name = None;
    let mut branch = None;
    let mut first_user_message = None;
    let mut message_count = 0_u32;

    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match value.get("type").and_then(Value::as_str) {
            Some("session_meta") => {
                native_session_id = native_session_id.or_else(|| {
                    value
                        .pointer("/payload/id")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                });
                project_path = project_path.or_else(|| {
                    value
                        .pointer("/payload/cwd")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                });
                branch = branch.or_else(|| {
                    value
                        .pointer("/payload/git/branch")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                });
                model_name = model_name.or_else(|| {
                    value
                        .pointer("/payload/model_provider")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                });
            }
            Some("turn_context") => {
                if let Some(model) = value.pointer("/payload/model").and_then(Value::as_str) {
                    model_name = Some(model.to_owned());
                }
                project_path = project_path.or_else(|| {
                    value
                        .pointer("/payload/cwd")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                });
            }
            Some("response_item")
                if value.pointer("/payload/type").and_then(Value::as_str) == Some("message") =>
            {
                let role = value.pointer("/payload/role").and_then(Value::as_str);
                if matches!(role, Some("user" | "assistant")) {
                    message_count = message_count.saturating_add(1);
                }
                if role == Some("user") && first_user_message.is_none() {
                    first_user_message =
                        extract_codex_message(&value).map(|text| truncate_title(&text));
                }
            }
            _ => {}
        }
    }

    let Some(native_session_id) = native_session_id else {
        return Ok(None);
    };
    let created_at = metadata
        .created()
        .or_else(|_| metadata.modified())
        .map(system_time_millis)
        .unwrap_or_default();
    let last_used_at = metadata
        .modified()
        .map(system_time_millis)
        .unwrap_or(created_at);
    let title = titles
        .get(&native_session_id)
        .cloned()
        .or(first_user_message)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("Codex 会话 {}", short_id(&native_session_id)));

    Ok(Some(AgentSession {
        id: format!("codex:{native_session_id}"),
        agent_type: AGENT_TYPE.into(),
        native_session_id,
        project_path,
        model_name,
        title,
        summary: None,
        branch,
        status: SESSION_STATUS.into(),
        message_count,
        transcript_path: path.to_string_lossy().into_owned(),
        created_at,
        last_used_at,
    }))
}

fn extract_codex_message(value: &Value) -> Option<String> {
    value
        .pointer("/payload/content")
        .and_then(Value::as_array)?
        .iter()
        .find_map(|item| {
            matches!(
                item.get("type").and_then(Value::as_str),
                Some("input_text" | "text")
            )
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
        env::temp_dir().join(format!("termexo-codex-{name}-{unique}"))
    }

    #[test]
    fn scans_codex_rollouts_and_preserves_them() {
        let directory = test_directory("sessions");
        let sessions = directory
            .join("sessions")
            .join("2026")
            .join("07")
            .join("27");
        fs::create_dir_all(&sessions).unwrap();
        fs::write(
            directory.join("session_index.jsonl"),
            r#"{"id":"019f9978-f46b-7d50-93b6-927b7eefcb1f","thread_name":"Implement Codex adapter","updated_at":"2026-07-27T10:00:00Z"}"#,
        )
        .unwrap();
        let transcript =
            sessions.join("rollout-2026-07-27T10-00-00-019f9978-f46b-7d50-93b6-927b7eefcb1f.jsonl");
        let mut file = File::create(&transcript).unwrap();
        writeln!(
            file,
            r#"{{"timestamp":"2026-07-27T10:00:00Z","type":"session_meta","payload":{{"id":"019f9978-f46b-7d50-93b6-927b7eefcb1f","cwd":"D:\\dev\\Termexo","model_provider":"openai","git":{{"branch":"main"}}}}}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"turn_context","payload":{{"model":"gpt-5.6-sol"}}}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"Build the adapter"}}]}}}}"#
        )
        .unwrap();
        let original = fs::read_to_string(&transcript).unwrap();

        let executable = directory.join(if cfg!(windows) { "codex.cmd" } else { "codex" });
        fs::write(&executable, "").unwrap();
        let adapter = CodexCliAdapter::with_paths(executable, directory.clone());
        let sessions = adapter.list_sessions(Some("D:/dev/Termexo")).unwrap();

        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].native_session_id,
            "019f9978-f46b-7d50-93b6-927b7eefcb1f"
        );
        assert_eq!(sessions[0].title, "Implement Codex adapter");
        assert_eq!(sessions[0].model_name.as_deref(), Some("gpt-5.6-sol"));
        assert_eq!(sessions[0].message_count, 1);
        assert_eq!(fs::read_to_string(&transcript).unwrap(), original);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn builds_new_and_resume_commands() {
        let directory = test_directory("launch");
        fs::create_dir_all(&directory).unwrap();
        let executable = directory.join(if cfg!(windows) { "codex.cmd" } else { "codex" });
        fs::write(&executable, "").unwrap();
        let adapter = CodexCliAdapter::with_paths(executable.clone(), directory.clone());

        let fresh = adapter
            .build_launch_command(&CodexLaunchOptions {
                session_id: None,
                model: Some("gpt-5.6-sol".into()),
            })
            .unwrap();
        assert!(fresh.command.contains("--model 'gpt-5.6-sol'"));
        assert!(!fresh.command.contains(" resume "));

        let resumed = adapter
            .build_launch_command(&CodexLaunchOptions {
                session_id: Some("019f9978-f46b-7d50-93b6-927b7eefcb1f".into()),
                model: None,
            })
            .unwrap();
        assert!(resumed
            .command
            .contains("resume '019f9978-f46b-7d50-93b6-927b7eefcb1f'"));

        fs::remove_dir_all(directory).unwrap();
    }
}
