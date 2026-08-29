use std::cmp::Reverse;
use std::env;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

use super::{AgentAdapter, AgentInstallation, AgentLaunchSpec, AgentSession, ClaudeLaunchOptions};

const AGENT_TYPE: &str = "claude";
const SESSION_STATUS: &str = "HISTORICAL";
const MAX_TITLE_LENGTH: usize = 96;
const CLAUDE_PATH_ENV: &str = "TERMEXO_CLAUDE_PATH";
const LEGACY_CLAUDE_PATH_ENV: &str = "AGENTDOCK_CLAUDE_PATH";
const AUTO_CONFIRM_MODE: &str = "--permission-mode auto";
const AGENTS_SUBCOMMAND: &str = "agents";
const RESUME_FLAG: &str = "--resume";
const STOP_SUBCOMMAND: &str = "stop";
const ATTACH_SUBCOMMAND: &str = "attach";
const JSON_FLAG: &str = "--json";
/// `kind` of the entries that survive their terminal and own a short id for `stop` and `attach`.
const BACKGROUND_KIND: &str = "background";
/// A session mid-turn reports one of these, so stopping it would discard work in flight.
const BUSY_STATUS: &str = "busy";
const WORKING_STATE: &str = "working";

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
    #[error("无法停止后台会话 {id}：{detail}")]
    StopFailed { id: String, detail: String },
}

/// A session the CLI still has running, as reported by `claude agents --json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeBackgroundSession {
    /// The short id `claude stop` and `claude attach` take, distinct from the full session id.
    pub short_id: String,
    pub session_id: String,
    pub name: Option<String>,
    /// True while the session is mid-turn, when stopping it would discard work in flight.
    pub busy: bool,
}

#[derive(Debug, Default)]
pub struct ClaudeCodeAdapter {
    config_dir_override: Option<PathBuf>,
}

impl ClaudeCodeAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_config_dir(config_dir: PathBuf) -> Self {
        Self {
            config_dir_override: Some(config_dir),
        }
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
        let output = cli_command(executable).arg("--version").output().ok()?;
        if !output.status.success() {
            return None;
        }

        let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        (!version.is_empty()).then_some(version)
    }

    /**
     * The session the CLI still has running under this id, if any.
     *
     * Claude Code keeps a session alive when the terminal it was started in goes away, so one
     * Termexo launched before its window closed is still registered and refuses to be resumed in
     * place — `--resume` prints "is running as a background session" and exits.
     */
    pub fn background_session(&self, session_id: &str) -> Option<ClaudeBackgroundSession> {
        let executable = self.find_executable()?;
        let output = cli_command(&executable)
            .args([AGENTS_SUBCOMMAND, JSON_FLAG])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }

        parse_background_sessions(&String::from_utf8_lossy(&output.stdout))
            .into_iter()
            .find(|session| session.session_id.eq_ignore_ascii_case(session_id))
    }

    /// Ends a background session so a Termexo terminal can resume its id again.
    pub fn stop_background_session(&self, short_id: &str) -> Result<(), ClaudeError> {
        let executable = self.find_executable().ok_or(ClaudeError::NotInstalled)?;
        let output = cli_command(&executable)
            .arg(STOP_SUBCOMMAND)
            .arg(short_id)
            .output()
            .map_err(|source| ClaudeError::SessionIo {
                path: short_id.to_owned(),
                source,
            })?;

        if output.status.success() {
            return Ok(());
        }
        Err(ClaudeError::StopFailed {
            id: short_id.to_owned(),
            detail: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        })
    }

    fn projects_directory(&self) -> PathBuf {
        if let Some(config_dir) = self.config_dir_override.as_ref() {
            return config_dir.join("projects");
        }
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
    type LaunchOptions = ClaudeLaunchOptions;

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

        // `attach` reconnects to a live session and accepts no other flags, so it is the whole
        // command: the session it opens already has the model and settings it was started with.
        if let Some(short_id) = options
            .attach_short_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            command.push_str(&format!(
                " {ATTACH_SUBCOMMAND} {}",
                powershell_quote(short_id)
            ));
            return Ok(AgentLaunchSpec {
                command,
                executable_path: executable.to_string_lossy().into_owned(),
            });
        }

        append_option(&mut command, "--name", options.name.as_deref());
        append_option(&mut command, "--model", options.model.as_deref());
        append_option(&mut command, "--settings", options.settings_path.as_deref());
        append_option(
            &mut command,
            "--mcp-config",
            options.mcp_config_path.as_deref(),
        );
        append_auto_confirm_mode(&mut command, options.auto_confirm);
        if let Some(session_id) = options
            .session_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            let flag = session_argument_flag(&self.projects_directory(), session_id);
            append_option(&mut command, flag, Some(session_id));
            // Only a resume can be forked; a brand new session has nothing to branch from.
            if options.fork_session && flag == RESUME_FLAG {
                command.push_str(" --fork-session");
            }
        }

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

/**
 * A command that runs the CLI itself.
 *
 * Windows installs Claude Code as an npm `.cmd` shim, which CreateProcess cannot execute, so on
 * that path the shim is handed to `cmd.exe` instead of being launched directly.
 */
fn cli_command(executable: &Path) -> Command {
    #[cfg(windows)]
    if executable
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd"))
    {
        let mut command = command_without_window("cmd.exe");
        command.args(["/d", "/c", "call"]).arg(executable);
        return command;
    }

    command_without_window(executable)
}

