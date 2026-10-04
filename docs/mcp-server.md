# Termexo MCP 服务

适用于 Termexo v0.10.10 及更新版本。简明上手步骤也收录在[官网中文使用说明](https://www.termexo.com/guide.html#ai-control)和[英文使用说明](https://www.termexo.com/guide.en.html#ai-control)，两份指南均提供 PDF。

Termexo 可以作为本机 MCP Server，让 AI 客户端操作正在运行的工作台。它与用于给 Agent 配置外部服务的 MCP Profile 独立，也与远程工作台访问独立。

## 启用和连接

1. 打开桌面应用的「设置 → AI 操控（MCP）」。
2. 勾选「启用本地 MCP 服务」，选择允许访问的范围，点击「应用」。
3. 保持默认勾选的「自动连接 Termexo 启动的 Agent」，确认状态为「运行中」，然后在 Termexo 中启动 Agent 或执行任务。
4. 已经运行的 Agent 需重新启动。连接期间保持 Termexo 桌面窗口打开。

默认地址为 `http://127.0.0.1:7421/mcp`。服务默认关闭；启用时默认允许终端和任务访问，设置访问需单独打开。端口被占用时，面板显示启动失败原因，可修改端口后再次应用。

第一次连接可以对新启动的 Agent 说：「调用 termexo-desktop 的 workspace_list，列出工作区；先不要修改任何内容。」确认实际工具调用成功后，再授权具体终端或任务操作。

## 自动连接 Agent

支持 Claude Code、Codex、OpenCode、Grok Build 和 Antigravity CLI。新会话、历史会话重新启动、任务执行及恢复都在实际创建终端进程时接入，服务未启用或取消自动连接时不会注入。

自动连接的服务名是 `termexo-desktop`，使用 Termexo 自带的 stdio 桥接程序连接本机 HTTP 服务。桥接程序每次请求读取当前端口和系统凭据，因此更新端口或令牌后仍可使用；生成的 Agent 配置和启动命令不包含令牌。访问范围仍由 MCP 设置控制，Agent 自身的工具审批仍生效。

| Agent | 配置方式 |
| --- | --- |
| Claude Code | 在当前 `--mcp-config` 文件列表中追加 Termexo 配置，保留所选 MCP Profile；`attach` 连接到已经运行的 Claude 进程，需重新启动原进程后才能载入 MCP |
| Codex | 本次启动追加 `-c mcp_servers.termexo-desktop=…`，保留其他 MCP 和模型配置 |
| OpenCode | 合并到本次启动的 `OPENCODE_CONFIG_CONTENT`，保留插件及其他 MCP；分别使用 V1 的 `mcp` 和 V2 的 `mcp.servers` 格式 |
| Grok Build | 合并到当前 `GROK_HOME`（默认 `~/.grok`）的 `config.toml`，保留已有条目和注释 |
| Antigravity CLI | 合并到 `~/.gemini/config/mcp_config.json`，保留其他服务 |

Grok 和 Antigravity 没有适用的单次启动 MCP 覆盖选项，因此在首次启动时写入用户配置；同一配置下在 Termexo 外启动的客户端也能看到该条目。关闭自动连接或关闭服务并应用后，Termexo 移除自己添加的条目。已经存在的同名自定义条目及无效配置不会被覆盖，启动时会提示错误。[Grok MCP 配置文档](https://raw.githubusercontent.com/xai-org/grok-build/main/crates/codegen/xai-grok-pager/docs/user-guide/07-mcp-servers.md)和 [Antigravity MCP 文档](https://antigravity.google/docs/mcp)说明了它们的配置格式和位置。

OpenCode V2 的配置和禁用字段与 V1 不同，参见 [OpenCode V2 MCP 文档](https://opencode.ai/v2/docs/mcp-servers)。

## 连接外部客户端

对于在 Termexo 外启动的其他 AI 客户端，复制设置面板的 JSON 或 TOML 配置到客户端 MCP 设置中，然后重新连接。JSON 配置用于支持此配置格式及 Streamable HTTP 的客户端：

```json
{
  "mcpServers": {
    "termexo": {
      "type": "http",
      "url": "http://127.0.0.1:7421/mcp",
      "headers": { "Authorization": "Bearer <TOKEN>" }
    }
  }
}
```

Codex 的 `config.toml` 配置：

```toml
[mcp_servers.termexo]
url = "http://127.0.0.1:7421/mcp"
http_headers = { Authorization = "Bearer <TOKEN>" }
```

面板的复制按钮会填入实际令牌；页面展示的 JSON 使用占位符。[Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)说明了 `url`、`http_headers` 和其他连接选项。

服务权限和 AI 客户端的工具审批分别生效。Codex 非交互运行且 `approval_policy="never"` 时，未批准的写入工具会被客户端拒绝；自动化测试可以通过 `enabled_tools` 限制工具，再为指定工具设置审批策略。[真实联调记录](./mcp-live-test.md)包含实际客户端测试结果与检查范围。

## 工具

| 工具 | 操作 |
| --- | --- |
| `workspace_list` | 查询工作区、项目路径和终端 ID，终端或任务访问任一开启时可用 |
| `terminal_list` | 查询终端及进程运行状态，可按工作区筛选 |
| `terminal_create` | 在已有工作区创建 Shell 终端，可指定目录和启动命令 |
| `terminal_read` | 读取终端画面及滚动历史，支持纯文本或 ANSI 格式，默认最多 20,000 字符 |
| `terminal_write` | 写入文字或控制按键，`submit: true` 追加回车 |
| `terminal_close` | 关闭终端及进程，同步工作区标签和关联任务状态 |
| `task_list` | 查询工作区的项目、任务和执行状态 |
| `task_create` | 创建任务；未指定模型配置时选择适用于该 Agent 的默认配置 |
| `task_update` | 编辑任务；正在执行的任务需先停止 |
| `task_delete` | 删除任务；正在执行的任务需先停止 |
| `task_execute` | 执行待办或失败任务，复用桌面的 Agent 启动与提示词投递流程 |
| `task_stop` | 中断任务，保留终端和会话 |
| `task_resume` | 在原会话中继续已停止任务 |
| `task_complete` | 将执行中的任务标为已完成；尚未投递的任务需等待提示词投递 |
| `task_verify` | 验收已完成任务并记录备注 |
| `settings_get` | 查询语言、终端显示偏好及模型、网络配置，不返回凭据和 MCP 令牌 |
| `settings_update` | 修改语言、终端字体及字号、侧栏显示偏好，立即应用到桌面 |
| `model_profile_update` | 修改已有模型配置，保留其已存储的 API Key |
| `network_profile_update` | 修改已有网络配置，保留其已存储的代理凭据 |

任务工具支持 Claude Code、Codex、OpenCode 和 Grok Build。`terminal_create` 创建 Shell；使用 `task_execute` 启动受 Termexo 配置管理的 Agent。

建议先调用 `workspace_list`、`task_list` 和 `settings_get` 获取实际 ID，再创建或执行任务。修改模型及网络配置影响后续启动的终端，已有进程保留启动时的配置。

## 执行语义

`terminal_write` 成功表示输入已经写入 PTY；`task_execute` 成功表示启动流程已建立任务和终端绑定。它们都不代表命令或任务已经完成。调用 `terminal_read` 或 `task_list` 查询后续状态，任务结果包含 `executionState` 和 `promptDeliveryState`。

服务同时只允许一条桌面自动化操作进入业务流程。其他调用会返回忙碌错误。单次等待最多 60 秒；超时不会撤销已开始的操作，应先查询状态再决定是否重试。桌面端也会拒绝过期请求，并在之前的操作尚未完成时拒绝新的操作。

正在执行的任务停止后可以编辑或删除。编辑停止任务时若更换 Agent，任务返回待办，供新 Agent 重新执行。

## 访问控制和协议

- 服务只监听 IPv4 本机回环地址，远程工作台和中继不提供此入口。
- 终端、任务、设置权限分别控制工具发现和调用。关闭权限后，已经发现工具的客户端也无法发起新的相关调用；客户端需重新连接以刷新工具列表。
- 使用独立 Bearer 令牌，凭据存入系统凭据管理器。重新生成令牌会使旧令牌的下一次请求失效。
- 管理服务的命令仅供桌面主窗口使用，远程命令桥拒绝调用它们。
- 校验 HTTP Host 和 Origin，不提供跨来源浏览器访问。
- 采用无状态 Streamable HTTP 和 JSON 响应，支持协商 `2025-11-25`、`2025-06-18`、`2025-03-26`；不提供 SSE 推送或协议会话。客户端 GET/DELETE 请求返回 405。
- 请求上限 1 MB。参数按工具 schema 验证，拒绝未知字段。工具执行失败通过 `isError: true` 返回；协议或参数错误使用 JSON-RPC error。
- 日志记录工具名及结果状态，不记录参数、终端输出、令牌或凭据。

传输方式及请求头要求参见 [MCP Streamable HTTP 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。
