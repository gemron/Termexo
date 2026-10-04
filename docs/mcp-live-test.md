# MCP 真实联调记录

日期：2026-10-04。测试对象为当前源码构建的 Windows 桌面应用，未使用模拟 MCP 服务或模拟 PTY。

## 测试环境

- 独立应用标识 `dev.termexo.mcpqa`，使用独立数据库和 WebView 数据目录。
- MCP 地址 `http://127.0.0.1:17421/mcp`，工作区 `mcp-live-qa`。
- 官方 TypeScript MCP SDK `1.29.0`。
- 实际 Codex CLI `0.160.0`，通过临时配置连接 MCP，沿用已有登录；未修改全局 Codex 配置。
- 桌面应用中的工作区、任务、Agent 服务和 PowerShell PTY 均为实际实现。

## 结果

| 检查 | 结果及证据 |
| --- | --- |
| MCP 初始化与工具发现 | SDK 成功握手，发现 19 个工具 |
| 鉴权 | 不带令牌的实际 HTTP 请求返回 401 |
| 工具调用 | SDK 对全部 19 个工具调用成功 |
| 终端读写 | 创建真实 PowerShell PTY，写入命令，读取唯一输出标记；命令写入的测试文件内容与标记一致 |
| Agent 启动 | Codex 交互界面正常启动，实际 PTY 接收任务提示词 |
| 任务状态流转 | 创建、编辑、执行、停止、继续、标记完成、验收、删除均通过 |
| 设置与配置 | 字号、侧栏偏好、模型名称、网络配置名称修改后查询一致；测试完成后恢复 |
| AI 自主调用 | 实际 Codex CLI 成功完成 17 次 MCP 调用，覆盖终端操作、任务增改删和设置修改；返回 `CODEX_MCP_LIVE_PASS` |
| 清理 | AI 最后的工作区和任务查询确认没有残留终端或任务，字号恢复为 12；临时应用随后关闭 |
| Rust 回归 | PTY 的 25 项测试通过，Rust 格式检查通过 |

任务的完成和验收检查验证的是工作台状态流转，由测试客户端显式调用完成及验收工具；它不表示 Agent 已完成一项开发任务。AI 自主调用测试操作的是草稿任务，不启动额外开发任务。

## 联调发现与修复

首次 Agent 启动继承了宿主的 `TERM=dumb`，Codex 拒绝启动交互界面。PTY 现在明确设置 `TERM=xterm-256color`。保持宿主为 `TERM=dumb` 再次测试时，PTY 报告正确的终端类型，Codex 交互界面正常启动。

首次 Codex 非交互测试因 `approval_policy="never"` 而拒绝终端创建。重试仅在临时测试配置中设置工具审批并限制可用工具；全局配置保持原样。服务端权限与客户端审批是独立控制。[Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)列出了 `default_tools_approval_mode` 和 `enabled_tools`。

## 检查范围与本机证据

Computer Use 的本机管道不可用，重试及重置后仍失败，因此本次未完成可见界面的按钮操作、布局或视觉检查。未使用 Playwright 或浏览器脚本替代。

本机证据保存在 `.tooling/mcp-live/`（不纳入版本控制）：

- `results.json`：SDK 调用结果。
- `codex-client.jsonl`：真实 Codex MCP 调用及返回记录。
- `codex-client-result.json`：CLI 退出码和终端输出标记。
- `agent-output.txt`：实际 Codex 交互界面的终端输出。
- `pty-proof.txt`：通过实际 PTY 命令生成的验证文件。

令牌通过本机凭据存储读取后只传入客户端进程，不写入上述记录。

## 自动接入 Agent 的追加联调

同日对自动连接功能使用独立测试应用再次联调：

| 检查 | 结果 |
| --- | --- |
| 实际 stdio 桥接 | SDK 启动 Termexo 的 `mcp-proxy` 子进程，完成握手、发现 19 个工具，并成功调用 `workspace_list` |
| 从任务启动 Codex | 由桌面的任务流程启动真实 Codex PTY，自动追加 `termexo-desktop` 配置；终端显示 `Called termexo-desktop.workspace_list`，返回测试工作区 |
| 自动连接开关 | 同一个桥接进程在关闭后拒绝调用，重新开启后成功调用；此检查修改独立测试数据库中的开关，界面应用设置及全局条目移除由组件和 Rust 测试覆盖 |
| Grok 原生客户端 | `grok mcp doctor` 握手成功、发现 19 个工具，报告健康 |
| OpenCode 2.0.15 | 使用隔离配置启动实际 V2 服务，`GET /api/mcp` 返回 `termexo-desktop` 状态 `connected` |
| Antigravity CLI | 实际 `agy mcp list` 识别隔离配置中的 stdio 条目，状态 `enabled`；本次未让其模型调用工具 |
| 兼容与清理 | Rust MCP 的 16 项测试通过，覆盖 Claude Profile 合并、OpenCode V1/V2、Grok/Antigravity 配置保留与移除、开关及端口更新；设置面板 7 项测试通过；前端生产构建及默认标识的原生应用构建成功 |

Codex 的任务提示词进入真实 PTY 后，本次测试通过 `terminal_write` 追加回车提交，再验证实际 MCP 调用；不将其记为任务提示词全程自动提交通过。Claude 的配置合并由 Rust 测试覆盖，本次没有额外调用其模型。

联调确认 OpenCode V2 使用 `mcp.servers` 和 `disabled`，与 V1 的格式不同，现按启动时选择的版本生成配置。[OpenCode V2 MCP 文档](https://opencode.ai/v2/docs/mcp-servers)说明了这一结构。

测试任务和终端已删除，临时应用及 OpenCode 测试服务已关闭，测试 MCP 已禁用，Antigravity 原有状态回传配置已恢复。新增证据位于 `.tooling/mcp-live/autoconnect-results.json`、`autoconnect-agent-output.txt` 及 `client-discovery-results.json`；这些记录不包含 MCP 令牌。

## v0.10.10 正式发布构建

正式版（release profile、默认应用标识）的 `termexo.exe mcp-proxy` 经官方 SDK 完成 stdio 握手，发现 19 个工具，并调用实际测试桌面的 `workspace_list` 返回独立工作区。此检查确认 Windows GUI 子系统的正式版程序能保留 MCP 所需的标准输入输出，不只验证 debug 程序。

EXE 和 MSI 安装包均由 Tauri 发布构建生成；npm 包的桌面程序、ConPTY DLL 和 OpenConsole 文件按 SHA-256 与对应发布文件逐项核对。发布证据位于 `.tooling/mcp-live/release-smoke-results.json` 和 `.tooling/releases/v0.10.10/`。测试后独立 MCP 设置和 Antigravity 状态回传配置恢复，测试桌面及桥接进程关闭。
