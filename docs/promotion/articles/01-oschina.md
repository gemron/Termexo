# OSCHINA：软件更新 / 开源项目稿

## 标题

Termexo 0.4.4 发布：在 Windows 中统一管理 Claude Code、Codex 与多模型供应商

## 摘要

Termexo 是一个 MIT 开源、仅在本地运行的 Windows AI 编程工作台。V0.4.4 加入 Codex 第三方模型 Profile、供应商余量面板、事务化模型切换与更完整的模型元数据配置，并继续提供多终端网格、原生会话恢复、多账号、Token 统计和 CLI 生命周期管理。

## 正文

Termexo V0.4.4 已发布。这个项目想解决的不是“再做一个 AI 聊天界面”，而是一个更具体的问题：当开发者同时运行多个 Claude Code、Codex 和不同模型供应商时，怎样在 Windows 上知道每个 Agent 正在做什么，并可靠地回到原来的会话。

![Termexo 工作台](../assets/termexo-workbench.png)

Termexo 使用真实 PTY 运行 Agent CLI。多个终端可以按照 1—6 行/列组成网格，每个 Workspace 会保存项目目录、终端、布局、模型和主题。Agent 等待输入、等待授权、执行完成或失败时，界面会显示统一状态，并可通过 Windows 通知与任务栏提醒定位到对应终端。

### V0.4.4 的重点变化

- Claude Code 与 Codex 均可使用按供应商组织的模型 Profile。
- 内置 Anthropic、OpenAI、DeepSeek、MiniMax、GLM、Kimi 等配置入口；自定义 Endpoint 也可以单独维护。
- Codex 第三方模型会生成独立模型目录和元数据，避免未知模型回退到通用 metadata。
- 右侧余量面板默认只显示当前终端所用供应商，并可手动查看、刷新全部供应商；Agent 活动时自动刷新。
- 模型切换采用预检、执行和恢复流程，切换失败时尽量恢复原会话与模型配置。
- API Key 保存到 Windows Credential Manager，不写入前端状态或 SQLite。

需要说明的是，Codex 当前通过 Responses API 工作，因此第三方 Endpoint 能否使用取决于供应商是否提供兼容接口。Termexo 不会把估算额度伪装成供应商官方数据：没有公开查询接口时会明确显示“估算”或“不可用”。

![模型 Profile](../assets/termexo-models.png)

### 原生会话恢复，而不是复制聊天记录

Termexo 只读发现本机 Claude Code 和 Codex 的原生会话文件，并分别调用 `claude --resume` 与 `codex resume`。它不会修改、重命名或删除原生 JSONL，也不会把会话上传到 Termexo 服务器。

![Agent 会话中心](../assets/termexo-session-center.png)

### 安装与体验

Windows 10/11 x64 用户可以直接运行：

```powershell
npx termexo@latest
```

也可以从 GitHub Release 下载 EXE 或 MSI 安装包。通过 npm 运行需要 Node.js 18.18 或更高版本；应用依赖 Windows WebView2。

- GitHub：https://github.com/gemron/Termexo
- V0.4.4：https://github.com/gemron/Termexo/releases/tag/v0.4.4
- npm：https://www.npmjs.com/package/termexo

项目采用 MIT 许可证。欢迎提交 Issue、复现报告和 PR；如果它确实改善了你的多 Agent 工作流，也欢迎在 GitHub 留下一个 Star，让更多需要这类工具的人发现它。

## 建议标签

`开源软件` `AI 编程` `Claude Code` `Codex` `Tauri` `Windows`
