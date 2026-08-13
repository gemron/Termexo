# Termexo 产品功能、软件架构与开发计划

## 一、产品定位

Termexo 是一个面向开发者和企业研发团队的本地优先 AI 开发工作空间与控制平面。
它以 Workspace 为核心，把项目、终端、Agent 原生会话、模型供应商、运行状态和协作权限
组织成可观察、可恢复、可扩展的工作现场。

一句话定位：

> 在桌面端统一管理 AI 编程 Agent 与模型，并把同一个 Workspace 安全延伸到授权用户、
> 可信电脑和手机。

产品能力按三个层次演进：

* **本地开发控制台**：多项目、多终端、原生 Agent 会话、布局、状态、配置与恢复。
* **多 Agent 与模型控制面**：Agent 编排、模型路由、供应商 Plan 余量、告警与耗尽降级。
* **连接式 Workspace**：细粒度共享、可信设备、远程电脑、手机访问和操作审计。

当前 V0.3.2 已形成 Claude Code 与 Codex CLI 共用的本地多 Agent 会话工作台，并完成
隔离多账号、Codex 按账号/模型启动恢复、可缩放折叠双侧栏、网络/npm Profile 和 CLI
安装升级管理。Plan 余量监控和远程协作属于后续版本规划。所有远程能力都必须建立在
本地所有权、明确授权、端到端加密和可撤销访问之上。

Termexo 计划统一管理：

* Claude Code
* OpenAI Codex CLI
* Aider
* OpenCode
* 自定义命令行 Agent
* 企业内部编程 Agent
* 通过 OpenAI、Anthropic 或兼容协议接入的第三方模型

Termexo 的整体目标是保存、恢复并安全连接以下工作状态：

* 项目目录
* Git 仓库及分支
* Git Worktree
* 终端进程
* Agent 类型
* Agent 原生会话
* 当前模型
* API 服务商
* 环境变量
* MCP 配置
* 权限策略
* 终端布局
* 任务状态
* 上下文摘要
* Provider Plan 配额与重置周期
* Workspace 成员、设备和共享权限
* 远程连接状态与操作审计

它不是简单的多标签终端，也不是用统一聊天界面取代现有 Agent。Termexo 优先调用各
Agent 的原生会话、配置和恢复机制，并在其上提供 Workspace 状态、模型路由、配额可见性
与安全连接能力。

---

# 二、核心使用场景

## 2.1 多项目并行开发

用户可以同时运行：

```text
MTS 云平台
├── Claude Code：后端接口开发
├── Codex CLI：单元测试
├── Codex CLI：代码审查
└── Shell：运行服务

设备健康管理系统
├── Claude Code：Angular 页面
├── Claude Code：Java 后端
├── Codex CLI：数据库迁移
└── Shell：Docker Compose
```

每个项目形成一个 Workspace。

Workspace 保存：

```text
项目路径
Git 仓库
当前分支
Worktree
终端列表
Agent 会话
模型配置
窗口布局
任务信息
```

关闭软件或重启电脑后，可以恢复整个 Workspace。

---

## 2.2 一键恢复全部工作现场

用户点击：

```text
恢复上次工作现场
```

系统执行：

1. 检查项目目录是否存在。
2. 检查 Git 分支和 Worktree。
3. 创建终端伪终端进程。
4. 恢复每个终端的工作目录。
5. 恢复环境变量和模型配置。
6. 调用对应 Agent 的原生 Resume 命令。
7. 恢复终端布局。
8. 标记无法恢复的会话。
9. 提供“新会话继承上下文”降级方案。

Claude Code 与 Codex 的本地会话记录可用于恢复；Termexo 通过各 CLI 的原生机制恢复会话。

---

## 2.3 一键切换全部终端模型

用户可以选择一个模型配置：

```text
全部切换到 Claude Sonnet
全部切换到 GPT 系列
全部切换到指定 Codex 模型
全部切换到 MiniMax
全部切换到 DeepSeek
全部切换到企业 LiteLLM 网关
```

需要注意，“切换模型”分为三个级别。

### 级别一：原生热切换

Agent 本身支持运行中修改模型时，直接发送对应命令：

```text
/model
```

或调用 Agent 的配置接口。

### 级别二：重新启动并恢复原会话

如果 Agent 不支持热切换，则：

```text
保存当前会话
停止进程
修改模型配置
重新启动 Agent
恢复原会话
```

### 级别三：迁移式切换

某些 Agent 会话不能跨提供商、账号或协议恢复。

这时系统执行：

```text
提取当前任务
提取上下文摘要
提取已修改文件
提取 Git Diff
提取未完成事项
启动新 Agent
注入迁移上下文
```

因此产品界面不能只显示“切换成功”，而应显示：

```text
原生切换
重启恢复
上下文迁移
不兼容
```

Claude Code 的模型可通过命令行、配置和环境变量设置；官方也提供了通过 LLM Gateway 接入统一模型网关的配置方式。

---

# 三、功能模块设计

## 3.1 Workspace 工作区管理

每个 Workspace 对应一个项目或任务集合。

主要功能：

* 创建工作区
* 从 Git 仓库创建
* 从本地目录创建
* 从历史记录恢复
* 导入现有 Claude 与 Codex 会话
* 克隆工作区
* 导出工作区配置
* 工作区分组
* 收藏和置顶
* 最近访问
* 工作区模板

工作区模板示例：

```text
Angular + Java
前端 + 后端 + 数据库
Claude + Codex 双 Agent
多 Worktree 并行开发
代码审查工作流
Bug 修复工作流
```

