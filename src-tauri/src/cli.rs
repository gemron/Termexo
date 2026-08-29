use std::collections::HashMap;
use std::env;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::agent::{
    AgentAdapter, AgentInstallation, ClaudeCodeAdapter, CodexCliAdapter, OpenCodeAdapter,
};
use crate::config::NetworkProfile;

const CLI_OPERATION_TIMEOUT: Duration = Duration::from_secs(300);
const CLI_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(45);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CAPTURED_OUTPUT_BYTES: usize = 32 * 1024;
const NPM_OVERRIDE_ENV: &str = "TERMEXO_NPM_PATH";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliOperationRequest {
    pub agent_type: String,
    pub target_version: Option<String>,
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliOperationPlan {
    pub agent_type: String,
    pub display_name: String,
    pub package_name: String,
    pub target_version: String,
    pub package_spec: String,
    /// `install`, `upgrade`, or `reinstall` when the installed version already matches.
    pub action: String,
    pub current_version: Option<String>,
    /// Version the registry resolves `target_version` to, when it could be queried.
    pub resolved_version: Option<String>,
    /// True when the installed version already equals the resolved one.
    pub up_to_date: bool,
    pub npm_path: Option<String>,
    pub npm_version: Option<String>,
    pub command_preview: String,
    pub network_profile_id: Option<String>,
    pub network_profile_name: Option<String>,
    pub npm_registry: Option<String>,
    pub ready: bool,
    pub diagnostic: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliOperationResult {
    pub success: bool,
    pub plan: CliOperationPlan,
    pub installation: AgentInstallation,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
    pub diagnostic: String,
    /// True when an installation changed (or may have changed) an existing CLI and Termexo
    /// attempted to put the previously detected version back.
    pub rollback_attempted: bool,
    /// `None` means no rollback was necessary. A performed rollback records its health result.
    pub rollback_succeeded: Option<bool>,
    pub rollback_diagnostic: Option<String>,
}

#[derive(Default)]
pub struct CliOperationManager {
    running: AtomicBool,
}

impl CliOperationManager {
    pub fn try_begin(&self) -> bool {
        self.running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub fn finish(&self) {
        self.running.store(false, Ordering::Release);
    }
}

pub fn build_operation_plan(
    request: &CliOperationRequest,
    network_profile: Option<&NetworkProfile>,
) -> Result<CliOperationPlan, String> {
    let definition = definition(&request.agent_type)?;
    let target_version = normalize_target_version(request.target_version.as_deref())?;
    let package_spec = format!("{}@{target_version}", definition.package_name);
    let installation = detect_agent(definition.agent_type)?;
    let npm_path = find_npm_executable();
    let npm_version = npm_path
        .as_deref()
        .and_then(|path| read_npm_version(path).ok());
    let ready = npm_path.is_some() && npm_version.is_some();

    // Ask the registry what the requested tag resolves to. Without this an already-current CLI
    // still reads as "upgrade", because being installed was the only thing checked.
    let resolved_version = npm_path
        .as_deref()
        .and_then(|path| read_published_version(path, &package_spec, network_profile).ok());
    let installed_version = installation.version.as_deref().map(extract_version);
    let up_to_date = match (installed_version.as_deref(), resolved_version.as_deref()) {
        (Some(installed), Some(resolved)) => installed == resolved,
        _ => false,
    };
    let action = if !installation.installed {
        "install"
    } else if up_to_date {
        "reinstall"
    } else {
        "upgrade"
    };

    let diagnostic = if !ready {
        if npm_path.is_some() {
            "已找到 npm，但版本检测失败；请先修复 Node.js/npm 环境。".into()
        } else {
            "未检测到 npm；请先安装 Node.js 与 npm。".into()
        }
    } else if up_to_date {
        format!(
            "{} 已是最新版本 {}，无需升级。如需修复安装可继续执行。",
            definition.display_name,
            resolved_version.as_deref().unwrap_or_default()
        )
    } else {
        match (&resolved_version, action) {
            (Some(resolved), "upgrade") => format!(
                "可将 {} 从 {} 升级到 {}。",
                definition.display_name,
                installed_version.as_deref().unwrap_or("未知版本"),
                resolved
            ),
            (Some(resolved), _) => {
                format!("可安装 {} {}。", definition.display_name, resolved)
            }
            (None, _) => format!(
                "已检测到 npm {}，可{} {}。（无法查询远端版本，可能是网络或代理问题）",
                npm_version.as_deref().unwrap_or_default(),
                if action == "install" {
                    "安装"
                } else {
                    "升级"
                },
                definition.display_name
            ),
        }
    };

    Ok(CliOperationPlan {
        agent_type: definition.agent_type.into(),
        display_name: definition.display_name.into(),
        package_name: definition.package_name.into(),
        target_version,
        package_spec: package_spec.clone(),
        action: action.into(),
        current_version: installation.version,
        resolved_version,
        up_to_date,
        npm_path: npm_path.map(|path| path.to_string_lossy().into_owned()),
        npm_version,
        command_preview: format!("npm install --global {package_spec} --no-fund --no-audit"),
        network_profile_id: network_profile.map(|profile| profile.id.clone()),
        network_profile_name: network_profile.map(|profile| profile.name.clone()),
        npm_registry: network_profile.and_then(|profile| profile.npm_registry.clone()),
        ready,
        diagnostic,
    })
}

pub fn execute_operation(
    plan: CliOperationPlan,
    environment: HashMap<String, String>,
) -> Result<CliOperationResult, String> {
    if !plan.ready {
        return Err(plan.diagnostic.clone());
    }
    let npm_path = plan
        .npm_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "安装计划缺少 npm 路径。".to_owned())?;
    let started = Instant::now();

    let preflight = run_npm_command(
        &npm_path,
        &["view", &plan.package_spec, "version", "--json"],
        &environment,
        CLI_PREFLIGHT_TIMEOUT,
    )?;
    if !preflight.success {
        return Ok(failed_result(
            plan,
            preflight.stdout,
            preflight.stderr,
            started,
            "无法从配置的 npm registry 解析目标版本，未修改现有 CLI。",
        ));
    }

    let install = run_npm_command(
        &npm_path,
        &[
            "install",
            "--global",
            &plan.package_spec,
            "--no-fund",
            "--no-audit",
        ],
        &environment,
        CLI_OPERATION_TIMEOUT,
    )?;
    if !install.success {
        return Ok(failed_result_with_rollback(
            plan,
            install.stdout,
            install.stderr,
            started,
            &npm_path,
            &environment,
            "npm 安装或升级失败。",
        ));
    }

    let installation = detect_agent(&plan.agent_type)?;
    let success = installation.healthy;
    let diagnostic = if success {
        format!(
            "{}完成，已验证 {}。",
            if plan.action == "install" {
                "安装"
            } else {
                "升级"
            },
            installation.version.as_deref().unwrap_or("CLI 可正常执行")
        )
    } else {
        return Ok(failed_result_with_rollback(
            plan,
            install.stdout,
            install.stderr,
            started,
            &npm_path,
            &environment,
            "npm 命令已完成，但 CLI 健康检查失败。",
        ));
    };

    Ok(CliOperationResult {
        success,
        plan,
        installation,
        stdout: install.stdout,
        stderr: install.stderr,
        duration_ms: started.elapsed().as_millis(),
        diagnostic,
        rollback_attempted: false,
        rollback_succeeded: None,
        rollback_diagnostic: None,
    })
}

fn failed_result_with_rollback(
    plan: CliOperationPlan,
    stdout: String,
    stderr: String,
    started: Instant,
    npm_path: &Path,
    environment: &HashMap<String, String>,
    diagnostic: &str,
) -> CliOperationResult {
    let Some(package_spec) = rollback_package_spec(&plan) else {
        return failed_result(
            plan,
            stdout,
            stderr,
            started,
            &format!("{diagnostic} 安装前未检测到可回滚版本，请查看诊断。"),
        );
    };

    let rollback = run_npm_command(
        npm_path,
        &[
            "install",
            "--global",
            &package_spec,
            "--no-fund",
            "--no-audit",
        ],
        environment,
        CLI_OPERATION_TIMEOUT,
    );
    let (rollback_command_succeeded, rollback_stdout, rollback_stderr) = match rollback {
        Ok(result) => (result.success, result.stdout, result.stderr),
        Err(error) => (false, String::new(), error),
    };
    let installation = detect_agent(&plan.agent_type).unwrap_or_else(|error| AgentInstallation {
        agent_type: plan.agent_type.clone(),
        installed: false,
        executable_path: None,
        version: None,
        healthy: false,
        diagnostic: error,
    });
    let expected_version = plan
        .current_version
        .as_deref()
        .map(extract_version)
        .unwrap_or_default();
    let restored_version = installation.version.as_deref().map(extract_version);
    let rollback_succeeded = rollback_command_succeeded
        && installation.healthy
        && restored_version.as_deref() == Some(expected_version.as_str());
    let rollback_diagnostic = if rollback_succeeded {
        format!("已自动恢复原版本 {expected_version}，并通过健康检查。")
    } else {
        format!(
            "自动回滚到 {expected_version} 失败；当前状态：{}",
            installation.diagnostic
        )
    };

    CliOperationResult {
        success: false,
        plan,
        installation,
        stdout: append_message(stdout, &rollback_stdout),
        stderr: append_message(stderr, &rollback_stderr),
        duration_ms: started.elapsed().as_millis(),
        diagnostic: format!("{diagnostic} {rollback_diagnostic}"),
        rollback_attempted: true,
        rollback_succeeded: Some(rollback_succeeded),
        rollback_diagnostic: Some(rollback_diagnostic),
    }
}

fn rollback_package_spec(plan: &CliOperationPlan) -> Option<String> {
    let version = plan
        .current_version
        .as_deref()
        .map(extract_version)
        .filter(|version| !version.trim().is_empty())?;
    Some(format!("{}@{version}", plan.package_name))
}

fn failed_result(
    plan: CliOperationPlan,
    stdout: String,
    stderr: String,
    started: Instant,
    diagnostic: &str,
) -> CliOperationResult {
    let installation = detect_agent(&plan.agent_type).unwrap_or_else(|error| AgentInstallation {
        agent_type: plan.agent_type.clone(),
        installed: false,
        executable_path: None,
        version: None,
        healthy: false,
        diagnostic: error,
    });
    CliOperationResult {
        success: false,
        plan,
        installation,
        stdout,
        stderr,
        duration_ms: started.elapsed().as_millis(),
        diagnostic: diagnostic.into(),
        rollback_attempted: false,
        rollback_succeeded: None,
        rollback_diagnostic: None,
    }
}

fn detect_agent(agent_type: &str) -> Result<AgentInstallation, String> {
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
        _ => Err(format!("不支持的 Agent CLI：{agent_type}")),
    }
}

fn normalize_target_version(value: Option<&str>) -> Result<String, String> {
    let value = value.unwrap_or("latest").trim();
    if value.is_empty() {
        return Ok("latest".into());
    }
    if value.len() > 64
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character))
    {
        return Err("目标版本只能包含字母、数字、点、短横线和下划线。".into());
    }
    Ok(value.into())
}

