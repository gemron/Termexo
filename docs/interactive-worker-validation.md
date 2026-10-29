# Termexo 原生交互 Worker 预览

日期：2026-10-24。实现仍在 Termexo 与 One Ring 各自的 `feat/windows-worker` 工作区，未提交或合并。

## 目标与实现

Worker 不再仅以后台 `codex exec` 运行。由 Termexo 的 `agent_session_start` MCP 工具调用既有 Codex 账号、启动配置、真实 PowerShell PTY、终端标签及状态追踪流程；窗口中显示原生 Codex TUI，可以继续输入或接管。任务结束后保留 CLI 会话。

Termexo 启动 One Ring Coordinator 时传递不含令牌的桌面桥接信息。插件据此选择 `TermexoInteractiveRuntime`；独立使用插件时仍保留 NativeRuntime 后台模式。两种模式不能混为同一次验收结果。

One Ring 记录 Worker 的 Termexo terminalId 和原生 sessionId，面板提供“打开 CLI 会话”。`agent_session_inspect` 定位该终端对应的原生只读 transcript；仅有空闲状态或普通“完成”文本不会产生结构化交付。模型报告中的验证命令还须在原生只读沙箱中独立重放，不能仅凭模型自述取得 PASS。

Worker 不自动注入 Termexo 的桌面控制 MCP，避免递归调度。Implementer 使用 workspace-write，Verifier 使用 read-only；原有生命周期 hooks 保留用于界面状态和原生会话绑定。用户账号的其他 Codex 全局功能仍按 CLI 实际配置生效，本轮不宣称清除了所有外部工具。

## 已实际验证

| 检查 | 结果 |
| --- | --- |
| 原生实施者窗口 | 真实 Codex 0.164.0 TUI，独立 terminalId/sessionId，回复只读连接测试后保持可输入 |
| 原生验证者窗口 | 同上，独立会话，read-only 启动策略 |
| One Ring 新 Runtime → Termexo MCP → 原生 Codex → 结构化结果 | 真实往返成功，返回 NATIVE_INTERACTIVE_RUNTIME_OK，CLI 保持开启 |
| 用户接管输入 | 在可见原生 CLI 中通过键盘提交新消息，收到 INTERACTIVE_INPUT_OK |
| 插件单测 | 33 通过、2 项 POSIX 专用测试跳过；最终资源清理调整后，5 项交互 Runtime 测试再次通过 |
| 前端相关测试 | MCP 与 One Ring 面板共 27 项通过 |
| 原生编译、前端生产构建 | 通过，保留已有构建警告 |
| Rust MCP 参数与权限测试 | 2 项通过 |

真实 Runtime 冒烟会话：terminalId `fd2acbbd-ad76-40d0-ab81-cd501f7c87ff`，sessionId `01a16e33-0772-7b70-80cd-76d5f8ff2c0e`。本机结果在 One Ring 仓库 `.one-ring/termexo-interactive-smoke.log` 及 `.one-ring/interactive-runtime-smoke/1792850197046/`。

本次交互测试不修改项目文件、不代替工作流批准，也没有把只读连接测试标记为真实开发任务已验收。此前 duration formatter 的真实任务已由独立实现者和验证者完成，用户实际接受交付后处于 COMPLETED（r11）；那次执行使用的是原后台 Worker 模式。

桌面截图与测试输出：`validation-results/windows-worker-live/`。主要截图为 `interactive-two-worker-tabs.png` 和 `native-user-input-confirmed.png`。

## 目前边界

- 已跑通原生 CLI 的创建、保留、结果取回和用户再次输入；尚未重跑完整的前台模式“计划审批 → 实施 → 独立验证 → 交付审批”开发任务。
- 当前结构化证据适配仅支持 Codex。OpenCode/Pi 的真实 CLI JSON 探针通过，并不表示已支持本交互工作流。
- 验证命令目前限于受支持可执行程序的简单字面 argv；含 Shell 串联、重定向或复杂引号的命令会阻塞，而不会猜测成功。
- 执行中关闭窗口、请求停止、收到额外用户回合或无法确认执行状态时，工作流保留阻塞/执行锁，原生窗口可留给用户检查。完整的跨会话接管与自动恢复策略尚未完成；用户在已结束的 Worker 会话中继续修改项目，仍会使旧验证快照失效。
- 原生 CLI 可以提出自身的工具权限请求，需要在相应窗口处理；工具许可仍不等于 One Ring 计划或交付批准。

## 复现只读连接验证

启动当前构建的独立测试桌面并开启其 MCP 后，在 One Ring 仓库运行：

```powershell
npm run build
node --import tsx scripts/termexo-interactive-smoke.ts <termexo.exe绝对路径> <测试桌面数据库绝对路径> <已添加工作区根目录>
```

该命令会启动真实 Codex 并使用模型，但不创建工作流、不代替任何审批、不修改项目源文件。
