<!--
平台：CSDN
标题：Termexo V0.6：Windows 本地多 Agent 工作台，支持 OpenCode、任务看板与会话交接
标签：人工智能、开源软件、Windows、Claude Code、Codex
文章类型：原创
-->

# Termexo V0.6：Windows 本地多 Agent 工作台，支持 OpenCode、任务看板与会话交接

Termexo 是一个 MIT 开源、面向 Windows 10/11 的本地多 Agent 工作台。它使用真实 PTY 同时运行 Claude Code、Codex 和 OpenCode，并在 Workspace 中统一管理终端布局、运行状态、原生会话、模型配置、提示词资产和任务执行。

![Termexo V0.6](../assets/termexo-cover-v0.6.png)

## 1. 适合解决什么问题

当多个 AI 编程 CLI 同时运行时，常见问题包括：

1. 终端分散，无法快速判断哪个 Agent 等待输入或授权；
2. 项目、分支、账号和历史会话难以对应；
3. 代理、npm registry、模型 Endpoint 与 API Key 配置容易互相污染；
4. 从一个 Agent 切换到另一个 Agent 时，上下文需要手工整理；
5. 任务看板与实际执行终端相互独立，完成状态依赖人工同步。

Termexo 以 Workspace 作为边界保存项目路径、终端标签、布局、模型和主题。多个终端可以排成持久化的 1—6 行/列网格，并通过统一状态识别运行、思考、等待输入、等待授权、完成与失败。

![多终端工作台](../assets/termexo-workbench.png)

## 2. V0.4.4 之后的功能演进

### V0.4：网络、模型与 Token 可观测

- 全局或 Workspace 级 HTTP、HTTPS、SOCKS 与 `NO_PROXY` Profile；
- npm registry、proxy、`https-proxy`、`strict-ssl` 与企业 CA 管理；
- 代理密码保存到操作系统凭据库；
- Claude Code/Codex/OpenCode CLI 安装、升级、版本预览与失败回滚；
- 模型切换预检与事务化恢复；
- 从原生事件和会话文件提取本地 Token 统计；
- Plan 额度、重置时间、阈值告警和数据来源标记。

Claude Code 可通过供应商 Profile 使用 Anthropic、DeepSeek、MiniMax、GLM 或自定义 Anthropic 兼容 Endpoint。API Key 保存到 Windows Credential Manager，不写入 SQLite 或前端状态。

![模型 Profile](../assets/termexo-models.png)

V0.4.5 又加入本机终端字体搜索、预览与选择，并继续修复 Windows 中文输入法候选框定位问题。

### V0.5：提示词资产与会话交接

V0.5 按终端捕获实时输入，异常关闭后可以恢复未发送草稿；已提交提示词支持搜索、收藏、置顶、删除和复用。

交接包可以从当前终端或整个 Workspace 生成，内容包括任务状态、会话摘要、最近提示词、终端输出、Git 状态与 Diff、变更文件、验证结果、风险和下一步。支持：

- Markdown/JSON 导入与导出；
- 直接发送给另一个 Agent 终端；
- 可配置 Token 预算；
- UTF-8 安全截断；
- 常见 API Key、Bearer Token、密码和 Secret 自动脱敏。

### V0.6：OpenCode 与可执行任务看板

OpenCode 在 V0.6 成为第三个一等 Agent，启动、恢复、重启还原、状态识别和自动确认与 Claude Code、Codex 对齐。

任务看板中的任务可以配置项目、优先级、验收标准、Agent 与模型。点击“开始执行”后会创建真实 Agent 终端，并按照终端上报的状态在以下阶段流转：

```text
待办 -> 执行中 -> 已完成 -> 已验收
```

![任务看板](../assets/termexo-task-board.png)

三个 Agent 均提供可选的自动确认模式，并使用一致的 `AUTO` 标记。自动确认应仅用于可信仓库和权限边界明确的任务。

V0.6 还增加了终端标签拖拽排序、中键关闭、滚轮切换、键盘操作，以及 Claude 后台会话的查看、fork 和 attach。

## 3. 原生会话恢复方式

Termexo 不会复制聊天记录来模拟恢复，而是只读发现本机原生会话文件，再调用 Agent 自己的命令：

```powershell
claude --resume <session-id>
codex resume <session-id>
opencode --session <session-id>
```

原始会话文件不会被修改、重命名或删除。应用重启后，Termexo 会创建新的 PTY 进程并恢复原生上下文；已经退出的操作系统进程和执行中的操作不会被伪恢复。

![Agent 会话中心](../assets/termexo-session-center.png)

## 4. 本地数据与安全边界

| 数据 | 保存位置 | 处理原则 |
| --- | --- | --- |
| Workspace、终端配置 | SQLite | 本机持久化 |
| 会话索引与 Agent 事件 | SQLite | 从原生数据只读解析、事件去重 |
| 模型与 MCP Profile | SQLite | 不保存 API Key 明文 |
| API Key | Windows Credential Manager | 前端只能读取是否已配置 |
| 原生 Agent 会话 | 各 CLI 数据目录 | 只读 |

Termexo 不要求注册账号，也没有自己的模型请求中转服务。Agent 仍会按照用户选择的供应商及其隐私政策联网。

## 5. 安装与运行

安装 Node.js 与 WebView2 后，可通过 npm 直接启动完整 Windows 应用：

```powershell
npx termexo@latest
```

也可以全局安装：

```powershell
npm install --global termexo@latest
termexo
```

- 官网：https://www.termexo.com
- GitHub：https://github.com/gemron/Termexo
- Release：https://github.com/gemron/Termexo/releases/latest
- npm：https://www.npmjs.com/package/termexo

项目采用 MIT 许可证。本文由 Termexo 项目维护者基于 V0.6.0 的公开源码整理；封面使用 AI 辅助生成，正文截图来自真实产品界面。
