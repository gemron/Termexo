# CSDN：技术实现稿

## 标题

Windows 下统一管理 Claude Code 和 Codex：PTY、原生会话恢复与模型 Profile 的实现

## 摘要

本文以开源项目 Termexo V0.4.4 为例，拆解 Windows 桌面端编排多个 AI CLI 时的三个关键问题：如何保持真实终端兼容性，如何不破坏原生会话完成恢复，以及如何为 Claude Code 与 Codex 生成不同的第三方供应商配置。

## 正文

同时运行多个 AI 编程 CLI 时，常见做法是开多个终端窗口。但当会话横跨项目、分支、账号和模型后，仅靠窗口标题很难回答“哪个 Agent 正在等我”和“这个会话还能不能原样恢复”。

Termexo 的实现边界是：不替代 Agent CLI，不解析后重新播放对话，只增加本地工作台与编排层。

![多终端工作台](../assets/termexo-workbench.png)

### 一、为什么使用真实 PTY

Claude Code 与 Codex 都是交互式终端程序，依赖 TTY 尺寸、ANSI 控制序列、键盘组合键、鼠标上报和进程生命周期。如果把标准输入输出当普通管道转发，常见结果是布局错误、快捷键失效或授权交互异常。

Termexo 的桌面端由 Tauri 2 与 Rust 提供 Windows PTY，Angular 负责工作台界面。每个终端保留独立进程、工作目录和尺寸，网格变化后再同步 resize。桌面层只托管它，不假装自己是 Agent。

### 二、原生会话只读索引

Claude Code 和 Codex 的会话格式、目录与恢复命令不同。Termexo 使用 Adapter 分别扫描原生元数据，建立本地索引，然后调用：

```text
claude --resume <session-id>
codex resume <session-id>
```

原始 JSONL 不会被修改、重命名或删除。SQLite 保存的是 Workspace、终端配置、索引和统一事件，而不是一份重新发明的聊天记录。

![Agent 会话中心](../assets/termexo-session-center.png)

### 三、Claude 与 Codex 的供应商配置不能混用

很多兼容模型同时提供 Anthropic 风格和 OpenAI 风格接口，但两个 CLI 的配置入口并不相同。一个供应商 Profile 因此需要分别保存：

- Claude 侧模型、Anthropic 兼容 Endpoint 和启用状态；
- Codex 侧模型、OpenAI 兼容 Endpoint 和启用状态；
- 两侧共用但安全保存的 API Key；
- 配额来源、计划阈值与刷新状态。

Codex 当前要求兼容 Responses API。仅设置常见的 OpenAI 环境变量并不能保证 provider 真正切换，所以 Termexo 会显式生成 Codex provider override，并为 DeepSeek、MiniMax、GLM、Kimi 建立对应模型 metadata。

![模型 Profile](../assets/termexo-models.png)

### 四、模型切换为什么要做成事务

切换运行中的 Agent 通常意味着：保存当前目标、校验凭据和 Endpoint、生成启动配置、停止 PTY、以原生会话 ID 恢复、确认新终端启动成功。

任何一步失败，如果只更新 UI，就会出现“看起来是新模型，实际仍走旧配置”的隐性错误。V0.4.4 把单终端与批量切换统一为预检—执行—回滚流程，失败时恢复原命令、原会话和原 Profile。

### 五、额度信息必须标注来源

并非所有模型供应商都提供官方额度 API。界面将供应商官方返回、本地 Token/消费估算和不可查询明确区分；不会用本地猜测冒充官方余额。右侧默认只显示当前终端所用供应商，用户可以手动查看和刷新全部供应商，Agent 活动时也会触发刷新。

### 六、本地安全边界

- Workspace 状态和索引：本机 SQLite；
- API Key：Windows Credential Manager；
- Claude/Codex 原生会话：只读；
- Termexo 账号或云同步：不需要；
- 模型请求：仍直接遵循所选供应商的 Endpoint 与隐私政策。

### 运行项目

Windows 10/11 x64 可以直接运行 npm 包：

```powershell
npx termexo@latest
```

项目源码（MIT）：https://github.com/gemron/Termexo

这篇文章重点记录实现边界和踩坑，不建议把它理解为“所有 OpenAI 兼容接口都能直接接入 Codex”。实际兼容性取决于供应商是否实现 Responses API。欢迎基于源码复现、提交问题或补充新的 Provider 适配。

## 建议分类与标签

- 分类：人工智能 / 开发工具
- 标签：`windows` `rust` `tauri` `pty` `claude` `codex`
- 文章类型：原创
- AIGC 标注：AI 辅助校对与封面生成
