# AgentDock

AgentDock 是一个本地优先的 AI 编程工作台。当前仓库实现 `AgentDock.md`
定义的 V0.1 纵向切片：Workspace 管理、多终端布局、xterm.js 终端、
Tauri PTY、SQLite 快照、Agent 状态检查器和模型切换预览。

## 技术栈

- Angular 22 standalone components
- Tauri 2 + Rust
- xterm.js + portable-pty
- SQLite（rusqlite bundled）

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

Tauri 模式使用真实 PTY，并将 Workspace 快照保存到应用数据目录中的
`agentdock.db`。

## 验证

```powershell
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

架构边界和当前版本范围见
[`docs/architecture/v0.1.md`](docs/architecture/v0.1.md)。
