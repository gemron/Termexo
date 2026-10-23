use std::cmp::Reverse;
use std::env;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use super::cli::{append_option, command_paths, powershell_quote, query_command};
use super::{AgentAdapter, AgentInstallation, AgentLaunchSpec, AgentSession, PiLaunchOptions};
use crate::process::run_with_timeout;

const AGENT_TYPE: &str = "pi";
const PI_PATH_ENV: &str = "TERMEXO_PI_PATH";
const PI_AGENT_DIR_ENV: &str = "PI_CODING_AGENT_DIR";
const PI_SESSION_DIR_ENV: &str = "PI_CODING_AGENT_SESSION_DIR";
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_TITLE: &str = "Pi 会话";

#[derive(Debug, Error)]
pub enum PiError {
    #[error("未安装 Pi Agent")]
    NotInstalled,
    #[error("无法读取 Pi 会话：{0}")]
    Io(#[from] std::io::Error),
    #[error("未找到 Pi 会话：{0}")]
    SessionNotFound(String),
}

#[derive(Debug, Default)]
pub struct PiAdapter {
    executable_override: Option<PathBuf>,
    agent_dir_override: Option<PathBuf>,
}

impl PiAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    fn find_executable(&self) -> Option<PathBuf> {
        if let Some(path) = &self.executable_override {
            return path.is_file().then(|| path.clone());
        }
        let mut candidates = Vec::new();
        if let Some(path) = env::var_os(PI_PATH_ENV) {
            candidates.push(PathBuf::from(path));
        }
        #[cfg(windows)]
        {
            candidates.extend(command_paths("pi.exe"));
            candidates.extend(command_paths("pi.cmd"));
            if let Some(app_data) = env::var_os("APPDATA") {
                candidates.push(PathBuf::from(app_data).join("npm/pi.cmd"));
            }
            if let Some(home) = env::var_os("USERPROFILE") {
                candidates.push(PathBuf::from(home).join(".local/bin/pi.exe"));
            }
            if let Some(agent_dir) = self.agent_dir() {
                candidates.push(agent_dir.join("bin/pi.cmd"));
            }
        }
        #[cfg(not(windows))]
        candidates.extend(command_paths("pi"));
        candidates.into_iter().find(|path| path.is_file())
    }

    fn agent_dir(&self) -> Option<PathBuf> {
        self.agent_dir_override
            .clone()
            .or_else(|| {
                env::var_os(PI_AGENT_DIR_ENV)
                    .filter(|value| !value.is_empty())
                    .map(expand_home)
            })
            .or_else(|| {
                env::var_os("USERPROFILE")
                    .or_else(|| env::var_os("HOME"))
                    .map(|home| PathBuf::from(home).join(".pi/agent"))
            })
    }

    fn sessions_dir(&self) -> Option<PathBuf> {
        if let Some(directory) = &self.agent_dir_override {
            return Some(directory.join("sessions"));
        }
        env::var_os(PI_SESSION_DIR_ENV)
            .filter(|value| !value.is_empty())
            .map(expand_home)
            .or_else(|| self.agent_dir().map(|directory| directory.join("sessions")))
    }

    fn session_path(&self, session_id: &str) -> Result<String, PiError> {
        // Resolve IDs to files before launch: --session accepts paths across project directories.
        self.list_sessions(None)?
            .into_iter()
            .find(|session| {
                session.native_session_id == session_id || session.transcript_path == session_id
            })
            .map(|session| session.transcript_path)
            .ok_or_else(|| PiError::SessionNotFound(session_id.into()))
    }
}

fn expand_home(path: std::ffi::OsString) -> PathBuf {
    let path = PathBuf::from(path);
    if let Ok(relative) = path.strip_prefix("~") {
        if let Some(home) = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")) {
            return PathBuf::from(home).join(relative);
        }
    }
    path
}

impl AgentAdapter for PiAdapter {
    type Error = PiError;
    type LaunchOptions = PiLaunchOptions;

    fn detect(&self) -> Result<AgentInstallation, PiError> {
        let Some(executable) = self.find_executable() else {
            return Ok(AgentInstallation {
                agent_type: AGENT_TYPE.into(),
                installed: false,
                executable_path: None,
                version: None,
                healthy: false,
                diagnostic: "未检测到 Pi Agent，请先安装后重试。".into(),
            });
        };
        let version =
            run_with_timeout(query_command(&executable).arg("--version"), VERSION_TIMEOUT)
                .ok()
                .filter(|output| output.status.success())
                .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
                .filter(|version| !version.is_empty());
        let healthy = version.is_some();
        Ok(AgentInstallation {
            agent_type: AGENT_TYPE.into(),
            installed: true,
            executable_path: Some(executable.to_string_lossy().into_owned()),
            version,
            healthy,
            diagnostic: if healthy {
                "Pi Agent 可用"
            } else {
                "已找到 Pi Agent，但版本检测失败。"
            }
            .into(),
        })
    }

