use std::collections::HashMap;
use std::env;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::agent::{
    AgentAdapter, AgentInstallation, AntigravityAdapter, ClaudeCodeAdapter, CodexCliAdapter,
    OpenCodeAdapter,
};
use crate::config::NetworkProfile;
use crate::process::{hide_window, terminate_process_tree};

const CLI_OPERATION_TIMEOUT: Duration = Duration::from_secs(300);
const CLI_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(45);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CAPTURED_OUTPUT_BYTES: usize = 32 * 1024;
const NPM_OVERRIDE_ENV: &str = "TERMEXO_NPM_PATH";

/// A script install always fetches the current release; there is no version to ask for.
const SCRIPT_TARGET_VERSION: &str = "latest";
/// The value a request carries to ask for the vendor's script rather than npm.
const SCRIPT_INSTALLER: &str = "script";
const NPM_INSTALLER: &str = "npm";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliOperationRequest {
    pub agent_type: String,
    /// `npm` or `script`; the agent's own default when absent.
    pub installer: Option<String>,
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
    /// `npm` for a published package, `script` for a vendor installer.
    pub installer: String,
    /// False when the agent's installer offers no version to pin, as a script install does not.
    pub supports_version: bool,
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
    match choose_installer(&definition, request.installer.as_deref())? {
        Installer::Npm { package_name } => {
            build_npm_plan(&definition, package_name, request, network_profile)
        }
        Installer::Script(script) => build_script_plan(&definition, script),
    }
}

/// Picks the installer the request asked for, or the agent's own when it asked for none.
///
/// An installer the agent does not have is refused rather than quietly swapped: a request for
/// the vendor's script must never end up running npm instead.
fn choose_installer(
    definition: &CliDefinition,
    requested: Option<&str>,
) -> Result<Installer, String> {
    match requested {
        Some(SCRIPT_INSTALLER) => definition
            .script
            .map(Installer::Script)
            .ok_or_else(|| format!("{} 没有官方安装脚本。", definition.display_name)),
        Some(NPM_INSTALLER) => definition
            .package_name
            .map(|package_name| Installer::Npm { package_name })
            .ok_or_else(|| format!("{} 未发布到 npm。", definition.display_name)),
        Some(other) => Err(format!("不支持的安装方式：{other}")),
        // npm first where both exist: it is the one that can be pinned and rolled back.
        None => definition
            .package_name
            .map(|package_name| Installer::Npm { package_name })
            .or_else(|| definition.script.map(Installer::Script))
            .ok_or_else(|| format!("{} 没有可用的安装方式。", definition.display_name)),
    }
}

/// The plan for a CLI published to npm, which can be pinned, compared and rolled back.
fn build_npm_plan(
    definition: &CliDefinition,
    package_name: &str,
    request: &CliOperationRequest,
    network_profile: Option<&NetworkProfile>,
) -> Result<CliOperationPlan, String> {
    let target_version = normalize_target_version(request.target_version.as_deref())?;
    let package_spec = format!("{package_name}@{target_version}");
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
        package_name: package_name.into(),
        target_version,
        installer: NPM_INSTALLER.into(),
        supports_version: true,
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

/// The plan for a CLI installed by the vendor's own script.
///
/// A script install takes no version, resolves nothing against a registry, and leaves nothing to
/// roll back to: it fetches whatever the vendor currently publishes. The plan therefore says what
/// will be run and where it lands, and leaves the npm fields empty rather than inventing them.
fn build_script_plan(
    definition: &CliDefinition,
    script: ScriptInstaller,
) -> Result<CliOperationPlan, String> {
    let installation = detect_agent(definition.agent_type)?;
    let ready = find_powershell().is_some();
    let action = if installation.installed {
        "reinstall"
    } else {
        "install"
    };
    let directory = script.directory();
    let shown = directory
        .as_deref()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| script.directory_label.to_owned());

    let diagnostic = if !ready {
        "未找到 PowerShell，无法运行官方安装脚本。".into()
    } else {
        let elsewhere = installs_elsewhere(&installation, directory.as_deref());
        let base = format!(
            "将运行 {} 的官方安装脚本，安装当前发布的版本到 {shown}。",
            definition.display_name
        );
        if elsewhere {
            // Two copies on one machine differ in version, and PATH decides which one runs.
            format!("{base} 当前检测到的是另一处安装（{}），安装后机器上会有两份，实际运行哪一份由 PATH 决定。",
                installation.executable_path.as_deref().unwrap_or("未知路径"))
        } else {
            base
        }
    };

    Ok(CliOperationPlan {
        agent_type: definition.agent_type.into(),
        display_name: definition.display_name.into(),
        package_name: String::new(),
        target_version: SCRIPT_TARGET_VERSION.into(),
        installer: SCRIPT_INSTALLER.into(),
        supports_version: false,
        package_spec: script.url.into(),
        action: action.into(),
        current_version: installation.version,
        // The script does not say what it is about to install, so there is no version to compare.
        resolved_version: None,
        up_to_date: false,
        npm_path: None,
        npm_version: None,
        command_preview: script_command_preview(script.url),
        network_profile_id: None,
        network_profile_name: None,
        npm_registry: None,
        ready,
        diagnostic,
    })
}

