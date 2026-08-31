<!--
平台：OSCHINA
类型：开源项目 / 软件更新
版本：V0.6.0
发布声明：项目维护者原创；封面由 AI 辅助生成，正文截图为真实界面。
-->

# OSCHINA：开源项目稿（V0.6.0）

## 标题

Termexo V0.6.0 发布：在 Windows 中统一管理 Claude Code、Codex 与 OpenCode，加入任务看板与会话交接

## 摘要

Termexo 是一个 MIT 开源、仅在本地运行的 Windows 多 Agent 工作台。V0.6.0 将 OpenCode 升级为第三个一等 Agent，新增可执行任务看板、提示词资产与会话交接包，并继续提供多终端网格、原生会话恢复、多账号、Token 统计、CLI 生命周期与网络 Profile 管理。

## 正文

Termexo V0.6.0 已发布。这个项目想解决的不是“再做一个 AI 聊天界面”，而是一个更具体的问题：当开发者同时运行多个 Claude Code、Codex、OpenCode 和不同模型供应商时，怎样在 Windows 上知道每个 Agent 正在做什么，并可靠地回到原来的会话、交接上下文、把任务跑起来。

![Termexo V0.6.0 工作台](../assets/termexo-cover-v0.6.png)

Termexo 不替换 Agent CLI，也不接管它们的对话界面。三个 Agent 仍然运行在真实 PTY 终端里，桌面层负责 Workspace、网格布局、状态识别、原生会话、模型与任务这一层。

![多终端工作台](../assets/termexo-workbench.png)

### V0.6.0 的重点变化

- OpenCode 成为与 Claude Code、Codex 并列的一等 Agent，启动、会话发现与恢复、重启还原、状态识别和自动确认进入同一套工作流。
- 新增任务看板：每条任务可携带项目、优先级、验收标准、目标 Agent 与模型；点击“开始执行”后创建真实 Agent 终端，并随终端状态在待办、执行中、已完成与已验收之间流转。
- 任务、Agent 会话、验收结果形成同一条链路；Agent 完成后由人决定验收通过或继续修改，最终判断权保留在开发者手里。
- 三个 Agent 统一支持可选的自动确认模式，终端用一致的 `AUTO` 标记提示当前状态，适合可信仓库与边界明确的任务。
- 终端工作台重构：标签支持拖拽排序、中键关闭、滚轮切换与键盘操作；Claude 后台会话可以查看并通过 fork 或 attach 接管。

![任务看板可直接创建 Agent 终端](../assets/termexo-task-board.png)

### V0.5.0：提示词资产与会话交接

- 按终端保存实时输入：尚未发送的草稿可在窗口意外关闭后恢复，已提交提示词支持搜索、收藏、置顶、删除和复用。
- 交接包可从当前终端或整个 Workspace 生成，内容包括任务状态、会话摘要、最近提示词、终端输出、Git 状态与 Diff、变更文件、验证结果、风险与下一步。
- 交接包支持 Markdown 与 JSON 导出，可直接发送给另一个 Agent 继续处理；生成过程带 Token 预算，在不破坏 UTF-8 字符的前提下截断过长内容，落库前清除常见 API Key、Bearer Token、密码与 Secret。
- 这里迁移的是经过脱敏的工作上下文，不会修改 Agent 自己的原生会话记录。

### V0.4.x：网络、模型与 Token 可观测

- 全局或 Workspace 级 HTTP、HTTPS、SOCKS、`NO_PROXY`、npm registry 与企业 CA Profile；代理密码进入系统凭据库。
- Claude Code/Codex/OpenCode CLI 安装、升级、版本预览、网络预检与失败回滚。
- 模型供应商 Profile：内置 Anthropic、OpenAI、DeepSeek、MiniMax、GLM、Kimi 等配置入口；自定义 Endpoint 可单独维护。
- 模型切换采用预检、执行与恢复流程，部分失败时尽量恢复原命令、原会话与原 Profile。
- API Key 保存到 Windows Credential Manager，不写入前端状态或 SQLite。
- 本地 Token 统计、速率曲线与 Plan 额度提醒；没有公开配额接口的供应商会明确标记为“估算”或“不可用”，不会用看似精确的数字冒充官方数据。

![模型与供应商 Profile](../assets/termexo-models.png)

### 原生会话恢复，而不是复制聊天记录

Termexo 只读发现本机 Claude Code、Codex 和 OpenCode 的原生会话文件，并分别调用 Agent 自己的恢复能力：

- Claude Code 使用 `claude --resume <session-id>`
- Codex 使用 `codex resume <session-id>`
- OpenCode 使用 `opencode --session <session-id>`

原始 JSONL 始终只读。Termexo 不会为了统一界面去改写 Agent 的原生 transcript，也不会把历史对话伪装成一段新提示词。

![Agent 会话中心](../assets/termexo-session-center.png)

### 本地优先，是它刻意保留的边界

Termexo 不要求注册账号，也没有自己的云端中转服务：

- Workspace、终端配置、会话索引与 Agent 事件保存在本机 SQLite；
- API Key 保存在 Windows Credential Manager；
- Agent 原生会话保持只读。

需要说明的是，“本地优先”不等于模型请求不联网：Claude Code、Codex 和 OpenCode 仍会按照所选供应商及其隐私政策访问对应模型服务。Termexo 做的是本地管理与编排，不是替供应商中转请求。

### 安装与体验

Windows 10/11 x64 用户可以直接运行：

```powershell
npx termexo@latest
```

也可以从 GitHub Release 下载 EXE 或 MSI 安装包，或全局安装：

```powershell
npm install --global termexo@latest
termexo
```

通过 npm 运行需要 Node.js 18.18 或更高版本；应用依赖 Windows WebView2。

- 官网：https://www.termexo.com
- GitHub：https://github.com/gemron/Termexo
- Release：https://github.com/gemron/Termexo/releases/latest
- npm：https://www.npmjs.com/package/termexo

项目采用 MIT 许可证。欢迎提交 Issue、复现报告与 PR；如果 Termexo 确实改善了你的多 Agent 工作流，也欢迎在 GitHub 留下一个 Star，让更多需要这类工具的人发现它。

## 建议标签

`开源软件` `AI 编程` `Claude Code` `Codex` `OpenCode` `Tauri` `Windows` `多 Agent`
