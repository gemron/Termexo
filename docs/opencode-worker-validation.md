# OpenCode 实施者、安装修复与动态 Codex 模型

日期：2026-10-25。工作区 `Termexo-windows-worker`，分支 `feat/windows-worker`；未提交、合入主分支或发布。

## 角色与模型选择

- 协调者固定为 Codex；实施者支持 Codex / OpenCode 2；独立验证者为 Codex。
- 面板记录用户的实施者 CLI / 可选模型偏好，完整传到协调说明。协调者可以查询原生模型目录并提出具体建议，计划确认绑定所选 CLI、模型和版本。
- OpenCode 必须在计划中明确 `provider/model`；后台 NativeRuntime 不接受 OpenCode 实施。读取原生结果时发现模型不符、会话不符或额外用户回合则拒绝自动回收。
- 实施后检查报告所列文件与实际差异，由独立 Codex 检查源码并执行测试；验证命令还要在 Codex 原生只读沙箱中重放。PASS 仍需要独立交付确认。
- 重启后重新应用 Worker 角色：Codex 验证者仍为只读，OpenCode 恢复已记录模型及工具权限；OpenCode Worker 缺失必要上下文时拒绝重建。只读模型/会话查询可以并行，修改操作继续互斥。

OpenCode 的工具权限与 Codex 的操作系统沙箱不同。本实现保留 OpenCode 前台权限交互，默认拒绝未允许的工具和递归调度，为引擎生成的说明目录允许读取、拒绝编辑。目录权限规则不等于操作系统级隔离。CLI 语义参照 [OpenCode 2 CLI](https://dev.opencode.ai/v2/docs/cli/) 和 [原生会话导出](https://dev.opencode.ai/v2/docs/cli/commands/#session)。

## 安装修复

本机 `@opencode/cli@2.1.4` 的 `opencode.exe` 原来只有 229 字节，内容是“postinstall 未执行”的文本占位。普通 npm 安装退出成功，但当前 npm 的脚本策略跳过了包的 postinstall，导致系统无法执行它。

Termexo 为该包的安装、修复及回滚添加 `--ignore-scripts=false --allow-scripts=@opencode/cli`，预览命令同步展示；其他 CLI 不添加该包授权，不修改全局 npm 配置。

已通过更新后的 Termexo 原生 `preview_cli_operation` / `execute_cli_operation` 实际重装同一版本，返回 success=true、healthy=true、版本 `opencode v2.1.4`，没有触发回滚。日志为 `validation-results/opencode-live-task/installer-result.json`。

## Codex 模型目录和默认值

原先内置默认 Profile 固定为 `gpt-5.6-sol`，覆盖了本机 CLI 实际配置的 `gpt-6.1-sol`。现对未被修改的旧内置 Profile 迁移为空模型，表示沿用 CLI 配置；已编辑的 Profile、账号及用户显式选择保留。

新接口使用选定账号和工作目录，启动短生命周期 Codex app-server，仅调用 initialize、model/list（分页）和 config/read，返回模型、默认值和能力元数据；不请求模型推理、不打印配置或凭据。前端支持刷新，账号切换和迟到响应有代次保护，列表失败仍允许手动输入。显式启动选择及恢复时的模型显示优先于 Profile 默认值，避免 UI 显示另一个模型。

实际桌面对话框读取到七个 CLI 模型，默认占位为 `gpt-6.1-sol`，未强制填写旧模型；刷新后保留手动输入。证据为 `validation-results/opencode-live-task/model-ui.json`、`codex-dynamic-model-dialog.png`。目录来自 CLI，其内部目录可能包含缓存或内置条目，不是逐个模型的调用授权证明；依据 [官方模型目录说明](https://learn.chatgpt.com/docs/app-server#models) 与 [模型目录/调用权限边界](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。

## 真实调用与受控协议测试分别记录

真实外部模型探针曾返回 `OPENCODE_PROTOCOL_OK`。随后原生前台实施会话选择 `opencode/big-pickle`，原生记录确认实际模型相同，但服务端返回 `provider.free-limit`、429，未修改测试项目。此次真实模型开发没有完成，未将它视为交付。已修复把服务端失败误称“用户中断”的错误分类，保留服务端的安全错误摘要。证据为 `opencode-v2-protocol.jsonl`、`opencode-live-task/failed-session.json`。

为不依赖外部额度，另建独立 Git 项目和独立 One Ring 状态库，以 `test-client` 来源授权受控测试，未伪造用户表单批准，也未使用或改写用户的 2048 工作流。实施者的原生 OpenCode 2 前台界面连接本地确定性 provider `termexo-fixture/protocol`；该 provider 提供工具调用和最终 JSON 响应，不是真实开发模型。

成功用例 `93dff557-68cc-48e4-8809-df61a4a3e6ea`：

1. 原始 `clamp.js` 返回输入值，六项测试中有失败。
2. 原生 OpenCode CLI 实际读取说明，并通过自己的 write 工具修改 `clamp.js`，生成原生 session export 和结构化实施报告。
3. 独立真实 Codex `gpt-6.1-sol` 检查 Git diff，确认只改动 `clamp.js`、HEAD/index 未变，六项测试及 git diff --check 通过。
4. 引擎独立重放两个验证命令，退出码均为 0；阶段到达 `AWAITING_DELIVERY_APPROVAL`，没有批准交付。

实施 terminalId：`609c7913-b801-45cd-b8d8-902d1af9b7f1`，sessionId：`ses_609c7913b80145cdb8d8902d1af9b7f1`。验证 terminalId：`0794e900-07bc-4b19-92de-e6ec5ee0b8cf`，sessionId：`01a17213-c9e5-7881-8b6b-87bf157933d9`。

前一受控用例因测试服务提供了不匹配的工具参数，未产生文件改动，却返回了声称修改文件的报告；引擎以实际文件差异不符拒绝继续，未取得 PASS。测试记录保留用于区分协议成功与真实改动。

完整本机证据在 `validation-results/opencode-live-task/`，包含原始失败测试、原生导出、实施/验证运行目录、两次协议测试日志及 `workflow.json`。这里证明调度、原生界面、文件变化、证据回收和独立验证链路；不证明当前账号已完成真实 OpenCode 模型开发任务。

## 自动化与构建

- 引擎：41 项通过、2 项 POSIX 专用测试跳过，覆盖两个 CLI 的角色、明确模型、来源绑定、失败分类、接管、审批与差异检查。
- 前端相关测试及应用协调入口测试：79 项通过；模型目录刷新、输入保留、偏好传递、显式模型显示优先级、只读 MCP 并发、角色与会话身份均有覆盖。
- Rust：安装器 12 通过、交互配置 1 通过、数据库 18 通过、远程命令分类 7 通过、内置引擎 6 通过 / 1 可选项忽略、OpenCode 相关 27 通过 / 1 手动项忽略。过滤范围有重叠，不作为独立测试数量求和。
- 最后新增的恢复检查所在命令测试组共 20 项通过；重启后的实际终端命令确认只读、禁用递归 MCP 与多 Agent 的约束均保留。
- 前端、内置引擎、Windows 桌面构建通过，现有体积和未使用字段警告保留。

日志前缀 `validation-results/opencode-*`。测试用本地 provider 不写入用户 OpenCode 全局配置；测试后移除其进程环境并停止本地服务。当前仍需可用的 OpenCode provider/model，才能补齐真实开发模型的验收。

最终重启检查见 `validation-results/opencode-live-task/final-check.json`：模型目录与 Worker 状态并发读取成功，当前 CLI 默认仍为 `gpt-6.1-sol`，临时 provider 不在模型目录中，通用 MCP 保持关闭；实际加载前端的 SHA-256 与本次构建一致。
