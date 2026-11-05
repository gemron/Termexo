use crate::agent::{AgentAdapter, CodexCliAdapter};
use crate::database::WorkspaceDatabase;
use crate::process::{hidden_command, run_with_timeout};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const SETTINGS_KEY: &str = "one-ring-plugin";
pub const PLUGIN_ID: &str = "one-ring@one-ring-local";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Settings {
    pub enabled: bool,
    pub source_path: String,
    pub node_path: String,
}

impl Default for Settings {
    fn default() -> Self {
        let node = std::env::var_os("TERMEXO_NODE_PATH")
            .map(PathBuf::from)
            .filter(|path| crate::platform::is_executable_file(path))
            .or_else(|| {
                std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
                    .map(|directory| directory.join("node"))
                    .find(|path| path.is_absolute() && crate::platform::is_executable_file(path))
            });
        Self {
            enabled: false,
            source_path: String::new(),
            node_path: node
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub settings: Settings,
    pub supported: bool,
    pub ready: bool,
    pub diagnostic: String,
}

impl Settings {
    pub fn load(database: &WorkspaceDatabase) -> Result<Self, String> {
        database
            .read_app_setting(SETTINGS_KEY)
            .map_err(|e| e.to_string())?
            .map(|text| {
                serde_json::from_str(&text).map_err(|e| format!("One Ring 插件设置无效：{e}"))
            })
            .unwrap_or_else(|| Ok(Self::default()))
    }

    pub fn source(&self) -> Result<PathBuf, String> {
        let source = Path::new(&self.source_path);
        if !source.is_absolute() {
            return Err("请选择 One Ring 源码或发行包的绝对路径。".into());
        }
        let source = source
            .canonicalize()
            .map_err(|e| format!("无法读取 One Ring 目录：{e}"))?;
        for name in [
            "scripts/install.mjs",
            "plugins/codex/.codex-plugin/plugin.json",
            "plugins/codex/server/index.mjs",
        ] {
            if !source.join(name).is_file() {
                return Err(format!("One Ring 缺少 {name}，请先执行 npm run build。"));
            }
        }
        let runtime = std::fs::read_to_string(source.join("plugins/codex/server/index.mjs"))
            .map_err(|e| e.to_string())?;
        if !runtime.contains("ONE_RING_TERMINAL_BRIDGE_URL") {
            return Err("该 One Ring 构建不支持 Termexo 终端，请更新并重新构建。".into());
        }
        Ok(source)
    }

    pub fn node(&self) -> Result<PathBuf, String> {
        let node = PathBuf::from(&self.node_path);
        if !node.is_absolute() || !crate::platform::is_executable_file(&node) {
            return Err("请填写 Node.js 24+ 的可执行文件绝对路径。".into());
        }
        Ok(node)
    }

    pub fn validate(&self) -> Result<(), String> {
        if !cfg!(target_os = "linux") {
            return Err("One Ring 当前仅认证 Linux/Codex Worker。".into());
        }
        self.source()?;
        let output = run_with_timeout(
            hidden_command(self.node()?).arg("--version"),
            Duration::from_secs(5),
        )
        .map_err(|e| e.to_string())?;
        let major = String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_start_matches('v')
            .split('.')
            .next()
            .and_then(|v| v.parse::<u32>().ok());
        if !output.status.success() || !major.is_some_and(|v| v >= 24) {
            return Err("One Ring 需要 Node.js 24 或更高版本。".into());
        }
        if !CodexCliAdapter::new()
            .detect()
            .map_err(|e| e.to_string())?
            .healthy
        {
            return Err("请先安装可用的 Codex CLI，并完成账号登录。".into());
        }
        Ok(())
    }

    pub fn status(self) -> Status {
        let result = self.validate();
        Status {
            supported: cfg!(target_os = "linux"),
            ready: result.is_ok(),
            diagnostic: result
                .err()
                .unwrap_or_else(|| "One Ring 插件可用，新建 Codex 会话后生效。".into()),
            settings: self,
        }
    }
}
