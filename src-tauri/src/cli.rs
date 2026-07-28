use std::collections::HashMap;
use std::env;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::agent::{AgentAdapter, AgentInstallation, ClaudeCodeAdapter, CodexCliAdapter};
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
    pub action: String,
    pub current_version: Option<String>,
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
    let action = if installation.installed {
        "upgrade"
    } else {
        "install"
    };
    let diagnostic = if ready {
        format!(
            "已检测到 npm {}，可{} {}。",
            npm_version.as_deref().unwrap_or_default(),
            if action == "install" {
                "安装"
            } else {
                "升级"
            },
            definition.display_name
        )
    } else if npm_path.is_some() {
        "已找到 npm，但版本检测失败；请先修复 Node.js/npm 环境。".into()
    } else {
        "未检测到 npm；请先安装 Node.js 与 npm。".into()
    };

    Ok(CliOperationPlan {
        agent_type: definition.agent_type.into(),
        display_name: definition.display_name.into(),
        package_name: definition.package_name.into(),
        target_version,
        package_spec: package_spec.clone(),
        action: action.into(),
        current_version: installation.version,
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
        .ok_or_else(|| "安装计划缺少 npm 路径。".to_owned())?;
    let started = Instant::now();

    let preflight = run_npm_command(
        Path::new(npm_path),
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
        Path::new(npm_path),
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
        return Ok(failed_result(
            plan,
            install.stdout,
            install.stderr,
            started,
            "npm 安装或升级失败；已重新检查原 CLI 状态。",
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
        "npm 命令已完成，但 CLI 健康检查失败；请查看输出诊断。".into()
    };

    Ok(CliOperationResult {
        success,
        plan,
        installation,
        stdout: install.stdout,
        stderr: install.stderr,
        duration_ms: started.elapsed().as_millis(),
        diagnostic,
    })
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
            let _ = child.kill();
            let _ = child.wait();
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
        _ => Err(format!("不支持的 Agent CLI：{agent_type}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
