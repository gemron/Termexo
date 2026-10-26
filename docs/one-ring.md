# One Ring · Termexo 内置编排

One Ring 是 Termexo 的内置能力，不再要求用户安装独立插件、获取其他仓库、安装 Node 或填写引擎及状态目录。

## 使用

1. 在 Termexo 中选择一个 Git 项目工作区，打开顶部 **One Ring**。
2. 填写任务目标，选择实施者 CLI（Codex / OpenCode 2），可指定实施者模型；随后选择 Codex 协调者的账号及模型。
3. 在协调会话中审核计划；确认后，One Ring 调度独立的实施及验证会话。
4. 在 Termexo 终端标签之间切换查看或接管 CLI；验证 PASS 后仍需单独确认交付。

Agent CLI 的安装与登录仍由 Termexo 原有 Agent 流程处理。内置引擎不替用户登录模型账号，也不代替计划、修复、恢复或交付确认。当前角色为 Codex 协调者、Codex / OpenCode 2 实施者、独立 Codex 验证者；One Ring 暂不调度其他 CLI。

## 实施者模型如何确定

用户可在面板或协调会话中指定 CLI 和模型。未指定时，协调者通过 `one_ring_worker_models` 查询当前项目的 CLI 模型目录，提出建议和理由。最终计划中的 `implementer.cli`、`implementer.model` 会展示在确认请求中，并计入计划哈希；执行后不能静默更换，改动选择需要重新审阅计划。

OpenCode 实施者必须明确 `provider/model`。Codex 可使用明确模型，或在计划中说明沿用 CLI 配置默认值。协调者和实施者使用独立模型选择；选择协调者模型不代表为实施者选择同一个模型。模型目录可见不保证账号仍有调用额度，实际调用失败会保留服务端错误。

Codex 新会话模型建议通过 CLI app-server 的 `model/list` 动态加载，默认值读取有效配置。未修改的内置旧默认 Profile 会迁移为沿用 CLI 配置；用户手动指定的模型保留。读取失败时仍可手动输入模型 ID。接口见 [Codex App Server 模型目录](https://learn.chatgpt.com/docs/app-server#models)。

## OpenCode 实施与验证

OpenCode 使用 Termexo 的原生前台 CLI 会话，可查看、输入及接管。结果取自 OpenCode 2 的原生 session export，核对 sessionId、实际模型、原生回合结束状态及 JSON 报告；空闲状态或普通完成文字不足以取得结果。改动文件还需与真实工作区差异一致，再由独立 Codex 检查并运行验证命令。OpenCode 实施者使用自身工具权限，Shell 命令仍可能要求在原生窗口确认；不宣称具有 Codex 的操作系统沙箱。

本机已验证原生 OpenCode 调度/回收、受控本地响应下的真实文件修改，以及独立真实 Codex 验证和只读沙箱命令重放。真实 OpenCode 开发任务在本机受到免费额度 429 限制，尚未完成真实模型开发验收。详见 [OpenCode 与模型选择验证记录](opencode-worker-validation.md)。

## 无需用户配置的部分

- 引擎源码随仓库的 `packages/one-ring/` 维护，开发和打包不再依赖外部 One Ring 仓库。
- 安装包与 npm 桌面程序一起携带编译后的引擎、Skill、固定 Node 运行时及授权声明。
- 工作流数据默认放在 Termexo 的应用数据目录。旧接入预览已有的工作流位置会保留，以免升级后丢失记录。
- 内部会话通道自动启动，使用系统凭据存储中的独立令牌和自动端口；用户不必打开通用 MCP 服务或配置端口。
- 通用 AI 操控 MCP 的开关与权限保持独立。内置通道不能修改模型/网络设置或操作旧任务看板。

## 开发与构建

```powershell
npm --prefix apps/desktop-ui install
npm run one-ring:stage
npm run one-ring:test
npm run tauri:build
```

Tauri 的开发和构建入口会自动准备引擎资源。`one-ring:stage` 从本仓库内部源码构建，将资源放入 `src-tauri/vendor/one-ring/`；这些生成资源不纳入 Git。新开发环境缺少内部包依赖时会按照锁文件安装依赖。正常用户不需要运行上述命令。

若包内资源损坏，面板提示检查或修复 Termexo 安装，不会要求用户手动寻找插件或 Node。

本机验证见 [内置集成验证](one-ring-builtin-validation.md)。早期外部插件方案与后台 Worker 验证属于历史记录，不能作为本版本的设置步骤。
