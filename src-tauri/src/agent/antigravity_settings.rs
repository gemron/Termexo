//! Installing and removing Termexo's status feed in the Antigravity CLI's own settings.
//!
//! Every other agent Termexo drives can be configured for one launch: Claude takes a `--settings`
//! file, Codex takes `-c` overrides, OpenCode takes a generated plugin. agy takes none of those —
//! it has no documented per-invocation override of any kind — so the only way to learn what its
//! agent is doing is to write into the settings file the user's own installation reads.
//!
//! That makes this the one place Termexo edits a file it does not own, which is why everything
//! here is written to be undone: the block is merged rather than overwritten, it is recognised by
//! the command it points at, and removing it restores whatever was there before.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use thiserror::Error;

/// The settings key holding the command the CLI runs whenever the agent's state changes.
const STATUS_LINE_KEY: &str = "statusLine";
/// Where the previous value is kept, so removing Termexo's feed can put it back.
const SAVED_STATUS_LINE_KEY: &str = "termexoPreviousStatusLine";
const SETTINGS_FILE: &str = "settings.json";
/// The subcommand Termexo's own executable answers the status feed with.
const STATUS_SUBCOMMAND: &str = "agy-status";
/// Workspaces the CLI will open without asking, which it records itself after the first prompt.
const TRUSTED_WORKSPACES_KEY: &str = "trustedWorkspaces";

#[derive(Debug, Error)]
pub enum AntigravitySettingsError {
    #[error("无法找到 Antigravity CLI 的配置目录。")]
    NoSettingsDirectory,
    #[error("Antigravity 配置文件不是 JSON 对象，未做修改：{0}")]
    NotAnObject(String),
    #[error("读取或写入 Antigravity 配置失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("解析 Antigravity 配置失败：{0}")]
    Parse(#[from] serde_json::Error),
}

/// Whether Termexo's status feed is installed, and where the settings file is.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityStatusFeed {
    pub settings_path: String,
    pub installed: bool,
    /// True when a status line is configured that is not Termexo's, which installing would replace.
    pub foreign_status_line: bool,
}

/// The settings file the CLI reads, which is beside its own data.
pub fn settings_path() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(
        PathBuf::from(home)
            .join(".gemini")
            .join("antigravity-cli")
            .join(SETTINGS_FILE),
    )
}

/// Reports whether the status feed is installed, without changing anything.
pub fn describe() -> Result<AntigravityStatusFeed, AntigravitySettingsError> {
    let path = settings_path().ok_or(AntigravitySettingsError::NoSettingsDirectory)?;
    let settings = read_settings(&path)?;
    let current = settings.get(STATUS_LINE_KEY);
    Ok(AntigravityStatusFeed {
        settings_path: path.to_string_lossy().into_owned(),
        installed: current.is_some_and(is_termexo_status_line),
        foreign_status_line: current.is_some_and(|value| !is_termexo_status_line(value)),
    })
}

/// Points the CLI's status feed at Termexo, keeping whatever was configured before.
///
/// The previous value is stored alongside rather than discarded, because the user may have had a
/// status line of their own and removing Termexo's should give it back rather than leave them
/// with none.
pub fn install(executable: &Path) -> Result<AntigravityStatusFeed, AntigravitySettingsError> {
    let path = settings_path().ok_or(AntigravitySettingsError::NoSettingsDirectory)?;
    let mut settings = read_settings(&path)?;

    if let Some(previous) = settings.get(STATUS_LINE_KEY).cloned() {
        if !is_termexo_status_line(&previous) {
            settings.insert(SAVED_STATUS_LINE_KEY.into(), previous);
        }
    }
    settings.insert(STATUS_LINE_KEY.into(), status_line_block(executable));
    write_settings(&path, &settings)?;
    describe()
}

