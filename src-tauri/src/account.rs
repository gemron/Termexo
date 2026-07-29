use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value;

use crate::agent::{AgentAdapter, AgentInstallation, ClaudeCodeAdapter, CodexCliAdapter};
use crate::config::AccountProfile;

pub fn validate_agent_type(agent_type: &str) -> Result<&str, String> {
    match agent_type.trim() {
        "claude" => Ok("claude"),
        "codex" => Ok("codex"),
        _ => Err("账号类型必须是 Claude 或 ChatGPT/Codex。".into()),
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

pub fn prepare_managed_directory(profile: &AccountProfile) -> Result<(), String> {
    let Some(config_dir) = profile.config_dir.as_deref() else {
        return Ok(());
    };
    let directory = Path::new(config_dir);
    fs::create_dir_all(directory)
        .map_err(|error| format!("无法创建账号目录 {}：{error}", directory.to_string_lossy()))?;
    if profile.agent_type == "codex" {
        ensure_codex_file_credentials(directory)?;
    }
    Ok(())
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
        let key = if profile.agent_type == "claude" {
            "CLAUDE_CONFIG_DIR"
        } else {
            "CODEX_HOME"
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
    let args: &[&str] = if profile.agent_type == "claude" {
        &["auth", "status", "--json"]
    } else {
        &["login", "status"]
    };
    match run_cli(executable, args, &environment(&profile)) {
        Ok(output) if profile.agent_type == "claude" => {
            let value = serde_json::from_slice::<Value>(&output.stdout).unwrap_or(Value::Null);
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
    }
    profile
}

pub fn login_spec(profile: &AccountProfile) -> Result<(String, String), String> {
    prepare_managed_directory(profile)?;
    let installation = detect(&profile.agent_type)?;
    let executable = installation
        .executable_path
        .ok_or_else(|| installation.diagnostic.clone())?;
    let command = if profile.agent_type == "claude" {
        format!("& {} auth login", powershell_quote(&executable))
    } else {
        format!("& {} login", powershell_quote(&executable))
    };
    Ok((command, executable))
}

fn detect(agent_type: &str) -> Result<AgentInstallation, String> {
    if agent_type == "claude" {
        ClaudeCodeAdapter::new()
            .detect()
            .map_err(|error| error.to_string())
    } else {
        CodexCliAdapter::new()
            .detect()
            .map_err(|error| error.to_string())
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

    command.args(args).envs(environment).output()
}

fn output_text(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if !stdout.is_empty() {
        return stdout;
    }
    String::from_utf8_lossy(&output.stderr).trim().to_owned()
}

fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_managed_profiles_to_isolated_cli_homes() {
        let claude = AccountProfile {
            id: "claude-one".into(),
            name: "Claude One".into(),
            agent_type: "claude".into(),
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
}
