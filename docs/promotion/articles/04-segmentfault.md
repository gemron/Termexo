# SegmentFault：架构复盘稿

## 标题

在桌面端编排多个 AI CLI，最难的不是画一个终端网格

## 正文

多个 Claude Code / Codex 并行之后，我原以为只需要把终端排成网格。真正做成 Termexo 后发现，难点主要落在三条边界上：PTY 必须保持原生交互，会话恢复必须尊重各 CLI 的数据，模型供应商切换必须能证明自己真的生效。

![Termexo 工作台](../assets/termexo-workbench.png)

### 真实 PTY 与统一状态并不冲突

Termexo 让每个 Agent 继续运行在真实 Windows PTY 中，不代理其输入输出协议。桌面层通过各 Agent 的原生事件和会话文件识别运行、思考、等待输入、等待授权、完成与失败，再投影到统一状态模型。

这比解析屏幕文字稳定，也保留了 CLI 的键盘、鼠标、ANSI 和授权交互。统一的是“人需要看到的状态”，不是强行统一两个 Agent 的内部协议。

### 恢复的是 Agent 会话，不是终端截图

应用重启后重新创建一个 shell，并不等于恢复 Agent 上下文。Termexo 只读发现 Claude Code / Codex 会话，分别调用 `claude --resume` 与 `codex resume`。原始 JSONL 始终只读，本地 SQLite 只保存 Workspace 和索引。

![原生会话中心](../assets/termexo-session-center.png)

### Provider Profile 需要协议意识

同一家模型供应商可能同时提供 Anthropic 兼容与 OpenAI 兼容入口，两者路径和能力并不相同。Termexo 的 Profile 分别记录 Claude 与 Codex 的模型、Endpoint 和启用状态，同时把 API Key 交给 Windows Credential Manager。

Codex 还要求供应商支持 Responses API。因此 V0.4.4 会显式生成 provider 配置，并为 DeepSeek、MiniMax、GLM、Kimi 补齐模型 metadata；它不会仅靠一个通用环境变量假定切换成功。

### 失败必须可见，也必须可恢复

模型切换会先预检，再停止 PTY、生成新配置并用原会话 ID 启动。如果中间失败，就恢复原命令、原会话和原 Profile。配额数据同样遵守这条原则：官方返回、估算和不可用必须在界面上明确区分。

### 项目与边界

Termexo 是 Windows 10/11 x64 上的 MIT 开源项目，技术栈为 Tauri 2、Rust、Angular 22 与 SQLite。无需注册 Termexo 账号，也没有 Termexo 云服务。

```powershell
npx termexo@latest
```

源码：https://github.com/gemron/Termexo

我希望进一步收集多 Agent 场景中的真实失败模式：例如 Windows PTY 兼容、不同供应商的 Responses API 差异、长会话恢复或企业代理环境。如果你能稳定复现，Issue 会比一句“好用”更有价值；如果它刚好解决了你的问题，也欢迎 Star 关注后续演进。

## 建议标签

`AI` `Rust` `Tauri` `Windows` `架构` `开源`
