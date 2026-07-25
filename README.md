# Termexo

Termexo 是一个本地优先的 AI 编程工作台。当前仓库实现 `Termexo.md`
定义的 V0.2 Claude Code 专用版：Workspace 管理、多终端布局、Claude
安装检测、历史会话索引与恢复、Hooks 状态识别、模型/API Profile 和
MCP Profile。

## 技术栈

- Angular 22 standalone components
- Tauri 2 + Rust
- xterm.js + portable-pty
- SQLite（rusqlite bundled）
- Windows Credential Manager（keyring）

## V0.2 功能

- Windows 下显式检测 `claude.cmd`/`claude.exe` 和 Claude Code 版本。
- 只读扫描 `%USERPROFILE%\.claude\projects` 中的 JSONL 会话。
- 使用 Claude 原生 `--resume` 恢复指定会话。
- 使用隔离的 `--settings` 接入 Claude Hooks，不改写用户全局配置。
- 将 Agent 状态事件去重写入 SQLite，并实时同步到 Inspector。
- 模型、Endpoint 和 MCP 配置保存为 Profile。
- API Key 只保存到 Windows Credential Manager，不进入 SQLite 或前端快照。

## 运行前端

Angular 22 要求 Node.js `22.22.3`、`24.15.0` 或更高版本。
仓库将 Node 24.15 作为开发依赖，Angular 命令会自动使用该项目级运行时。

```powershell
npm run dev
```

打开 <http://127.0.0.1:4200>。浏览器模式提供可输入的终端预览，
支持 `help`、`status`、`git status` 和 `clear`。

## 运行桌面端

先安装 Rust stable 和 Windows WebView2/C++ 构建工具，然后执行：

```powershell
npm run tauri:dev
```

Tauri 模式使用真实 PTY，并将 Workspace、Claude 会话索引、Profile 和
Agent 事件保存到应用数据目录中的 `agentdock.db`。为兼容已有安装，
数据库文件和 Tauri 应用标识继续沿用旧内部标识。退出的操作系统进程
不会被伪恢复；历史 Claude 会话需要从会话中心显式恢复。

## 验证

```powershell
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm --prefix apps/desktop-ui run e2e:smoke
npm run tauri:build
```

架构边界和当前版本范围见
[`docs/architecture/v0.2.md`](docs/architecture/v0.2.md)。
