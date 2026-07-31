<p align="center">
  <img src="apps/desktop-ui/public/termexo-mark.svg" width="104" alt="Termexo 标志">
</p>

<h1 align="center">Termexo</h1>

<p align="center">面向 Agent、模型与多设备连接的本地优先 AI 开发工作空间</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <img alt="Version 0.3.6" src="https://img.shields.io/badge/version-0.3.6-58c7a0">
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white">
  <img alt="Angular 22" src="https://img.shields.io/badge/Angular-22-DD0031?logo=angular">
</p>

Termexo 是一个本地优先的 AI 开发工作空间与控制平面。它把项目、终端、Agent
原生会话、模型/供应商配置和运行状态集中到一个可恢复的桌面环境中，而不是再做一个
彼此隔离的聊天窗口。

当前桌面版本重点统一管理本机 AI 编程终端；后续路线图会沿用同一个 Workspace 模型，
逐步扩展多 Agent 编排、供应商 Plan 余量实时查看、安全的 Workspace 共享，以及从可信
电脑和手机访问工作空间。项目数据与凭据仍由明确的设备、权限和加密边界保护。

> 最新正式版本为 **V0.3.6 安全凭据恢复更新版**。模型 Profile 现在会核对 Windows 安全
> 存储中的真实条目；旧密钥丢失时会提示重新输入，不再在切换模型时显示底层错误。

![Termexo 多终端网格工作台](docs/images/termexo-workbench-v0.3.2.png)

<p align="center">
  <sub>4 个 Claude Code/Codex 终端、2 × 2 自定义网格、指定窗口显示、会话状态与 Inspector。</sub>
</p>

## V0.3.6 更新

- 模型 Profile 会核对 Windows 安全存储中的真实 API Key，不再只相信数据库里的旧引用。
- 安全存储条目已删除时按“未配置密钥”处理，重新保存 Profile 时不会保留失效引用。
- 切换供应商遇到密钥丢失时显示可操作的中文提示，不再显示底层 keyring 错误。

## V0.3.5 更新

- 可从工作区工具栏调整终端字体大小，并在重启后保留设置。
- 支持将 CLI 标签向左或向右移动，不打乱当前选择和工作空间顺序。
- 在标签、终端面板和 Inspector 中突出显示等待输入、等待授权、429 限流和已完成状态；
  最多保留 250 条 Agent 活动，并展示更多最近活动。
- 增加 xterm 滚动缓冲区；隐藏终端重新显示时主动校正尺寸，修复部分终端无法上下滚动。
- 切换模型供应商时创建全新会话，校验自定义供应商凭据，并将 MiniMax 预设升级为
  `MiniMax-M3[1m]`。
- 识别 Claude 429/限流与超时错误，提供醒目提示；从多账号恢复会话时使用正确的隔离
  Claude 配置目录。
- 明确说明：手动恢复原生会话会重新加载历史上下文；切换供应商则不会回放旧会话，
  从而避免无意的 Token 重复消耗。

## V0.3.4 更新

- 将 Termexo DaisyUI 主题挂载到文档根节点，确保所有全局界面都能继承正确的文字与背景颜色。
- 为较旧的 WebView2 运行时提供等效十六进制颜色，并将 `color-mix()` 调整为渐进增强。
- 为桌面应用和官网增加明确的颜色兜底，避免出现黑色文字与黑色背景重叠。
- 扩展浏览器冒烟测试，自动检查根主题以及前景色、背景色的实际对比。

## V0.3.3 更新

