use std::env;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::time::Duration;

use thiserror::Error;

use super::{AgentAdapter, AgentInstallation, AgentLaunchSpec, AgentSession};
use crate::process::{hidden_command, run_with_timeout};

const AGENT_TYPE: &str = "antigravity";
const SESSION_STATUS: &str = "HISTORICAL";
const ANTIGRAVITY_PATH_ENV: &str = "TERMEXO_ANTIGRAVITY_PATH";

/// The installer registers the binary here and does not put it on PATH by default, so a lookup
/// that only searched PATH would report a working installation as missing.
const INSTALL_SUBDIRECTORY: &[&str] = &["agy", "bin"];

/// The CLI rewrites its own binary in the background, which a control plane should not have
/// happening underneath a running terminal.
const DISABLE_AUTO_UPDATE_ENV: &str = "AGY_CLI_DISABLE_AUTO_UPDATE";

const VERSION_TIMEOUT: Duration = Duration::from_secs(20);
/// Listing models reaches the service, so it is given longer than a local version check.
const MODEL_LIST_TIMEOUT: Duration = Duration::from_secs(45);

/// Reading the allowance reaches the service and starts the CLI, which is not quick.
const USAGE_TIMEOUT: Duration = Duration::from_secs(60);

/// The slash command that reports the allowance, run as a one-shot prompt.
///
/// There is no `agy usage` subcommand — the figures are only reachable through the command the TUI
/// offers, which a headless run accepts and answers in JSON.
const USAGE_COMMAND: &str = "/usage";

/// Conversations are summarised in one database beside the transcripts.
///
/// Reading it directly rather than driving the CLI keeps listing fast and works while signed out:
/// the only command that lists conversations is the interactive session picker.
const SUMMARY_DATABASE: &str = "conversation_summaries.db";

#[derive(Debug, Error)]
pub enum AntigravityError {
    #[error("未检测到 Antigravity CLI（agy），请先安装后重试。")]
    NotInstalled,
    #[error("Antigravity CLI 执行失败：{0}")]
    CommandFailed(String),
    #[error("读取 Antigravity 会话失败：{0}")]
    SessionRead(String),
    #[error("无法读取 Antigravity 余量：{0}")]
    UsageUnavailable(String),
}

/// One allowance window the CLI reports.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AntigravityUsageBucket {
    #[serde(default)]
    pub name: String,
    /// How much of the window is left, from 0 to 1.
    #[serde(default)]
    pub remaining_fraction: Option<f64>,
    #[serde(default)]
    pub reset_time: Option<String>,
}

/// Models that share one allowance, as the CLI groups them.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AntigravityUsageGroup {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub buckets: Vec<AntigravityUsageBucket>,
}

/// What `/usage` reports: the allowance groups.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct AntigravityUsage {
    #[serde(default)]
    pub groups: Vec<AntigravityUsageGroup>,
}

/// One model the CLI offers, as `agy models` reports it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityModel {
    /// The value `--model` accepts.
    pub slug: String,
    /// The name shown in the CLI, which is also what its own settings file records.
    pub display_name: String,
}

#[derive(Default)]
pub struct AntigravityAdapter {
    executable_override: Option<PathBuf>,
    /// Overridden in tests so the summary database can be pointed at a fixture.
    data_directory_override: Option<PathBuf>,
}