/// Whether the CLI already on the machine sits somewhere the script will not replace.
///
/// Installing the vendor's build beside an npm one leaves two executables of different versions,
/// and which of them runs comes down to PATH order — worth saying before the user commits to it.
fn installs_elsewhere(installation: &AgentInstallation, directory: Option<&Path>) -> bool {
    let (Some(existing), Some(directory)) = (installation.executable_path.as_deref(), directory)
    else {
        return false;
    };
    !Path::new(existing).starts_with(directory)
}

pub fn execute_operation(
    plan: CliOperationPlan,
    environment: HashMap<String, String>,
) -> Result<CliOperationResult, String> {
    if !plan.ready {
        return Err(plan.diagnostic.clone());
    }
    if plan.installer == SCRIPT_INSTALLER {
        return execute_script_install(plan, environment);
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

/// Runs the vendor's installer script and checks the CLI afterwards.
///
/// Nothing is rolled back on failure: the script owns its own directory and Termexo has no
/// previous copy to put back, so a failed run is reported with its output and left as it lies.
fn execute_script_install(
    plan: CliOperationPlan,
    environment: HashMap<String, String>,
) -> Result<CliOperationResult, String> {
    let Some(shell) = find_powershell() else {
        return Err("未找到 PowerShell，无法运行官方安装脚本。".to_owned());
    };
    let script = definition(&plan.agent_type)?
        .script
        .ok_or_else(|| format!("{} 没有官方安装脚本。", plan.display_name))?;
    let started = Instant::now();

    let mut command = Command::new(shell);
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script_expression(&plan.package_spec),
        ])
        .envs(&environment)
        // Last, so a script that must not stop to ask cannot be overridden by the proxy
        // environment carrying the same name.
        .envs(script.environment.iter().copied());
    let install = run_command(command, "PowerShell", CLI_OPERATION_TIMEOUT)?;
    if !install.success {
        return Ok(failed_result(
            plan,
            install.stdout,
            install.stderr,
            started,
            "官方安装脚本执行失败。",
        ));
    }

    let installation = detect_agent(&plan.agent_type)?;
    if !installation.healthy {
        return Ok(failed_result(
            plan,
            install.stdout,
            install.stderr,
            started,
            "安装脚本已完成，但 CLI 健康检查失败。",
        ));
    }

    let diagnostic = format!(
        "安装完成，已验证 {}。",
        installation.version.as_deref().unwrap_or("CLI 可正常执行")
    );
    Ok(CliOperationResult {
        success: true,
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

/// The one-liner the vendor documents, which downloads the script and runs it.
fn script_expression(url: &str) -> String {
    format!("irm {url} | iex")
}

/// The whole command as the user sees it before confirming, shell included.
fn script_command_preview(url: &str) -> String {
    format!(
        "powershell -NoProfile -ExecutionPolicy Bypass -Command \"{}\"",
        script_expression(url)
    )
}

/// Windows PowerShell, which every supported Windows carries.
fn find_powershell() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(root) = env::var_os("SystemRoot") {
            let path = PathBuf::from(root)
                .join("System32")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe");
            if path.is_file() {
                return Some(path);
            }
        }
        return command_on_path("powershell.exe");
    }
    #[cfg(not(windows))]
    {
        command_on_path("pwsh")
    }
}

fn command_on_path(name: &str) -> Option<PathBuf> {
    let search_path = env::var_os("PATH")?;
    env::split_paths(&search_path)
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
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
        "antigravity" => AntigravityAdapter::new()
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
    command.args(arguments).envs(environment);
    run_command(command, "npm", timeout)
}

/// Runs one installer command to completion, capturing its output and killing it on timeout.
///
/// `name` only names the program in the errors, so both installers report failures the same way.
fn run_command(
    mut command: Command,
    name: &str,
    timeout: Duration,
) -> Result<CommandResult, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 {name}：{error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("无法捕获 {name} 标准输出。"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("无法捕获 {name} 错误输出。"))?;
    let stdout_reader = thread::spawn(move || read_output(stdout));
    let stderr_reader = thread::spawn(move || read_output(stderr));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("等待 {name} 退出失败：{error}"))?
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
                stderr: append_message(stderr, &format!("{name} 操作超时，进程已终止。")),
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
    /// The npm package, for the CLIs published to one.
    package_name: Option<&'static str>,
    /// The vendor's Windows installer, for the CLIs that publish one.
    script: Option<ScriptInstaller>,
}

