# One Ring 可选 Codex 插件

在 **设置 → Codex 插件 → One Ring** 中连接独立安装的 One Ring，默认关闭。One Ring 保留持续 CLI 会话、逐轮任务结果、文件权限与进程停止确认；Host 决定如何规划和派发任务。Termexo 使用现有终端服务和 PTY 显示 Worker，不打包 One Ring 引擎或 Node.js。

需要包含终端宿主接口和挂断清理修复的 [One Ring 配套提交 `93bc4cb`](https://github.com/wuyh410/one-ring/commit/93bc4cb)，或包含该提交的后续版本。

## 配置与使用

1. 在 One Ring 项目中执行 `npm ci --ignore-scripts` 和 `npm run build`。
2. 在上述设置中选择源码或发行包根目录，填写 Node.js 24+ 的可执行文件路径。Termexo 会尝试从 PATH 自动填入 Node.js 路径。
3. 点击“检查环境”，勾选“启用 One Ring”并保存，然后新建 Codex 终端。
4. 向 Host 提出请求，例如“使用 One Ring 打开一个只读 Worker，分析当前项目”。Worker 默认显示为 Host 所属工作区的独立终端标签。

当前认证环境为 Linux/Codex。首次为一个账号启动 Host 时，会调用 One Ring 的原生安装器，将插件安装到该账号的 `CODEX_HOME`；保留现有模型、登录和其他 MCP 设置。同名 MCP 指向其他安装或缓存过期时会报错，按 One Ring 原生更新流程处理后重开 Host。

Codex 的工具授权仍然生效。首次调用 One Ring 的执行工具可能需要授权；若 Host 设置了 `approval_policy=never`，未获许可的执行工具可能被拒绝。Termexo 不会为插件自动放宽审批或文件权限。Worker 未指定模型时沿用所选账号的 CLI 默认配置，Host 临时选择的模型不会隐式覆盖 Worker。

设置修改对新终端生效。禁用会阻止新的内嵌 Worker，并在 Termexo 新建的受管理 Codex 会话中关闭对应插件；账号中的原生插件保留。已有 Worker 可通过 Host 的 `one_ring_close_worker` 关闭。关闭 Worker 标签会停止其 CLI 会话；关闭 Host 会断开 MCP，触发 One Ring 清理其 Worker。已结束会话的 runner 不会在应用重开时重新执行任务。

## 与内置 MCP 的关系

内置 `termexo-desktop` MCP 提供工作区、终端、任务和设置的操作接口；One Ring 的 `one_ring` MCP 管理 CLI Worker 会话与逐轮任务。两者拥有各自的配置表，启动时只修改对应服务的配置，因此可以同时保留。

Worker 的显示通过认证的本机终端宿主接口接入，复用 Termexo 的工作区、终端标签和 PTY，不要求开启公开的“AI 操控（MCP）”服务。宿主接口仅接受仍在运行的 Host，启动文件必须位于应用数据目录下 `plugins/one-ring/state/sessions` 内。

## 自动测试

常规测试不调用模型：

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

One Ring 项目的 `npm test` 包含终端宿主 PTY、会话关闭、Host 断开及挂断信号的回归测试。

桌面测试需已构建当前分支的桌面程序，并准备好 `tauri-driver` 和 `WebKitWebDriver`。默认程序路径为 `src-tauri/target/debug/termexo`，可通过 `TERMEXO_DESKTOP_BINARY` 覆盖。测试会在需要时启动前端开发服务，并在结束后停止自己启动的服务。

```sh
TERMEXO_ONE_RING_SOURCE=/absolute/path/to/one-ring npm run test:one-ring:desktop
```

该测试自动操作真实设置窗口，使用固定的 MCP Host 测试驱动和真实 Codex Worker，覆盖原生插件安装、并发终端连接、工作区标签、Worker 标签关闭、工作区占用释放、Host 断开清理和插件禁用，不调用模型。

如需验证真实模型任务，可显式启用以下模式。它沿用当前 Codex 账号的默认模型，并消耗该账号额度：

```sh
TERMEXO_ONE_RING_SOURCE=/absolute/path/to/one-ring \
TERMEXO_ONE_RING_REAL_TASKS=1 \
TERMEXO_ONE_RING_OUTPUT=validation-results/one-ring-real \
npm run test:one-ring:desktop
```

真实任务模式让同一个只读 Worker 连续完成随机文件读取和无命令的上下文回忆，检查命令证据、逐轮结果、文件未改变和最终进程停止。测试使用隔离的应用数据及私有账号配置副本，结束后删除复制的登录和配置文件；不改日常账号的插件设置。Host 使用测试驱动，以便自动复验会话协议和 Worker 行为；此测试不验证 Host 模型是否会自主选择 One Ring。

报告和截图默认保存在 `validation-results/one-ring-plugin`，可通过 `TERMEXO_ONE_RING_OUTPUT` 覆盖。