---

## 3.2 多终端管理

终端模块需要支持：

* 多标签
* 水平分屏
* 垂直分屏
* 网格布局
* 标签拖动
* 标签重命名
* 标签着色
* 全屏终端
* 放大当前终端
* 广播输入
* 批量执行命令
* 终端搜索
* 终端输出导出
* ANSI 色彩
* 超链接识别
* 文件路径点击
* 错误信息识别
* 终端状态保存

终端状态：

```text
STARTING
RUNNING
THINKING
WAITING_INPUT
WAITING_APPROVAL
IDLE
COMPLETED
FAILED
STOPPED
DISCONNECTED
```

---

## 3.3 Agent 管理

建立统一 Agent Adapter 接口：

```typescript
interface AgentAdapter {
  detect(): Promise<AgentInstallation>;
  getVersion(): Promise<string>;

  start(options: StartOptions): Promise<AgentProcess>;
  stop(processId: string): Promise<void>;

  listSessions(projectPath?: string): Promise<AgentSession[]>;
  resume(sessionId: string, options: ResumeOptions): Promise<AgentProcess>;

  getModels(): Promise<ModelDescriptor[]>;
  switchModel(processId: string, model: ModelRef): Promise<SwitchResult>;

  parseOutput(data: Uint8Array): AgentEvent[];
  inspectSession(sessionId: string): Promise<SessionMetadata>;

  buildEnvironment(profile: ModelProfile): Record<string, string>;
  buildCommand(options: StartOptions): CommandSpec;
}
```

首批 Adapter：

```text
ClaudeCodeAdapter
CodexAdapter
AiderAdapter
OpenCodeAdapter
GenericCliAdapter
```

GenericCliAdapter 允许用户配置任意命令行程序：

```yaml
name: MyAgent
command: my-agent
startArgs:
  - "--model"
  - "${MODEL}"
resumeArgs:
  - "--resume"
  - "${SESSION_ID}"
sessionDirectory: "~/.my-agent/sessions"
```

---

## 3.4 会话管理

会话中心展示所有 Agent 的历史会话：

```text
会话名称
所属项目
Agent 类型
原生会话 ID
创建时间
最后使用时间
模型
Git 分支
工作目录
状态
上下文长度
修改文件数量
```

支持：

* 搜索会话
* 按项目过滤
* 按 Agent 过滤
* 按模型过滤
* 重命名
* 收藏
* 标签
* 恢复
* 克隆
* 归档
* 删除
* 导出
* 从会话创建新 Workspace

不要直接修改各 CLI 的原始会话文件。

建议采用：

```text
只读扫描原生会话目录
+
Termexo 自己保存索引和扩展元数据
```

避免 CLI 升级后出现文件格式不兼容。

---

## 3.5 模型与供应商管理

模型配置不能只保存 Model Name，而应分成四层。

### Provider

```text
Anthropic
OpenAI
Google
Azure OpenAI
AWS Bedrock
Google Vertex AI
OpenRouter
LiteLLM
MiniMax
DeepSeek
Moonshot
阿里云百炼
火山方舟
企业私有网关
```

### Credential

```text
API Key
OAuth
Access Token
Service Account
企业 SSO
本地代理令牌
```

### Endpoint

```text
Base URL
API Version
区域
代理地址
证书
请求头
```

### Model Profile

```yaml
name: 企业 Claude
provider: litellm
endpoint: https://ai.company.com
model: claude-sonnet
temperature: 0.2
maxTokens: 32000
permissionProfile: enterprise-safe
mcpProfile: java-development
```

模型配置需要支持：

* 当前终端切换
* 当前 Workspace 切换
* 选中终端批量切换
* 全局切换
* 根据任务自动路由
* 临时切换
* 永久切换
* 切换预览
* 兼容性检查
* 切换失败回滚

### Provider Plan 配额余量监控

统一展示每个模型供应商、账号和模型的订阅 Plan 余量：

```text
Provider / 账号
Plan 名称与计费周期
总额度、已使用、剩余额度和使用率
Token、请求次数、金额或供应商自定义配额单位
分钟、小时、日、周、月等不同时间窗口
下一次重置时间
当前限流状态和最近一次 429
最近同步时间和数据来源
```

数据来源按可信度分级：

1. 供应商官方 Usage、Billing 或 Rate Limit API。
2. Agent CLI 暴露的账号、`/usage` 或 Plan 状态接口。
3. 企业 LiteLLM、OpenRouter 或私有网关的统一配额接口。
4. 根据本地请求和 Token 记录计算的估算值。

界面必须明确标记：

```text
官方实时数据
官方延迟数据
本地估算
供应商暂不支持查询
认证失效
```

刷新和告警策略：

* 支持手动刷新、后台轮询和供应商事件推送
* 根据不同 API 限制设置动态刷新间隔和本地缓存
* 支持同一供应商的多个账号和多个 Plan
* 可配置 50%、80%、90%、95% 和自定义余量阈值
* 余额不足、即将重置、认证失败和限流时发送通知
* 模型路由和批量切换前检查剩余额度，避免切换到不可用供应商
* 配额历史仅保存统计值，不保存 API Key、Cookie 或完整账单明细

并非所有供应商都提供实时剩余额度 API。无法获得官方数据时，系统必须显示
“估算”或“不可用”，不能将本地推算值伪装成官方 Plan 余量。

---

## 3.6 模型切换事务

“一键切换全部模型”必须设计为事务，而不是简单修改环境变量。

