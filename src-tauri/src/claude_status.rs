//! Claude Code's subscription allowance, taken from the status line instead of from its login.
//!
//! Claude Code hands its status line command a JSON document after every response, and for Pro
//! and Max subscribers that document carries `rate_limits` with the 5-hour and 7-day windows.
//! Termexo registers `claude-status` as that command for the terminals it launches, which keeps the
//! latest figures in a small file the quota view reads. Nothing here touches the OAuth token, so
//! macOS has no Keychain item to ask the user about.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

const EVENT_FILE_FLAG: &str = "--event-file";
const CONFIG_DIR_ENV: &str = "CLAUDE_CONFIG_DIR";
const DEFAULT_ACCOUNT_KEY: &str = "default";
/// The windows Claude Code reports; anything else it adds later is not a quota line yet.
const WINDOWS: [&str; 2] = ["five_hour", "seven_day"];
/// Hex characters of the account digest kept in a file name; collisions between a user's few
/// accounts at 64 bits are not a concern.
const DIGEST_CHARS: usize = 16;

/// Keeps the figures from the status line input, for the account the process runs under.
///
/// Runs as Claude Code's status line command, so it prints nothing: the line it would draw is
/// not something Termexo has an opinion about.
pub fn capture_from_cli() -> Result<(), String> {
    let arguments = std::env::args().skip(2).collect::<Vec<_>>();
    let event_file = arguments
        .windows(2)
        .find(|pair| pair[0] == EVENT_FILE_FLAG)
        .map(|pair| PathBuf::from(&pair[1]))
        .ok_or("missing --event-file")?;
    let data_directory = event_file.parent().ok_or("event file has no directory")?;

    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| error.to_string())?;
    let input: Value = serde_json::from_str(&input).map_err(|error| error.to_string())?;
    let config_dir = std::env::var(CONFIG_DIR_ENV).ok();
    store(data_directory, config_dir.as_deref(), &input, now_seconds())
}

/// Writes the rate limits found in `input`, if it has any, and leaves the file alone if not.
fn store(
    data_directory: &Path,
    config_dir: Option<&str>,
    input: &Value,
    now: i64,
) -> Result<(), String> {
    let Some(limits) = input.get("rate_limits").and_then(Value::as_object) else {
        return Ok(());
    };
    let mut windows = Map::new();
    for name in WINDOWS {
        let Some(window) = limits.get(name) else {
            continue;
        };
        let (Some(used), Some(resets_at)) = (
            window.get("used_percentage").and_then(Value::as_f64),
            window.get("resets_at").and_then(Value::as_i64),
        ) else {
            continue;
        };
        windows.insert(
            name.into(),
            json!({"used_percentage": used, "resets_at": resets_at}),
        );
    }
    if windows.is_empty() {
        return Ok(());
    }
    let record = json!({"updated_at": now, "windows": windows});

    let path = rate_limit_file(data_directory, config_dir);
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(&record).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}

/// One file per account, named from a digest so a config directory path never ends up in it.
pub fn rate_limit_file(data_directory: &Path, config_dir: Option<&str>) -> PathBuf {
    let key = config_dir
        .map(str::trim)
        .filter(|directory| !directory.is_empty())
        .unwrap_or(DEFAULT_ACCOUNT_KEY);
    let digest = Sha256::digest(key.as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    data_directory.join(format!("claude-rate-limits-{}.json", &hex[..DIGEST_CHARS]))
}

/// What the quota view needs: the windows in the shape the provider's own endpoint answers with,
/// so the one parser serves both, and when the figures were last seen (milliseconds).
pub struct StoredAllowance {
    pub body: Value,
    pub updated_at: i64,
}

/// The stored figures that are still current: a window whose reset time has passed describes a
/// period that is over, so it is dropped rather than shown as consumed.
pub fn read_allowance(
    data_directory: &Path,
    config_dir: Option<&str>,
    now: i64,
) -> Option<StoredAllowance> {
    let record: Value =
        serde_json::from_slice(&fs::read(rate_limit_file(data_directory, config_dir)).ok()?)
            .ok()?;
    let windows = record.get("windows")?.as_object()?;
    let mut body = Map::new();
    for (name, window) in windows {
        let resets_at = window.get("resets_at").and_then(Value::as_i64)?;
        if resets_at <= now {
            continue;
        }
        body.insert(
            name.clone(),
            json!({
                "utilization": window.get("used_percentage")?,
                "resets_at": resets_at,
            }),
        );
    }
    let updated_at = record.get("updated_at").and_then(Value::as_i64)? * 1000;
    (!body.is_empty()).then(|| StoredAllowance {
        body: Value::Object(body),
        updated_at,
    })
}

/// Whether the user already configured a status line of their own, which Termexo must not replace.
pub fn user_has_status_line() -> bool {
    let Some(home) = crate::platform::home_dir() else {
        return false;
    };
    let path = std::env::var_os(CONFIG_DIR_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"))
        .join("settings.json");
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|settings| settings.get("statusLine").is_some())
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "termexo-claude-status-{name}-{}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn input(five_hour: f64, resets_at: i64) -> Value {
        json!({
            "model": {"display_name": "Opus"},
            "rate_limits": {
                "five_hour": {"used_percentage": five_hour, "resets_at": resets_at},
                "seven_day": {"used_percentage": 41.2, "resets_at": resets_at + 1000}
            }
        })
    }

    #[test]
    fn stored_windows_come_back_in_the_providers_shape() {
        let directory = directory("round-trip");
        store(&directory, None, &input(23.5, 2_000), 1_000).unwrap();

        let allowance = read_allowance(&directory, None, 1_500).unwrap();

        assert_eq!(allowance.body["five_hour"]["utilization"], 23.5);
        assert_eq!(allowance.body["seven_day"]["resets_at"], 3_000);
        assert_eq!(allowance.updated_at, 1_000_000);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn a_window_that_has_reset_is_not_shown() {
        let directory = directory("expired");
        store(&directory, None, &input(90.0, 2_000), 1_000).unwrap();

        let allowance = read_allowance(&directory, None, 2_500).unwrap();

        assert!(allowance.body.get("five_hour").is_none());
        assert!(allowance.body.get("seven_day").is_some());
        assert!(read_allowance(&directory, None, 9_000).is_none());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn input_without_limits_keeps_what_was_stored() {
        let directory = directory("absent");
        store(&directory, None, &input(10.0, 2_000), 1_000).unwrap();
        store(&directory, None, &json!({"model": {}}), 1_200).unwrap();

        assert_eq!(read_allowance(&directory, None, 1_500).unwrap().updated_at, 1_000_000);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn each_account_has_its_own_file() {
        let directory = directory("accounts");
        store(&directory, Some("/profiles/one"), &input(10.0, 2_000), 1_000).unwrap();

        assert!(read_allowance(&directory, Some("/profiles/one"), 1_500).is_some());
        assert!(read_allowance(&directory, None, 1_500).is_none());
        assert!(!rate_limit_file(&directory, Some("/profiles/one"))
            .to_string_lossy()
            .contains("profiles"));
        fs::remove_dir_all(directory).unwrap();
    }
}
