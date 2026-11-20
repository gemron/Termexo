use crate::platform::shell_invoke;
use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::{Map, Value};

use crate::agent::{
    AgentAdapter, AgentInstallation, ClaudeCodeAdapter, CodexCliAdapter, GrokBuildAdapter,
    OpenCodeAdapter, PiAdapter,
};
use crate::config::{AccountLoginMethod, AccountProfile};

/// Claude's per-home global config: identity, first-run state and caches.
const CLAUDE_GLOBAL_CONFIG_FILE: &str = ".claude.json";
/// Where Claude keeps the OAuth tokens of a signed-in account; its presence is the sign-in.
const CLAUDE_CREDENTIALS_FILE: &str = ".credentials.json";
/// The flag Claude reads to decide whether to run its first-run wizard.
const CLAUDE_ONBOARDING_FLAG: &str = "hasCompletedOnboarding";
/// Suffix of the temporary file a config is written through, so a reader never sees half of it.
const ATOMIC_WRITE_SUFFIX: &str = ".termexo-tmp";

/// What may travel between accounts: the user's own configuration, and nothing else.
///
/// An allow list rather than a deny list, because both CLIs keep credentials, identity, session
/// history, caches, logs and multi-hundred-megabyte databases in the same directory. Copying
/// `.credentials.json`/`auth.json` would sign one account in as another, and `.claude.json`
/// carries `userID`, `oauthAccount` and `machineID`, so neither is ever eligible.
const CLAUDE_PORTABLE_ENTRIES: &[&str] = &[
    "settings.json",
    "CLAUDE.md",
    "plugins",
    "skills",
    "agents",
    "commands",
];
const CODEX_PORTABLE_ENTRIES: &[&str] = &["config.toml", "AGENTS.md", "skills", "plugins", "rules"];
const PI_PORTABLE_ENTRIES: &[&str] = &["settings.json", "models-store.json"];
const GROK_PORTABLE_ENTRIES: &[&str] = &["config.toml", "hooks", "installed-plugins"];
const OPENCODE_PORTABLE_ENTRIES: &[&str] = &[];

/// Names copied under a portable directory are still filtered, so a plugin cache cannot smuggle
/// a token across.
const NEVER_COPY: &[&str] = &[
    CLAUDE_CREDENTIALS_FILE,
    "auth.json",
    "auth.json.lock",
    "active_sessions.json",
    "active_sessions.lock",
    CLAUDE_GLOBAL_CONFIG_FILE,
    "installation_id",
    "cap_sid",
];

pub fn validate_agent_type(agent_type: &str) -> Result<&str, String> {
    match agent_type.trim() {
        "claude" => Ok("claude"),
        "codex" => Ok("codex"),
        "opencode" => Ok("opencode"),
        "pi" => Ok("pi"),
        "grok" => Ok("grok"),
        _ => Err("账号类型必须是 Claude、ChatGPT/Codex、OpenCode、Pi 或 Grok。".into()),
    }
}

pub fn validate_profile_id(profile_id: &str) -> Result<&str, String> {
    let profile_id = profile_id.trim();
    if profile_id.is_empty()
        || !profile_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("账号 Profile ID 只能包含字母、数字、连字符和下划线。".into());
    }
    Ok(profile_id)
}

pub fn managed_config_dir(
    app_data_dir: &Path,
    agent_type: &str,
    profile_id: &str,
) -> Result<PathBuf, String> {
    let agent_type = validate_agent_type(agent_type)?;
    let profile_id = validate_profile_id(profile_id)?;
    Ok(app_data_dir
        .join("accounts")
        .join(agent_type)
        .join(profile_id))
}

/// Keychain service Claude Code files a config directory's sign-in under: the shared name with
/// the first eight hex digits of the directory path's SHA-256 appended.
#[cfg(target_os = "macos")]
fn claude_keychain_service(config_dir: &str) -> String {
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(config_dir.as_bytes());
    let suffix: String = digest
        .iter()
        .take(4)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("Claude Code-credentials-{suffix}")
}

/// Removes what a deleted managed account leaves behind: its config directory and, on macOS for
/// Claude, the sign-in Claude Code keeps in the Keychain rather than in that directory.
///
/// Only a directory inside Termexo's own `accounts` folder is touched, so a profile pointing at
/// someone's real home directory is never deleted. Best effort: the profile is already gone.
pub fn forget_managed_account(profile: &AccountProfile, data_directory: &Path) {
    let Some(config_dir) = profile.config_dir.as_deref() else {
        return;
    };
    let accounts = data_directory.join("accounts");
    let inside_accounts = Path::new(config_dir)
        .canonicalize()
        .ok()
        .zip(accounts.canonicalize().ok())
        .is_some_and(|(directory, accounts)| directory.starts_with(accounts));
    if !inside_accounts {
        return;
    }
    #[cfg(target_os = "macos")]
    if profile.agent_type == "claude" {
        let removed = Command::new("security")
            .args([
                "delete-generic-password",
                "-s",
                &claude_keychain_service(config_dir),
            ])
            .output()
            .is_ok_and(|output| output.status.success());
        if !removed {
            tracing::info!(target: "termexo::account", "No Keychain sign-in found for the deleted account");
        }
    }
    if let Err(error) = fs::remove_dir_all(config_dir) {
        tracing::warn!(target: "termexo::account", "Could not remove the account directory: {error}");
    }
}

