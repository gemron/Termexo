//! Use One Ring's own installer in the account selected by Termexo.
use super::settings::Settings;
use crate::agent::{AgentAdapter, CodexCliAdapter};
use crate::database::WorkspaceDatabase;
use crate::process::{hidden_command, run_with_timeout};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

const OWNED_ACCOUNTS: &str = "one-ring-plugin-accounts";

#[derive(Clone)]
pub(super) struct Installation {
    pub fingerprint: String,
    pub runtime: PathBuf,
    pub path: String,
}

pub(super) fn home(environment: &HashMap<String, String>) -> Result<PathBuf, String> {
    environment
        .get("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("CODEX_HOME").map(PathBuf::from))
        .or_else(|| crate::platform::home_dir().map(|home| home.join(".codex")))
        .ok_or_else(|| "无法找到 Codex 配置目录。".into())
}

fn owned(database: &WorkspaceDatabase) -> Result<Vec<PathBuf>, String> {
    database
        .read_app_setting(OWNED_ACCOUNTS)
        .map_err(|e| e.to_string())?
        .map(|text| serde_json::from_str(&text).map_err(|e| e.to_string()))
        .unwrap_or_else(|| Ok(Vec::new()))
}

pub(super) fn managed(
    database: &WorkspaceDatabase,
    environment: &HashMap<String, String>,
) -> Result<bool, String> {
    Ok(owned(database)?.contains(&home(environment)?))
}

pub(super) fn ensure(
    settings: &Settings,
    environment: &HashMap<String, String>,
    database: &WorkspaceDatabase,
    cache: &mut HashMap<PathBuf, Installation>,
) -> Result<Installation, String> {
    let source = settings.source()?;
    let node = settings.node()?;
    let account = home(environment)?;
    let bytes =
        std::fs::read(source.join("plugins/codex/server/index.mjs")).map_err(|e| e.to_string())?;
    let fingerprint = format!(
        "{}:{}:{:x}",
        source.display(),
        node.display(),
        Sha256::digest(bytes)
    );
    if let Some(previous) = cache
        .get(&account)
        .filter(|value| value.fingerprint == fingerprint && value.runtime.is_file())
    {
        return Ok(previous.clone());
    }
    let cli = CodexCliAdapter::new()
        .detect()
        .map_err(|e| e.to_string())?
        .executable_path
        .ok_or("请先安装 Codex CLI。")?;
    let mut paths = vec![
        Path::new(&cli)
            .parent()
            .ok_or("Codex CLI 路径无效。")?
            .to_path_buf(),
        node.parent().ok_or("Node.js 路径无效。")?.to_path_buf(),
    ];
    let inherited = environment
        .get("PATH")
        .cloned()
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_default();
    paths.extend(std::env::split_paths(&inherited));
    let path = std::env::join_paths(paths)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();
    let output = run_with_timeout(
        hidden_command(&node)
            .arg(source.join("scripts/install.mjs"))
            .args(["--codex-home"])
            .arg(&account)
            .current_dir(&source)
            .envs(environment)
            .env("PATH", &path),
        Duration::from_secs(90),
    )
    .map_err(|e| format!("安装 One Ring 插件失败：{e}"))?;
    if !output.status.success() {
        return Err(format!(
            "安装 One Ring 插件失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let result: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let runtime = PathBuf::from(
        result["installedPath"]
            .as_str()
            .ok_or("插件安装器未返回安装路径。")?,
    )
    .join("server/index.mjs");
    if !runtime.is_file() {
        return Err("One Ring 插件运行文件不存在。".into());
    }
    let mut accounts = owned(database)?;
    if !accounts.contains(&account) {
        accounts.push(account.clone());
        database
            .write_app_setting(
                OWNED_ACCOUNTS,
                &serde_json::to_string(&accounts).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
    }
    let installation = Installation {
        fingerprint,
        runtime,
        path,
    };
    cache.insert(account, installation.clone());
    Ok(installation)
}