fn find_npm_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(configured) = env::var_os(NPM_OVERRIDE_ENV) {
        candidates.push(PathBuf::from(configured));
    }

    #[cfg(windows)]
    let command_names = ["npm.cmd", "npm.exe"];
    #[cfg(not(windows))]
    let command_names = ["npm"];

    if let Some(search_path) = env::var_os("PATH") {
        for directory in env::split_paths(&search_path) {
            for command_name in command_names {
                candidates.push(directory.join(command_name));
            }
        }
    }

    candidates.into_iter().find(|path| path.is_file())
}

/// Asks the registry which version `package_spec` resolves to.
///
/// A dist-tag like `latest` says nothing about whether an upgrade is needed, so the concrete
/// version behind it has to be looked up before the plan can claim one is available.
fn read_published_version(
    npm_path: &Path,
    package_spec: &str,
    network_profile: Option<&NetworkProfile>,
) -> Result<String, String> {
    // The lookup goes through the same registry and proxy the install would use.
    let mut environment = HashMap::new();
    if let Some(profile) = network_profile {
        if let Ok(profile_environment) = crate::network::profile_environment(profile, None) {
            environment.extend(profile_environment);
        }
    }

    let result = run_npm_command(
        npm_path,
        &["view", package_spec, "version"],
        &environment,
        VERSION_TIMEOUT,
    )?;
    if !result.success {
        return Err(result.stderr);
    }
    // `npm view` prints one bare version for a single match, so the last non-empty line is it.
    let version = result
        .stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .next_back()
        .unwrap_or_default();
    if version.is_empty() {
        Err("npm 未返回可用的版本号。".into())
    } else {
        Ok(version.to_owned())
    }
}