pub fn prepare_managed_directory(profile: &AccountProfile) -> Result<(), String> {
    let Some(config_dir) = profile.config_dir.as_deref() else {
        return Ok(());
    };
    let directory = Path::new(config_dir);
    fs::create_dir_all(directory)
        .map_err(|error| format!("无法创建账号目录 {}：{error}", directory.to_string_lossy()))?;
    match profile.agent_type.as_str() {
        "codex" => ensure_codex_file_credentials(directory)?,
        "claude" => {
            // Best effort: a launch must not fail over a wizard flag the user can click through.
            if let Err(error) = ensure_claude_onboarding_complete(directory) {
                tracing::warn!(target: "termexo::account", "{error}");
            }
        }
        "opencode" => {
            // OpenCode stores auth.json and opencode.db under $XDG_DATA_HOME/opencode.
            let nested = directory.join("opencode");
            fs::create_dir_all(&nested).map_err(|error| {
                format!(
                    "无法创建 OpenCode 账号数据目录 {}：{error}",
                    nested.to_string_lossy()
                )
            })?;
        }
        _ => {}
    }
    Ok(())
}

/// Marks first-run onboarding as done in a managed Claude account that already holds a sign-in.
///
/// Claude decides whether to run its first-run wizard from `hasCompletedOnboarding` alone, and the
/// wizard always ends on a login screen, so an account signed in through `claude auth login` was
/// asked to sign in again the first time a terminal opened on it. Current CLI builds set the flag
/// from `auth login` themselves; accounts signed in by earlier builds never got it. The flag is
/// only written once the credentials file exists, so an account that has not signed in still gets
/// the wizard, and nothing else in the file is touched.
fn ensure_claude_onboarding_complete(directory: &Path) -> Result<(), String> {
    if !directory.join(CLAUDE_CREDENTIALS_FILE).is_file() {
        return Ok(());
    }
    let config_path = directory.join(CLAUDE_GLOBAL_CONFIG_FILE);
    let mut config = read_claude_global_config(&config_path)?;
    if config.get(CLAUDE_ONBOARDING_FLAG).and_then(Value::as_bool) == Some(true) {
        return Ok(());
    }
    config.insert(CLAUDE_ONBOARDING_FLAG.into(), Value::Bool(true));
    write_json_atomically(&config_path, &Value::Object(config))
}

fn read_claude_global_config(config_path: &Path) -> Result<Map<String, Value>, String> {
    let bytes = match fs::read(config_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Map::new()),
        Err(error) => {
            return Err(format!(
                "无法读取账号配置 {}：{error}",
                config_path.to_string_lossy()
            ))
        }
    };
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Object(config)) => Ok(config),
        // Claude repairs a damaged config from its own backups; rewriting it here would destroy
        // what it repairs from.
        _ => Err(format!(
            "账号配置 {} 不是有效的 JSON 对象，已跳过首次向导标记。",
            config_path.to_string_lossy()
        )),
    }
}

/// Writes through a sibling temporary file and renames it into place, so a CLI reading the
/// config at the same moment sees either the old file or the new one, never a partial write.
fn write_json_atomically(path: &Path, value: &Value) -> Result<(), String> {
    let describe = |action: &str, error: std::io::Error| {
        format!("无法{action} {}：{error}", path.to_string_lossy())
    };
    let serialized = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("无法序列化 {}：{error}", path.to_string_lossy()))?;
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(ATOMIC_WRITE_SUFFIX);
    let temporary = PathBuf::from(temporary);
    fs::write(&temporary, serialized).map_err(|error| describe("写入", error))?;
    fs::rename(&temporary, path).map_err(|error| {
        fs::remove_file(&temporary).ok();
        describe("替换", error)
    })
}

fn ensure_codex_file_credentials(directory: &Path) -> Result<(), String> {
    let config_path = directory.join("config.toml");
    let current = fs::read_to_string(&config_path).unwrap_or_default();
    if current
        .lines()
        .any(|line| line.trim_start().starts_with("cli_auth_credentials_store"))
    {
        return Ok(());
    }
    let separator = (!current.is_empty() && !current.ends_with('\n')).then_some("\n");
    let updated = format!(
        "{current}{}cli_auth_credentials_store = \"file\"\n",
        separator.unwrap_or_default()
    );
    fs::write(&config_path, updated)
        .map_err(|error| format!("无法写入 Codex 账号隔离配置：{error}"))
}

pub fn environment(profile: &AccountProfile) -> HashMap<String, String> {
    let mut environment = HashMap::new();
    if let Some(config_dir) = profile.config_dir.as_deref() {
        let key = match profile.agent_type.as_str() {
            "claude" => "CLAUDE_CONFIG_DIR",
            "codex" => "CODEX_HOME",
            "opencode" => "XDG_DATA_HOME",
            "pi" => "PI_CODING_AGENT_DIR",
            "grok" => "GROK_HOME",
            _ => return environment,
        };
        environment.insert(key.into(), config_dir.into());
    }
    environment
}

