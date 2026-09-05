# Termexo 远程访问工作台 — 实施计划

## Context

Termexo 是 Windows 本地桌面应用（Tauri 2 / Rust 壳 + Angular 22），把 Claude Code / Codex 等
AI 编码终端放在一个工作台里管理。用户希望**在别的设备（手机、另一台电脑）的浏览器里打开
同一个工作台**：看到同样的工作空间和终端、实时交互 PTY、改设置，与桌面窗口共享同一批进程
和同一份 SQLite 数据。

现状：前端约 60 处 `invoke()` 集中在 7 个 service，事件只有 `terminal-output` / `terminal-exit`；
每个 service 都用 `isTauriRuntime()` 在「Tauri 后端」与「浏览器预览兜底」间切换。
Tauri 2.11.5 公开了 `AppHandle::invoke_key()` 与 `Webview::on_message()`（已核对源码：可跨线程
调用，同步命令在调用线程回调、异步命令在 tokio 上回调），因此远程请求可以**复用现有命令表**
而不必手写第二套分发器。

详细设计（协议、数据结构、模块划分）已写在 `docs/architecture/remote-access.md`
（本次会话在 plan mode 之前落盘）。实施时需按本文「设计文档修订」一节同步修改它。

## 方案要点

1. **Rust 内嵌 axum 服务**（新模块 `src-tauri/src/remote/`）：静态资源来自 `app.asset_resolver()`，
   `/ws` 承载 invoke 与事件推送，`/api/health` 仅版本。
2. **invoke 复用**：`InvokeRequest` → 主窗口 `WebviewWindow::on_message` → oneshot 回传。
   `request.url` 用常量 `http://tauri.localhost/`（Windows）/ `tauri://localhost/`，不调
   `Webview::url()`（它会阻塞等主线程往返）。
3. **远程命令白名单**：核对发现应用命令在本地 origin 下不查 ACL，所以 `bridge.rs` 维护显式
   `REMOTE_COMMANDS` allowlist + 单测（`include_str!("../lib.rs")` 提取 `generate_handler!` 里全部
   命令名，断言每个都被归类）。拒绝：`plugin:*`、`update_via_npm`、`open_release_page`、
   `show_desktop_notification`、`write_handoff_document`、`read_handoff_document`、
   `write_network_profile_export`、`import_network_profiles`、`update_remote_access_settings`、
   `regenerate_remote_access_token`（远程只能查看远程访问状态，不能改）。
4. **事件转发**：`RemoteEventHub`（`tokio::sync::broadcast`，容量 2048，预序列化帧）。
   `terminal-output` / `terminal-exit` 由 `PtyManager` 持有的 `Arc<RemoteEventHub>` **直推**
   （与 sequence 分配同一临界区，避免 `listen_any` 的 `try_lock`+pending 乱序）；
   `workspace-changed` / `workspace-deleted` / `agent-events` 由命令处理器用统一 helper
   `remote::broadcast_event(&app, &hub, name, &payload)`（`app.emit` + `hub.publish`）发出。
5. **前端传输适配层** `core/services/backend-bridge.ts`：同形 `invoke`/`listen`，
   按 `runtimeMode()`（desktop / remote / preview）分流；service 只改导入。
   `remote-bridge-client.ts` 用动态 `import()` 仅在 remote 模式加载（initial bundle 距 warning 线
   仅约 25 kB）。
6. **鉴权**：随机令牌（keyring 保存），URL fragment 携带，WS 首帧鉴权（5 s 超时），
   来源 IP 失败锁定（10 分钟 5 次），`Origin`/`Host` 与服务自身一致，服务端 60 s 无帧关闭。
7. **默认自签名 HTTPS**（可关）：否则远程页面处于非安全上下文，`crypto.randomUUID`、
   剪贴板、通知不可用。`rustls::crypto::aws_lc_rs::default_provider().install_default()`
   放在 `run()` 开头。
8. **两端状态同步**：`save_workspace` / `delete_workspace` 带 `originId` 发事件；远程端启动走
   「附着」；PTY 增加按块淘汰的回放缓冲（≤256 KiB）+ `sequence`，附着时回放。
   `sync_agent_events` 改为保存后广播 `agent-events`，两端都只通过事件应用 hook 事件
   （返回值不再直接用于状态更新），解决一次性消费被抢的问题。
9. **设置 UI**：设置对话框新增「远程访问」标签页（独立组件，`@defer`），远程模式有令牌门与
   连接徽标。

