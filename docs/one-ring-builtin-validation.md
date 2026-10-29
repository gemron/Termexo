# One Ring 内置集成验证

日期：2026-10-24。开发分支 `feat/windows-worker`，尚未合并或发布。

## 实现

- 引擎源码、锁定依赖、Skill 与测试进入 `packages/one-ring/`，Termexo 的开发和打包不依赖外部 One Ring 仓库。
- Tauri 构建自动准备内置服务与固定 Node 24.15.0；应用安装资源和 npm 桌面包均携带引擎、运行时及授权声明。
- 应用启动时自动绑定包内引擎和运行时，默认状态目录为应用数据目录下的 `one-ring`。旧预览的已有工作流目录保留，已保存的协调上下文改用当前包内引擎。
- 面板移除插件目录、Node 和状态目录表单，也不提供外部插件配置入口。
- 内部会话通道拥有独立凭据、自动端口及终端权限，通用 MCP 关闭时仍可运行；不会由此启用通用 MCP、任务看板或设置访问权限。
- 安装资源缺失时提示修复 Termexo，不将路径寻找交给用户。已修复 Rust canonical Windows 路径与 Node 24.15 入口解析的兼容问题。

## 实际桌面检查

以独立标识 `dev.termexo.oneringbuiltin`、全新数据库启动当前源码构建的 Windows 桌面。启动进程 PATH 特意不含系统 Node 路径。

| 检查 | 结果 |
| --- | --- |
| One Ring 默认可用 | 自动使用包内引擎与 Node；doctor/list 成功 |
| 人工路径输入 | 0 个，未操作任何 One Ring 设置 |
| 工作流状态位置 | `AppData/Roaming/dev.termexo.oneringbuiltin/one-ring` |
| 通用 MCP | enabled=false、running=false，未为测试开启 |
| 内部会话通道 | SDK 握手成功，仅发现 8 个工作区/终端工具，不含任务和设置工具 |
| 原生 Codex Worker | 从内部包的新 Runtime 创建实际 Termexo CLI 会话，取回 NATIVE_INTERACTIVE_RUNTIME_OK，窗口保持开启 |
| npm 打包 dry-run | 16 个文件，包含引擎、Skill、Node、许可证和第三方声明；未发布 |

原生会话 terminalId：`b8066633-deb6-47e2-834f-43da99619f05`，sessionId：`01a16e60-4618-7e41-8b50-250fe5c4c3a0`。这是不改项目文件的连接与结果回收检查，不替代真实开发任务的批准或交付。

打包 inventory 检查使用当前 debug EXE 作为受控暂存输入，仅验证 npm 文件清单和资源完整性；不是正式 release/MSI 构建或发布。

## 自动化

| 检查 | 结果 |
| --- | --- |
| 内置引擎单测 | 33 通过、2 项 POSIX 测试跳过 |
| 前端相关测试 | 32 通过 |
| Rust 引擎初始化/迁移/恢复/路径测试 | 6 通过、1 项可选外部插件检查忽略 |
| Rust MCP 权限、传输、内部通道 | 22 通过 |
| npm launcher 测试 | 7 通过 |
| 前端生产构建、原生应用构建 | 通过，保留现有体积/未使用字段警告 |

本机日志位于 `validation-results/builtin-one-ring-*.log`，桌面证据位于 `validation-results/windows-worker-live/builtin-overview.json` 及 `builtin-one-ring-no-configuration.png`。

## 边界

用户仍需使用 Termexo 原有的 Agent 安装与登录流程，并选择可用账号/模型。One Ring 内置不代表代登录、代批准计划或代接受交付。完整交互模式的跨 CLI 调度和中断恢复仍延续预览版限制；默认打包不会把未验证的 OpenCode/Pi 自动标记为可执行 Worker。

## Windows Codex 状态回调

2048 实际任务暴露了反复出现的 `Hook failed: hook timed out after 10s`。旧回调在启动、工具执行前后等事件中启动 PowerShell，再运行桌面 EXE 写入状态；回调超时不等同于工作流失败。

Windows 回调现改为使用 Termexo 已提供的 Node，直接写入相同的事件格式，省去 PowerShell 和桌面 EXE 的启动。模块路径通过会话环境中的文件 URL 传递，使用 `cmd /V:ON` 延迟展开，兼容 npm `.cmd` 启动链、路径转义以及 PowerShell 调用；`--eval=0` 防止 Node 将回调的标准输入当作 JavaScript。回调仅记录事件，不授予权限，也不修改工具输入。

独立诊断覆盖大体积工具输出：本机一次采样中新回调约 1.4 秒，旧 PowerShell 链路约 4.1 秒。该采样只说明启动开销减少，不保证任何系统负载下都能满足 10 秒限时。日志在 `validation-results/codex-hook-fix-timings.jsonl`。

随后在 Codex 0.164.0 原生交互界面中复现了旧链路的连续 10 秒超时，不能仅以后台调用耗时作为结论。带标记的交互采样中，PowerShell 进程创建到进入回调前约 11.4 秒，调用桌面 EXE 后总耗时约 24 秒；回调最终仍可成功写入部分事件。因此证据支持旧链路在交互环境中的启动/执行开销超过限时，不能将它定性为 stdin 永久死锁。