pub fn refresh_status(mut profile: AccountProfile) -> AccountProfile {
    if let Err(error) = prepare_managed_directory(&profile) {
        profile.diagnostic = error;
        return profile;
    }
    let installation = match detect(&profile.agent_type) {
        Ok(installation) => installation,
        Err(error) => {
            profile.diagnostic = error;
            return profile;
        }
    };
    let Some(executable) = installation.executable_path.as_deref() else {
        profile.diagnostic = installation.diagnostic;
        return profile;
    };
    match profile.agent_type.as_str() {
        "claude" => {
            match run_cli(
                executable,
                &["auth", "status", "--json"],
                &environment(&profile),
            ) {
                Ok(output) => {
                    let value =
                        serde_json::from_slice::<Value>(&output.stdout).unwrap_or(Value::Null);
                    profile.authenticated = value
                        .get("loggedIn")
                        .and_then(Value::as_bool)
                        .unwrap_or(output.status.success());
                    profile.diagnostic = value
                        .get("authMethod")
                        .and_then(Value::as_str)
                        .filter(|method| !method.is_empty() && *method != "none")
                        .map(|method| format!("已登录 · {method}"))
                        .unwrap_or_else(|| "尚未登录".into());
                }
                Err(error) => profile.diagnostic = format!("登录状态检测失败：{error}"),
            }
        }
        "codex" => match run_cli(executable, &["login", "status"], &environment(&profile)) {
            Ok(output) => {
                profile.authenticated = output.status.success();
                let detail = output_text(&output);
                profile.diagnostic = if profile.authenticated {
                    if detail.is_empty() {
                        "已登录 ChatGPT".into()
                    } else {
                        detail
                    }
                } else {
                    "尚未登录".into()
                };
            }
            Err(error) => profile.diagnostic = format!("登录状态检测失败：{error}"),
        },
        "opencode" => {
            refresh_opencode_status(&mut profile, executable);
        }
        "pi" => {
            refresh_pi_status(&mut profile);
        }
        "grok" => {
            refresh_grok_status(&mut profile);
        }
        _ => {
            profile.diagnostic = "不支持的账号类型".into();
        }
    }
    profile
}

fn refresh_opencode_status(profile: &mut AccountProfile, executable: &str) {
    let standalone = OpenCodeAdapter::new()
        .plugin_api_version()
        .is_ok_and(|major| major >= 2);
    let args: &[&str] = if standalone {
        &["auth", "list", "--format", "json", "--standalone"]
    } else {
        &["auth", "list", "--format", "json"]
    };
    if let Ok(output) = run_cli(executable, args, &environment(profile)) {
        if output.status.success() {
            if let Ok(Value::Array(items)) = serde_json::from_slice::<Value>(&output.stdout) {
                if !items.is_empty() {
                    let labels: Vec<String> = items
                        .iter()
                        .filter_map(|item| {
                            item.get("provider")
                                .or_else(|| item.get("name"))
                                .or_else(|| item.get("id"))
                                .and_then(Value::as_str)
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_owned)
                        })
                        .take(3)
                        .collect();
                    profile.authenticated = true;
                    profile.diagnostic = if labels.is_empty() {
                        "已登录 OpenCode".into()
                    } else {
                        format!("已登录 · {}", labels.join(", "))
                    };
                    return;
                }
                profile.authenticated = false;
                profile.diagnostic = "尚未登录".into();
                return;
            }
        }
    }
    // Fallback to OpenCode's auth.json directly when an older CLI does not support `--format json`.
    if let Ok(dir) = resolve_config_dir(profile) {
        let auth_path = dir.join("opencode").join("auth.json");
        let (authenticated, diagnostic) = read_provider_auth_json(&auth_path, "OpenCode");
        profile.authenticated = authenticated;
        profile.diagnostic = diagnostic;
    } else {
        profile.authenticated = false;
        profile.diagnostic = "尚未登录".into();
    }
}

fn refresh_pi_status(profile: &mut AccountProfile) {
    match resolve_config_dir(profile) {
        Ok(dir) => {
            let (authenticated, diagnostic) = read_provider_auth_json(&dir.join("auth.json"), "Pi");
            profile.authenticated = authenticated;
            profile.diagnostic = diagnostic;
        }
        Err(error) => {
            profile.authenticated = false;
            profile.diagnostic = error;
        }
    }
}

fn refresh_grok_status(profile: &mut AccountProfile) {
    let dir = match resolve_config_dir(profile) {
        Ok(dir) => dir,
        Err(error) => {
            profile.authenticated = false;
            profile.diagnostic = error;
            return;
        }
    };
    let path = dir.join("auth.json");
    let Ok(bytes) = fs::read(&path) else {
        profile.authenticated = false;
        profile.diagnostic = "尚未登录".into();
        return;
    };
    let Ok(Value::Object(entries)) = serde_json::from_slice::<Value>(&bytes) else {
        profile.authenticated = false;
        profile.diagnostic = "尚未登录".into();
        return;
    };
    let signed_in = entries.values().any(|value| {
        value.as_object().is_some_and(|object| {
            ["key", "access_token", "token", "api_key"]
                .iter()
                .any(|field| {
                    object
                        .get(*field)
                        .and_then(Value::as_str)
                        .is_some_and(|secret| !secret.trim().is_empty())
                })
        })
    });
    profile.authenticated = signed_in;
    profile.diagnostic = if signed_in {
        "已登录 Grok".into()
    } else {
        "尚未登录".into()
    };
}