## 后端改动（src-tauri）

新增
- `src/remote/mod.rs` — `RemoteAccessManager`（托管状态）：设置缓存、令牌、服务生命周期
  （`std::net::TcpListener::bind` + `set_nonblocking(true)` → `axum_server::from_tcp` /
  `from_tcp_rustls`，`Handle<SocketAddr>`；停止 / 换令牌时先经 `tokio::sync::watch` 通知每个
  WS 任务发 Close(1001 / 4401) 再 `graceful_shutdown(Some(2s))`）、状态快照、`broadcast_event` helper。
- `src/remote/settings.rs` — `RemoteAccessSettings` + 校验 + `app_settings` 表持久化。
- `src/remote/token.rs` — 生成（`getrandom::fill` 32 B → base64url）、`subtle` 常量时间比较、锁定表。
- `src/remote/server.rs` — Router：`/api/health`、`/ws`、静态资源。静态：按扩展名判断，
  有扩展名且 `asset_resolver().get()` 返回 text/html（生产回退产物）→ 404；无扩展名 → index.html；
  `index.html` 注入 `<meta name="termexo-remote" content='{"version":"…","secure":true}'>`；
  `Cache-Control: no-cache`。dev 下不做反代：dist 不存在返回 503 并提示先 `npm run build`。
- `src/remote/bridge.rs` — `dispatch()`（`spawn_blocking` 内调 `on_message`；oneshot `RecvError`
  映射为错误）、`REMOTE_COMMANDS` allowlist + 覆盖性单测、`RemoteEventHub`。
- `src/remote/tls.rs` — `rcgen::generate_simple_self_signed`（SAN：localhost、主机名、本机 IPv4）；
  PEM 持久化到 `<app_data>/remote/`；`RustlsConfig::from_pem` 是 async。
- `src/remote/qr.rs` — `qrcode::QrCode::new` → `to_colors()`/`width()` → SVG path 字符串。
- `src/commands/remote.rs` — `get_remote_access_status`、`update_remote_access_settings`、
  `regenerate_remote_access_token`、`render_remote_access_qr`。
- `migrations/0009_app_settings.sql` — `app_settings(key, value, updated_at)`，幂等。

修改
- `Cargo.toml` — `rust-version = "1.88"`（rcgen 0.14 要求；工具链 cargo 1.97 满足）；
  `axum 0.8 (ws)`、`axum-server 0.8 (tls-rustls)`、`tokio (sync, time, macros)`、`futures-util`、
  `rcgen 0.14 (default-features=false, crypto+pem+aws_lc_rs)`、`qrcode 0.14 (no default)`、
  `if-addrs 0.15`、`getrandom 0.4`、`base64 0.22`、`subtle 2`。加完用
  `cargo tree -e features -i rustls` 复核仍只有 `aws_lc_rs`。
- `database/mod.rs` — 0009 常量 + `open()` 追加执行；`read_app_setting` / `write_app_setting`。
- `pty/mod.rs` — `PtyManager::new(Arc<RemoteEventHub>)`；`OutputHistory { chunks: VecDeque<(u64, Vec<u8>)> }`
  按块淘汰；`spawn_reader` 在同一临界区里分配 sequence、写缓冲、`hub.publish`，再 `app.emit`；
  `TerminalOutputEvent.sequence`；`is_running(id, revision)`；`read_scrollback(id)`。
- `commands/terminal.rs` — `create_terminal` 返回 `TerminalStartResult { attached }`：
  id+revision 都相同 → 直接 `attached: true`（跳过 `take` / `relaunch_environment` / `capture_baseline`）；
  id 相同 revision 不同 → 先 `close` 旧 PTY 再正常启动。新增 `read_terminal_scrollback`
  （返回 `{ data, sequence, runtimeRevision }`，不存在则空）。
- `commands/workspace.rs` — `origin_id: Option<String>` 参数 + `broadcast_event`。
- `commands/hooks.rs` — `sync_agent_events` 保存后非空即 `broadcast_event("agent-events", &events)`。
- `lib.rs` — `install_default()`；`manage(RemoteEventHub)`、`manage(RemoteAccessManager)`、
  `start_if_enabled`；注册新命令；`commands/mod.rs` 加 `remote`。
- `config/mod.rs` — 令牌 target 常量 `remote-access-token`（复用 `CredentialStore`）。

