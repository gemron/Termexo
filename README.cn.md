<p align="center">
  <img src="apps/desktop-ui/public/termexo-mark.svg" width="104" alt="Termexo 标志">
</p>

<h1 align="center">Termexo</h1>

<p align="center"><strong>电脑上开工，跨网络接着用</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <img alt="Version 0.10.0" src="https://img.shields.io/badge/version-0.10.0-58c7a0">
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white">
  <img alt="Angular 22" src="https://img.shields.io/badge/Angular-22-DD0031?logo=angular">
</p>

<p align="center">
  <a href="https://www.termexo.com">官方网站</a> ·
  <a href="https://github.com/gemron/Termexo/releases/latest">下载安装</a> ·
  <a href="https://www.npmjs.com/package/termexo">npm</a>
</p>

<p>
  <img src="website/assets/agent-claude.svg" alt="Claude Code" title="Claude Code" width="26" height="26">&nbsp;&nbsp;
  <img src="website/assets/agent-codex.svg" alt="Codex CLI" title="Codex CLI" width="26" height="26">&nbsp;&nbsp;
  <img src="website/assets/agent-opencode.svg" alt="OpenCode" title="OpenCode" width="26" height="26">&nbsp;&nbsp;
  <img src="website/assets/agent-antigravity.svg" alt="Antigravity" title="Antigravity" width="26" height="26">
</p>

Termexo 把 Claude Code、Codex、OpenCode 和 Antigravity 放进同一个 Windows 工作台。
Agent 留在电脑上运行；通过自建中继，用手机或另一台电脑的浏览器跨网络接回同一个工作台，查看输出、回复审批、发送下一条指令。桌面无需公网 IP，也无需路由器端口映射。

![Termexo Windows 工作台](website/assets/termexo-workbench.png)

| 同时看清多个 Agent | 知道谁在等你 | 手机上接着操作 |
| --- | --- | --- |
| 按项目组织真实终端，并排显示。 | 区分运行中、等待输入和等待审批。 | 通过自建中继跨网络连接，也支持可信局域网或 VPN。 |

## 在 Windows 上开始使用