impl AntigravityAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    fn with_data_directory(directory: PathBuf) -> Self {
        Self {
            executable_override: None,
            data_directory_override: Some(directory),
        }
    }

    fn find_executable(&self) -> Option<PathBuf> {
        if let Some(executable) = self.executable_override.as_ref() {
            return executable.is_file().then(|| executable.clone());
        }

        let mut candidates = Vec::new();
        if let Some(configured) = env::var_os(ANTIGRAVITY_PATH_ENV) {
            candidates.push(PathBuf::from(configured));
        }

        #[cfg(windows)]
        {
            if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
                let mut path = PathBuf::from(local_app_data);
                path.extend(INSTALL_SUBDIRECTORY);
                candidates.push(path.join("agy.exe"));
            }
            candidates.extend(command_paths("agy.exe"));
            candidates.extend(command_paths("agy.cmd"));
        }

        #[cfg(not(windows))]
        {
            if let Some(home) = env::var_os("HOME") {
                let mut path = PathBuf::from(home).join(".local");
                path.extend(INSTALL_SUBDIRECTORY);
                candidates.push(path.join("agy"));
            }
            candidates.extend(command_paths("agy"));
        }

        candidates.into_iter().find(|path| path.is_file())
    }

    /// The directory holding the CLI's own state, which is where conversations are summarised.
    fn data_directory(&self) -> Option<PathBuf> {
        if let Some(directory) = self.data_directory_override.as_ref() {
            return Some(directory.clone());
        }
        let home = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"))?;
        Some(PathBuf::from(home).join(".gemini").join("antigravity-cli"))
    }

    fn run(&self, arguments: &[&str], timeout: Duration) -> Result<Output, AntigravityError> {
        let executable = self
            .find_executable()
            .ok_or(AntigravityError::NotInstalled)?;
        let mut command = hidden_command(&executable);
        command.args(arguments);
        // Keeping the updater out of a control plane's terminals: it rewrites the binary in the
        // background, and a launch that raced it would be starting a file being replaced.
        command.env(DISABLE_AUTO_UPDATE_ENV, "true");
        run_with_timeout(&mut command, timeout)
            .map_err(|error| AntigravityError::CommandFailed(error.to_string()))
    }

    fn read_version(&self) -> Option<String> {
        let output = self.run(&["--version"], VERSION_TIMEOUT).ok()?;
        if !output.status.success() {
            return None;
        }
        let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        (!version.is_empty()).then_some(version)
    }

    /// The allowance the signed-in account has left, as the CLI reports it.
    ///
    /// Run headlessly with a JSON envelope, so the figures arrive structured rather than as the
    /// table the TUI draws. The envelope carries the command's own payload beside the rendered
    /// text; the payload is what is read, because the text is formatted for a terminal.
    pub fn read_usage(&self) -> Result<AntigravityUsage, AntigravityError> {
        let output = self.run(
            &[
                "-p",
                USAGE_COMMAND,
                "--output-format",
                "json",
                // The allowance is a property of the account, not of any workspace, and asking
                // for it must not add a conversation to whichever folder Termexo happens to be in.
                "--print-timeout",
                "1m",
            ],
            USAGE_TIMEOUT,
        )?;
        if !output.status.success() {
            return Err(AntigravityError::CommandFailed(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        parse_usage(&String::from_utf8_lossy(&output.stdout))
    }

    /// The models this installation offers, newest first as the CLI orders them.
    ///
    /// Each line is `slug<tab>Display Name`; the progress line the CLI prints goes to stderr and
    /// so never reaches this.
    pub fn list_models(&self) -> Result<Vec<AntigravityModel>, AntigravityError> {
        let output = self.run(&["models"], MODEL_LIST_TIMEOUT)?;
        if !output.status.success() {
            return Err(AntigravityError::CommandFailed(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        Ok(parse_models(&String::from_utf8_lossy(&output.stdout)))
    }
}

impl AgentAdapter for AntigravityAdapter {
    type Error = AntigravityError;
    type LaunchOptions = super::AntigravityLaunchOptions;

    fn detect(&self) -> Result<AgentInstallation, Self::Error> {
        let Some(executable) = self.find_executable() else {
            return Ok(AgentInstallation {
                agent_type: AGENT_TYPE.into(),
                installed: false,
                executable_path: None,
                version: None,
                healthy: false,
                diagnostic: "未检测到 Antigravity CLI（agy），请先安装后重试。".into(),
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
                "Antigravity CLI 可用".into()
            } else {
                "已找到 Antigravity CLI，但版本检测失败。".into()
            },
        })
    }

    fn list_sessions(&self, project_path: Option<&str>) -> Result<Vec<AgentSession>, Self::Error> {
        let Some(directory) = self.data_directory() else {
            return Ok(Vec::new());
        };
        let database = directory.join(SUMMARY_DATABASE);
        if !database.is_file() {
            return Ok(Vec::new());
        }
        read_sessions(&database, &directory, project_path)
    }

    fn build_launch_command(
        &self,
        options: &super::AntigravityLaunchOptions,
    ) -> Result<AgentLaunchSpec, Self::Error> {
        let executable = self
            .find_executable()
            .ok_or(AntigravityError::NotInstalled)?;
        let mut command = format!("& {}", powershell_quote(&executable.to_string_lossy()));
        append_option(
            &mut command,
            "--conversation",
            options.session_id.as_deref(),
        );
        if options.continue_last && options.session_id.as_deref().is_none_or(str::is_empty) {
            command.push_str(" --continue");
        }
        append_option(&mut command, "--model", options.model.as_deref());
        append_option(&mut command, "--effort", options.effort.as_deref());
        if options.auto_confirm {
            // The CLI's own wording for it: every tool runs without asking.
            command.push_str(" --dangerously-skip-permissions");
        }
        Ok(AgentLaunchSpec {
            command,
            executable_path: executable.to_string_lossy().into_owned(),
        })
    }
}

/// Reads the conversation summaries, newest first.
///
/// The database belongs to the CLI and may be open in another process, so it is opened read-only
/// and a failure to read is reported rather than treated as "no sessions" — an empty session list
/// and an unreadable one mean very different things to somebody looking for their work.
fn read_sessions(
    database: &Path,
    data_directory: &Path,
    project_path: Option<&str>,
) -> Result<Vec<AgentSession>, AntigravityError> {
    let connection = rusqlite::Connection::open_with_flags(
        database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|error| AntigravityError::SessionRead(error.to_string()))?;

    // The timestamp carries more precision than SQLite parses, so it is trimmed to seconds before
    // being converted; the fractional part is of no use to a session list.
    let mut statement = connection
        .prepare(
            "SELECT conversation_id, title, preview, step_count, workspace_uris,
                    CAST(strftime('%s', substr(last_modified_time, 1, 19)) AS INTEGER)
             FROM conversation_summaries
             WHERE killed = 0
             ORDER BY last_modified_time DESC",
        )
        .map_err(|error| AntigravityError::SessionRead(error.to_string()))?;

    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<i64>>(5)?,
            ))
        })
        .map_err(|error| AntigravityError::SessionRead(error.to_string()))?;

    let mut sessions = Vec::new();
    for row in rows {
        let (id, title, preview, steps, workspaces, seconds) =
            row.map_err(|error| AntigravityError::SessionRead(error.to_string()))?;
        let workspace = first_workspace_path(&workspaces);
        if let Some(wanted) = project_path.filter(|path| !path.trim().is_empty()) {
            if !workspace
                .as_deref()
                .is_some_and(|path| paths_equal(path, wanted))
            {
                continue;
            }
        }
        let last_used = seconds.unwrap_or_default() * 1000;
        sessions.push(AgentSession {
            id: id.clone(),
            agent_type: AGENT_TYPE.into(),
            native_session_id: id.clone(),
            account_profile_id: None,
            project_path: workspace,
            model_name: None,
            // A conversation is only given a title once it has been named, so the first thing
            // that was said stands in for one until then.
            title: pick_title(&title, &preview, &id),
            summary: (!preview.trim().is_empty()).then(|| preview.clone()),
            branch: None,
            status: SESSION_STATUS.into(),
            message_count: steps.max(0) as u32,
            transcript_path: transcript_path(data_directory, &id),
            created_at: last_used,
            last_used_at: last_used,
        });
    }
    Ok(sessions)
}

fn pick_title(title: &str, preview: &str, id: &str) -> String {
    for candidate in [title.trim(), preview.trim()] {
        if !candidate.is_empty() {
            return candidate.to_owned();
        }
    }
    id.to_owned()
}

/// Where the CLI writes the conversation's transcript.
fn transcript_path(data_directory: &Path, conversation_id: &str) -> String {
    data_directory
        .join("brain")
        .join(conversation_id)
        .join(".system_generated")
        .join("logs")
        .join("transcript.jsonl")
        .to_string_lossy()
        .into_owned()
}

/// The first workspace a conversation was opened against, as a native path.
///
/// The column holds a JSON array of file URIs (`["file:///C:/Users/x"]`), which has to become a
/// Windows path before it can be compared with the one a workspace records.
fn first_workspace_path(workspace_uris: &str) -> Option<String> {
    let uris: Vec<String> = serde_json::from_str(workspace_uris).ok()?;
    uris.into_iter().find_map(|uri| file_uri_to_path(&uri))
}

fn file_uri_to_path(uri: &str) -> Option<String> {
    let remainder = uri.strip_prefix("file://")?;
    let trimmed = remainder.strip_prefix('/').unwrap_or(remainder);
    if trimmed.is_empty() {
        return None;
    }
    let decoded = trimmed.replace("%20", " ");
    Some(if cfg!(windows) {
        decoded.replace('/', "\\")
    } else {
        format!("/{decoded}")
    })
}

/// Reads the usage payload out of the headless envelope.
///
/// The envelope reports its own status, which is where an expired session or a service that is
/// unreachable shows up — a run can exit successfully and still carry nothing worth reading.
fn parse_usage(stdout: &str) -> Result<AntigravityUsage, AntigravityError> {
    let line = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .ok_or_else(|| AntigravityError::UsageUnavailable("CLI 未返回 JSON 结果".into()))?;
    let envelope: serde_json::Value = serde_json::from_str(line)
        .map_err(|error| AntigravityError::UsageUnavailable(error.to_string()))?;

    let status = envelope
        .get("status")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if !status.eq_ignore_ascii_case("SUCCESS") {
        let reason = envelope
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(status);
        return Err(AntigravityError::UsageUnavailable(reason.to_owned()));
    }

    let payload = envelope
        .get("command")
        .filter(|command| command.get("name").and_then(serde_json::Value::as_str) == Some("usage"))
        .and_then(|command| command.get("data"))
        .ok_or_else(|| AntigravityError::UsageUnavailable("CLI 未返回余量数据".into()))?;

    serde_json::from_value(payload.clone())
        .map_err(|error| AntigravityError::UsageUnavailable(error.to_string()))
}

fn parse_models(output: &str) -> Vec<AntigravityModel> {
    output
        .lines()
        .filter_map(|line| {
            let (slug, display) = line.split_once('\t').or_else(|| line.split_once("  "))?;
            let slug = slug.trim();
            let display = display.trim();
            (!slug.is_empty() && !display.is_empty()).then(|| AntigravityModel {
                slug: slug.to_owned(),
                display_name: display.to_owned(),
            })
        })
        .collect()
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
    let mut paths = Vec::new();
    if let Some(search_path) = env::var_os("PATH") {
        paths.extend(env::split_paths(&search_path).map(|directory| directory.join(command)));
    }
    paths
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
    use crate::agent::AntigravityLaunchOptions;

    fn summary_database(directory: &Path, rows: &[(&str, &str, &str, i64, &str)]) {
        let connection = rusqlite::Connection::open(directory.join(SUMMARY_DATABASE)).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE conversation_summaries (
                     conversation_id TEXT, title TEXT NOT NULL DEFAULT '',
                     preview TEXT NOT NULL DEFAULT '', step_count INTEGER NOT NULL DEFAULT 0,
                     last_modified_time DATETIME NOT NULL, workspace_uris TEXT NOT NULL,
                     killed INTEGER NOT NULL DEFAULT 0)",
            )
            .unwrap();
        for (id, title, preview, steps, workspace) in rows {
            connection
                .execute(
                    "INSERT INTO conversation_summaries
                     (conversation_id, title, preview, step_count, last_modified_time,
                      workspace_uris, killed)
                     VALUES (?1, ?2, ?3, ?4, '2026-09-11 16:46:08.6884507+00:00', ?5, 0)",
                    rusqlite::params![id, title, preview, steps, workspace],
                )
                .unwrap();
        }
    }

    fn temporary_directory(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("termexo-agy-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn a_missing_summary_database_lists_nothing_rather_than_failing() {
        let directory = temporary_directory("no-database");
        let adapter = AntigravityAdapter::with_data_directory(directory);

        assert!(adapter.list_sessions(None).unwrap().is_empty());
    }

    #[test]
    fn sessions_are_read_from_the_summary_database() {
        let directory = temporary_directory("sessions");
        summary_database(
            &directory,
            &[(
                "dec7618f-85d9-439e-b3a8-bd6429774085",
                "",
                "hi",
                4,
                r#"["file:///C:/Users/gemro"]"#,
            )],
        );
        let adapter = AntigravityAdapter::with_data_directory(directory);

        let sessions = adapter.list_sessions(None).unwrap();

        assert_eq!(sessions.len(), 1);
        let session = &sessions[0];
        assert_eq!(session.agent_type, AGENT_TYPE);
        assert_eq!(
            session.native_session_id,
            "dec7618f-85d9-439e-b3a8-bd6429774085"
        );
        assert_eq!(session.message_count, 4);
        // An unnamed conversation is listed by what was said in it, not by its id.
        assert_eq!(session.title, "hi");
        assert_eq!(session.last_used_at, 1_789_145_168_000);
        assert!(session.transcript_path.contains("transcript.jsonl"));
    }

    /// A workspace only wants the conversations that belong to it.
    #[test]
    fn sessions_are_filtered_by_the_workspace_they_were_opened_against() {
        let directory = temporary_directory("filter");
        summary_database(
            &directory,
            &[
                (
                    "one",
                    "",
                    "mine",
                    1,
                    r#"["file:///C:/Users/gemro/project"]"#,
                ),
                ("two", "", "other", 1, r#"["file:///D:/elsewhere"]"#),
            ],
        );
        let adapter = AntigravityAdapter::with_data_directory(directory);

        let sessions = adapter
            .list_sessions(Some("C:\\Users\\gemro\\project"))
            .unwrap();

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].native_session_id, "one");
    }

    #[test]
    fn a_file_uri_becomes_a_native_path() {
        let path = first_workspace_path(r#"["file:///C:/Users/gemro/my%20project"]"#).unwrap();

        if cfg!(windows) {
            assert_eq!(path, "C:\\Users\\gemro\\my project");
        }
    }

    /// The envelope the CLI actually answers with, trimmed to the fields that are read.
    const USAGE_ENVELOPE: &str = r#"{"conversation_id":"","status":"SUCCESS","response":"Gemini Models\tWeekly Limit Remaining\t0%\n","command":{"name":"usage","data":{"description":"Within each group, models share a weekly limit.","groups":[{"name":"Gemini Models","description":"Models within this group: Gemini Flash, Gemini Pro","buckets":[{"id":"gemini-weekly","name":"Weekly Limit Remaining","description":"You have hit your weekly limit.","window":"weekly","remaining_fraction":0,"reset_time":"2026-09-18T16:45:19Z"}]},{"name":"Claude and GPT models","buckets":[{"id":"3p-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":1,"reset_time":"2026-09-19T01:58:53Z"}]}]}}}"#;

    #[test]
    fn the_usage_payload_is_read_out_of_the_headless_envelope() {
        let usage = parse_usage(USAGE_ENVELOPE).unwrap();

        assert_eq!(usage.groups.len(), 2);
        let gemini = &usage.groups[0];
        assert_eq!(gemini.name, "Gemini Models");
        assert_eq!(gemini.buckets[0].remaining_fraction, Some(0.0));
        assert_eq!(
            gemini.buckets[0].reset_time.as_deref(),
            Some("2026-09-18T16:45:19Z")
        );
        assert_eq!(usage.groups[1].buckets[0].remaining_fraction, Some(1.0));
    }

    /// The CLI prints progress before the envelope, so the payload is not on the first line.
    #[test]
    fn a_line_printed_before_the_envelope_is_skipped() {
        let noisy = format!("Fetching usage...\n{USAGE_ENVELOPE}");

        let usage = parse_usage(&noisy).unwrap();

        assert_eq!(usage.groups.len(), 2);
    }

    /// A run can exit successfully and still carry nothing: a signed-out CLI does exactly that.
    #[test]
    fn an_unsuccessful_envelope_is_reported_rather_than_read_as_empty() {
        let envelope = r#"{"status":"ERROR","error":"authentication required"}"#;

        let result = parse_usage(envelope);

        assert!(matches!(
            result,
            Err(AntigravityError::UsageUnavailable(reason)) if reason.contains("authentication")
        ));
    }

    #[test]
    fn output_without_an_envelope_is_refused() {
        assert!(matches!(
            parse_usage("Fetching usage...\n"),
            Err(AntigravityError::UsageUnavailable(_))
        ));
    }

    #[test]
    fn models_are_read_as_slug_and_display_name() {
        let models = parse_models(
            "gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n\
             claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n\
             \n",
        );

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].slug, "gemini-3.8-flash-high");
        assert_eq!(models[0].display_name, "Gemini 3.8 Flash (High)");
    }

    #[test]
    fn a_resumed_conversation_is_launched_by_id() {
        let executable = temporary_directory("launch").join("agy.exe");
        std::fs::write(&executable, b"").unwrap();
        let adapter = AntigravityAdapter {
            executable_override: Some(executable),
            data_directory_override: None,
        };

        let spec = adapter
            .build_launch_command(&AntigravityLaunchOptions {
                session_id: Some("abc-123".into()),
                model: Some("gemini-3.8-flash-high".into()),
                effort: None,
                continue_last: false,
                auto_confirm: false,
            })
            .unwrap();

        assert!(spec.command.contains("--conversation 'abc-123'"));
        assert!(spec.command.contains("--model 'gemini-3.8-flash-high'"));
        // Resuming a named conversation must not also ask for the most recent one.
        assert!(!spec.command.contains("--continue"));
    }

    #[test]
    fn continuing_without_an_id_asks_for_the_most_recent_conversation() {
        let executable = temporary_directory("continue").join("agy.exe");
        std::fs::write(&executable, b"").unwrap();
        let adapter = AntigravityAdapter {
            executable_override: Some(executable),
            data_directory_override: None,
        };

        let spec = adapter
            .build_launch_command(&AntigravityLaunchOptions {
                session_id: None,
                model: None,
                effort: None,
                continue_last: true,
                auto_confirm: true,
            })
            .unwrap();

        assert!(spec.command.contains("--continue"));
        assert!(spec.command.contains("--dangerously-skip-permissions"));
    }
}