    fn list_sessions(&self, project_path: Option<&str>) -> Result<Vec<AgentSession>, PiError> {
        let Some(root) = self.sessions_dir().filter(|root| root.is_dir()) else {
            return Ok(Vec::new());
        };
        let mut directories = vec![root];
        let mut sessions = Vec::new();
        while let Some(directory) = directories.pop() {
            for entry in fs::read_dir(directory)? {
                let entry = entry?;
                let kind = entry.file_type()?;
                let path = entry.path();
                // Do not follow symlinks into unrelated directories or cycles.
                if kind.is_dir() {
                    directories.push(path);
                } else if kind.is_file() && path.extension().is_some_and(|ext| ext == "jsonl") {
                    match read_session(&path) {
                        Ok(Some(session))
                            if project_path.is_none_or(|expected| {
                                session
                                    .project_path
                                    .as_deref()
                                    .is_some_and(|cwd| paths_equal(cwd, expected))
                            }) =>
                        {
                            sessions.push(session)
                        }
                        Ok(_) => {}
                        Err(error) => {
                            tracing::warn!(%error, path = %path.display(), "Could not read Pi session")
                        }
                    }
                }
            }
        }
        sessions.sort_by_key(|session| Reverse(session.last_used_at));
        Ok(sessions)
    }

    fn build_launch_command(&self, options: &PiLaunchOptions) -> Result<AgentLaunchSpec, PiError> {
        let executable = self.find_executable().ok_or(PiError::NotInstalled)?;
        let mut command = format!("& {}", powershell_quote(&executable.to_string_lossy()));
        if let Some(id) = options
            .session_id
            .as_deref()
            .filter(|id| !id.trim().is_empty())
        {
            append_option(&mut command, "--session", Some(&self.session_path(id)?));
        } else if options.continue_last {
            command.push_str(" --continue");
        }
        append_option(&mut command, "--model", options.model.as_deref());
        append_option(
            &mut command,
            "--extension",
            options.extension_path.as_deref(),
        );
        Ok(AgentLaunchSpec {
            command,
            executable_path: executable.to_string_lossy().into_owned(),
        })
    }
}

fn paths_equal(left: &str, right: &str) -> bool {
    let normalize = |path: &str| path.trim_end_matches(['/', '\\']).replace('\\', "/");
    if cfg!(windows) {
        normalize(left).eq_ignore_ascii_case(&normalize(right))
    } else {
        normalize(left) == normalize(right)
    }
}

fn timestamp(value: &Value) -> Option<i64> {
    OffsetDateTime::parse(value.as_str()?, &Rfc3339)
        .ok()
        .map(|time| (time.unix_timestamp_nanos() / 1_000_000) as i64)
}

