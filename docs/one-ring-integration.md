# One Ring · Termexo 接入预览

> 历史记录：外部插件接入方式已被 [Termexo 内置 One Ring](one-ring.md) 替代。当前用户无需执行下文的独立安装或目录设置步骤。

Termexo 增加独立的 **One Ring** 工作台入口，连接本地 One Ring Codex 插件，读取真实工作流，并在支持的平台上启动 Codex Coordinator。One Ring 仍单独安装；本仓库不包含它的私有引擎。

Windows Worker 适配位于 `feat/windows-worker`，基于已合入 One Ring 的 `main`（`771d5bf`）。需同时使用 One Ring 的 Windows Worker 分支构建插件；旧插件仍保持查询模式。

## 当前能力与边界

| 项目 | 当前行为 |
| --- | --- |
| 插件连接 | 验证 `plugin.json`、构建产物、Skill 和 Node 24+；真实调用 `one_ring_doctor` 后保存配置 |
| 工作流面板 | 按当前项目根目录过滤；显示计划、阶段、运行记录、阻塞原因、逐项证据和验证命令 |
| 状态来源 | MCP `one_ring_list` / `one_ring_status`；不会把终端退出或 PASS 映射为已接受交付 |
| 协调入口 | 在现有 Codex 启动对话框中选择协调会话的账号、模型与推理强度 |
| 会话恢复 | 每个协调终端保存原始连接；恢复及切换账号/模型时重新注入同一 MCP，而不随全局连接设置漂移 |
| 人工决策 | 留在 Codex 交互终端，通过 One Ring 原有 MCP form elicitation；宿主拒绝时保持等待 |
| Windows | 仅当 doctor 声明 `workerExecution.supported=true`、包含 `codex` 且 `lifecycle=windows-job-v1` 时开放启动；旧插件仍禁用 |
| 其他 CLI | 当前 One Ring 只认证 Codex Worker；发现 Claude/OpenCode/Pi 不代表可调度执行 |

Worker 使用 One Ring 批准的 profile；未指定模型时使用 Worker 自身 Codex CLI 的默认模型。Termexo 模型 Profile 的临时 provider/model 覆盖只作用于 Coordinator，**不自动改写 Worker 的 provider/model**。MCP 显式继承所选账号的 `CODEX_HOME` 及代理变量，不把 API Key 写入启动命令。应先在这个账号的 Codex 配置中准备好 Worker 所需模型、provider 和登录状态。

## Windows 验证步骤

需要 Git、Node.js 24+、Codex CLI；编译桌面还需要 Rust MSVC toolchain、WebView2 和 Visual Studio 2022 Build Tools 的 Desktop C++ workload。

已有 Termexo 仓库时：

```powershell
git fetch origin
git switch feat/windows-worker
npm --prefix apps/desktop-ui install
npm run tauri:dev
```

另一个目录准备 One Ring 私有仓库（需要你自己的 GitHub 权限）：

```powershell
git clone https://github.com/wuyh410/one-ring.git
cd one-ring
git switch feat/windows-worker
npm ci
npm run build
```

Termexo 工作区切换到一个 Git 项目的**根目录**，点击顶部 **One Ring**。填写：

- 插件目录：`C:\...\one-ring\plugins\codex`，不是仓库根目录。
- Node：`node` 或 `C:\Program Files\nodejs\node.exe`。
- 状态目录：例如 `C:\Users\you\.one-ring`，放在目标项目以外。若查看已有工作流，必须选原来的状态目录。

点击“验证并保存连接”。预期看到真实版本、Node 版本和 `win32`。新版插件声明 Windows 执行能力后可启动协调会话，旧版仍显示限制。首次连接空状态目录时，工作流为空是正常结果。连接错误应显示原始诊断；不能显示已启动任务。

验证以下行为：

1. 带空格或单引号的插件路径能连接；错误目录、缺失构建产物、Node 低于 24 时显示明确错误。
2. 重启 Termexo 后仍保留连接；切换工作区后只显示该项目的工作流。
3. 无效 Node 路径/插件目录的设置保存失败，原来的有效连接保留。
4. 旧插件在 Windows 上仍禁用任务启动；声明所需能力的新版插件允许启动。普通 Codex 和其他 CLI 的入口仍正常。
5. 远程浏览器可读取桌面已配置的工作流；插件路径只能在桌面端修改。

无需启动桌面，也可以验证相同桥接代码：

```powershell
# 在 Termexo 仓库运行；省略状态目录会创建并清理临时空库。
node scripts/one-ring-smoke.mjs "C:\...\one-ring\plugins\codex"
node --test scripts/one-ring-bridge.test.mjs
```

不要把 Linux 生成的状态库直接拷到 Windows 当作可恢复任务：工作流记录绝对路径、PID、Git 快照和本机运行证据，均属于原主机。

## 协调链路

Termexo 启动的 Coordinator 会为新 Worker 使用真实的 Termexo 原生 CLI 会话；独立插件仍保留后台 Job Object 模式。请先确认所选账号能够使用原生沙箱。交互模式的验证与边界见 [交互 Worker 预览](interactive-worker-validation.md)。在桌面环境中：

1. 连接插件并填写任务目标。
2. 选择 Coordinator 的 Codex 账号和模型。One Ring 会话不启用 Termexo 的自动确认选项。
3. 启动命令只通过当前会话 `-c mcp_servers.one_ring=…` 接入，不修改用户全局 Codex 配置。用 `required=true` 避免连接失败后静默降级。
4. Coordinator 读取状态目录下的任务说明，调用 doctor，创建/检查计划，并请求真实人工确认。未确认时不应修改项目。
5. 返回面板看阶段与证据；回到原协调终端处理计划、修复、恢复和交付确认。

当前集成保留 Codex 原生 form elicitation。若所用交互宿主未显示表单或返回 decline，不应以聊天回复或面板按钮替代审批。Windows PTY 中实际显示/接受表单仍待后续平台适配验证。

## 实现与验证

- `src-tauri/src/one_ring.rs`：连接验证、配置持久化、Coordinator 启动配置与恢复。
- `src-tauri/src/one_ring_bridge.mjs`：内置 Node MCP 查询客户端，无第三方依赖；仅允许 doctor/list/status，不声明 elicitation 能力。
- `apps/desktop-ui/src/app/one-ring/`：延迟加载的独立面板。
- `scripts/one-ring-smoke.mjs`：使用与 Tauri 相同的桥接代码连接真实插件，不调用模型或授权执行。

仅在面板打开时定期刷新列表与所选工作流；doctor 在连接/首次加载时执行，避免每五秒探测所有 CLI。查询有输出和时间上限；状态查询可能触发 One Ring 自身的孤儿进程或过期 PASS 对账，不触发执行审批。

关闭 Coordinator 终端会关闭其 MCP 并中断 Worker；面板查询进程不接管执行所有权。One Ring 工作流不写入旧 Todo 看板，避免旧的“终端完成/已验证”操作越过 One Ring 交付确认。

Windows 原生执行闭环、沙箱角色权限和进程生命周期的本机验证见 [Windows Worker 验证](windows-worker-validation.md)。OpenCode 和 Pi 已通过真实 CLI 配合本地模拟模型的 JSON 协议探针，尚未开放为 One Ring Worker。桌面原生审批和 Worker 终端可视化属于后续扩展。

Codex MCP 配置参考：[OpenAI 官方文档](https://developers.openai.com/codex/mcp/)。