事务流程：

```text
创建切换计划
      ↓
检查 Agent 兼容性
      ↓
检查模型和供应商权限
      ↓
保存所有终端状态
      ↓
暂停可暂停的 Agent
      ↓
切换支持热切换的 Agent
      ↓
重启需要重启的 Agent
      ↓
迁移无法直接恢复的会话
      ↓
验证新模型
      ↓
提交事务
```

任何步骤失败时：

```text
回滚模型配置
恢复原进程
恢复原会话
记录失败原因
```

切换结果示例：

```text
6 个终端切换成功
2 个终端重启恢复
1 个终端使用上下文迁移
1 个终端保持原模型
```

---

## 3.7 会话迁移引擎

这是产品最有价值的核心能力之一。

迁移包结构：

```json
{
  "task": "实现 OPC UA 数据读取模块",
  "summary": "已经完成连接和节点浏览",
  "completed": [
    "完成连接配置类",
    "完成证书加载"
  ],
  "pending": [
    "实现订阅",
    "实现断线重连"
  ],
  "decisions": [
    "使用 Eclipse Milo",
    "订阅周期为 100ms"
  ],
  "changedFiles": [],
  "gitDiff": "",
  "commands": [],
  "errors": [],
  "constraints": [],
  "nextAction": "实现 SubscriptionManager"
}
```

迁移上下文来源：

* Agent 原始会话
* 终端输出
* Git Diff
* Git Status
* 最近修改文件
* TODO
* 用户标记的重要信息
* Agent 自动生成摘要

迁移时不能默认把完整历史交给另一个模型，因为可能：

* Token 太多
* 包含密钥
* 包含企业敏感信息
* 不同 Agent 的系统提示不兼容

应先经过：

```text
内容过滤
密钥脱敏
摘要压缩
文件白名单
Token 预算
```

---

## 3.8 Git 和 Worktree 管理

功能包括：

* 当前分支显示
* 未提交修改提示
* Git Diff 预览
* Commit 记录
* 创建 Worktree
* 删除 Worktree
* Agent 与 Worktree 绑定
* 防止多个 Agent 修改同一文件
* 文件冲突提醒
* 自动创建任务分支
* Agent 完成后生成 Commit
* 合并 Worktree
* 冲突解决入口

推荐结构：

```text
主项目
├── main
├── worktree/feature-login
├── worktree/fix-opc
└── worktree/refactor-storage
```

每个 Agent 默认运行在独立 Worktree 中，可以明显降低多个 Agent 同时修改代码造成的冲突。

---

## 3.9 MCP 管理中心

统一管理：

* MCP Server
* MCP 配置文件
* MCP 启停
* Workspace 级 MCP
* Agent 级 MCP
* 模型级 MCP
* 权限配置
* 环境变量
* 健康检查
* 日志
* 工具清单
* 调用次数
* 执行耗时
* 失败率

MCP Profile 示例：

```text
Java 开发
├── Git
├── PostgreSQL
├── Jira
├── Maven
└── Browser

工业软件开发
├── Git
├── OPC UA
├── QuestDB
├── Docker
└── Internal Docs
```

---

## 3.10 权限与安全管理

提供权限模板：

```text
只读模式
普通开发
自动修改
自动测试
自动提交
完全自动
企业受控
```

控制范围：

* 文件读取
* 文件修改
* Shell 命令
* Git Commit
* Git Push
* 网络访问
* MCP 工具
* Docker
* 数据库
* 管理员权限
* 敏感目录
* 环境变量
* 密钥读取

危险命令规则：

```text
rm -rf
format
mkfs
DROP DATABASE
git reset --hard
git push --force
shutdown
reboot
```

可以配置：

```text
禁止
每次确认
Workspace 内允许
白名单允许
审计后允许
```

---

## 3.11 Agent 状态识别

不能仅通过进程是否存在判断状态。

状态识别来源：

1. Agent 官方 Hooks。
2. 标准输出解析。
3. 进程 CPU 使用率。
4. 子进程状态。
5. 终端提示符识别。
6. Agent SDK 事件。
7. 文件和 Git 变化。
8. 用户手动标记。

Claude Code Hooks 和 Agent SDK 可以提供 SessionStart、工具调用、停止等事件，适合建立比纯终端文本匹配更可靠的状态机制。

统一事件模型：

```typescript
type AgentEvent =
  | { type: "session.started"; sessionId: string }
  | { type: "model.changed"; model: string }
  | { type: "agent.thinking" }
  | { type: "tool.started"; tool: string }
  | { type: "tool.completed"; tool: string }
  | { type: "approval.required"; detail: string }
  | { type: "user.input.required"; question: string }
  | { type: "task.completed" }
  | { type: "agent.failed"; error: string };
```

---

## 3.12 任务看板

在终端之上增加任务管理：

```text
待处理
进行中
等待确认
已完成
失败
```

任务可以关联：

* Workspace
* Agent
* Session
* Git 分支
* Worktree
* 模型
* Issue
* Commit
* Pull Request

任务详情：

```text
任务目标
执行计划
当前进度
已完成事项
待处理事项
修改文件
运行命令
Token 消耗
费用
错误
最终结果
```

---

## 3.13 通知中心

通知条件：

* Agent 等待输入
* Agent 等待权限确认
* Agent 完成任务
* Agent 执行失败
* 测试失败
* 模型配额不足
* API 请求限流
* 上下文接近上限
* Git 冲突
* 终端进程退出

通知方式：

