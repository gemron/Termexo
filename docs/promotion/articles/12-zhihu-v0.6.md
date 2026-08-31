<!--
平台：知乎专栏
标题：同时运行多个 AI 编程 Agent，怎样避免被一排终端拖垮？
话题建议：AI 编程、Claude Code、Codex、开源软件、程序员工具
发布身份：Termexo 项目维护者
-->

# 同时运行多个 AI 编程 Agent，怎样避免被一排终端拖垮？

我的答案是：不要继续给终端“加窗口”，而要给 Agent 增加一层可观察、可恢复的工作台。

我同时使用 Claude Code 和 Codex 后，很快遇到一个反直觉的问题：Agent 越能独立工作，人反而越容易被终端打断。因为你需要不断确认谁在运行、谁在等授权、哪一段会话属于哪个项目，以及某个任务到底做完没有。

于是我做了 Termexo。先说明身份：我是项目维护者，下面不是第三方测评，而是我对这个工具解决什么问题、又刻意不解决什么问题的说明。

![Termexo V0.6](../assets/termexo-cover-v0.6.png)

## 第一件事：只在 Agent 需要人时打断人

Termexo 把 Claude Code、Codex 和 OpenCode 放进同一个 Windows Workspace，但没有重写它们的界面。Agent 仍然运行在真实 PTY 中，Termexo 只负责布局、状态、会话与任务。

多个终端可以并排显示，界面会把不同 Agent 的事件统一成运行、思考、等待输入、等待授权、完成和失败。需要人工处理时，再通过常驻提示、Windows 通知和任务栏提醒定位到具体终端。

![多终端工作台](../assets/termexo-workbench.png)

这比“把四个终端排得更整齐”重要。后者只是节省屏幕，前者是在管理注意力。

## 第二件事：会话恢复要尊重原生数据

很多统一工作台会把聊天记录复制到自己的数据库，然后模拟一段恢复后的上下文。我不太喜欢这个方案，因为工具调用、压缩点和 Agent 自己维护的状态很容易丢失。

Termexo 只读发现本机原生会话，再分别调用：

- `claude --resume`
- `codex resume`
- `opencode --session`

原始 JSONL 不会被修改或删除。应用重启后，已经退出的进程也不会被描述成“无缝存活”：Termexo 创建新的 PTY，再用原生会话 ID 恢复上下文；执行到一半的操作仍需要重新确认状态。

![Agent 会话中心](../assets/termexo-session-center.png)

## 第三件事：把“上下文交接”做成显式资产

从 V0.5 开始，Termexo 会保存每个终端的实时提示词草稿，并提供搜索、收藏、置顶和复用。

它还可以生成一份交接包，整理任务状态、会话摘要、最近提示词、终端输出、Git 状态与 Diff、验证结果、风险和下一步。交接包支持 Token 预算，写入前会清除常见密钥和密码，并可以导出 Markdown/JSON，或直接发送给另一个 Agent。

这里迁移的不是某家供应商的私有 transcript，而是一份经过脱敏、让下一个执行者可以继续工作的上下文。

## 第四件事：任务看板不能只是手工拖卡片

V0.6 加入 OpenCode 和任务看板后，我希望任务本身能够创建 Agent，而不是在看板里写一句“进行中”，再去另一个窗口手工启动终端。

现在一条任务可以携带项目、Agent、模型、优先级和验收标准。开始执行后，它会创建真实 Agent 终端，并随着终端状态从待办进入执行中、已完成和已验收。Agent 做完以后，最终验收仍然由人决定。

![Termexo 任务看板](../assets/termexo-task-board.png)

三个 Agent 也有可选的自动确认模式。它适合完全可信的仓库和边界明确的重复任务；涉及未知脚本、敏感信息或高权限操作时，不开启更合理。

## 它解决不了什么？

Termexo 不是模型，也不会让 Agent 本身更聪明。它不做进程级快照，不能让正在执行的命令在 Windows 重启后继续跑；它也不会把 Claude 的私有会话“无损转换”为 Codex 会话。

“本地优先”也不等于完全离线。Workspace、索引和配置留在本机，API Key 进入 Windows Credential Manager，但 Claude Code、Codex 和 OpenCode 仍会按照你选择的模型供应商联网。

如果你一次只使用一个 CLI，原生终端很可能已经足够。Termexo 更适合同时维护多个项目、多个账号或多个 Agent，并且已经明显感受到上下文切换成本的人。

项目目前面向 Windows 10/11，采用 MIT 许可证开源，可以直接运行：

```powershell
npx termexo@latest
```

- 官网：https://www.termexo.com
- GitHub：https://github.com/gemron/Termexo
- 最新版本：https://github.com/gemron/Termexo/releases/latest

如果你正在使用多个编程 Agent，我也很想知道：最消耗你时间的是窗口管理、权限确认、会话恢复，还是把任务从一个 Agent 交给另一个 Agent？这些具体问题比抽象的“多 Agent 协作”更值得讨论。

> 本文由 Termexo 项目维护者撰写，封面使用 AI 辅助生成，正文截图均为真实产品界面。
