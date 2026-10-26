# 上游同步与创建会话时的模型选择

2026-10-26。将 `gemron/Termexo` 上游 main 的 `7e45193217ed8b0f57662cc0f22f8a2e9096db46` 合入 One Ring / Windows Worker 开发分支，保留本地已验证的内置引擎、原生前台 Worker、状态恢复和模型目录，同时保留上游的预览、工作区、通知、账号登录和 macOS 支持代码。

合并前的接入工作保存为本地提交 `6d10798`。主工作区原有四份未提交测试改动在合并前单独保存；开发工作树中的冲突均已处理。

## 模型列表

- 创建 Codex / Claude Code 时，“模型 / Profile”下拉框同时显示“官方模型”和“已保存的 Profile”。没有保存任何 Profile 时仍可使用 CLI 默认模型。
- Codex 官方目录继续由选定账号与工作目录的 CLI app-server 动态读取；Claude 使用上游动态目录中的 Anthropic 模型。刷新目录不会覆盖用户已经选定的模型。
- 官方选择具有独立的原生路由标记，不读取默认第三方 Profile 的 endpoint 或 API Key。自定义 Profile 继续保留其模型、Provider、凭据和配置。
- 原生选择、明确模型及账号在创建、账号切换和应用重启恢复时保留，避免官方模型被自定义默认 Profile 替换。自定义 Profile 与官方 CLI 账号仍是不同的凭据来源。
- OpenCode / Pi / Antigravity 继续使用各自 CLI 的 Provider 或模型机制；本改动没有将 Claude/Codex Profile 凭据复制给这些 CLI。

## 验证

- 前端完整测试：97 文件，812 项通过，含官方/自定义选择、无 Profile 启动和原生模型恢复回归。
- Rust 库测试：466 通过，5 个手动/环境测试忽略。
- 内置 One Ring：55 通过，2 个 POSIX 专用测试跳过。
- npm 启动器：7 项通过。
- 前端生产构建、内置引擎构建和 Windows 桌面构建通过，未放宽构建体积上限。
- 修正了合并后通知测试中的 Tauri 模拟接口；PowerShell 的 UI 自动化测试夹具使用仅针对子进程的执行策略，不修改系统策略，也不进行真实消息发送。

真实 Windows 桌面检查中，在同一下拉框读取到 CLI 默认项、七个官方模型以及保存的 Profile；实际切换 Profile → 官方模型并创建了 Codex 会话，模型为 `gpt-6.1-sol`，命令明确使用 OpenAI Provider，原生选择标记正确。临时 Profile 和会话均已清理，未发送模型任务。

本机证据在忽略目录 `validation-results/upstream-model-merge/`，包含完整检查日志、`ui-check.json`、模型对话框及原生 CLI 截图。Claude 选择路径有自动化覆盖；本机未安装 Claude CLI，没有将它表述为真实推理验证。此次在 Windows 验证，未声称完成 macOS 原生构建验证。