* 桌面通知
* 声音
* 系统托盘
* 企业微信
* 钉钉
* 飞书
* Slack
* Webhook

---

## 3.14 Workspace 共享与远程访问

### Workspace 共享

支持将 Workspace 安全共享给指定用户或设备，共享范围可按需选择：

* Workspace 基本信息和项目状态
* 终端列表、Agent 状态与只读输出
* 任务看板、会话摘要和 Git 状态
* 指定终端的交互控制权限
* Workspace 模板与非敏感配置

权限模型：

* 所有者：管理成员、设备、权限和共享生命周期
* 协作者：在授权范围内操作终端、Agent 和任务
* 观察者：只读查看状态、输出和通知
* 临时访客：通过可过期、可撤销的邀请访问指定范围

### 远程电脑

用户可以将可信电脑注册到自己的设备列表，并从其他设备访问该电脑上的 Workspace：

* 查看远程电脑在线、离线和连接质量
* 浏览远程电脑上的 Workspace 与 Agent 状态
* 打开终端只读输出或请求交互控制
* 远程启动、停止或恢复授权的 Agent 会话
* 优先建立端到端直连，无法直连时使用加密中继
* 网络断开后保留状态快照，重连后继续同步

### 手机访问 Workspace

提供响应式 Web 或 PWA 移动端入口，优先覆盖轻量、及时的操作：

* 查看 Workspace、终端、Agent 和任务状态
* 接收等待输入、权限确认、完成与失败通知
* 审批 Agent 权限请求
* 查看终端输出并发送简短输入
* 切换 Workspace、指定显示终端和查看会话摘要
* 一键断开远程控制或撤销设备授权

### 安全边界

* 使用设备配对、短期访问令牌和多因素验证
* 传输内容端到端加密，服务端不保存终端明文
* API Key、系统凭据和本机密钥默认不参与同步
* 每次远程输入、权限审批和配置修改写入审计日志
* 高风险操作需要在被控电脑确认，支持只读安全模式
* 共享可随时暂停、撤销，并立即使已有访问令牌失效

---

# 四、软件架构

## 4.1 总体架构

建议采用：

```text
┌──────────────────────────────────────┐
│            Desktop UI                │
│ React/Angular + xterm.js             │
└──────────────────┬───────────────────┘
                   │ IPC
┌──────────────────▼───────────────────┐
│          Desktop Core                │
│ Workspace / Session / Layout         │
│ Model Switch / Task / Notification   │
└──────────────────┬───────────────────┘
                   │
┌──────────────────▼───────────────────┐
│       Agent Runtime Manager          │
│ Claude / Codex / Generic             │
└──────────┬───────────┬───────────────┘
           │           │
┌──────────▼─────┐ ┌───▼──────────────┐
│ PTY Manager    │ │ Agent Adapters   │
│ Process Tree   │ │ Hooks / Parsers  │
└──────────┬─────┘ └───┬──────────────┘
           │           │
┌──────────▼───────────▼───────────────┐
│ Local Data Layer                     │
│ SQLite / Secret Store / Event Log    │
└──────────────────────────────────────┘
```

---

## 4.2 推荐技术栈

### 桌面框架

首选：

```text
Tauri 2 + Rust
```

前端：

```text
Angular 22
xterm.js
Monaco Editor
Golden Layout 或自研 Dock Layout
```

选择 Tauri 而不是 Electron 的原因：

* 安装包更小
* 内存占用更低
* Rust 更适合管理进程和 PTY
* 更容易控制本地权限
* 适合做长期运行的桌面工具

考虑到你已有 Angular 技术积累，采用：

```text
Tauri 2 + Angular + Rust
```

最合适。

### 终端

```text
前端：xterm.js
Rust PTY：portable-pty
进程信息：sysinfo
异步运行时：Tokio
```

### 数据库

```text
SQLite
```

ORM 可选：

```text
SeaORM
SQLx
Diesel
```

建议 SQLx，结构简单、可控。

### 密钥存储

不能把 API Key 明文存入 SQLite。

使用：

```text
Windows Credential Manager
macOS Keychain
Linux Secret Service
```

Rust 可以封装 keyring 库。

### 日志

```text
tracing
tracing-subscriber
```

日志分为：

```text
应用日志
Agent 日志
终端日志
审计日志
模型请求统计
```

---

## 4.3 核心进程划分

### Desktop UI

负责：

* 页面展示
* 终端渲染
* 用户交互
* 拖拽布局
* 状态展示

### Core Service

负责：

* Workspace 管理
* 会话索引
* 配置管理
* 模型切换事务
* 权限检查
* 任务编排

### PTY Service

负责：

* 创建 PTY
* 输入输出
* Resize
* 进程树
* 退出监控
* 环形缓冲区
* 重连

### Agent Adapter Service

负责：

* Agent 检测
* 版本检测
* 启动命令生成
* Resume 命令生成
* 会话扫描
* 模型切换
* 输出解析
* Hooks 集成

### Snapshot Service

负责保存：

* Workspace 状态
* 布局
* 终端配置
* 进程启动参数
* 会话 ID
* Git 状态
* 当前模型

### Router Service

负责：

* 模型选择
* Provider 选择
* 失败降级
* 配额切换
* 成本控制

---

# 五、数据模型

核心数据表：

```text
workspaces
projects
terminals
terminal_snapshots
agent_installations
agent_sessions
model_providers
model_profiles
provider_accounts
provider_quota_snapshots
quota_alert_rules
credentials
mcp_profiles
mcp_servers
tasks
task_events
git_worktrees
layout_snapshots
switch_transactions
audit_logs
notifications
```