fn read_provider_auth_json(path: &Path, label: &str) -> (bool, String) {
    let Ok(bytes) = fs::read(path) else {
        return (false, "尚未登录".into());
    };
    let Ok(Value::Object(entries)) = serde_json::from_slice::<Value>(&bytes) else {
        return (false, "尚未登录".into());
    };
    let providers: Vec<String> = entries
        .iter()
        .filter(|(_, value)| match value {
            Value::Object(map) => !map.is_empty(),
            Value::String(secret) => !secret.trim().is_empty(),
            _ => false,
        })
        .map(|(provider, _)| provider.clone())
        .collect();
    if providers.is_empty() {
        (false, "尚未登录".into())
    } else {
        let preview = providers.iter().take(3).cloned().collect::<Vec<_>>().join(", ");
        let suffix = if providers.len() > 3 {
            format!(" 等 {} 项", providers.len())
        } else {
            String::new()
        };
        let detail = if preview.is_empty() {
            format!("已登录 {label}")
        } else {
            format!("已登录 · {preview}{suffix}")
        };
        (true, detail)
    }
}

/// Where an account's CLI actually keeps its files: its managed directory, or the CLI's own
/// default location for the system account, which has no directory of its own.
pub fn resolve_config_dir(profile: &AccountProfile) -> Result<PathBuf, String> {
    if let Some(config_dir) = profile.config_dir.as_deref() {
        return Ok(PathBuf::from(config_dir));
    }
    let home = crate::platform::home_dir()
        .ok_or_else(|| "无法定位用户主目录，系统账号的配置位置未知。".to_owned())?;
    let default_dir = match profile.agent_type.as_str() {
        "claude" => match std::env::var_os("CLAUDE_CONFIG_DIR") {
            Some(dir) if !dir.is_empty() => PathBuf::from(dir),
            _ => home.join(".claude"),
        },
        "codex" => match std::env::var_os("CODEX_HOME") {
            Some(codex_home) if !codex_home.is_empty() => PathBuf::from(codex_home),
            _ => home.join(".codex"),
        },
        "opencode" => match std::env::var_os("XDG_DATA_HOME") {
            Some(data_home) if !data_home.is_empty() => PathBuf::from(data_home),
            _ => home.join(".local").join("share"),
        },
        "pi" => match std::env::var_os("PI_CODING_AGENT_DIR") {
            Some(dir) if !dir.is_empty() => PathBuf::from(dir),
            _ => home.join(".pi").join("agent"),
        },
        "grok" => match std::env::var_os("GROK_HOME") {
            Some(dir) if !dir.is_empty() => PathBuf::from(dir),
            _ => home.join(".grok"),
        },
        other => return Err(format!("不支持的账号类型：{other}")),
    };
    Ok(default_dir)
}

/// Copies the user's configuration from one account to another, leaving both sign-ins intact.
///
/// Returns the entries that were actually copied, so the UI can report what moved instead of
/// claiming a success that silently did nothing.
pub fn copy_configuration(
    source: &AccountProfile,
    target: &AccountProfile,
) -> Result<Vec<String>, String> {
    if source.id == target.id {
        return Err("源账号与目标账号相同。".into());
    }
    if source.agent_type != target.agent_type {
        return Err("只能在同一类型的账号之间复制配置。".into());
    }
    let source_dir = resolve_config_dir(source)?;
    if !source_dir.is_dir() {
        return Err(format!(
            "源账号还没有配置目录：{}",
            source_dir.to_string_lossy()
        ));
    }
    prepare_managed_directory(target)?;
    let target_dir = resolve_config_dir(target)?;
    fs::create_dir_all(&target_dir).map_err(|error| format!("无法创建目标账号目录：{error}"))?;

    let entries = match source.agent_type.as_str() {
        "claude" => CLAUDE_PORTABLE_ENTRIES,
        "codex" => CODEX_PORTABLE_ENTRIES,
        "pi" => PI_PORTABLE_ENTRIES,
        "grok" => GROK_PORTABLE_ENTRIES,
        "opencode" => OPENCODE_PORTABLE_ENTRIES,
        _ => return Err("不支持的账号类型。".into()),
    };
    let mut copied = Vec::new();
    for entry in entries {
        let from = source_dir.join(entry);
        if !from.exists() {
            continue;
        }
        let to = target_dir.join(entry);
        if from.is_dir() {
            copy_directory(&from, &to)?;
        } else {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("无法创建 {}：{error}", parent.to_string_lossy()))?;
            }
            fs::copy(&from, &to).map_err(|error| format!("无法复制 {entry}：{error}"))?;
        }
        copied.push((*entry).to_owned());
    }

    // Copying config.toml would drop the isolation setting Termexo writes for a managed Codex
    // account, which is what keeps its credentials out of the shared store.
    if target.agent_type == "codex" {
        ensure_codex_file_credentials(&target_dir)?;
    }
    Ok(copied)
}