用户可见字符串一律中文（`Result<T, String>` 里的错误直接进 toast）；令牌不进日志。

## 前端改动（apps/desktop-ui/src/app）

基础层（先做，其余都依赖）
- `core/services/tauri-runtime.ts` — `runtimeMode()`（读 `<meta name="termexo-remote">`）、
  `hasBackend()`、`remoteRuntimeInfo()`、`runtimeClientId()`；`isTauriRuntime()` 语义收窄为「有原生窗口」。
- `core/models/remote-access.models.ts` — 设置 / 状态 / 协议帧类型。
- `core/models/identifiers.ts` — `createId()`，替换全部 `crypto.randomUUID()`
  （`app.ts` ×7、`app-state.service.ts` ×2、`todo.service.ts`、`agent-settings-dialog.ts` ×4、`workspace.fixtures.ts`）。
- `core/services/remote-bridge-client.ts` — WebSocket 客户端：socket 工厂作为构造参数（便于测试
  `vi.stubGlobal` / fake），请求 id、事件表、指数退避重连（1s→15s）、每 20 s `ping`、45 s 无帧重连；
  **重连中排队，未授权 / `forget()` 时以「未授权」拒绝队列**。
- `core/services/backend-bridge.ts` — `invoke` / `listen` 门面；remote 分支 `await import()` 客户端。
- `core/services/remote-connection.service.ts` — `state`、`error`、`hasStoredToken` 信号；
  `submitToken` / `forget` / `onReconnected`；令牌来源 `#token=` → `?token=` → localStorage，取到即
  `history.replaceState` 抹掉。
- `core/services/remote-access.service.ts` — 设置面板用的命令封装 + `buildUrl(address, port, tls, token)`。

service 迁移（模式：`@tauri-apps/api/core` 的 `invoke` 换成 `backend-bridge`；只需后端的
`isTauriRuntime()` 改 `hasBackend()`；原生对话框 / 窗口 / 通知插件分支保留 `isTauriRuntime()`）
- 改 `hasBackend()`：`agent.service.ts`（除 `exportNetworkProfiles` / `importNetworkProfiles` 的对话框
  分支外全部）、`workspace.repository.ts`、`prompt-asset.service.ts`、`git.service.ts`、
  `terminal/terminal-font.service.ts`、`terminal-gateway.service.ts`、`update.service.ts`（`check`、
  `startPeriodicChecks`）、`handoff.service.ts`（invoke 分支）、`app.ts:assertTodoAgentAvailable`。
- 保留 `isTauriRuntime()` 并补 remote 兜底：`handoff.service.ts` 的 `save`/`open` 对话框（remote 走
  已有的 blob 下载 / `pickBrowserDocument`）；`update.service.ts` 的 `openReleasePage`（remote
  `window.open`）与 `updateViaNpm`（remote 抛「请在桌面端执行」）；`agent.service.ts` 的网络配置
  导入导出（remote 返回 null，UI 提示在桌面端操作）；`app.ts:loadAppVersion`（remote 读
  `remoteRuntimeInfo().version`）；`desktop-notification.service.ts`（remote 走浏览器 `Notification`）；
  `directory-picker.service.ts`、`window-controls.service.ts` 不改。

行为改动
- `workspace.repository.ts` — `save/delete` 带 `originId`；`watchChanges({ changed, deleted })`。
- `app-state.service.ts` — remote 初始化跳过 `restartRestoredTerminals` 的置 STARTING / 改 command /
  revision+1、跳过 `saveAll` 与默认工作空间；`applyExternalWorkspace` / `removeExternalWorkspace`
  **绝不回写**；remote 下 `selectWorkspace` 不保存 `lastOpenedAt`；重连后 `reloadFromRepository()`。
- `agent.service.ts` — `syncEvents()` 只触发同步；新增 `listen('agent-events')` 应用批次
  （桌面与远程一致）。
- `terminal-gateway.service.ts` — `connect()`：订阅 → 缓存 → `read_terminal_scrollback` →
  以后端返回的 `runtimeRevision`/`sequence` 过滤后放行；`start()` 返回 `{ attached }`；
  `resync` / 重连时写 `\x1b[2J\x1b[H` 后重放。
- `terminal/terminal-panel.ts` — `attached` 且记录状态为 STARTING → RUNNING，其他状态保留；
  `navigator.clipboard?.`。