同一原生界面的新回调成功记录 `SessionStart`、`UserPromptSubmit`、`Stop`，未再出现 Hook failed。该对照使用独立 `CODEX_HOME` 和本地静态 Responses 协议响应，不调用真实模型，不代表重新执行了 2048 开发或完成跨 CLI 认证。证据位于 `validation-results/native-hook-1792896538292/`，其中 `old-powershell/io-markers.jsonl` 保存耗时标记，`new-node/events.jsonl` 保存三个实际事件。隔离诊断使用了已审查回调的 Hook trust bypass。本次复验另确认，基线 `src-tauri/src/agent/codex.rs` 本来就会为带 Hook 的会话添加该标志；本次回调修复没有新增或修改这一既有策略，不能据此宣称产品启动命令不含该标志。Hook 信任与工具/工作流审批分别处理。

最新 Windows 回归验证了 npm `.cmd` 参数保真、CMD/PowerShell 两种父进程、特殊路径、中文与大体积 stdin、缺失模块正确失败，日志为 `validation-results/codex-hook-cmd-fix-regression.log`。较宽范围 Hook 测试为 34 通过、2 项手动实验忽略、1 项 OpenCode V2 回放失败；OpenCode 回放在不经过 Codex 新回调的独立 Node 调用中也失败，未将该问题混入本次 Codex 修复。

已运行的 Codex 进程保留启动时的 Hook 配置。需用更新后的 Termexo 创建新会话才会使用新回调；不应为更新回调而中断仍在执行的工作流。

## 2026-10-25 更新桌面复验

重新暂存内置引擎、构建前端和 Windows 桌面后，在独立测试应用中，通过内部 MCP 创建可见的原生 Codex 0.164.0 会话。使用已登录账号和真实模型，限定只读检查，没有修改 2048 项目或启动开发工作流。通用 MCP 保持关闭，启动环境移除系统 Node 路径，Hook 使用内置运行时。

连续两轮分别执行输出标记的命令，实际返回 `TERMEXO_HOOK_RECHECK_OK` 和 `TERMEXO_HOOK_SECOND_OK`。保存的原生终端内容未出现 Hook failed；正常退出 Codex 后，事件记录包含下列生命周期回调：

| 事件 | 次数 |
| --- | --- |
| SessionStart | 1 |
| UserPromptSubmit | 2 |
| PreToolUse | 3 |
| PostToolUse | 3 |
| Stop | 2 |
| SessionEnd | 1 |

会话 terminalId 为 `57437097-a4e8-4833-9d12-f4f57d362300`，Codex sessionId 为 `01a1711c-a86e-7b83-bee5-1e6b06c5c541`。本机证据在 `validation-results/hook-desktop-recheck/`：`first-turn-inspection.json` 与带时间戳的 `inspection-*.json` 保存终端快照，`events.json` 保存事件列表。最终 `inspection.json` 是正常退出后的 PowerShell 状态。

复验还发现，在 Codex 额度/模型菜单中确认“保持当前模型”后，Termexo 会把 Enter 误判为新任务，显示“思考中”。已调整已空闲/已完成 Codex 会话的非审批菜单判断，并增加捕获画面的回归用例；状态相关两组测试共 29 项通过。普通输入提交和进行中的审批判断保持原有行为。

上述状态修正随后重新完成前端和桌面构建，并重新打开测试应用。实际加载的 `main-GU7GHHP7.js` SHA-256 与本次构建一致；`final-window.json` 和 `latest-test-window.png` 保存最终面板证据。两轮真实模型交互验证的是相同 Hook 实现；菜单状态修正由回归测试覆盖，没有再调用模型复测该菜单。

日志：`validation-results/codex-hook-recheck-ui-tests.log`、`codex-hook-recheck-ui-build.log`、`codex-hook-desktop-recheck-final-build.log`。构建成功，仍有现有体积和未使用字段警告。

2048 原工作流 `c9aef677-ef7c-4440-bafd-da7d974d5764` 仍为 `BLOCKED`、r7，原因是先前交互 Worker 超时，且状态中仍有待确认的进程终止。本次仅复验回调和状态显示，没有恢复该工作流、完成游戏功能验收或确认交付。

### 再次启动后的连续交互

2026-10-25 14:25，再次检查时应用已经退出，随后重新启动上述最新构建，创建可见的 `One Ring · 重启复验（只读）` 会话。真实 Codex 连续两轮完成相同命令与应答标记，没有 Hook failed 或 hook timed out；事件包含 SessionStart 1 次、UserPromptSubmit 2 次、工具前后各 3 次、Stop 2 次。界面最终显示“空闲”，原生 CLI 为 Ready，会话保留在前台供接管，所以本次未触发 SessionEnd。