## Workspace

```sql
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    project_type TEXT,
    git_repository TEXT,
    active_branch TEXT,
    layout_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_opened_at INTEGER
);
```

## Terminal

```sql
CREATE TABLE terminals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    shell TEXT,
    working_directory TEXT NOT NULL,
    agent_type TEXT,
    agent_session_id TEXT,
    model_profile_id TEXT,
    status TEXT NOT NULL,
    start_command TEXT,
    environment_profile_id TEXT,
    sort_order INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

## Agent Session

```sql
CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    agent_type TEXT NOT NULL,
    native_session_id TEXT NOT NULL,
    workspace_id TEXT,
    project_path TEXT,
    model_name TEXT,
    title TEXT,
    metadata_json TEXT,
    created_at INTEGER,
    last_used_at INTEGER,
    UNIQUE(agent_type, native_session_id)
);
```

---

# 六、关键技术难点

## 6.1 不能恢复正在运行的原进程

操作系统重启后，原 PTY 和进程已经不存在。

因此所谓“恢复终端”实际是：

```text
恢复终端配置
+
重新启动进程
+
调用 Agent 原生会话恢复
```

普通 Shell 终端无法恢复进程内存状态，只能恢复：

* 工作目录
* 环境变量
* Shell 历史
* 启动命令
* 屏幕输出快照

对于正在运行的开发服务，可以记录并重新执行：

```text
npm run dev
mvn spring-boot:run
docker compose up
```

---

## 6.2 不同 Agent 会话格式不同

不能创建一个通用 Parser 直接解析全部格式。

需要采用：

```text
统一接口
+
每个 Agent 单独 Adapter
+
版本兼容层
```

每个 Adapter 需要声明：

```text
支持的 Agent 版本
支持的会话格式版本
支持的模型切换方式
支持的恢复方式
```

---

## 6.3 第三方模型并不一定兼容 Claude Code

即使某个平台提供 Anthropic 兼容接口，也不代表：

* Tool Use 完全兼容
* Prompt Cache 兼容
* Streaming 兼容
* Thinking 模式兼容
* Context Window 兼容
* Claude Code 特殊请求头兼容

所以必须建立兼容性矩阵：

```text
完全兼容
基本兼容
实验性
不支持
```

---

## 6.4 终端输出解析不稳定

仅依靠正则匹配终端输出会受以下因素影响：

* CLI 版本变化
* 语言不同
* ANSI 控制字符
* 动态刷新
* Spinner
* TUI 全屏渲染

优先级应为：

```text
官方 Hooks / SDK
    >
JSON 输出模式
    >
进程与文件事件
    >
终端文本解析
```

---

## 6.5 批量模型切换的上下文一致性

模型切换前必须保证：

* 当前输出已经完成
* 文件写入已经结束
* 工具调用已经结束
* Agent 不处于权限确认状态
* 会话 ID 已持久化
* Git Diff 已保存

否则重启时可能丢失正在进行的操作。

---

# 七、用户界面设计

## 7.1 主界面

```text
┌──────────────┬────────────────────────────┬────────────┐
│ Workspace    │ Terminal Area              │ Inspector  │
│              │                            │            │
│ MTS          │ ┌─────────┬──────────────┐ │ Agent      │
│ Health       │ │ Claude  │ Codex        │ │ Model      │
│ ODS Server   │ ├─────────┴──────────────┤ │ Session    │
│              │ │ Codex                   │ │ Git        │
│              │ └────────────────────────┘ │ Task       │
└──────────────┴────────────────────────────┴────────────┘
```

顶部工具栏：

```text
新建终端
新建 Agent
恢复会话
切换模型
广播输入
保存快照
恢复布局
任务看板
设置
```

---

## 7.2 全局 Agent 面板

```text
Agent               状态       模型             项目
Claude-Backend      运行中     Claude Sonnet    MTS
Codex-Test          等待输入   GPT              MTS
Codex-Review        已完成     GPT Codex        MTS
Claude-Frontend     需确认     Claude Sonnet    Health
```

支持点击后立即跳转到对应终端。

---

## 7.3 模型切换面板

```text
作用范围

○ 当前终端
○ 当前 Workspace
○ 已选择终端
● 所有 Agent

目标模型

Provider：企业 LiteLLM
Model：Claude Sonnet
配置：Java 企业开发

切换方式

