# Windows Worker 接入与验证

后续的前台原生 CLI 改造与验证见 [交互 Worker 预览](interactive-worker-validation.md)。本文记录的是先前后台 Worker 执行模式。

日期：2026-10-24。Termexo 基线 `771d5bf`，One Ring 基线 `c245d20`。两仓库的实现分支均为 `feat/windows-worker`，改动尚未提交、合并或推送。

## 结果

| 检查 | 本机结果 |
| --- | --- |
| Windows / Node 24.22.1 / Codex 0.164.0 | 真实执行、独立验证闭环通过，2 个不同 Worker 会话 |
| Codex 原生沙箱 | read-only 拒绝项目写入；workspace-write 允许项目写入；两者拒绝指定的用户目录外部文件写入 |
| Windows Job Object 生命周期 | 7 项通过，包含取消、超时、父进程退出后清理后代、强杀 supervisor、MCP owner 消失 |
| One Ring 全量自动化 | 28 通过，0 失败，2 项 POSIX 专用测试跳过 |
| Termexo 接入相关测试 | 3 文件、17 项全部通过 |
| Termexo 生产构建 | 通过；现有初始包及 3 个样式预算警告 |
| OpenCode 2.1.4 | 真实 Windows CLI、JSON 事件、本地模拟模型响应和 Job 回收通过 |
| Pi 1.4.0 | 真实 Windows CLI、JSON 事件、本地模拟模型响应和 Job 回收通过 |

Codex 闭环测试使用隔离的 retry-policy Git 测试项目，Implementer 修改代码、测试和 README，Verifier 独立执行测试并返回 PASS。工作流 `853f1ca8-8445-421f-9047-a003dcf82a32` 最终为 COMPLETED。人工确认由明确限定该测试项目的测试客户端模拟；不能视为 Windows PTY 中真实用户确认已经验证。

## 实现

- One Ring 将 npm 的 `codex.cmd` 解析为包内原生 `codex.exe`，Worker 参数不经 cmd.exe 拼接。
- PowerShell 加载本地 C# supervisor，通过 CREATE_SUSPENDED 创建 Worker，先加入 kill-on-close Job Object，再恢复主线程。
- supervisor 监视取消信号和 MCP owner；正常退出也会清理 Job 中仍存活的后代。
- 只有确认 Job 活跃进程为零后写停止凭据。强杀 supervisor 导致缺少凭据时，运行仍记录为未知停止，保留执行锁。
- 状态查询可在孤儿 Job 的停止凭据到达后解除 pendingStop，但继续执行仍需新的人为确认。
- Termexo 只为 `win32` 且明确声明 `workerExecution.supported=true`、包含 `codex`、`lifecycle=windows-job-v1` 的插件开放启动。旧插件和未知生命周期实现仍禁用。

## 本机目录与日志

- Termexo：`C:\Users\WYH\Desktop\workspace\Termexo-windows-worker`。
- One Ring：`C:\Users\WYH\Desktop\workspace\one-ring-validation-plugin`。
- Termexo 日志：`validation-results/windows-worker/`。
- One Ring 单测：`.one-ring/windows-final-tests.log`。
- 生命周期测试：`.one-ring/windows-lifecycle-tests.log`。
- Codex 闭环：`.one-ring/windows-e2e.log` 与 `.one-ring/e2e/1792775762602/`。
- CLI 协议探针：`.one-ring/windows-cli-probes.log` 与 `.one-ring/cli-protocol-probes/1792775967157/`。

## 复现

在 One Ring 仓库使用系统 Node 24+：

```powershell
npm run build
npm test
node --import tsx scripts/windows-preflight.ts
npm run test:e2e
```

最后一个命令会调用真实 Codex 模型并修改隔离测试项目；审批由测试客户端模拟，不用于真实项目。沙箱探针使用 Codex 0.164.0 的命名权限 profile 语法；需要本机原生沙箱可用，本次验证使用已有的 elevated 配置，未修改用户全局配置。

OpenCode / Pi 探针仅向本地测试服务请求模拟响应：

```powershell
npm install --prefix .one-ring/cli-probes --ignore-scripts --no-audit --no-fund @opencode/cli@2.1.4 @earendil-works/pi-coding-agent@1.4.0
node --import tsx scripts/windows-cli-probes.ts
```

桌面连接时，插件目录选 `C:\Users\WYH\Desktop\workspace\one-ring-validation-plugin\plugins\codex`，仍需通过“验证并保存连接”重新读取能力声明。生产构建产物已更新；本次未启动真实 Tauri UI。

## 当前边界

OpenCode 和 Pi 尚未接入 One Ring Worker 调度：还缺各自结构化报告、真实工具执行证据、角色权限及真实模型闭环认证。它们的探针结果不能替代这些认证。其他 Codex 版本、不同 Windows 企业策略、ARM64、Linux 回归以及真实 Windows PTY 审批均未在本轮验证。

设计依据：[OpenAI Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)、[OpenCode CLI](https://opencode.ai/docs/cli/)、[Pi 官方说明](https://github.com/earendil-works/pi)。