/// Pulls the bare version out of a CLI's `--version` output.
///
/// The two CLIs place it differently — Claude prints `2.1.224 (Claude Code)` and Codex prints
/// `codex-cli 0.147.0` — so the first token that actually looks like a version is taken rather
/// than the first token. Getting this wrong makes every comparison fail and offers an upgrade
/// that is not needed.
fn extract_version(reported: &str) -> String {
    reported
        .split_whitespace()
        .map(|token| token.trim_start_matches('v'))
        .find(|token| {
            let mut characters = token.chars();
            characters
                .next()
                .is_some_and(|first| first.is_ascii_digit())
                && token
                    .chars()
                    .all(|character| character.is_ascii_digit() || ".-+".contains(character))
        })
        .unwrap_or_else(|| reported.trim())
        .to_owned()
}

fn read_npm_version(path: &Path) -> Result<String, String> {
    let result = run_npm_command(path, &["--version"], &HashMap::new(), VERSION_TIMEOUT)?;
    if !result.success {
        return Err(result.stderr);
    }
    let version = result.stdout.trim();
    if version.is_empty() {
        Err("npm 未返回版本号。".into())
    } else {
        Ok(version.into())
    }
}

struct CommandResult {
    success: bool,
    stdout: String,
    stderr: String,
}