/// Brings a status line Termexo installed earlier back in line with this installation.
///
/// The command holds the path of the executable that wrote it, so it goes stale whenever Termexo
/// moves, and an older version may have written it in a shape the CLI cannot run at all. Either
/// way it then fails on every agy session on the machine until it is rewritten. Only a block
/// Termexo installed is touched, one that is already correct is left as it is, and nothing is
/// installed where the user has none.
///
/// Returns whether anything was rewritten.
pub fn refresh(executable: &Path) -> Result<bool, AntigravitySettingsError> {
    let path = settings_path().ok_or(AntigravitySettingsError::NoSettingsDirectory)?;
    let mut settings = read_settings(&path)?;
    let Some(current) = settings.get(STATUS_LINE_KEY) else {
        return Ok(false);
    };
    if !is_termexo_status_line(current) {
        return Ok(false);
    }
    let wanted = status_line_block(executable);
    if current == &wanted {
        return Ok(false);
    }
    settings.insert(STATUS_LINE_KEY.into(), wanted);
    write_settings(&path, &settings)?;
    Ok(true)
}

/// Removes Termexo's status feed and restores whatever it replaced.
///
/// A status line the user configured themselves is put back; one Termexo added to an installation
/// that had none is removed entirely. A status line that is not Termexo's is left alone — this
/// must never take away something it did not install.
pub fn remove() -> Result<AntigravityStatusFeed, AntigravitySettingsError> {
    let path = settings_path().ok_or(AntigravitySettingsError::NoSettingsDirectory)?;
    let mut settings = read_settings(&path)?;

    let ours = settings
        .get(STATUS_LINE_KEY)
        .is_some_and(is_termexo_status_line);
    if ours {
        match settings.remove(SAVED_STATUS_LINE_KEY) {
            Some(previous) => settings.insert(STATUS_LINE_KEY.into(), previous),
            None => settings.remove(STATUS_LINE_KEY),
        };
    } else {
        // Nothing of ours is installed, but a saved value would otherwise linger forever.
        settings.remove(SAVED_STATUS_LINE_KEY);
    }
    write_settings(&path, &settings)?;
    describe()
}

/// Records a workspace as trusted, so opening a terminal in it does not stop to ask.
///
/// The CLI asks about an unfamiliar workspace on first launch and waits for an answer. In a
/// terminal the user opened to do something else, that prompt is the first thing they see and the
/// agent never starts until they deal with it.
pub fn trust_workspace(workspace: &str) -> Result<(), AntigravitySettingsError> {
    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Ok(());
    }
    let path = settings_path().ok_or(AntigravitySettingsError::NoSettingsDirectory)?;
    let mut settings = read_settings(&path)?;
    let trusted = settings
        .entry(TRUSTED_WORKSPACES_KEY)
        .or_insert_with(|| json!([]));
    let Some(list) = trusted.as_array_mut() else {
        // The CLI owns this key; a shape Termexo does not recognise is left for it to deal with.
        return Ok(());
    };
    if list
        .iter()
        .filter_map(Value::as_str)
        .any(|existing| paths_equal(existing, workspace))
    {
        return Ok(());
    }
    list.push(Value::String(workspace.to_owned()));
    write_settings(&path, &settings)
}

fn status_line_block(executable: &Path) -> Value {
    json!({
        "type": "command",
        "command": format!("{} {STATUS_SUBCOMMAND}", command_path(executable)),
    })
}

/// The executable as it has to be written into the status line: a bare, unquoted path.
///
/// The CLI puts the configured command through Go's own argument escaping before handing it to
/// `cmd`, which turns a quote of ours into a literal `\"` that `cmd` then reads as part of the
/// program name — the command fails on every invocation, and the CLI disables the status line
/// after thirty of them. The path therefore has to survive unquoted, so one holding a space is
/// written in its 8.3 short form instead.
fn command_path(executable: &Path) -> String {
    let path = executable.to_string_lossy().into_owned();
    if !path.contains(' ') {
        return path;
    }
    short_path(executable).unwrap_or(path)
}