**[下载 Windows 安装包](https://github.com/gemron/Termexo/releases/latest)**：选择 EXE 或 MSI 文件安装，无需 Rust 或编译工具。

已安装 Node.js 18.18+？也可以直接运行：

```powershell
npx termexo@latest
```

需要 Windows 10 build 17763+ 和 WebView2 Chromium 111+。
使用 Agent 需安装相应 CLI 并配置模型服务；Termexo 不包含模型订阅。
**MIT 开源，无需注册 Termexo 账号。**

## 通过自建中继，从电脑接到手机

1. 在电脑上打开项目，启动 Claude Code、Codex、OpenCode 或 Antigravity。
2. 按 **[termexo-relay 文档](https://github.com/gemron/termexo-relay)** 部署双方可达的 HTTPS 中继，或使用管理员提供的入口。
3. 在「设置 → 远程访问」中启用访问、填写中继地址，使用注册码或中继账号登记设备。
4. 手机打开生成的中继访问链接或扫描二维码，按提示完成中继登录和桌面访问令牌校验，接回原来的终端。

桌面主动建立出站隧道，无需公网 IP 或路由器端口映射。**电脑需保持开机、Termexo 运行并连接中继。** 同一可信局域网或受控 VPN 内，也可直接连接桌面地址。

中继登录与桌面访问令牌独立校验；v2 会话握手后使用 AES-256-GCM 加密会话帧，中继转发加密的终端会话。中继服务支持 Linux、macOS、Windows 的 x64 / arm64 和容器部署；Termexo 桌面版面向 Windows。

[![Termexo 手机工作台](website/assets/termexo-phone.png)](https://www.termexo.com/guide.html#remote)

上图展示手机界面，完整设置步骤见 **[手机连接指南](https://www.termexo.com/guide.html#remote)**。
远程访问默认关闭。中继浏览器入口需使用 HTTPS；桌面直连默认使用自签名 HTTPS。请保管好令牌和二维码；关闭 Termexo 或停止电脑会结束运行中的进程。

## 最新版本

**[v0.10.0](https://github.com/gemron/Termexo/releases/tag/v0.10.0)** 新增自建中继、注册码或账号登记、级联访问地址与 v2 加密会话，让工作台跨网络延续到浏览器。
[完整更新记录](CHANGELOG.cn.md)。

如果 Termexo 帮到了你，欢迎 **给仓库点一个 Star**，帮助更多开发者发现它。
遇到问题请 [提交 Issue](https://github.com/gemron/Termexo/issues)，附上 Windows 版本和复现步骤。

第一次试用？欢迎 [告诉我们是否顺利、卡在了哪一步](https://github.com/gemron/Termexo/issues/new?template=first-use.yml)，简单描述即可。

<details>
<summary><strong>更多功能与截图</strong></summary>

## 现在已经能做什么

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>四个 Agent，一块屏幕。</strong><br><br>
      Claude Code、Codex、OpenCode 和 Antigravity 可以并排跑在真实 PTY 终端里，想开多少开多少，再选择当前
      要显示的终端，排成 1–6 行/列的自定义网格。标签支持拖拽排序和中键关闭，工作台支持键盘
      快捷键。每个工作空间都会记住目录、标签、布局、模型和主题。
      <br><br>
      <a href="website/assets/termexo-workbench.png"><img src="website/assets/termexo-workbench.png" alt="Termexo 多 Agent 工作台"></a>
    </td>
    <td width="50%" valign="top">
      <strong>Agent 需要你时，马上知道。</strong><br><br>
      等待输入、等待授权、已完成和失败状态一眼可分；常驻提示条、Windows 系统通知与任务栏
      闪烁会把你带回真正需要处理的那个终端。
      <br><br>
      <a href="website/assets/termexo-attention.png"><img src="website/assets/termexo-attention.png" alt="Termexo Agent 状态提醒"></a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>接着昨天的会话继续。</strong><br><br>
      跨项目、账号、分支和模型搜索本机 Claude Code/Codex/OpenCode/Antigravity 会话。Termexo 调用 CLI
      原生的 <code>claude --resume</code>、<code>codex resume</code>、<code>opencode --session</code>
      与 <code>agy --conversation</code>
      恢复完整上下文，也能接管 CLI 仍然持有的 Claude 后台会话，并始终只读原生会话文件。
      <br><br>
      <a href="website/assets/termexo-session-center.png"><img src="website/assets/termexo-session-center.png" alt="Termexo 原生会话中心"></a>
    </td>
    <td width="50%" valign="top">
      <strong>同一个 CLI，换个模型运行。</strong><br><br>
      让 Claude Code 使用 Anthropic、DeepSeek、MiniMax、GLM 或自定义 Anthropic 兼容 Endpoint。
      供应商保存为 Profile，API Key 交给 Windows 凭据管理器保管，还能一次切换工作空间里的全部 Claude 终端。
      <br><br>
      <a href="website/assets/termexo-models.png"><img src="website/assets/termexo-models.png" alt="Termexo 模型供应商 Profile"></a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>在手机上回它一句。</strong><br><br>
      打开远程访问，手机、平板、另一台电脑通过自建中继跨网络连接，也可在可信局域网或 VPN 内直连。浏览器打开完整工作台——
      同一批工作空间、同一批终端，实时读写桌面正在跑的那些 PTY 进程。终端支持手指拖拽滚动，
      布局在窄屏收成单终端、侧栏浮在工作区之上，连接是 HTTPS，凭访问令牌进入，令牌可显示、
      可生成二维码、可随时更换。
      <br><br>
      <a href="website/assets/termexo-phone.png"><img src="website/assets/termexo-phone.png" alt="通过远程访问在手机上打开的 Termexo 工作台"></a>
    </td>
    <td width="50%" valign="top">
      <strong>看清这次会话改了什么。</strong><br><br>
      Git 视图跟随当前终端，以该终端启动时的 HEAD 为基线：它动过哪些文件、提交了哪些内容，
      任意一个都能看单栏或双栏 Diff。停留在这个视图时会持续读取仓库，不用手动刷新；离开再
      回来，还是原来那个文件、原来那种布局。
      <br><br>
      <a href="website/assets/termexo-git.png"><img src="website/assets/termexo-git.png" alt="Termexo 当前终端的 Git 图谱与会话 Diff"></a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>把一条任务直接跑成 Agent。</strong><br><br>
      任务看板按项目管理任务，带优先级和验收标准。把任务交给 Claude Code、Codex 或 OpenCode，
      它就变成一个真实终端，并随该终端上报的状态在待办、执行中、已完成、已验收之间流转。
    </td>
    <td width="50%" valign="top">
      <strong>不用盯着一路点确认。</strong><br><br>
      每个 Agent 都可以带自动确认启动——Claude 用 <code>--permission-mode auto</code>，Codex 用
      <code>--approve-for-me</code>，OpenCode 用 <code>--auto</code>，Antigravity 用
      <code>--dangerously-skip-permissions</code>——终端上的 AUTO 标记在任意
      Agent 下含义一致。
    </td>
  </tr>
</table>

Termexo 默认只在本地工作：没有 Termexo 账号、云服务或强制同步。工作空间状态保存在本机
SQLite，密钥保存在 Windows Credential Manager，Claude/Codex 历史会话只读。Agent CLI
仍会按照你选择的供应商及其隐私政策连接对应模型服务。

界面支持简体中文、英语、西班牙语、法语、德语、日语和韩语。默认自动跟随 Windows
系统语言，也可通过主工具栏手动切换并跨重启保留选择。

</details>

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
| Agent 检测         | 在 Windows 上检测 Claude Code、Codex、OpenCode 与 Antigravity 的可执行文件、版本与健康状态 |
| 新建 Agent 会话    | 按目录启动 Claude/Codex/OpenCode/Antigravity，选择隔离账号与 Agent 对应的模型配置，并可开启自动确认 |
| Agent 会话中心     | 只读发现多账号 Claude/Codex/OpenCode/Antigravity 会话，支持搜索、Workspace 过滤、原生恢复，以及接管 CLI 仍持有的 Claude 后台会话 |
| Agent 状态识别     | 为每个终端生成隔离 Hooks 设置，识别思考、工具调用、权限确认、用户输入和完成状态   |
| 模型与 MCP Profile | 管理模型、Endpoint、API Key 与 MCP 配置；Claude CLI 可切换 Anthropic 兼容后端     |
| 网络与 npm Profile | 按全局/Workspace 管理 HTTP/HTTPS/SOCKS 与 npm 配置，测试连通性并在启动时注入      |
| 多账号管理         | 管理多个隔离 Claude 与 ChatGPT/Codex 登录、默认账号、认证状态和启动时选择         |
| CLI 生命周期管理   | 预览、确认、安装或升级各 Agent 的 CLI——可用官方 npm 包，也可用厂商自己发布的 Windows 安装脚本——并在完成后验证结果 |
| 任务看板           | 按项目管理任务，带优先级与验收标准；可将一条任务跑成 Claude/Codex/OpenCode 终端，并从待办跟踪到执行中、已完成、已验收 |
| 提示词资产         | 按终端恢复实时草稿；搜索、收藏、置顶、删除和复用已提交提示词                     |
| 会话交接           | 生成带脱敏和 Token 预算的 Git/任务包；导入导出文档并交给另一个 Agent 继续         |
| Git Graph 与 Diff  | 展示当前终端的分支、提交拓扑和启动后的代码变更，支持单栏或双栏 Diff              |
| 远程访问           | 以 HTTPS 把完整工作台提供给同网络的手机和其他电脑，凭访问令牌进入，支持二维码与令牌更换；远程调用需通过显式命令白名单 |
| 本地数据与密钥     | Workspace、会话索引和事件保存到 SQLite；API Key 保存到 Windows Credential Manager |
| 浏览器预览         | 无需 Rust 即可预览完整 UI，并使用可交互的模拟终端验证布局与基础流程               |

![Termexo 模型 Profile](website/assets/termexo-models.png)

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

- Claude Code 与 Codex 都已支持原生检测、按账号/模型启动、本地会话发现、恢复和基于生命周期
  事件的终端状态。两者的事件语义并不完全相同；兼容供应商模型切换目前只适用于 Claude 终端。
- 应用退出后，已退出的操作系统进程不会被“伪恢复”。Termexo 只恢复终端配置，
  历史 Claude 会话需要从会话中心显式恢复。
- Claude 与 Codex 原始 JSONL 均只读，Termexo 不修改、重命名或删除这些文件。
- 快照入口会保持隐藏，直到对应生产后端完成。Git 会话变更表示终端启动后观察到的仓库差异，
  同期运行的编辑器或其他终端也可能参与这些改动。
- V0.5 迁移的是脱敏后的上下文包，不会改写供应商私有的原生会话记录。自动权限批准、
  原生 transcript 改写和跨 Agent 批量模型切换事务仍不在当前版本范围内。

完整产品规划见 [Termexo.md](./Termexo.md)，当前架构边界见
[V0.2 架构说明](./docs/architecture/v0.2.md)。

## 从源码构建

以下要求面向构建 Termexo 的开发者；普通用户使用上方安装包即可。

### 环境要求

- Windows 10 build 17763（2018 年 10 月）或更高——终端所依赖的伪控制台从这个版本开始才有；
- WebView2 运行时需 Chromium 111 或更高——界面的配色用 `color-mix()` 和 `oklch()` 表达，更旧的
  运行时会直接丢弃这些声明。遇到旧版本时 Termexo 会提示并提供下载入口；Windows 11 自带，安装包
  也会补装；
- Node.js `^22.22.3`、`^24.15.0` 或 `>=26.0.0`；
- 桌面模式需要 Rust stable 和 Visual Studio C++ Build Tools；
- 本机已安装至少一个 Agent CLI（也可由 Termexo 安装与升级）。

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
    Adapters["Agent Adapters"]
    Hooks["Hooks / Event Pipeline"]
    DB[("SQLite")]
    Vault["Windows Credential Manager"]
    Agents["Claude Code / Codex"]

    UI <--> IPC
    IPC --> PTY
    PTY --> Agents
    IPC --> Adapters
    Adapters --> Agents
    Agents --> Hooks
    Hooks --> DB
    IPC <--> DB
    IPC --> Vault
```

- **Angular UI**：Workspace、终端布局、会话中心、设置和 Inspector。
- **Tauri Commands**：前后端 IPC 边界，暴露最小化桌面能力。
- **PTY Service**：创建、输入、调整尺寸和关闭真实终端进程。
- **Agent Adapters**：检测 Claude/Codex 安装、只读扫描会话，并生成原生启动/恢复命令。
- **Hooks Pipeline**：接收 Agent 生命周期事件，去重并映射统一终端状态。
- **SQLite / Credential Manager**：分别保存结构化本地数据和敏感凭据。

## 数据与安全

| 数据                  | 存储位置                   | 处理原则                               |
| --------------------- | -------------------------- | -------------------------------------- |
| Workspace、终端配置   | SQLite                     | 本地持久化                             |
| Claude/Codex 会话索引 | SQLite                     | 从 Agent 原生会话文件只读解析后 Upsert |
| Agent 事件            | JSONL spool + SQLite       | 按 `event_key` 去重                    |
| 模型与 MCP Profile    | SQLite                     | API Key 明文不进入数据库               |
| 提示词资产与交接包    | SQLite                     | 保存前自动清除常见凭据                 |
| API Key               | Windows Credential Manager | 前端只能读取 `hasCredential`           |
| Agent 原始会话        | Claude/Codex 数据目录      | 只读，不修改、重命名或删除             |

为兼容早期安装，数据库文件和部分 Tauri 内部标识仍沿用旧标识；这不影响产品名称
与新的 `TERMEXO_*` 环境变量。

## 路线图

| 版本 | 已交付内容 | 状态 |
| --- | --- | --- |
| V0.1–0.5 | 工作空间、真实终端、原生会话恢复、模型配置与会话交接 | 已发布 |
| V0.6 | OpenCode、任务看板与 Agent 确认选项 | 已发布 |
| V0.7 | 自绘窗口、GPU 终端渲染与账号流程改进 | 已发布 |
| V0.8.0–0.8.4 | 手机访问、首次使用引导、输入延迟和手机滚动改进 | 已发布 |
| V0.8.5 | 自带 ConPTY 与 WebView2 启动诊断 | 已发布 |
| V0.8.6 | 屏幕级准确的终端重放与重连稳定性 | 已发布 |
| V0.8.7 | 不会让终端卡死的屏幕解析器 | 已发布 |
| V0.8.8 | 存储面板与可迁移的数据目录 | 已发布 |
| V0.9.0 | 第四个 agent Antigravity 与厂商安装脚本 | 已发布 |
| V0.10.0 | 自建中继与端到端加密的远程访问 | 当前版本 |
| V1.0 | 稳定性、安全加固与恢复体验 | 规划中 |

进行中的工作见 [Issues](https://github.com/gemron/Termexo/issues)，实际交付内容见
[CHANGELOG.cn.md](CHANGELOG.cn.md)。规划中的工作尚无承诺发布日期。

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

本项目基于 [MIT 许可证](LICENSE) 开源。