fn parse_background_sessions(payload: &str) -> Vec<ClaudeBackgroundSession> {
    let Ok(Value::Array(entries)) = serde_json::from_str::<Value>(payload) else {
        return Vec::new();
    };

    entries
        .iter()
        .filter(|entry| entry.get("kind").and_then(Value::as_str) == Some(BACKGROUND_KIND))
        .filter_map(|entry| {
            Some(ClaudeBackgroundSession {
                short_id: entry.get("id").and_then(Value::as_str)?.to_owned(),
                session_id: entry.get("sessionId").and_then(Value::as_str)?.to_owned(),
                name: entry.get("name").and_then(Value::as_str).map(str::to_owned),
                busy: is_busy(entry),
            })
        })
        .collect()
}

/// Which field carries "mid-turn" varies by CLI version, so either one counts.
fn is_busy(entry: &Value) -> bool {
    let field = |key: &str| {
        entry
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase()
    };
    field("status") == BUSY_STATUS || field("state") == WORKING_STATE
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

fn session_argument_flag(projects_directory: &Path, session_id: &str) -> &'static str {
    let mut transcripts = Vec::new();
    let transcript_exists = collect_transcripts(projects_directory, &mut transcripts).is_ok()
        && transcripts.iter().any(|path| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case(session_id))
        });

    if transcript_exists {
        RESUME_FLAG
    } else {
        "--session-id"
    }
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
        account_profile_id: None,
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

fn append_auto_confirm_mode(command: &mut String, enabled: bool) {
    if enabled {
        command.push(' ');
        command.push_str(AUTO_CONFIRM_MODE);
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

    #[test]
    fn reads_running_background_sessions_and_their_busy_state() {
        let payload = r#"[
            {"pid":18500,"id":"04cd7760","kind":"background","sessionId":"04cd7760-d05a-4fb5",
             "name":"Task flow","status":"idle","state":"done"},
            {"pid":21884,"kind":"interactive","sessionId":"71f3fbbc-7aee","name":"termexo-d2",
             "status":"idle"},
            {"pid":50264,"id":"76624ba6","kind":"background","sessionId":"76624ba6-8cc9",
             "name":"Tabs","status":"busy","state":"working"}
        ]"#;

        let sessions = parse_background_sessions(payload);

        // The interactive entry owns no short id, so `stop` and `attach` cannot address it.
        assert_eq!(
            sessions,
            vec![
                ClaudeBackgroundSession {
                    short_id: "04cd7760".into(),
                    session_id: "04cd7760-d05a-4fb5".into(),
                    name: Some("Task flow".into()),
                    busy: false,
                },
                ClaudeBackgroundSession {
                    short_id: "76624ba6".into(),
                    session_id: "76624ba6-8cc9".into(),
                    name: Some("Tabs".into()),
                    busy: true,
                },
            ]
        );
    }

    #[test]
    fn treats_a_working_state_as_busy_without_a_busy_status() {
        let payload = r#"[{"id":"a1","kind":"background","sessionId":"a1-full","state":"working"}]"#;

        assert!(parse_background_sessions(payload)[0].busy);
    }

    #[test]
    fn attaches_with_only_the_short_id_because_the_subcommand_takes_no_flags() {
        let options = ClaudeLaunchOptions {
            session_id: Some("04cd7760-d05a-4fb5".into()),
            name: Some("Auth refactor".into()),
            model: Some("opus".into()),
            settings_path: Some("C:\\runtime\\hooks.json".into()),
            mcp_config_path: None,
            auto_confirm: true,
            fork_session: false,
            attach_short_id: Some("04cd7760".into()),
        };

        let Ok(spec) = ClaudeCodeAdapter::new().build_launch_command(&options) else {
            // Claude Code is not installed on this machine, so there is no command to build.
            return;
        };

        assert!(spec.command.ends_with(" attach '04cd7760'"), "{}", spec.command);
        assert!(!spec.command.contains("--model"), "{}", spec.command);
        assert!(!spec.command.contains("--settings"), "{}", spec.command);
        assert!(!spec.command.contains("--resume"), "{}", spec.command);
    }

    #[test]
    fn ignores_output_that_is_not_a_session_list() {
        assert!(parse_background_sessions("not json").is_empty());
        assert!(parse_background_sessions("{}").is_empty());
    }

    #[test]
    fn forks_a_resume_so_a_running_session_can_be_branched() {
        let directory = test_directory("fork-session");
        fs::create_dir_all(&directory).unwrap();
        File::create(directory.join("session-1.jsonl")).unwrap();
        let adapter = ClaudeCodeAdapter::with_config_dir(directory.parent().unwrap().to_path_buf());

        let flag = session_argument_flag(&directory, "session-1");

        assert_eq!(flag, RESUME_FLAG);
        // A session with no transcript is created, not resumed, so it has nothing to fork.
        assert_eq!(
            session_argument_flag(&directory, "never-seen"),
            "--session-id"
        );
        drop(adapter);
        fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn uses_claudes_auto_permission_mode_for_auto_confirm() {
        let mut command = "claude".to_owned();
        append_auto_confirm_mode(&mut command, true);

        assert_eq!(command, "claude --permission-mode auto");

        let mut disabled = "claude".to_owned();
        append_auto_confirm_mode(&mut disabled, false);
        assert_eq!(disabled, "claude");
    }

    #[test]
    fn resumes_only_when_the_transcript_exists() {
        let directory = test_directory("resume-existing");
        let nested = directory.join("project");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("03788ec4-3e8c-4608-8ce5-427a71a05bba.jsonl"),
            "",
        )
        .unwrap();

        assert_eq!(
            session_argument_flag(&directory, "03788ec4-3e8c-4608-8ce5-427a71a05bba"),
            "--resume"
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reuses_the_session_id_when_no_transcript_exists() {
        let directory = test_directory("resume-missing");

        assert_eq!(
            session_argument_flag(&directory, "03788ec4-3e8c-4608-8ce5-427a71a05bba"),
            "--session-id"
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