/// The 8.3 form of an existing path, when Windows still keeps one for it.
#[cfg(windows)]
fn short_path(path: &Path) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetShortPathNameW;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: `wide` is a live, NUL-terminated buffer, and the call is made twice in the shape
    // the API documents: once for the length it needs, once to fill a buffer of that length.
    let short = unsafe {
        let length = GetShortPathNameW(PCWSTR(wide.as_ptr()), None);
        if length == 0 {
            return None;
        }
        let mut buffer = vec![0u16; length as usize];
        let written = GetShortPathNameW(PCWSTR(wide.as_ptr()), Some(&mut buffer));
        if written == 0 || written as usize >= buffer.len() + 1 {
            return None;
        }
        String::from_utf16_lossy(&buffer[..written as usize])
    };
    // Short-name creation can be switched off per volume, in which case the long path comes back.
    (!short.contains(' ')).then_some(short)
}

#[cfg(not(windows))]
fn short_path(_path: &Path) -> Option<String> {
    None
}

/// Whether a status line block is one Termexo installed.
///
/// Recognised by the subcommand rather than by the full path, so a Termexo that moved — an update
/// that reinstalled it elsewhere, say — still recognises its own block instead of treating it as
/// the user's and refusing to touch it.
fn is_termexo_status_line(value: &Value) -> bool {
    value
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| command.contains(STATUS_SUBCOMMAND))
}

fn read_settings(path: &Path) -> Result<Map<String, Value>, AntigravitySettingsError> {
    let Ok(contents) = fs::read_to_string(path) else {
        // No settings file yet is normal before the CLI's first run.
        return Ok(Map::new());
    };
    if contents.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str::<Value>(&contents)? {
        Value::Object(object) => Ok(object),
        other => Err(AntigravitySettingsError::NotAnObject(
            other.to_string().chars().take(40).collect(),
        )),
    }
}