- 发布官方 [`termexo`](https://www.npmjs.com/package/termexo) npm 包，内置完整 Windows
  x64 桌面可执行程序。
- 可通过 `npx termexo@latest` 直接运行，也可以使用
  `npm install --global termexo@latest` 全局安装。
- npm 包压缩后约 4.8 MB，安装后约 13.6 MB，适合常规分发与升级。
- 发布流程增加 PE 文件校验、构建产物与 npm 包 SHA-256 对比、隔离安装测试和真实进程
  启动验证。

## V0.3.2 更新

- 支持创建、登录、管理和切换多个隔离的 Claude Code 与 ChatGPT/Codex 账号。
- 新建或恢复 Codex 会话时可指定账号与模型，同时保持原生 rollout 文件只读。
- 会话中心可扫描系统账号及所有隔离账号目录，并在恢复时沿用会话所属账号。
- 左右侧栏均可拖动调整宽度、独立折叠，并持久化宽度和展开状态。
- 移除 Google CLI 入口，隐藏尚未完成的快照、任务和原型 Git 界面。
- 自动测试覆盖工具栏对齐、菜单、弹窗、消息、紧凑布局和双侧栏交互。

## V0.3.0 更新

- 支持不限数量的终端标签，通过终端选择器指定当前布局中显示的窗口。
- 网格布局支持持久化的 `1–6 列 × 1–6 行` 自定义配置，并根据实际窗口数量自动收缩。
- 支持单个终端最大化和整个工作区最大化，可使用 `Shift+Esc` 逐级恢复。
- Claude Code CLI 保持不变，可通过模型 Profile 切换 Anthropic、DeepSeek、MiniMax、
  GLM 或自定义 Anthropic 兼容 Endpoint。
- 批量切换当前 Workspace 内的 Claude Code 后端模型，并在重启终端后继续使用原会话 ID。
- 当本地会话记录存在时使用 `--resume`；记录缺失时改用 `--session-id`，避免启动失败。

- 原生检测 Codex CLI 可执行文件与安装版本，检测过程不弹出系统控制台。
- 通过统一托管 PTY 在指定工作目录中启动 Codex。
- 只读扫描 `CODEX_HOME/sessions` 中的 Codex rollout 元数据，不修改原生 JSONL。
- 使用原生 UUID 和 `codex resume` 恢复 Codex 会话。
- 在 Agent 会话中心统一展示 Claude 与 Codex 会话，并保留各 Agent 独立的恢复参数。
- 支持按 Agent、健康状态、Workspace 和范围搜索筛选会话，并容忍部分扫描失败。
- 行列设置增加步进控制、可视化预览、行列互换与实时容量提示。
- 桌面应用、安装包和网站统一使用新的简约科技线条品牌标识。

## V0.4 开发进展

- 支持全局或 Workspace 作用域的 HTTP、HTTPS、SOCKS 与 `NO_PROXY` 网络 Profile。
- 管理 npm registry、proxy、`https-proxy`、`strict-ssl` 和企业 CA，且不改写用户全局 npm 配置。
- 代理密码保存到操作系统凭据库，并拒绝在代理 URL 中直接保存账号密码。
- 支持 DNS/TCP 连通性测试，启动 Claude/Codex 时优先使用 Workspace Profile，再回退全局 Profile。
- 支持预览并确认从官方 npm 包一键安装/升级 Claude Code 与 Codex，可选择精确版本或 dist-tag。
- 安装时应用当前网络 Profile，先检查 registry，禁止并发修改，设置超时并在完成后验证 CLI 健康状态。
- 多个隔离 Claude/ChatGPT 账号已可使用；失败自动回滚、系统代理发现和 Plan 余量监控仍在后续计划中。

## 为什么做 Termexo

AI 编程工具通常以独立终端或独立会话运行。项目一多，开发者需要自己记住：

- 哪个终端属于哪个项目、分支和 Agent；
- 哪些会话正在运行、等待输入或等待权限确认；
- 某次 Claude 会话如何恢复；
- 不同模型、Endpoint、API Key 和 MCP 配置应当如何组合；
- 应用重启后哪些只是终端配置，哪些是真正可恢复的原生会话。

Termexo 以 **Workspace** 为组织单位，把这些信息集中到一个可观察、可恢复、
可扩展的本地控制面中。

## 已实现功能

| 能力               | 当前实现                                                                          |
| ------------------ | --------------------------------------------------------------------------------- |
| Workspace 管理     | 创建、改名、换色、手动排序和切换 Workspace，并持久化项目路径、布局与终端配置      |
| 多终端工作台       | 不限终端数量、指定窗口显示、1–6 行列网格、终端/工作区最大化；桌面端启动真实 PTY   |
| Claude Code 检测   | 在 Windows 上检测 `claude.exe` / `claude.cmd`、版本与健康状态                     |
| 新建 Agent 会话    | 按目录启动 Claude/Codex，并选择隔离账号及 Agent 对应的模型配置                    |
| Agent 会话中心     | 只读发现多账号 Claude/Codex 会话，支持搜索、Workspace 过滤与原生恢复              |
| Agent 状态识别     | 为每个终端生成隔离 Hooks 设置，识别思考、工具调用、权限确认、用户输入和完成状态   |
| 模型与 MCP Profile | 管理模型、Endpoint、API Key 与 MCP 配置；Claude CLI 可切换 Anthropic 兼容后端     |
| 网络与 npm Profile | 按全局/Workspace 管理 HTTP/HTTPS/SOCKS 与 npm 配置，测试连通性并在启动时注入      |
| 多账号管理         | 管理多个隔离 Claude 与 ChatGPT/Codex 登录、默认账号、认证状态和启动时选择         |
| CLI 生命周期管理   | 预览、确认、安装或升级官方 Claude Code/Codex npm 包，并在完成后验证结果           |
| 本地数据与密钥     | Workspace、会话索引和事件保存到 SQLite；API Key 保存到 Windows Credential Manager |
| 浏览器预览         | 无需 Rust 即可预览完整 UI，并使用可交互的模拟终端验证布局与基础流程               |

![Termexo 模型 Profile](docs/images/termexo-model-profiles.png)

<p align="center">
  <sub>模型、Endpoint 与凭据入口集中管理；已保存的密钥不会回传给前端。</sub>
</p>

## 设计目标

1. **本地优先**：项目路径、终端、会话索引和配置默认留在本机，不依赖 Termexo 云服务。
2. **尊重 Agent 原生能力**：优先调用 Agent 自己的会话恢复与配置机制，不伪造对话恢复。
3. **统一管理而非替代终端**：Termexo 提供工作台、状态和编排层，命令仍在 PTY 与原生 Agent 中运行。
4. **状态可观察**：将不同 Agent 的事件映射为运行、思考、等待输入、等待确认、完成和失败等统一状态。
5. **安全边界清晰**：密钥进入操作系统凭据存储，不写入 SQLite、快照、Hook payload 或日志。
6. **面向多 Agent 扩展**：以后端 Adapter、PTY、Hooks、Snapshot 和 Router 等边界逐步接入更多 CLI。
7. **安全延伸到可信设备**：在不削弱本地所有权和安全边界的前提下，增加共享、远程访问、
   手机审批与协作能力。

## 当前边界

- Claude Code 仍是事件能力最完整的 Adapter。Codex 已支持原生检测、按账号/模型启动、
  多账号本地会话发现和恢复，但 Codex Hooks 与统一运行事件尚未实现。
- 应用退出后，已退出的操作系统进程不会被“伪恢复”。Termexo 只恢复终端配置，
  历史 Claude 会话需要从会话中心显式恢复。
- Claude 与 Codex 原始 JSONL 均只读，Termexo 不修改、重命名或删除这些文件。
- 快照、Git 与任务编排入口会保持隐藏，直到对应生产后端完成。
- 当前版本不包含自动权限批准、跨 Agent 会话迁移或跨 Agent 批量模型切换事务。

完整产品规划见 [Termexo.md](./Termexo.md)，当前架构边界见
[V0.2 架构说明](./docs/architecture/v0.2.md)。

## 快速开始

### 通过 npm 直接运行

npm 包已经包含 Windows x64 桌面可执行文件：

```powershell
npx termexo
```

也可以全局安装命令：

```powershell
npm install --global termexo
termexo
```

此方式需要 Windows 10/11、WebView2 和 Node.js 18.18 或更高版本。从源码构建
则使用下方列出的新版开发工具链。

### 环境要求

- Windows 10/11；
- Node.js `^22.22.3`、`^24.15.0` 或 `>=26.0.0`；
- 桌面模式需要 Rust stable、Visual Studio C++ Build Tools 和 WebView2；
- 使用 Claude 功能需要本机已安装 Claude Code。

### 1. 获取代码与安装前端依赖

```powershell
git clone https://github.com/gemron/Termexo.git
cd Termexo
npm --prefix apps/desktop-ui install
```

### 2. 运行浏览器预览

```powershell
npm run dev
```

打开 <http://127.0.0.1:4200>。浏览器模式使用模拟终端，支持 `help`、`status`、
`git status` 和 `clear`，适合查看界面与开发前端。

### 3. 运行桌面应用

```powershell
npm run tauri:dev
```

桌面模式使用真实 PTY。若 Claude Code 不在 PATH 中，可以显式指定：

```powershell
$env:TERMEXO_CLAUDE_PATH = "C:\path\to\claude.exe"
npm run tauri:dev
```

## 工作方式

```mermaid
flowchart LR
    UI["Angular Desktop UI"]
    IPC["Tauri Commands"]
    PTY["PTY Service"]
    Adapter["Claude Adapter"]
    Hooks["Hooks / Event Pipeline"]
    DB[("SQLite")]
    Vault["Windows Credential Manager"]
    Claude["Claude Code"]

    UI <--> IPC
    IPC --> PTY
    PTY --> Claude
    IPC --> Adapter
    Adapter --> Claude
    Claude --> Hooks
    Hooks --> DB
    IPC <--> DB
    IPC --> Vault
```

- **Angular UI**：Workspace、终端布局、会话中心、设置和 Inspector。
- **Tauri Commands**：前后端 IPC 边界，暴露最小化桌面能力。
- **PTY Service**：创建、输入、调整尺寸和关闭真实终端进程。
- **Claude Adapter**：安装检测、只读会话扫描和原生启动/恢复命令。
- **Hooks Pipeline**：接收 Claude Hooks，去重并映射统一 Agent 状态。
- **SQLite / Credential Manager**：分别保存结构化本地数据和敏感凭据。

## 数据与安全

| 数据                | 存储位置                         | 处理原则                          |
| ------------------- | -------------------------------- | --------------------------------- |
| Workspace、终端配置 | SQLite                           | 本地持久化                        |
| Claude 会话索引     | SQLite                           | 从 Claude JSONL 只读解析后 Upsert |
| Agent 事件          | JSONL spool + SQLite             | 按 `event_key` 去重               |
| 模型与 MCP Profile  | SQLite                           | API Key 明文不进入数据库          |
| API Key             | Windows Credential Manager       | 前端只能读取 `hasCredential`      |
| Claude 原始会话     | `%USERPROFILE%\.claude\projects` | 只读，不回写                      |

为兼容早期安装，数据库文件和部分 Tauri 内部标识仍沿用旧标识；这不影响产品名称
与新的 `TERMEXO_*` 环境变量。

## 路线图

| 版本 | 目标                                             | 状态     |
| ---- | ------------------------------------------------ | -------- |
| V0.1 | Workspace、多终端、PTY、SQLite 基础              | 已完成   |
| V0.2 | Claude Code 检测、会话恢复、Hooks、Profile       | 已完成   |
| V0.3 | Codex CLI Adapter 与 Claude/Codex 统一会话中心   | 当前版本 |
| V0.4 | 账号/供应商控制、CLI/网络环境、回滚与 Plan 余量 | 开发中   |
| V0.5 | 会话摘要与跨 Agent 迁移                          | 规划中   |
| V0.6 | 多 Agent 协作、任务编排与通知                    | 规划中   |
| V0.7 | Workspace 共享、远程电脑与手机访问               | 规划中   |
| V1.0 | 稳定发布、安全加固与完整恢复体验                 | 规划中   |

## 项目结构

```text
Termexo/
├── apps/desktop-ui/       # Angular 桌面界面与浏览器预览
├── src-tauri/             # Rust Core、PTY、Agent、Hooks、数据库与命令
├── docs/architecture/     # 当前版本架构说明
├── docs/images/           # README 截图
└── Termexo.md             # 产品设计与长期路线图
```

## 开发与验证

```powershell
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm --prefix apps/desktop-ui run e2e:smoke
npm run tauri:build
```

本地开发服务运行后，可重新生成 README 截图：

```powershell
npm run capture:readme
```

## 参与贡献

欢迎通过 [Issues](https://github.com/gemron/Termexo/issues) 报告问题、讨论设计或提出功能建议。
提交代码前，请确认改动属于当前版本范围，并为行为变化补充相应测试。

## 许可证

仓库当前尚未声明开源许可证。在许可证补充前，请勿默认获得复制、修改或分发授权。