UI（先调用 `frontend-standard` skill）
- `dialogs/agent-settings-dialog.ts` — `SettingsTab` 加 `'remote'`，标签与 `@case` 内 `@defer` 嵌入
  `dialogs/remote-access-panel.ts`（新组件，注入 `RemoteAccessService`；remote 模式下只读 + 提示）。
  面板内容：启用开关、绑定地址（所有网卡 / 各网卡 IPv4 / 仅本机）、端口、HTTPS 开关、运行状态与
  最近错误、地址列表 + 当前地址的带令牌 URL 与二维码（`<svg><path [attr.d]>`）、令牌显示 / 复制 /
  重新生成（需确认，会断开所有客户端）、安全提示与已知限制。
- `remote/remote-access-gate.ts`（未鉴权 / 连接中 / 重连中的全屏遮罩，可输入令牌）、
  `remote/remote-connection-badge.ts`（顶栏状态徽标）— `app.html` 用 `@defer (when remote)` 挂载。
- `core/i18n/i18n.service.ts` — `settings.tabRemote`、`remote.*` 键，7 种语言表都补。

## 设计文档修订（实施时同步改 `docs/architecture/remote-access.md`）

- 「invoke 分发」：URL 用常量，不调 `Webview::url()`；加 allowlist 段落；oneshot 丢失映射为错误。
- 「WebSocket 协议」：加 `agent-events` 进白名单；加 Origin/Host 校验与服务端空闲超时；
  未授权时拒绝而非排队。
- 「HTTP 路由」：删除 dev 反代；写明 404 规则与 `<meta>` 注入。
- 「PTY 回放缓冲」：按块淘汰；`create_terminal` 的 revision 不一致处理。
- 「状态同步」：`sync_agent_events` 广播；remote `selectWorkspace` 不写盘；整行 last-writer-wins 说明。
- 「安全边界」：明确 ACL 不覆盖应用命令，白名单是唯一防线。

## 执行顺序

0. **先把本计划保存进仓库**：`docs/architecture/remote-access-plan.md`（原样复制本文），并按
   「设计文档修订」一节修改 `docs/architecture/remote-access.md`。这一步不改任何代码，
   完成后再进入下面的并行实施；用户若只需要文档，可在此处叫停。

## 并行拆分

1. Rust 后端（一个 agent）：「后端改动」全部 + `cargo test` + `cargo tree` 复核。
2. 前端基础层 + service 迁移 + 行为改动（一个 agent）：不碰 i18n、dialogs、app.html。
3. 前端 UI（一个 agent）：设置面板、门、徽标、i18n、app.html；依赖基础层的类型与
   `RemoteConnectionService` / `RemoteAccessService` 的公开 API（设计文档已定义）。

文件归属互不重叠；协议以（修订后的）设计文档为准。

## 验证

- Rust：`cargo test --manifest-path src-tauri/Cargo.toml`（token 锁定、设置校验、QR path、meta 注入、
  静态 404 规则、回放缓冲淘汰、allowlist 覆盖性、本地 URL 常量被 `is_local_url` 接受）；
  `npm run tauri:build` 能链接。
- 前端：`npm test`（bridge client 假 socket 测试：鉴权、排队 / 拒绝、重连退避、事件分发；`createId`；
  `AppStateService` 外部变更应用且不回写；gateway 回放顺序与 sequence 过滤；runtimeMode 检测）；
  `npm run build` 不触发预算警告。
- 端到端：`npm run tauri:dev`（先 `npm run build` 产出 dist）→ 设置 → 远程访问 → 启用 →
  本机另一浏览器打开 `https://<本机IP>:7420/#token=…`：接受证书警告 → 看到同样的工作空间 →
  远程新建终端，桌面端立刻出现；桌面终端输入，远程实时可见；远程刷新页面后终端内容回放；
  重新生成令牌后远程被踢回令牌门；关闭远程访问后端口释放；用错误令牌连续 5 次后被锁定。
- 用 Chrome MCP 对远程页面截图并检查控制台（无 `randomUUID` / clipboard / WebSocket 报错）。

## 已知限制（写进设置面板提示与文档）

- PTY 单一尺寸，最后一次 resize 生效。
- Todo 面板仍在各浏览器 localStorage。
- 远程不能改远程访问设置、不能做需要原生文件对话框的导入导出、不能触发 npm 自更新。
- 自签名证书需在设备上确认一次；令牌等同本机 Termexo 完整控制权，仅在可信网络使用。