fn run_npm_command(
    npm_path: &Path,
    arguments: &[&str],
    environment: &HashMap<String, String>,
    timeout: Duration,
) -> Result<CommandResult, String> {
    let mut command = npm_command(npm_path);
    command
        .args(arguments)
        .envs(environment)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command_without_window(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 npm：{error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法捕获 npm 标准输出。".to_owned())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法捕获 npm 错误输出。".to_owned())?;
    let stdout_reader = thread::spawn(move || read_output(stdout));
    let stderr_reader = thread::spawn(move || read_output(stderr));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("等待 npm 退出失败：{error}"))?
        {
            break status;
        }
        if started.elapsed() >= timeout {
            terminate_process_tree(&mut child);
            let stdout = stdout_reader.join().unwrap_or_default();
            let stderr = stderr_reader.join().unwrap_or_default();
            return Ok(CommandResult {
                success: false,
                stdout,
                stderr: append_message(stderr, "npm 操作超时，进程已终止。"),
            });
        }
        thread::sleep(Duration::from_millis(100));
    };

    Ok(CommandResult {
        success: status.success(),
        stdout: stdout_reader.join().unwrap_or_default(),
        stderr: stderr_reader.join().unwrap_or_default(),
    })
}

/// Stops npm and every process launched through its Windows `.cmd` shim.
///
/// Killing only `cmd.exe` leaves `node npm-cli.js` alive with the inherited stdout/stderr pipes.
/// The reader threads then wait forever even though the advertised command timeout elapsed.
fn terminate_process_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let pid = child.id().to_string();
        let mut taskkill = Command::new("taskkill.exe");
        taskkill
            .args(["/PID", &pid, "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command_without_window(&mut taskkill);
        let _ = taskkill.status();
    }

    // This is also the non-Windows implementation and a fallback if taskkill could not run.
    let _ = child.kill();
    let _ = child.wait();
}

fn npm_command(npm_path: &Path) -> Command {
    #[cfg(windows)]
    if npm_path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd"))
    {
        let mut command = Command::new("cmd.exe");
        command.args(["/d", "/s", "/c", "call"]).arg(npm_path);
        return command;
    }

    Command::new(npm_path)
}

fn command_without_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn read_output(mut reader: impl Read) -> String {
    let mut output = Vec::new();
    let _ = reader.read_to_end(&mut output);
    if output.len() > MAX_CAPTURED_OUTPUT_BYTES {
        output = output.split_off(output.len() - MAX_CAPTURED_OUTPUT_BYTES);
    }
    String::from_utf8_lossy(&output).trim().to_owned()
}

fn append_message(value: String, message: &str) -> String {
    if value.is_empty() {
        message.into()
    } else {
        format!("{value}\n{message}")
    }
}

struct CliDefinition {
    agent_type: &'static str,
    display_name: &'static str,
    package_name: &'static str,
}