terminalId：`0fe36282-fc1a-494a-9fdc-4818e7ff90e9`，sessionId：`01a171bc-41f8-7122-8c08-a3bd35b0beb1`。内置 Node 为 v24.15.0、通用 MCP 仍关闭、内部 MCP 可创建/检查会话，实际加载前端的哈希与最新构建一致。原 2048 工作流仍为 BLOCKED r7，项目文件状态与复验前一致。

证据位于 `validation-results/restart-20261025/`，包含 `events.json`、两轮 `inspection-*.json`、`desktop-summary.json` 与 `restart-two-turns.png`。本轮没有源代码变更，未重复构建或运行单元测试。

### 三个开发目录的关系

这三个目录由同一个 Git 仓库通过 worktree 管理，共享 Git 历史，文件内容各自独立：

| 目录 | 分支 / 当前提交 | 用途与保留原因 |
| --- | --- | --- |
| `Termexo` | `main` / `771d5bf` | 主工作目录；有四个本地测试文件改动，需保留。 |
| `Termexo-one-ring-validation` | `fix/one-ring-windows-tests` / `b3258c5` | 旧验证工作目录；提交已被 main 包含，没有独有提交，但仍有未跟踪的 `validation-results/` 报告与日志。归档这些记录后可以移除 worktree。 |
| `Termexo-windows-worker` | `feat/windows-worker` / `771d5bf`，另有未提交改动 | 当前内置引擎、交互 Worker、Hook 修复的开发工作目录；这些最新改动尚未合入 main，不能直接删除。 |

One Ring 的内置源码位于当前开发工作目录的 `packages/one-ring/`；旧验证 worktree 不再是运行依赖。当前测试 EXE 放在主目录的共享 Cargo target 下，是构建输出位置，不代表主分支源代码已包含这些改动。后续可将开发改动提交并合入主分支、归档验证记录，再通过 Git worktree 移除临时目录；本轮仅检查关系，没有删除目录或改动分支。

## 2026-10-25 交互 Worker 终止核对与恢复

用户随后在真实协调会话中复现了恢复失败。前述两轮 Hook 测试没有覆盖此路径：旧实现只会自动核对 `windows-job-v1` 的停止凭据；`termexo-interactive-v1` 超时后即使其 CLI 会话已经关闭，`pendingStop=true` 仍会永久保留，恢复与结束操作均被阻止。

修复后，交互 Runtime 通过内部 MCP 请求特定 terminalId 的状态。桌面层先查询后端的终端进程清单；即使 UI 记录已经移除，也能返回明确的停止确认。只缺少 UI 记录、会话仍在运行、会话身份不匹配、查询失败或断连时，不视为确认。原生界面处于 Ready/空闲也不等于已停止。

`one_ring_status`、恢复确认前和 `one_ring_stop` 会进行核对；异步检查期间若工作流版本或最后一次运行变化，不应用过期结果。确认后保留部分文件、刷新工作区快照、释放执行租约，将 UNKNOWN/RUNNING 调整为 INTERRUPTED，继续停在 BLOCKED 等待新的人工决定。孤立交互运行也不再因为缺少 childPid 被误判为已停止。

面板明确提示已停止的 Worker 可通过协调会话恢复或结束；已移除的 CLI 不再提供无效的打开按钮，执行记录仍保留。

验证结果：

- 引擎测试 36 通过、2 项 POSIX 测试跳过，包含交互停止确认、执行租约、未批准不启动、异步核对过期和身份不匹配等覆盖。
- 桌面 MCP 与 One Ring 面板两组前端测试共 33 通过。
- 内置引擎类型检查/构建、前端生产构建和 Windows 桌面构建通过，保留现有构建警告。
- 对用户的真实 2048 工作流 `c9aef677-ef7c-4440-bafd-da7d974d5764` 使用本次打包引擎和桌面内部 MCP 核对：旧 terminalId `53bfa8e5-a993-4ec1-bc2a-69d97899a4fd` 返回 `live=false, stoppedConfirmed=true`。工作流从 r7 进入 r8，`pendingStop=false`，原 Worker 为 INTERRUPTED。
- 实际调用恢复决定工具成功取得版本化确认请求；诊断客户端明确拒绝，没有代用户批准。确认后运行数和审批数不变，阶段仍为 BLOCKED，证明现在可请求恢复而不会自动启动工作。

证据位于 `validation-results/interactive-recovery-live/`：`before-workflow.json`、`reconciled-workflow.json`、`resume-review.json`、`summary.json` 与最终桌面快照。此处的恢复确认请求是 MCP 协议验证，不宣称向原生协调 CLI 展示并接受了表单。游戏功能与完整恢复后的交付仍需通过实际协调会话继续；本次没有删除旧工作流或修改游戏源码。

## 后续 OpenCode 与动态模型接入

同日后续增加 OpenCode 2 实施者、独立 Codex 验证、实施者 CLI/模型共同选择，修复 OpenCode 安装脚本被跳过及 Codex 默认模型被旧内置 Profile 覆盖的问题。当前角色与实际验证范围以 [OpenCode 与模型验证记录](opencode-worker-validation.md) 为准；其中明确区分真实模型的额度失败与成功的本地受控协议链路。