fn copy_directory(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to)
        .map_err(|error| format!("无法创建 {}：{error}", to.to_string_lossy()))?;
    let listing = fs::read_dir(from)
        .map_err(|error| format!("无法读取 {}：{error}", from.to_string_lossy()))?;
    for entry in listing {
        let entry = entry.map_err(|error| format!("无法读取目录项：{error}"))?;
        let name = entry.file_name();
        if NEVER_COPY.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }
        let source_path = entry.path();
        let target_path = to.join(&name);
        if source_path.is_dir() {
            copy_directory(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path)
                .map_err(|error| format!("无法复制 {}：{error}", source_path.to_string_lossy()))?;
        }
    }
    Ok(())
}

pub fn login_spec(profile: &AccountProfile) -> Result<(String, String), String> {
    validate_agent_type(&profile.agent_type)?;
    validate_login_method(&profile.agent_type, profile.login_method)?;
    prepare_managed_directory(profile)?;
    let installation = detect(&profile.agent_type)?;
    let executable = installation
        .executable_path
        .ok_or_else(|| installation.diagnostic.clone())?;
    let mut command = login_command(&profile.agent_type, profile.login_method, &executable)?;
    if profile.agent_type == "opencode"
        && OpenCodeAdapter::new()
            .plugin_api_version()
            .is_ok_and(|major| major >= 2)
    {
        command.push_str(" --standalone");
    }
    let command = close_when_done(command);
    Ok((command, executable))
}

pub fn validate_login_method(agent_type: &str, method: AccountLoginMethod) -> Result<(), String> {
    login_arguments(agent_type, method).map(|_| ())
}

fn login_arguments(agent_type: &str, method: AccountLoginMethod) -> Result<&'static str, String> {
    match (validate_agent_type(agent_type)?, method) {
        ("claude", AccountLoginMethod::Browser) => Ok("auth login"),
        ("claude", AccountLoginMethod::Console) => Ok("auth login --console"),
        ("claude", AccountLoginMethod::Sso) => Ok("auth login --sso"),
        ("codex", AccountLoginMethod::Browser) => Ok("login"),
        ("codex", AccountLoginMethod::DeviceCode) => Ok("login --device-auth"),
        ("opencode", AccountLoginMethod::Browser) => Ok("auth login"),
        ("grok", AccountLoginMethod::Browser) => Ok("login"),
        ("grok", AccountLoginMethod::DeviceCode) => Ok("login --device-auth"),
        ("pi", AccountLoginMethod::Interactive) => Ok(""),
        _ => Err(format!(
            "{agent_type} 不支持 {} 登录方式。",
            method.as_str()
        )),
    }
}

/// Ends the shell when the login CLI does, so the terminal's exit is the moment the account is
/// read back. Both Unix shells (where the command is typed) and PowerShell (which Termexo launches
/// with `-NoExit -Command` so normal agent sessions stay inspectable after exit) would otherwise
/// drop back to a prompt, leaving the login tab "running" and preventing exit-triggered account
/// confirmation. Passing the CLI's exit status preserves failure reporting.
fn close_when_done(command: String) -> String {
    #[cfg(unix)]
    return format!("{command}; exit");
    #[cfg(windows)]
    return format!("{command}; if ($null -ne $LASTEXITCODE) {{ exit $LASTEXITCODE }} else {{ exit 0 }}");
    #[cfg(not(any(unix, windows)))]
    return command;
}

fn login_command(
    agent_type: &str,
    method: AccountLoginMethod,
    executable: &str,
) -> Result<String, String> {
    let arguments = login_arguments(agent_type, method)?;
    if arguments.is_empty() {
        Ok(shell_invoke(executable))
    } else {
        Ok(format!("{} {arguments}", shell_invoke(executable)))
    }
}

fn detect(agent_type: &str) -> Result<AgentInstallation, String> {
    match agent_type {
        "claude" => ClaudeCodeAdapter::new()
            .detect()
            .map_err(|error| error.to_string()),
        "codex" => CodexCliAdapter::new()
            .detect()
            .map_err(|error| error.to_string()),
        "opencode" => OpenCodeAdapter::new()
            .detect()
            .map_err(|error| error.to_string()),
        "pi" => PiAdapter::new()
            .detect()
            .map_err(|error| error.to_string()),
        "grok" => GrokBuildAdapter::new()
            .detect()
            .map_err(|error| error.to_string()),
        other => Err(format!("不支持的账号类型：{other}")),
    }
}