/// How an agent's CLI reaches the machine, for one operation.
///
/// The distinction runs through the whole operation: a published package can be pinned to a
/// version, checked against a registry and rolled back to the version that was there before,
/// while a vendor script installs whatever the vendor currently publishes.
enum Installer {
    /// A package installed globally with npm.
    Npm { package_name: &'static str },
    /// The vendor's own installer script.
    Script(ScriptInstaller),
}

/// One vendor's Windows installer script, as its own documentation gives it.
#[derive(Clone, Copy)]
struct ScriptInstaller {
    url: &'static str,
    /// The environment variable naming the root the script installs under.
    directory_root: &'static str,
    /// The path below that root, and what the plan falls back to naming when it cannot resolve.
    directory_suffix: &'static str,
    directory_label: &'static str,
    /// What the script needs to run without stopping to ask; captured output is not a console.
    environment: &'static [(&'static str, &'static str)],
}

impl ScriptInstaller {
    /// Where the script will put the binary, resolved so the plan can name the real path.
    fn directory(&self) -> Option<PathBuf> {
        let root = env::var_os(self.directory_root)?;
        Some(PathBuf::from(root).join(self.directory_suffix))
    }
}

/// Codex asks before replacing an existing install; captured output already suppresses the
/// prompt, and this says so outright rather than relying on that.
const CODEX_NON_INTERACTIVE: &[(&str, &str)] = &[("CODEX_NON_INTERACTIVE", "1")];

fn definition(agent_type: &str) -> Result<CliDefinition, String> {
    match agent_type {
        "claude" => Ok(CliDefinition {
            agent_type: "claude",
            display_name: "Claude Code",
            package_name: Some("@anthropic-ai/claude-code"),
            script: Some(ScriptInstaller {
                url: "https://claude.ai/install.ps1",
                directory_root: "USERPROFILE",
                directory_suffix: ".local\\bin",
                directory_label: "%USERPROFILE%\\.local\\bin",
                environment: &[],
            }),
        }),
        "codex" => Ok(CliDefinition {
            agent_type: "codex",
            display_name: "Codex CLI",
            package_name: Some("@openai/codex"),
            script: Some(ScriptInstaller {
                url: "https://chatgpt.com/codex/install.ps1",
                directory_root: "LOCALAPPDATA",
                directory_suffix: "Programs\\OpenAI\\Codex\\bin",
                directory_label: "%LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin",
                environment: CODEX_NON_INTERACTIVE,
            }),
        }),
        // OpenCode publishes no Windows installer script; its own documentation points at npm,
        // Chocolatey or WSL, so npm is the only way Termexo can offer here.
        "opencode" => Ok(CliDefinition {
            agent_type: "opencode",
            display_name: "OpenCode",
            package_name: Some("opencode-ai"),
            script: None,
        }),
        "antigravity" => Ok(CliDefinition {
            agent_type: "antigravity",
            display_name: "Antigravity",
            package_name: None,
            script: Some(ScriptInstaller {
                url: "https://antigravity.google/cli/install.ps1",
                directory_root: "LOCALAPPDATA",
                directory_suffix: "agy\\bin",
                directory_label: "%LOCALAPPDATA%\\agy\\bin",
                environment: &[],
            }),
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
            Some("@anthropic-ai/claude-code")
        );
        assert_eq!(
            definition("codex").unwrap().package_name,
            Some("@openai/codex")
        );
        assert_eq!(
            definition("opencode").unwrap().package_name,
            Some("opencode-ai")
        );
        assert_eq!(definition("antigravity").unwrap().package_name, None);
        assert!(definition("shell").is_err());
    }

    /// Every script offered is the vendor's own, and the command shown is the documented
    /// one-liner rather than anything Termexo invented.
    #[test]
    fn every_script_installer_is_the_vendors_own() {
        let expected = [
            ("claude", "https://claude.ai/install.ps1"),
            ("codex", "https://chatgpt.com/codex/install.ps1"),
            ("antigravity", "https://antigravity.google/cli/install.ps1"),
        ];
        for (agent_type, url) in expected {
            let script = definition(agent_type).unwrap().script.unwrap();
            assert_eq!(script.url, url);
            assert!(script_command_preview(url).contains(&format!("irm {url} | iex")));
        }
        // OpenCode publishes none for Windows, and inventing one would install something else.
        assert!(definition("opencode").unwrap().script.is_none());
    }

    /// Asking for an installer the agent does not have is refused, never quietly swapped.
    #[test]
    fn an_installer_the_agent_does_not_have_is_refused() {
        let opencode = definition("opencode").unwrap();
        assert!(choose_installer(&opencode, Some(SCRIPT_INSTALLER)).is_err());

        let antigravity = definition("antigravity").unwrap();
        assert!(choose_installer(&antigravity, Some(NPM_INSTALLER)).is_err());

        // Both available means npm, which is the one that can be pinned and rolled back.
        let claude = definition("claude").unwrap();
        assert!(matches!(
            choose_installer(&claude, None).unwrap(),
            Installer::Npm { .. }
        ));
        assert!(matches!(
            choose_installer(&claude, Some(SCRIPT_INSTALLER)).unwrap(),
            Installer::Script(_)
        ));
    }

    /// A CLI found outside the script's own directory stays where it is; the plan has to say so,
    /// because the machine then carries two of them.
    #[test]
    fn a_second_copy_elsewhere_is_reported() {
        let script = definition("claude").unwrap().script.unwrap();
        let directory = script.directory().unwrap();
        let npm_install = AgentInstallation {
            agent_type: "claude".into(),
            installed: true,
            executable_path: Some("C:\\npm\\claude.cmd".into()),
            version: Some("2.1.0".into()),
            healthy: true,
            diagnostic: String::new(),
        };

        assert!(installs_elsewhere(&npm_install, Some(&directory)));

        let same_place = AgentInstallation {
            executable_path: Some(directory.join("claude.exe").to_string_lossy().into_owned()),
            ..npm_install
        };
        assert!(!installs_elsewhere(&same_place, Some(&directory)));
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
            installer: "npm".into(),
            supports_version: true,
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