3 个支持热切换
4 个需要重启恢复
1 个需要上下文迁移
1 个不兼容
```

用户点击“执行切换”后展示实时进度和最终结果。

---

# 八、版本规划

## 近期执行顺序（2026-08 重新规划）

以下顺序以“先稳定高频操作，再建立数据与模型控制底座，最后扩展自动化和外部集成”为原则。
GitHub Issue 是执行入口，版本章节定义能力边界和验收标准。

| 顺序 | 版本阶段 | 目标 | 对应 Issue | 依赖关系 |
| --- | --- | --- | --- | --- |
| P0 | V0.3 稳定化 | 修复 Claude 右键粘贴重复；Agent 选择弹窗支持点击空白关闭；文件链接可选择 VS Code 或文本编辑器打开 | [#11](https://github.com/gemron/Termexo/issues/11)、[#15](https://github.com/gemron/Termexo/issues/15) | 无，优先降低日常操作摩擦 |
| P1 | V0.4 模型控制 | Claude 支持单窗口切换和多终端批量切换，展示兼容性、执行进度、失败回滚 | [#11](https://github.com/gemron/Termexo/issues/11) | 复用现有账号/Profile 和会话恢复能力 |
| P2 | V0.4 用量可观测 | 建立统一 Token 用量事件、实时曲线、消耗速度、累计总量和分终端统计 | [#4](https://github.com/gemron/Termexo/issues/4) | 为 Plan 估算、告警和切换预检提供数据底座 |
| P3 | V0.4 Plan 额度 | 检查账号 Plan 总量、余量与重置时间；额度不足、恢复可用和即将重置时提示 | [#12](https://github.com/gemron/Termexo/issues/12) | 优先使用官方数据，缺失时复用 #4 的本地统计并标记为估算 |
| P4 | V0.5 提示词资产（已完成） | 实时保存输入草稿，提供历史检索、收藏和置顶 | [#8](https://github.com/gemron/Termexo/issues/8) | 复用本地数据库、搜索和敏感信息保护策略 |
| P5 | V0.5 会话接力（已完成） | 一键批量操作会话；生成、读取交接文档，并让新 Agent 按交接内容继续工作 | [#7](https://github.com/gemron/Termexo/issues/7) | 依赖会话摘要、任务状态、Git Diff 和迁移包 |
| P6 | V0.6 通知集成 | 把统一事件接入企业微信、钉钉、飞书及海外通知应用 | [#5](https://github.com/gemron/Termexo/issues/5) | 依赖 Agent 状态、Plan 告警和可扩展通知事件模型 |

并行原则：P0 可独立完成；P1 与 P2 可并行；P3 在 P2 的统一数据模型确定后接入；P4 可与
P1～P3 并行；P5 在会话迁移包稳定后完成；P6 最后接渠道 Adapter，避免各渠道重复实现业务判断。

---

## V0.1：多终端原型

目标：验证终端和 Workspace 恢复能力。

功能：

* Tauri + Angular 基础框架
* xterm.js 终端
* 多标签
* 分屏
* PTY 创建
* Workspace
* SQLite
* 保存工作目录
* 保存终端布局
* 重启后重新打开终端
* Windows 支持

交付标准：

```text
可以创建 10 个终端
可以关闭软件
重新打开后恢复布局和目录
```

---

## V0.2：Claude Code 专用版

功能：

* 自动检测 Claude Code
* 创建 Claude 会话
* 扫描历史会话
* 恢复 Claude 会话
* 命名会话
* Claude 模型配置
* Claude Hooks
* 状态识别
* API 配置
* 第三方 Anthropic 兼容 Endpoint
* MCP Profile

交付标准：

```text
可以管理多个 Claude Code
可以恢复指定会话
可以显示运行、等待、完成和失败状态
```

---

## V0.3：多 Agent 版本

增加：

* Codex CLI
* Aider
* Generic CLI Adapter
* Agent 安装检测
* Adapter SDK
* 会话中心
* Agent 状态统一展示

当前开发进度：

* [x] Codex CLI 安装检测与版本读取
* [x] Codex CLI 托管 PTY 启动
* [x] Codex 原生 rollout 会话只读扫描与 UUID 恢复
* [x] Claude / Codex 统一会话中心
* [ ] Codex Hooks 与统一运行状态事件
* [ ] Generic CLI Adapter 与 Adapter SDK
* [ ] 修复 Claude 右键粘贴重复，Agent 选择弹窗支持点击遮罩关闭（[#11](https://github.com/gemron/Termexo/issues/11)）
* [ ] 终端文件链接支持选择 VS Code、系统默认或指定文本编辑器打开（[#15](https://github.com/gemron/Termexo/issues/15)）

交付标准：

```text
至少同时运行 Claude 与 Codex
所有 Agent 可以从统一界面创建和恢复
```

---

## V0.4：模型切换版本

增加：

* 支持的 Agent CLI 一键安装
* CLI 版本检查、一键升级与升级结果验证
* 安装源、目标版本和升级策略可见且可确认
* 安装或升级失败时提供明确诊断，不破坏现有可用 CLI
* 为内网开发环境创建全局或 Workspace 级 HTTP、HTTPS 与 SOCKS 代理 Profile
* 支持系统代理以及 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 等标准环境变量
* 管理 npm registry、`proxy`、`https-proxy`、`strict-ssl` 和企业 CA 证书配置
* 启动 Agent、安装或升级 CLI 时按作用域注入代理，不默认改写用户的全局 npm 配置
* 提供代理、registry、DNS、TLS 和目标服务连通性测试及明确诊断
* 代理账号凭据进入操作系统安全存储，不写入日志、快照或可导出的普通配置
* 代理应用失败时回退到原网络配置，并明确显示当前生效的代理 Profile
* 同时管理多个 Claude Code 登录账号与多个 Codex 登录账号
* 为每个第三方模型供应商保存多个独立账号和凭据配置
* 在全局、Workspace 或单个终端范围选择默认账号并快速切换
* 始终明确显示当前 Agent、供应商和正在使用的账号，不静默切换
* 切换前检查会话与账号兼容性，失败时恢复原账号和运行配置
* 账号凭据进入操作系统安全存储，界面、数据库、日志和快照不回显明文
* Provider 管理
* Model Profile
* 密钥存储
* 当前终端切换
* Workspace 批量切换
* 全局切换
* 切换兼容性检查
* 切换事务
* 失败回滚
* Provider Plan 配额余量仪表盘
* 官方 Usage API、CLI 状态和本地估算适配器
* 多账号、多时间窗口和余量告警
* 模型切换前的配额可用性检查
* Claude 当前终端、选中终端、Workspace 和全部终端的分级模型切换（[#11](https://github.com/gemron/Termexo/issues/11)）
* 单终端及聚合 Token 实时曲线、消耗速度和累计总量仪表（[#4](https://github.com/gemron/Termexo/issues/4)）
* Token Plan 额度检查、重置倒计时、额度恢复和阈值提示（[#12](https://github.com/gemron/Termexo/issues/12)）

当前开发进度：

* [x] 全局与 Workspace 网络代理 Profile 的创建、编辑、删除和 SQLite 持久化
* [x] HTTP、HTTPS、SOCKS、`NO_PROXY` 与 npm registry/proxy/SSL/CA 配置
* [x] 代理密码进入操作系统安全存储，拒绝 URL 内嵌明文凭据
* [x] Workspace Profile 优先、全局 Profile 回退，并注入 Claude/Codex 启动环境
* [x] DNS 解析与 TCP 连通性测试、错误诊断和桌面端功能测试
* [x] Claude Code 与 Codex 官方 npm 包安装/升级计划预览
* [x] 精确版本或 dist-tag 选择、安装源、npm 与生效代理可见并明确确认
* [x] 安装前 registry 解析、禁止并发操作、超时终止与安装后健康验证
* [x] CLI 安装/升级复用 Workspace 优先、全局回退的代理与 npm 配置
* [x] 系统代理与标准代理环境变量的自动发现、无密码导入
* [x] CLI 安装失败或健康检查失败后的原版本自动回滚
* [x] Claude/Codex 单窗口与批量模型切换、全量预检及失败回滚（[#11](https://github.com/gemron/Termexo/issues/11)）
* [x] Token 实时曲线、速度、累计总量和分终端统计（[#4](https://github.com/gemron/Termexo/issues/4)）
* [x] 多账号切换、自定义 Plan 额度/重置时间、本地余量估算和阈值提示（[#12](https://github.com/gemron/Termexo/issues/12)）
* [ ] 按供应商接入官方 Usage/Billing API，并在官方重置后确认额度恢复

交付标准：

```text
一次操作切换多个 Agent 的模型配置
不会因为部分失败破坏原有会话
可以查看每个供应商和账号的 Plan 剩余额度与重置时间
可以查看当前终端、Workspace 和账号维度的实时消耗速度与累计总量
达到阈值、额度耗尽、额度恢复或临近重置时只触发一次可解释的提示
无法获取官方数据时明确显示估算或不可用
可以为内网 Workspace 配置代理与 npm registry，并在启动 Agent 前验证连通性
代理密码不进入 SQLite、日志、快照或前端回传数据
```

---

## V0.5：会话迁移版本

状态：已完成（V0.5.0）。迁移使用 Termexo 自有的脱敏上下文包，不改写 Claude Code 或
Codex 的原生会话文件。

增加：

* Git Diff 提取
* 会话摘要
* 任务状态提取
* 上下文迁移包
* 跨 Agent 迁移
* 内容脱敏
* Token 预算
* 输入中提示词实时草稿、历史检索、收藏与置顶（[#8](https://github.com/gemron/Termexo/issues/8)）
* 所有会话的一键批量快捷操作（[#7](https://github.com/gemron/Termexo/issues/7)）
* 基于迁移包生成和读取交接文档，并从交接点继续工作（[#7](https://github.com/gemron/Termexo/issues/7)）

交付标准：

```text
Claude 会话可以迁移到 Codex
新 Agent 能够了解已完成工作和下一步任务
应用异常关闭后可以恢复尚未发送的提示词草稿
交接文档包含任务、决策、改动、验证结果、风险和下一步，并可被新 Agent 读取
```

---

## V0.6：多 Agent 协作

增加：

* 任务看板
* Worktree 自动创建
* Agent 任务分配
* Reviewer Agent
* Test Agent
* Planner Agent
* 多 Agent 消息
* 冲突检测
* 自动提交
* Pull Request 生成
* 可扩展通知 Channel Adapter（[#5](https://github.com/gemron/Termexo/issues/5)）
* 企业微信、钉钉、飞书、Slack、Microsoft Teams、Discord、Telegram 和通用 Webhook
* 按 Workspace、事件、严重级别和静默时段路由，支持测试、重试、去重和脱敏

交付标准：

```text
同一个 Agent 或 Plan 事件只由统一规则判断一次，再投递到一个或多个渠道
渠道故障不阻塞本地 Agent，会记录可重试状态且不泄露提示词、密钥和完整终端输出
```

---

## V0.7：Workspace 共享与远程访问

增加：

* Workspace 成员、角色与细粒度共享权限
* 可信设备注册、配对、撤销与在线状态
* 远程电脑 Workspace 浏览和终端访问
* 端到端加密直连与安全中继
* 手机 Web/PWA Workspace 入口
* 移动端通知、权限审批和简短终端输入
* 远程操作审计日志与只读安全模式

交付标准：

```text
可以把指定 Workspace 安全共享给授权用户或设备
可以从另一台电脑访问远程 Workspace 和授权终端
可以在手机上查看状态、处理审批并发送简短输入
撤销共享或设备后，已有远程访问立即失效
```

---

## V1.0：正式版本

包含：

* Windows、Linux、macOS
* 自动更新
* 插件市场
* Adapter SDK
* 企业配置
* 审计日志
* 使用统计
* 费用统计
* 团队 Workspace 模板
* 配置导入导出
* 稳定的崩溃恢复

---

# 九、开发周期与人员安排

## 第一阶段：基础桌面框架

周期：2 周。

人员：

```text
Rust/Tauri：1 人
Angular：1 人
测试：兼职
```

工作内容：

* 工程初始化
* IPC
* SQLite
* PTY
* xterm.js
* 多终端
* Workspace
* 布局保存

---

## 第二阶段：Claude Code 集成

周期：2～3 周。

工作内容：

* Claude 检测
* 会话扫描
* Resume
* 模型设置
* Hooks
* 状态识别
* MCP 配置
* Claude 日志

---

## 第三阶段：Codex 集成

周期：2～3 周。

工作内容：

* Adapter 抽象
* Codex Adapter
* Generic Adapter
* 统一会话中心
* 兼容性测试

---

## 第四阶段：模型切换

周期：3 周。

工作内容：

* Provider
* Credential
* Model Profile
* 切换计划
* 切换事务
* 回滚
* 多 Agent 批量切换
* Provider Plan 余量采集适配器
* 实时配额仪表盘、历史趋势和阈值告警
* 模型路由的配额预检和耗尽降级

---

## 第五阶段：上下文迁移

周期：3～4 周。

工作内容：

* 终端内容提取
* 会话摘要
* Git 信息提取
* 迁移包
* 数据脱敏
* 跨 Agent 迁移

---

## 第六阶段：测试与发布

周期：2～3 周。

工作内容：

* Windows 测试
* Linux 测试
* macOS 测试
* 崩溃恢复
* 性能优化
* 安装包
* 自动更新
* 使用文档

---

## 第七阶段：Workspace 共享与远程访问

周期：3～4 周。

工作内容：

* 设备身份、配对与信任管理
* Workspace 共享权限模型
* 端到端加密传输与中继服务
* 远程终端输出、输入和重连
* 响应式 Web/PWA 移动端
* 移动通知、权限审批和审计日志
* 弱网、离线、撤销与安全测试

---

## 总体时间

两名核心开发人员情况下：

```text
可演示原型：2～3 周
Claude 专用 MVP：5～6 周
多 Agent MVP：8～10 周
模型切换版本：11～13 周
Workspace 远程协作版本：17～21 周
可公开发布版本：20～24 周
```

---

# 十、MVP 功能边界

第一版不要直接开发完整的 AI 调度平台。

建议 MVP 只实现：

1. Windows 桌面端。
2. Tauri + Angular。
3. 多终端和分屏。
4. Workspace 保存。
5. Claude Code 会话扫描和恢复。
6. Codex 多账号会话扫描和恢复。
7. 模型配置模板。
8. 批量重启并恢复。
9. Agent 状态看板。
10. Git 分支和 Diff 展示。

暂不实现：

* 团队云同步
* 手机控制
* 完整多 Agent 自动协作
* 自动任务拆解
* 插件市场
* 复杂计费
* 自建云端 Agent
* 容器隔离
* 企业 SSO

先把“终端不丢、会话不丢、一键切换、快速跳转”做稳定。

---

# 十一、推荐代码目录

```text
termexo/
├── apps/
│   └── desktop-ui/
│       ├── src/app/
│       │   ├── workspace/
│       │   ├── terminal/
│       │   ├── agent/
│       │   ├── session/
│       │   ├── models/
│       │   ├── git/
│       │   ├── tasks/
│       │   └── settings/
│       └── package.json
│
├── src-tauri/
│   ├── src/
│   │   ├── commands/
│   │   ├── workspace/
│   │   ├── terminal/
│   │   ├── pty/
│   │   ├── process/
│   │   ├── agent/
│   │   │   ├── adapter.rs
│   │   │   ├── claude.rs
│   │   │   ├── codex.rs
│   │   │   └── generic.rs
│   │   ├── session/
│   │   ├── model_router/
│   │   ├── migration/
│   │   ├── git/
│   │   ├── security/
│   │   ├── database/
│   │   └── main.rs
│   ├── migrations/
│   └── Cargo.toml
│
├── packages/
│   ├── agent-adapter-sdk/
│   ├── shared-types/
│   └── terminal-protocol/
│
├── docs/
│   ├── architecture/
│   ├── adapter-sdk/
│   └── model-compatibility/
│
└── tests/
    ├── integration/
    └── compatibility/
```

---

# 十二、商业化方向

## 社区版

免费开源：

* 多终端
* Workspace
* Claude 与 Codex
* 会话恢复
* 本地模型配置
* 基础 MCP

## Pro 版

个人订阅：

* 全局模型切换
* 上下文迁移
* 高级任务看板
* Token 和费用统计
* 远程通知
* 无限 Workspace 模板

## Enterprise 版

企业授权：

* 统一模型网关
* 模型白名单
* 密钥集中管理
* 权限策略
* 审计日志
* 企业 SSO
* 配置下发
* 私有部署
* 团队模板
* 成本预算
* 数据脱敏
* 合规控制

---

# 十三、产品核心壁垒

真正的产品壁垒不是终端界面，而是以下四项：

1. 多种 Agent 的 Adapter 兼容层。
2. 稳定的会话恢复和状态识别。
3. 带回滚能力的批量模型切换事务。
4. 跨 Agent、跨模型的上下文迁移引擎。

开发优先级应当是：

```text
会话恢复
>
多 Agent Adapter
>
模型切换
>
上下文迁移
>
多 Agent 自动协作
```

建议第一阶段以“Claude Code 多会话桌面管理器”切入，再逐步演进为统一 AI 编程 Agent 工作台。
