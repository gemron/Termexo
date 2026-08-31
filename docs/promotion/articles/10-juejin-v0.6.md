<!--
平台：掘金
标题：我把 Claude Code、Codex 和 OpenCode 放进了同一个 Windows 工作台
分类：人工智能 / 开发工具
标签：AI、开源、Windows、Rust、Tauri
发布声明：项目维护者原创；封面由 AI 辅助生成，正文截图为真实界面。
-->

# 我把 Claude Code、Codex 和 OpenCode 放进了同一个 Windows 工作台

当 AI 编程从“偶尔问一句”变成多个 Agent 并行工作，真正先耗尽的通常不是算力，而是人的注意力。

我经常同时开着 Claude Code 和 Codex：一个在改功能，一个在跑测试，另一个项目的会话还停在等待授权。终端可以继续加，但“哪个 Agent 需要我、昨天的会话在哪、这个任务到底做完没有”逐渐变成了新的管理成本。

所以我做了 Termexo，一个 MIT 开源、只在本地工作的 Windows 多 Agent 工作台。现在的 V0.6 已经把 Claude Code、Codex 和 OpenCode 接进同一套工作流。

![Termexo V0.6](../assets/termexo-cover-v0.6.png)

## 真实 PTY，而不是重新做一层聊天界面

Termexo 没有模拟 Agent 的对话，也不接管它们的协议。三个 CLI 仍然运行在真实 PTY 中，桌面层只负责 Workspace、网格布局、状态、会话和任务。

一个 Workspace 可以打开任意数量的终端，再选择当前要显示的窗口，排成 1—6 行/列的网格。目录、标签、布局、模型和主题会持久化。Termexo 把不同 Agent 的事件统一映射为运行、思考、等待输入、等待授权、完成和失败；真正需要人介入时，再通过常驻提示条、Windows 通知和任务栏提醒定位到对应终端。

![Termexo 多终端工作台](../assets/termexo-workbench.png)

这层状态映射很重要。多 Agent 场景里，问题不是“终端不够开”，而是传统终端不会主动告诉你哪一个值得现在去看。

## V0.4：先把运行、网络和模型边界做稳

V0.4 加入了全局或 Workspace 级网络 Profile，可管理 HTTP、HTTPS、SOCKS、`NO_PROXY`、npm registry 与企业 CA。代理密码保存在系统凭据库，CLI 安装和升级会先预检网络与版本，失败后尽量回滚。

模型供应商也以 Profile 管理。Claude Code 可以选择 Anthropic、DeepSeek、MiniMax、GLM 或自定义 Anthropic 兼容 Endpoint；API Key 只进入 Windows Credential Manager。模型切换不是简单改环境变量后重启，而是预检全部目标配置，部分失败时恢复原命令、原会话与原 Profile。

Token 与 Plan 数据则明确区分官方返回、本地估算和不可用。并非所有供应商都开放配额 API，与其给出一个错误的精确数字，不如把数据来源写清楚。

![Termexo 模型 Profile](../assets/termexo-models.png)

## V0.5：交接的不是聊天记录，而是可继续工作的上下文

多个 Agent 之间最难迁移的不是最后一句回答，而是任务状态、改过哪些文件、测试到哪一步、还有什么风险。

V0.5 开始按终端保存实时提示词草稿，支持历史搜索、收藏、置顶和复用。它还能从当前终端或整个 Workspace 生成交接包，包括：

- 任务状态与会话摘要；
- 最近提示词和必要的终端输出；
- Git 状态、Diff 与变更文件；
- 已完成的验证、已知风险和下一步。

交接包可以导出 Markdown 或 JSON，也能直接发给另一个 Claude Code 或 Codex 终端继续工作。生成过程带可配置 Token 预算，过长内容会在不破坏 UTF-8 字符的前提下截断；常见 API Key、Bearer Token、密码和 Secret 会在落库前清除。

这里没有改写 Agent 的原生 transcript。迁移的是经过脱敏的工作上下文，不是假装把 A 的私有会话“无损搬进”B。

## V0.6：任务看板开始真正驱动 Agent

V0.6 把 OpenCode 升级为第三个一等 Agent，并加入了能够直接创建 Agent 终端的任务看板。

每条任务可以携带项目、优先级、验收标准、目标 Agent 和模型。点击开始执行后，任务会创建真实终端，并随着终端状态在待办、执行中、已完成、已验收之间流转。Agent 做完后仍由人决定验收通过，还是继续修改。

![Termexo 任务看板](../assets/termexo-task-board.png)

三个 Agent 也有统一的可选自动确认入口，终端会显示一致的 `AUTO` 标记。这个模式只适合可信仓库和边界明确的任务；面对未知脚本、敏感数据或高权限操作，人工确认仍然更合适。

工作台本身也重新整理：标签支持拖拽排序、中键关闭、滚轮切换和键盘操作。对于仍被 Claude CLI 持有的后台会话，可以查看并通过 fork 或 attach 接管，避免普通恢复后首条消息就退出。

## 恢复会话时，尊重 Agent 自己的数据

Termexo 只读扫描本机原生会话，并调用 CLI 自己的恢复命令：

```text
claude --resume
codex resume
opencode --session
```

原始 JSONL 不会被修改、重命名或删除。重启后创建的是新的 PTY 进程，再用原生会话 ID 恢复上下文；正在执行中的操作不会被伪装成进程级快照。

![Termexo Agent 会话中心](../assets/termexo-session-center.png)

## 一条命令体验

Termexo 当前面向 Windows 10/11，不需要注册 Termexo 账号，也没有自己的云端中转服务：

```powershell
npx termexo@latest
```

- 官网：https://www.termexo.com
- GitHub：https://github.com/gemron/Termexo
- Release：https://github.com/gemron/Termexo/releases/latest

如果你也在同时运行多个编程 Agent，欢迎分享真实的工作流和失败案例。对 Termexo 来说，比“再加一个入口”更重要的问题始终是：怎样让 Agent 帮人节省注意力，而不是制造新的终端管理工作。

> 本文由 Termexo 项目维护者撰写，基于 V0.6.0 的公开源码与已发布功能整理。封面使用 AI 辅助生成，正文均为真实产品截图。