fn write_settings(
    path: &Path,
    settings: &Map<String, Value>,
) -> Result<(), AntigravitySettingsError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let serialized = serde_json::to_string_pretty(settings)?;
    fs::write(path, serialized)?;
    Ok(())
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

    /// Writes a settings file for one case and returns its path.
    fn settings_file(case: &str, contents: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "termexo-agy-settings-{case}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join(SETTINGS_FILE);
        if !contents.is_empty() {
            fs::write(&path, contents).unwrap();
        }
        path
    }

    fn settings_with(case: &str, contents: &str) -> (PathBuf, Map<String, Value>) {
        let path = settings_file(case, contents);
        let settings = read_settings(&path).unwrap();
        (path, settings)
    }

    #[test]
    fn a_missing_settings_file_reads_as_empty_rather_than_failing() {
        let (_, settings) = settings_with("missing", "");

        assert!(settings.is_empty());
    }

    /// The CLI escapes the command again before running it, so a quote of ours reaches `cmd` as
    /// part of the program name and every update fails.
    #[test]
    fn the_command_is_written_without_quotes() {
        let block = status_line_block(Path::new(r"C:\Termexo\termexo.exe"));

        let command = block.get("command").and_then(Value::as_str).unwrap();
        assert_eq!(command, r"C:\Termexo\termexo.exe agy-status");
        assert!(!command.contains('"'));
    }

    /// Windows can have short names switched off, and a path that does not exist has none at all;
    /// the command is still written, because an unquoted long path is what `cmd` copes with best.
    #[test]
    fn a_path_with_spaces_falls_back_to_itself_when_it_has_no_short_form() {
        let long = Path::new(r"C:\Program Files\Nowhere At All\termexo.exe");

        let command = command_path(long);
        assert!(command.ends_with("termexo.exe"));
        assert!(!command.contains('"'));
    }

    /// A status line left by an older or relocated Termexo has to be brought back into line,
    /// because until it is, it fails on every agy session on the machine.
    #[test]
    fn a_stale_status_line_is_rewritten_for_this_installation() {
        let (path, mut settings) = settings_with("stale", "{}");
        settings.insert(
            STATUS_LINE_KEY.into(),
            json!({ "type": "command", "command": "\"D:\\Old\\termexo.exe\" agy-status" }),
        );
        write_settings(&path, &settings).unwrap();

        // The repair only rewrites the settings file this process resolves, so the check is on
        // the decision itself: the recorded command is ours, and it is not the one we would write.
        let current = read_settings(&path).unwrap();
        let recorded = current.get(STATUS_LINE_KEY).unwrap();
        assert!(is_termexo_status_line(recorded));
        assert_ne!(
            recorded,
            &status_line_block(Path::new(r"C:\Termexo\termexo.exe"))
        );
    }

    /// A status line that is not Termexo's is never rewritten, whatever it points at.
    #[test]
    fn a_foreign_status_line_is_left_alone_by_the_repair() {
        let foreign = json!({ "type": "command", "command": "my-own-status-line" });

        assert!(!is_termexo_status_line(&foreign));
    }

    /// The user's own settings must survive having the feed added beside them.
    #[test]
    fn installing_keeps_the_settings_that_were_already_there() {
        let (path, mut settings) = settings_with("keeps", r#"{"model":"Gemini 3.8 Flash (High)"}"#);
        settings.insert(
            STATUS_LINE_KEY.into(),
            status_line_block(Path::new("C:\\Termexo\\termexo.exe")),
        );
        write_settings(&path, &settings).unwrap();

        let reread = read_settings(&path).unwrap();
        assert_eq!(reread.get("model").unwrap(), "Gemini 3.8 Flash (High)");
        assert!(is_termexo_status_line(reread.get(STATUS_LINE_KEY).unwrap()));
    }

    /// A status line the user configured is theirs; removing ours has to give it back.
    #[test]
    fn a_replaced_status_line_is_restored_when_the_feed_is_removed() {
        let (path, mut settings) = settings_with(
            "restore",
            r#"{"statusLine":{"type":"command","command":"~/my-own-statusline.sh"}}"#,
        );

        // Install: the previous block is set aside, not discarded.
        let previous = settings.get(STATUS_LINE_KEY).cloned().unwrap();
        settings.insert(SAVED_STATUS_LINE_KEY.into(), previous);
        settings.insert(
            STATUS_LINE_KEY.into(),
            status_line_block(Path::new("C:\\Termexo\\termexo.exe")),
        );
        write_settings(&path, &settings).unwrap();

        // Remove: it comes back.
        let mut settings = read_settings(&path).unwrap();
        let saved = settings.remove(SAVED_STATUS_LINE_KEY).unwrap();
        settings.insert(STATUS_LINE_KEY.into(), saved);
        write_settings(&path, &settings).unwrap();

        let reread = read_settings(&path).unwrap();
        assert_eq!(
            reread.get(STATUS_LINE_KEY).unwrap().get("command").unwrap(),
            "~/my-own-statusline.sh"
        );
        assert!(reread.get(SAVED_STATUS_LINE_KEY).is_none());
    }

    /// Recognised by the subcommand, so a Termexo that moved still knows its own block.
    #[test]
    fn a_status_line_is_recognised_wherever_termexo_was_installed() {
        let moved = status_line_block(Path::new("D:\\Elsewhere\\termexo.exe"));

        assert!(is_termexo_status_line(&moved));
        assert!(!is_termexo_status_line(&json!({
            "type": "command",
            "command": "~/my-own-statusline.sh"
        })));
    }

    #[test]
    fn a_settings_file_that_is_not_an_object_is_refused_rather_than_overwritten() {
        let path = settings_file("not-object", "[]");

        assert!(matches!(
            read_settings(&path),
            Err(AntigravitySettingsError::NotAnObject(_))
        ));
    }

    #[test]
    fn trusting_a_workspace_does_not_add_it_twice() {
        let (path, mut settings) =
            settings_with("trust", r#"{"trustedWorkspaces":["C:\\Users\\me"]}"#);
        let trusted = settings
            .entry(TRUSTED_WORKSPACES_KEY)
            .or_insert_with(|| json!([]));
        let list = trusted.as_array_mut().unwrap();
        let already = list
            .iter()
            .filter_map(Value::as_str)
            .any(|existing| paths_equal(existing, "c:/users/me"));

        assert!(
            already,
            "the same path in another shape is still the same workspace"
        );
        write_settings(&path, &settings).unwrap();
    }
}