fn read_session(path: &Path) -> Result<Option<AgentSession>, PiError> {
    let mut lines = BufReader::new(File::open(path)?).lines();
    let Some(header) = lines
        .next()
        .transpose()?
        .and_then(|line| serde_json::from_str::<Value>(&line).ok())
    else {
        return Ok(None);
    };
    if header["type"] != "session" {
        return Ok(None);
    }
    let Some(id) = header["id"].as_str().filter(|id| !id.is_empty()) else {
        return Ok(None);
    };
    let created_at = timestamp(&header["timestamp"]).unwrap_or_default();
    let mut session = AgentSession {
        id: format!("pi:{id}"),
        agent_type: AGENT_TYPE.into(),
        native_session_id: id.into(),
        account_profile_id: None,
        project_path: header["cwd"].as_str().map(str::to_owned),
        model_name: None,
        title: DEFAULT_TITLE.into(),
        summary: None,
        branch: None,
        status: "HISTORICAL".into(),
        message_count: 0,
        transcript_path: path.to_string_lossy().into_owned(),
        created_at,
        last_used_at: created_at,
    };
    let mut name = None;
    for line in lines {
        // A partial final line is normal while the agent is writing the transcript.
        let Ok(entry) = serde_json::from_str::<Value>(&line?) else {
            continue;
        };
        session.last_used_at = session
            .last_used_at
            .max(timestamp(&entry["timestamp"]).unwrap_or_default());
        match entry["type"].as_str() {
            Some("session_info") => {
                name = entry["name"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty())
                    .map(str::to_owned)
            }
            Some("model_change") => {
                session.model_name =
                    entry["modelId"]
                        .as_str()
                        .map(|model| match entry["provider"].as_str() {
                            Some(provider) => format!("{provider}/{model}"),
                            None => model.into(),
                        });
            }
            Some("message") => {
                session.message_count += 1;
                if session.title == DEFAULT_TITLE && entry["message"]["role"] == "user" {
                    let content = &entry["message"]["content"];
                    let text = content
                        .as_str()
                        .map(str::to_owned)
                        .or_else(|| {
                            content.as_array().map(|blocks| {
                                blocks
                                    .iter()
                                    .filter(|block| block["type"] == "text")
                                    .filter_map(|block| block["text"].as_str())
                                    .collect::<Vec<_>>()
                                    .join(" ")
                            })
                        })
                        .unwrap_or_default();
                    if !text.trim().is_empty() {
                        session.title = text.trim().chars().take(100).collect();
                    }
                }
            }
            _ => {}
        }
    }
    if let Some(name) = name {
        session.title = name;
    }
    Ok(Some(session))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        root: PathBuf,
        adapter: PiAdapter,
    }

    impl Fixture {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = env::temp_dir().join(format!("termexo-pi-{}-{unique}", std::process::id()));
            fs::create_dir_all(root.join("sessions/project")).unwrap();
            let executable = root.join(if cfg!(windows) { "pi.cmd" } else { "pi" });
            fs::write(
                &executable,
                if cfg!(windows) {
                    "@echo off\r\necho 1.0.0\r\n"
                } else {
                    "#!/bin/sh\necho 1.0.0\n"
                },
            )
            .unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
            }
            Self {
                adapter: PiAdapter {
                    executable_override: Some(executable),
                    agent_dir_override: Some(root.clone()),
                },
                root,
            }
        }

        fn write_session(&self, id: &str, cwd: &str, timestamp: &str) -> PathBuf {
            let path = self
                .root
                .join("sessions")
                .join("project")
                .join(format!("{id}.jsonl"));
            let records = [
                json!({"type":"session","version":3,"id":id,"cwd":cwd,"timestamp":timestamp}),
                json!({"type":"model_change","provider":"anthropic","modelId":"sonnet","timestamp":timestamp}),
                json!({"type":"message","message":{"role":"user","content":[{"type":"text","text":"修复解析器"}]},"timestamp":timestamp}),
                json!({"type":"session_info","name":"命名的 Pi 会话","timestamp":timestamp}),
            ];
            fs::write(
                &path,
                records
                    .iter()
                    .map(|record| format!("{record}\n"))
                    .collect::<String>()
                    + "{partial",
            )
            .unwrap();
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn imports_native_sessions_without_modifying_them_and_filters_by_cwd() {
        let fixture = Fixture::new();
        let path = fixture.write_session("older", "C:/repo", "2026-10-01T10:00:00Z");
        let original = fs::read(&path).unwrap();
        fixture.write_session("newer", "C:/other", "2026-10-02T10:00:00Z");
        fs::write(
            fixture.root.join("sessions/project/broken.jsonl"),
            "not JSON",
        )
        .unwrap();
        let sessions = fixture.adapter.list_sessions(None).unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].native_session_id, "newer");
        let filtered = fixture.adapter.list_sessions(Some("C:\\repo\\")).unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "pi:older");
        assert_eq!(filtered[0].title, "命名的 Pi 会话");
        assert_eq!(filtered[0].model_name.as_deref(), Some("anthropic/sonnet"));
        assert_eq!(filtered[0].message_count, 1);
        assert_eq!(filtered[0].created_at, 1_790_848_800_000);
        assert_eq!(fs::read(path).unwrap(), original);
    }

    #[test]
    fn launch_resolves_session_file_quotes_arguments_and_prefers_it_over_continue() {
        let fixture = Fixture::new();
        let path = fixture.write_session("session-id", "C:/repo", "2026-10-01T10:00:00Z");
        let spec = fixture
            .adapter
            .build_launch_command(&PiLaunchOptions {
                session_id: Some("session-id".into()),
                model: Some("provider/model's".into()),
                continue_last: true,
                extension_path: Some("C:/Termexo's data/pi.mjs".into()),
            })
            .unwrap();
        assert!(spec.command.contains(&format!(
            "--session {}",
            powershell_quote(&path.to_string_lossy())
        )));
        assert!(spec.command.contains("--model 'provider/model''s'"));
        assert!(spec
            .command
            .contains("--extension 'C:/Termexo''s data/pi.mjs'"));
        assert!(!spec.command.contains("--continue"));
        assert!(!spec.command.contains("--auto"));
    }

    #[test]
    fn continues_latest_session_without_overriding_pi_model_defaults() {
        let fixture = Fixture::new();
        let spec = fixture
            .adapter
            .build_launch_command(&PiLaunchOptions {
                session_id: None,
                model: None,
                continue_last: true,
                extension_path: None,
            })
            .unwrap();
        assert!(spec.command.ends_with(" --continue"));
        assert!(!spec.command.contains("--model"));
        assert!(matches!(
            fixture.adapter.build_launch_command(&PiLaunchOptions {
                session_id: Some("missing".into()),
                model: None,
                continue_last: false,
                extension_path: None,
            }),
            Err(PiError::SessionNotFound(_))
        ));
    }

    #[test]
    fn detects_version_and_missing_executables() {
        let mut fixture = Fixture::new();
        let installation = fixture.adapter.detect().unwrap();
        assert!(installation.installed && installation.healthy);
        assert_eq!(installation.version.as_deref(), Some("1.0.0"));
        fixture.adapter.executable_override = Some(fixture.root.join("missing"));
        assert!(!fixture.adapter.detect().unwrap().installed);
    }
}