fn run_cli(
    executable: &str,
    args: &[&str],
    environment: &HashMap<String, String>,
) -> std::io::Result<Output> {
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let path = Path::new(executable);
        let mut command = if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd"))
        {
            let mut command = Command::new("cmd.exe");
            command.args(["/d", "/c", "call"]).arg(executable);
            command
        } else {
            Command::new(executable)
        };
        command.creation_flags(CREATE_NO_WINDOW);
        command
    };

    #[cfg(not(windows))]
    let mut command = Command::new(executable);

    crate::process::run_with_timeout(
        command.args(args).envs(environment),
        std::time::Duration::from_secs(20),
    )
}

fn output_text(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if !stdout.is_empty() {
        return stdout;
    }
    String::from_utf8_lossy(&output.stderr).trim().to_owned()
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn the_keychain_service_follows_claude_codes_naming() {
        // Observed on a real sign-in: this config directory was filed under this suffix.
        assert_eq!(
            super::claude_keychain_service(
                "/Users/ullvarirontrail/Library/Application Support/Termexo/accounts/claude/d9834650-9eae-4951-a853-2737eb32673a"
            ),
            "Claude Code-credentials-20e800dd"
        );
    }
    use super::*;
    use serde_json::json;

    #[cfg(windows)]
    #[test]
    fn each_agent_uses_its_native_authentication_subcommand() {
        assert_eq!(
            login_command(
                "claude",
                AccountLoginMethod::Browser,
                "C:/Claude Code/claude.exe"
            )
            .unwrap(),
            "& 'C:/Claude Code/claude.exe' auth login"
        );
        assert_eq!(
            login_command(
                "codex",
                AccountLoginMethod::Browser,
                "C:/Codex's CLI/codex.cmd"
            )
            .unwrap(),
            "& 'C:/Codex''s CLI/codex.cmd' login"
        );
        assert!(login_command("unknown-agent", AccountLoginMethod::Browser, "agent.exe").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn the_login_shell_exits_with_the_cli() {
        assert_eq!(
            close_when_done("'/bin/claude' auth login".into()),
            "'/bin/claude' auth login; exit"
        );
    }

    #[cfg(unix)]
    #[test]
    fn login_commands_are_plain_posix_words() {
        assert_eq!(
            login_command(
                "claude",
                AccountLoginMethod::Browser,
                "/Users/me/my tools/claude"
            )
            .unwrap(),
            "'/Users/me/my tools/claude' auth login"
        );
        assert_eq!(
            login_command(
                "codex",
                AccountLoginMethod::DeviceCode,
                "/opt/codex's/bin/codex"
            )
            .unwrap(),
            r"'/opt/codex'\''s/bin/codex' login --device-auth"
        );
        assert!(login_command("unknown-agent", AccountLoginMethod::Browser, "agent").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn builds_only_the_login_methods_supported_by_each_agent() {
        for (agent, method, arguments) in [
            (
                "claude",
                AccountLoginMethod::Console,
                "auth login --console",
            ),
            ("claude", AccountLoginMethod::Sso, "auth login --sso"),
            (
                "codex",
                AccountLoginMethod::DeviceCode,
                "login --device-auth",
            ),
        ] {
            assert_eq!(
                login_command(agent, method, "C:/Agent's CLI/agent.exe").unwrap(),
                format!("& 'C:/Agent''s CLI/agent.exe' {arguments}")
            );
        }
        assert!(validate_login_method("claude", AccountLoginMethod::DeviceCode).is_err());
        assert!(validate_login_method("codex", AccountLoginMethod::Console).is_err());
        assert!(validate_login_method("codex", AccountLoginMethod::Sso).is_err());
    }

    #[test]
    fn legacy_account_inputs_keep_browser_login_and_unknown_methods_are_rejected() {
        let input = json!({"id":"legacy", "name":"Legacy", "agentType":"claude"});
        let parsed: crate::config::AccountProfileInput =
            serde_json::from_value(input.clone()).unwrap();
        assert_eq!(parsed.login_method, AccountLoginMethod::Browser);
        let mut invalid = input;
        invalid["loginMethod"] = json!("custom; injected-command");
        assert!(serde_json::from_value::<crate::config::AccountProfileInput>(invalid).is_err());
    }

    #[test]
    fn maps_managed_profiles_to_isolated_cli_homes() {
        let claude = AccountProfile {
            id: "claude-one".into(),
            name: "Claude One".into(),
            agent_type: "claude".into(),
            login_method: AccountLoginMethod::Browser,
            config_dir: Some("C:\\profiles\\claude-one".into()),
            is_default: true,
            is_system: false,
            authenticated: false,
            diagnostic: String::new(),
        };
        let codex = AccountProfile {
            agent_type: "codex".into(),
            config_dir: Some("C:\\profiles\\codex-one".into()),
            ..claude.clone()
        };

        assert_eq!(
            environment(&claude)
                .get("CLAUDE_CONFIG_DIR")
                .map(String::as_str),
            Some("C:\\profiles\\claude-one")
        );
        assert_eq!(
            environment(&codex).get("CODEX_HOME").map(String::as_str),
            Some("C:\\profiles\\codex-one")
        );
    }

    #[test]
    fn rejects_path_traversal_profile_ids() {
        assert!(validate_profile_id("../shared").is_err());
        assert!(validate_profile_id("safe-profile_1").is_ok());
    }

    fn temp_directory(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "termexo-account-{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn managed_claude_profile(config_dir: &Path) -> AccountProfile {
        AccountProfile {
            id: "managed".into(),
            name: "Managed".into(),
            agent_type: "claude".into(),
            login_method: AccountLoginMethod::Browser,
            config_dir: Some(config_dir.to_string_lossy().into_owned()),
            is_default: false,
            is_system: false,
            authenticated: false,
            diagnostic: String::new(),
        }
    }

    fn global_config_text(directory: &Path) -> String {
        fs::read_to_string(directory.join(CLAUDE_GLOBAL_CONFIG_FILE)).unwrap()
    }

    #[test]
    fn marks_onboarding_complete_for_a_signed_in_claude_account() {
        let root = temp_directory("onboarding");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(CLAUDE_CREDENTIALS_FILE), "{}").unwrap();
        fs::write(
            root.join(CLAUDE_GLOBAL_CONFIG_FILE),
            r#"{"theme":"dark","oauthAccount":{"emailAddress":"user@example.com"}}"#,
        )
        .unwrap();

        prepare_managed_directory(&managed_claude_profile(&root)).unwrap();

        let config = read_claude_global_config(&root.join(CLAUDE_GLOBAL_CONFIG_FILE)).unwrap();
        assert_eq!(config.get(CLAUDE_ONBOARDING_FLAG), Some(&Value::Bool(true)));
        // Everything Claude already stored, identity included, survives the flag.
        assert_eq!(config["theme"], "dark");
        assert_eq!(config["oauthAccount"]["emailAddress"], "user@example.com");
        assert!(!root
            .join(format!("{CLAUDE_GLOBAL_CONFIG_FILE}{ATOMIC_WRITE_SUFFIX}"))
            .exists());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn creates_the_config_for_a_sign_in_that_has_none_yet() {
        let root = temp_directory("onboarding-fresh");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(CLAUDE_CREDENTIALS_FILE), "{}").unwrap();

        prepare_managed_directory(&managed_claude_profile(&root)).unwrap();

        let config = read_claude_global_config(&root.join(CLAUDE_GLOBAL_CONFIG_FILE)).unwrap();
        assert_eq!(config.get(CLAUDE_ONBOARDING_FLAG), Some(&Value::Bool(true)));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn leaves_an_account_without_a_sign_in_on_the_wizard() {
        let root = temp_directory("onboarding-unsigned");
        fs::create_dir_all(&root).unwrap();
        let original = r#"{"theme":"dark"}"#;
        fs::write(root.join(CLAUDE_GLOBAL_CONFIG_FILE), original).unwrap();

        prepare_managed_directory(&managed_claude_profile(&root)).unwrap();

        assert_eq!(global_config_text(&root), original);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn does_not_rewrite_a_completed_or_damaged_config() {
        for original in [
            r#"{"hasCompletedOnboarding":true,"theme":"dark"}"#,
            "{not json",
        ] {
            let root = temp_directory("onboarding-untouched");
            fs::create_dir_all(&root).unwrap();
            fs::write(root.join(CLAUDE_CREDENTIALS_FILE), "{}").unwrap();
            fs::write(root.join(CLAUDE_GLOBAL_CONFIG_FILE), original).unwrap();

            prepare_managed_directory(&managed_claude_profile(&root)).unwrap();

            // Byte-identical proves the file was left alone, not merely re-serialised.
            assert_eq!(global_config_text(&root), original);

            fs::remove_dir_all(&root).ok();
        }
    }

    #[test]
    fn copies_configuration_without_carrying_credentials_or_identity() {
        let root = temp_directory("copy");
        let source_dir = root.join("source");
        let target_dir = root.join("target");
        fs::create_dir_all(source_dir.join("plugins").join("hud")).unwrap();
        fs::write(source_dir.join("settings.json"), "{\"theme\":\"dark\"}").unwrap();
        fs::write(source_dir.join("CLAUDE.md"), "# instructions").unwrap();
        fs::write(
            source_dir.join("plugins").join("hud").join("index.js"),
            "//",
        )
        .unwrap();
        // Identity and credentials sit beside the portable files and must not travel.
        fs::write(
            source_dir.join(".credentials.json"),
            "{\"token\":\"secret\"}",
        )
        .unwrap();
        fs::write(
            source_dir.join(".claude.json"),
            "{\"userID\":\"source-user\"}",
        )
        .unwrap();
        // A token hidden inside an otherwise portable directory is filtered too.
        fs::write(
            source_dir.join("plugins").join(".credentials.json"),
            "{\"token\":\"nested\"}",
        )
        .unwrap();
        fs::create_dir_all(source_dir.join("sessions")).unwrap();
        fs::write(source_dir.join("sessions").join("a.jsonl"), "{}").unwrap();

        let source = AccountProfile {
            id: "source".into(),
            name: "Source".into(),
            agent_type: "claude".into(),
            login_method: AccountLoginMethod::Browser,
            config_dir: Some(source_dir.to_string_lossy().into_owned()),
            is_default: false,
            is_system: false,
            authenticated: true,
            diagnostic: String::new(),
        };
        let target = AccountProfile {
            id: "target".into(),
            name: "Target".into(),
            config_dir: Some(target_dir.to_string_lossy().into_owned()),
            ..source.clone()
        };

        let copied = copy_configuration(&source, &target).unwrap();

        assert!(copied.contains(&"settings.json".to_owned()));
        assert!(copied.contains(&"CLAUDE.md".to_owned()));
        assert!(copied.contains(&"plugins".to_owned()));
        assert!(target_dir
            .join("plugins")
            .join("hud")
            .join("index.js")
            .is_file());
        assert!(!target_dir.join(".credentials.json").exists());
        assert!(!target_dir.join(".claude.json").exists());
        assert!(!target_dir
            .join("plugins")
            .join(".credentials.json")
            .exists());
        assert!(!target_dir.join("sessions").exists());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_to_copy_between_different_agents_or_onto_itself() {
        let claude = AccountProfile {
            id: "one".into(),
            name: "One".into(),
            agent_type: "claude".into(),
            login_method: AccountLoginMethod::Browser,
            config_dir: Some("C:\\profiles\\one".into()),
            is_default: false,
            is_system: false,
            authenticated: false,
            diagnostic: String::new(),
        };
        let codex = AccountProfile {
            id: "two".into(),
            agent_type: "codex".into(),
            ..claude.clone()
        };

        assert!(copy_configuration(&claude, &claude).is_err());
        assert!(copy_configuration(&claude, &codex).is_err());
    }

    #[test]
    fn maps_opencode_pi_and_grok_to_their_isolated_env_vars() {
        let base = AccountProfile {
            id: "isolated".into(),
            name: "Isolated".into(),
            agent_type: "opencode".into(),
            login_method: AccountLoginMethod::Browser,
            config_dir: Some("C:\\profiles\\isolated".into()),
            is_default: false,
            is_system: false,
            authenticated: false,
            diagnostic: String::new(),
        };
        assert_eq!(
            environment(&base).get("XDG_DATA_HOME").map(String::as_str),
            Some("C:\\profiles\\isolated")
        );
        let pi = AccountProfile {
            agent_type: "pi".into(),
            login_method: AccountLoginMethod::Interactive,
            ..base.clone()
        };
        assert_eq!(
            environment(&pi)
                .get("PI_CODING_AGENT_DIR")
                .map(String::as_str),
            Some("C:\\profiles\\isolated")
        );
        let grok = AccountProfile {
            agent_type: "grok".into(),
            ..base
        };
        assert_eq!(
            environment(&grok).get("GROK_HOME").map(String::as_str),
            Some("C:\\profiles\\isolated")
        );
    }

    #[test]
    fn builds_login_commands_for_opencode_pi_and_grok() {
        assert!(login_command("opencode", AccountLoginMethod::Browser, "opencode")
            .unwrap()
            .contains("auth login"));
        assert!(login_command("grok", AccountLoginMethod::Browser, "grok")
            .unwrap()
            .contains("login"));
        assert!(login_command("grok", AccountLoginMethod::DeviceCode, "grok")
            .unwrap()
            .contains("login --device-auth"));
        assert!(!login_command("pi", AccountLoginMethod::Interactive, "pi")
            .unwrap()
            .contains("login"));
        assert!(validate_login_method("pi", AccountLoginMethod::Browser).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_login_shell_exits_with_cli_exit_code() {
        let wrapped = close_when_done("& 'C:/claude.exe' auth login".into());
        assert!(wrapped.contains("exit $LASTEXITCODE"));
    }

    #[test]
    fn reads_grok_and_pi_auth_json_status() {
        let root = temp_directory("multi-auth");
        fs::create_dir_all(&root).unwrap();
        let mut pi = AccountProfile {
            id: "pi-1".into(),
            name: "Pi 1".into(),
            agent_type: "pi".into(),
            login_method: AccountLoginMethod::Interactive,
            config_dir: Some(root.to_string_lossy().into_owned()),
            is_default: false,
            is_system: false,
            authenticated: false,
            diagnostic: String::new(),
        };
        refresh_pi_status(&mut pi);
        assert!(!pi.authenticated);
        fs::write(
            root.join("auth.json"),
            r#"{"anthropic":{"access":"secret-token"}}"#,
        )
        .unwrap();
        refresh_pi_status(&mut pi);
        assert!(pi.authenticated);
        assert!(pi.diagnostic.contains("anthropic"));

        let mut grok = AccountProfile {
            id: "grok-1".into(),
            name: "Grok 1".into(),
            agent_type: "grok".into(),
            login_method: AccountLoginMethod::Browser,
            config_dir: Some(root.to_string_lossy().into_owned()),
            is_default: false,
            is_system: false,
            authenticated: false,
            diagnostic: String::new(),
        };
        fs::write(
            root.join("auth.json"),
            r#"{"https://auth.x.ai":{"key":"tok","user_id":"u1"}}"#,
        )
        .unwrap();
        refresh_grok_status(&mut grok);
        assert!(grok.authenticated);
        fs::remove_dir_all(&root).ok();
    }
}