fn definition(agent_type: &str) -> Result<CliDefinition, String> {
    match agent_type {
        "claude" => Ok(CliDefinition {
            agent_type: "claude",
            display_name: "Claude Code",
            package_name: "@anthropic-ai/claude-code",
        }),
        "codex" => Ok(CliDefinition {
            agent_type: "codex",
            display_name: "Codex CLI",
            package_name: "@openai/codex",
        }),
        "opencode" => Ok(CliDefinition {
            agent_type: "opencode",
            display_name: "OpenCode",
            package_name: "opencode-ai",
        }),
        _ => Err(format!("不支持的 Agent CLI：{agent_type}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    use std::fs;

    #[test]
    fn accepts_latest_tags_and_exact_versions() {
        assert_eq!(normalize_target_version(None).unwrap(), "latest");
        assert_eq!(
            normalize_target_version(Some("0.145.0")).unwrap(),
            "0.145.0"
        );
        assert_eq!(normalize_target_version(Some("next")).unwrap(), "next");
    }

    #[test]
    fn extracts_the_bare_version_from_cli_output() {
        // The real outputs of both CLIs, which put the version in different positions.
        assert_eq!(extract_version("2.1.224 (Claude Code)"), "2.1.224");
        assert_eq!(extract_version("codex-cli 0.147.0"), "0.147.0");
        assert_eq!(extract_version("0.45.0"), "0.45.0");
        assert_eq!(extract_version("  1.2.3  "), "1.2.3");
        assert_eq!(extract_version("v2.0.1"), "2.0.1");
        assert_eq!(extract_version("1.0.0-beta.1"), "1.0.0-beta.1");
    }

    #[test]
    fn version_extraction_falls_back_to_the_whole_string() {
        // Without a version-looking token the value is kept as-is, so the comparison simply
        // fails to match rather than silently claiming the CLI is current.
        assert_eq!(extract_version("unknown build"), "unknown build");
    }

    #[test]
    fn rejects_target_versions_that_could_become_arguments() {
        for value in ["latest --force", "@scope/package", "1.0.0/../../x", ""] {
            if value.is_empty() {
                assert_eq!(normalize_target_version(Some(value)).unwrap(), "latest");
            } else {
                assert!(normalize_target_version(Some(value)).is_err());
            }
        }
    }

    #[test]
    fn exposes_only_supported_official_packages() {
        assert_eq!(
            definition("claude").unwrap().package_name,
            "@anthropic-ai/claude-code"
        );
        assert_eq!(definition("codex").unwrap().package_name, "@openai/codex");
        assert_eq!(definition("opencode").unwrap().package_name, "opencode-ai");
        assert!(definition("shell").is_err());
    }

    #[test]
    fn prevents_overlapping_cli_mutations() {
        let manager = CliOperationManager::default();
        assert!(manager.try_begin());
        assert!(!manager.try_begin());
        manager.finish();
        assert!(manager.try_begin());
    }

    #[test]
    fn builds_a_rollback_spec_from_the_detected_cli_version() {
        let plan = CliOperationPlan {
            agent_type: "claude".into(),
            display_name: "Claude Code".into(),
            package_name: "@anthropic-ai/claude-code".into(),
            target_version: "latest".into(),
            package_spec: "@anthropic-ai/claude-code@latest".into(),
            action: "upgrade".into(),
            current_version: Some("2.1.224 (Claude Code)".into()),
            resolved_version: Some("2.2.0".into()),
            up_to_date: false,
            npm_path: Some("npm.cmd".into()),
            npm_version: Some("11.0.0".into()),
            command_preview: String::new(),
            network_profile_id: None,
            network_profile_name: None,
            npm_registry: None,
            ready: true,
            diagnostic: String::new(),
        };

        assert_eq!(
            rollback_package_spec(&plan).as_deref(),
            Some("@anthropic-ai/claude-code@2.1.224")
        );
    }

    #[cfg(windows)]
    #[test]
    fn npm_timeout_stops_the_windows_command_tree() {
        let script_path =
            env::temp_dir().join(format!("termexo-npm-timeout-{}.cmd", std::process::id()));
        fs::write(
            &script_path,
            "@echo off\r\n%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -Command \"Start-Sleep -Seconds 30\"\r\n",
        )
        .unwrap();

        let started = Instant::now();
        let result = run_npm_command(
            &script_path,
            &[],
            &HashMap::new(),
            Duration::from_millis(250),
        )
        .unwrap();
        let elapsed = started.elapsed();
        let _ = fs::remove_file(&script_path);

        assert!(!result.success);
        assert!(result.stderr.contains("npm 操作超时"), "{}", result.stderr);
        assert!(
            elapsed < Duration::from_secs(5),
            "terminating the npm process tree took {elapsed:?}"
        );
    }
}
