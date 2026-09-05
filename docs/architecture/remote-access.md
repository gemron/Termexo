# Termexo 远程访问（Remote Access）设计

## 目标

在桌面端 Termexo 运行时，允许同一局域网 / VPN（Tailscale、WireGuard 等）内的任意浏览器
（手机、平板、另一台电脑）打开**完整的工作台界面**：工作空间、终端实时输入输出、Agent
状态、Git 视图、设置对话框，与桌面窗口看到的是同一份数据、同一批 PTY 进程。

不做的事（本版本明确不做）：多用户 / 权限分级、公网穿透、每个客户端独立的 PTY 尺寸、
Todo 面板同步（Todo 仍在各浏览器的 localStorage 里）。

## 总体架构

```
┌──────────────── termexo.exe (Tauri / Rust) ────────────────┐
│                                                            │
│  Tauri 命令表 (generate_handler!)  ◄──── 桌面 WebView IPC   │
│          ▲                                                 │
│          │ Webview::on_message(InvokeRequest)              │
│          │                                                 │
│  remote::bridge::dispatch ◄──── remote::server (axum)      │
│          │                          │  GET /            静态资源（嵌入的 Angular 产物）
│          │                          │  GET /ws          WebSocket：invoke + 事件推送
│          │                          │  GET /api/health  无鉴权，仅版本信息
│  PTY / 命令 helper ──────────► RemoteEventHub ──► 每个 WS 连接 │
└────────────────────────────────────────────────────────────┘
                       ▲ https://192.168.x.x:7420/#token=…
                       │
        手机 / 另一台电脑上的浏览器（同一份 Angular 应用，runtimeMode() === 'remote'）
```

核心思路：**不写第二套后端**。远程请求到达 Rust 后，构造 `tauri::webview::InvokeRequest`
并调用主窗口 `Webview::on_message`，走与桌面 WebView 完全相同的命令表、参数反序列化和
参数校验。应用命令在本地 origin 下不受 ACL 保护，远程调用必须先经过显式命令白名单。
后端事件由 PTY 直接发布或通过 `broadcast_event` helper 发给桌面和远程连接。前端只在最底层加
一个传输适配层，业务 service 不感知自己在桌面还是远程。

## 后端（src-tauri）

### 模块布局

```
src-tauri/src/remote/
  mod.rs        RemoteAccessManager（托管状态）：设置缓存、令牌、服务生命周期、状态快照
  settings.rs   RemoteAccessSettings + 校验 + 通过 app_settings 表持久化
  token.rs      RemoteAuth：令牌生成 / 常量时间比较 / 按来源 IP 的失败锁定
  server.rs     axum Router：静态资源、index.html 注入、/ws、/api/health
  bridge.rs     dispatch()：InvokeRequest → Webview::on_message → oneshot；RemoteEventHub
  tls.rs        自签名证书生成与持久化（<app_data>/remote/cert.pem, key.pem）
  qr.rs         把 URL 编码为 QR 模块矩阵并输出 SVG path 字符串
src-tauri/src/commands/remote.rs   Tauri 命令
src-tauri/migrations/0009_app_settings.sql
```

### 设置与持久化

```rust
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessSettings {
    pub enabled: bool,        // 默认 false
    pub bind_address: String, // "0.0.0.0" | 某个本机 IPv4 | "127.0.0.1"，默认 "0.0.0.0"
    pub port: u16,            // 默认 7420，允许 1024..=65535
    pub tls: bool,            // 默认 true：自签名 HTTPS
}
```

- 保存在新表 `app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`，
  key = `remote_access`，value = JSON。迁移必须幂等（`CREATE TABLE IF NOT EXISTS`）。
- 访问令牌保存在 `CredentialStore`（keyring），target = `remote-access-token`；
  首次启用时生成 32 字节随机数的 base64url（无 padding）。**令牌是唯一允许回传给前端的凭据**
  （设置面板要展示 / 生成二维码），除此之外不得写入日志、hook 载荷、快照。
- 证书：`rcgen::generate_simple_self_signed`，SAN 含 `localhost`、主机名和生成时的全部本机 IPv4；
  PEM 写入 `<app_data>/remote/`，存在且可解析就复用。

### 为什么默认 HTTPS

浏览器只在安全上下文里提供 `crypto.randomUUID`、`navigator.clipboard`、Web Notification。
远程页面以 `http://192.168.x.x` 打开时这些 API 不存在，终端复制粘贴和新建终端都会失效。
自签名证书需要用户在手机上确认一次警告，换来完整功能；`tls: false` 保留给受控环境。

### 服务生命周期

- `RemoteAccessManager::new(app_handle, database, credentials)` 在 `setup` 里创建并 `manage`，
  托管共享的 `Arc<RemoteEventHub>`，供 PTY 与命令 helper 发布事件。
- 设置里 `enabled == true` 则启动时自动 `start()`。
- `start()`：先用 `std::net::TcpListener::bind` 抢占端口（端口占用立即报错并写入 `last_error`），
  设置 `set_nonblocking(true)` 后，再 `axum_server::from_tcp(listener)` / `from_tcp_rustls(listener, config)`，通过
  `tauri::async_runtime::spawn` 运行，`axum_server::Handle` 用于优雅停止。
- `update_settings()`：持久化后按需重启（禁用 → 停止；参数变化 → 停止再启动）。
- `regenerate_token()`：换令牌并断开所有已连接客户端（关闭码 4401）。
- 停止 / 换令牌通过 `tokio::sync::watch` 通知每个 WS 任务先发送 Close（1001 / 4401）；
  停止服务再调用 `graceful_shutdown(Some(2s))`，确保端口释放。
- TLS 提供者：仓库里 rustls 已启用 `aws_lc_rs`（reqwest 引入），服务启动前调用
  `rustls::crypto::aws_lc_rs::default_provider().install_default()`（忽略已安装错误）。

### HTTP 路由

| 路径 | 说明 |
| --- | --- |
| `GET /ws` | WebSocket 升级；协议见下 |
| `GET /api/health` | 无鉴权，仅返回 `{"version":"x.y.z"}` |
| `GET /*` | 静态资源：`app.asset_resolver().get(path)`；无扩展名路径回退到 `index.html`；有扩展名且缺失或得到 HTML 回退产物时返回 404（实际 `index.html` 除外）。dev 不做反代，dist 不存在返回 503，提示先运行 `npm run build` |

`index.html` 在 `</head>` 前注入：

```html
<meta name="termexo-remote" content='{"version":"0.7.0","secure":true}'>
```

所有响应 `Cache-Control: no-cache`。静态资源和 `/api/health` 不鉴权（应用代码本身是开源的），
**所有能触达后端的操作都只经过 `/ws`，并且必须先鉴权。**

### WebSocket 协议（JSON 文本帧）

连接建立后客户端必须在 5 秒内发送鉴权帧，否则服务端关闭连接（4408）。

| 方向 | 帧 |
| --- | --- |
| C→S | `{"type":"auth","token":"…","clientId":"<uuid>"}` |
| S→C | `{"type":"ready","serverVersion":"0.7.0"}` 成功；`{"type":"auth-failed","reason":"…"}` 后关闭（4401） |
| C→S | `{"type":"invoke","id":123,"command":"list_workspaces","args":{…}}`（`args` 可省略，等价 `{}`） |
| S→C | `{"type":"result","id":123,"ok":true,"value":<json>}` 或 `{"type":"result","id":123,"ok":false,"error":<json>}` |
| S→C | `{"type":"event","name":"terminal-output","payload":{…}}` |
| S→C | `{"type":"resync"}` 该连接消费过慢导致事件被丢弃，客户端应重放终端回放缓冲 |
| C→S / S→C | `{"type":"ping"}` / `{"type":"pong"}` 客户端每 20 秒发一次；45 秒无任何帧则客户端重连 |

- `invoke` 的 `args` 键名与桌面端 `invoke()` 完全一致（camelCase），服务端原样放进
  `InvokeBody::Json`，由 Tauri 的命令宏做反序列化。
- 所有命令必须属于 `REMOTE_COMMANDS` 白名单；未归类命令和 `plugin:*` 一律拒绝，
  返回 `ok:false, error:"该命令不支持远程调用"`。
- 事件白名单 `REMOTE_EVENTS = ["terminal-output", "terminal-exit", "workspace-changed", "workspace-deleted", "agent-events"]`。
  PTY 在分配 sequence、写入回放缓冲的同一临界区里调用 `hub.publish`，然后 `app.emit`；
  其他事件使用 `remote::broadcast_event(&app, &hub, name, &payload)`。
  预序列化帧经 `tokio::sync::broadcast`（容量 2048）广播；`Lagged` 时发送 `resync`。
- 升级连接前校验 `Origin` / `Host` 与服务自身地址、端口和协议一致；服务端 60 秒无帧关闭。
- 鉴权失败锁定：同一来源 IP 10 分钟内失败 5 次后，再锁定 10 分钟；令牌比较使用
  `subtle::ConstantTimeEq`。
- 状态里维护 `connected_clients` 计数。

### invoke 分发（bridge.rs）

```rust
pub async fn dispatch(app: &AppHandle, command: String, args: Value) -> Result<Value, Value>
```

1. `app.get_webview_window("main")` → `AsRef<Webview>` 克隆出 `Webview`。
2. 构造 `InvokeRequest { cmd, callback: CallbackFn(0), error: CallbackFn(0), url: <本地常量 URL>, body: InvokeBody::Json(args), headers: HeaderMap::new(), invoke_key: app.invoke_key().to_string() }`。
   Windows 使用 `http://tauri.localhost/`，其他平台使用 `tauri://localhost/`；禁止调用
   `Webview::url()`，避免阻塞等待主线程。
3. 在 `tauri::async_runtime::spawn_blocking` 里调用 `webview.on_message(request, Box::new(responder))`，
   responder 把 `InvokeResponse` 送进 `tokio::sync::oneshot`：
   `Ok(InvokeResponseBody::Json(s))` → `serde_json::from_str`；`Ok(Raw(bytes))` → 数字数组；
   `Err(InvokeError(v))` → `Err(v)`。
4. 主 WebView 不存在（窗口已关）→ `Err("桌面窗口不可用")`。
5. oneshot `RecvError` 映射为中文错误，不 panic。

`REMOTE_COMMANDS` 是应用命令的远程安全边界。明确拒绝 `plugin:*`、`update_via_npm`、
`open_release_page`、`show_desktop_notification`、`write_handoff_document`、
`read_handoff_document`、`write_network_profile_export`、`import_network_profiles`、
`update_remote_access_settings`、`regenerate_remote_access_token`。
覆盖性测试从 `include_str!("../lib.rs")` 的 `generate_handler!` 提取命令，要求每项明确归类。

### 新增 / 修改的命令

| 命令 | 说明 |
| --- | --- |
| `get_remote_access_status() -> RemoteAccessStatus` | 设置 + 运行状态 + 地址列表 + 令牌 + 连接数 |
| `update_remote_access_settings(settings) -> RemoteAccessStatus` | 校验、持久化、按需重启 |
| `regenerate_remote_access_token() -> RemoteAccessStatus` | 换令牌并踢掉所有客户端 |
| `render_remote_access_qr(url: String) -> QrCodeImage` | `{ path: "M0 0h1v1H0z…", size: 33 }`，前端用 `<svg viewBox="0 0 size size"><path d>` 渲染，不经 innerHTML |
| `read_terminal_scrollback(terminal_id) -> TerminalScrollback` | `{ data, sequence, runtimeRevision }`；终端不存在时返回空 data、sequence 0 |
| `create_terminal(request) -> TerminalStartResult` | 返回 `{ attached: bool }`；id 和 revision 均一致且运行中直接附着，跳过环境消费、环境重建、Git 基线；同 id 不同 revision 先关闭旧 PTY 再启动 |
| `save_workspace(workspace, origin_id: Option<String>)` | 保存后 `app.emit("workspace-changed", { workspace, originId })` |
| `delete_workspace(workspace_id, origin_id: Option<String>)` | 删除后 `app.emit("workspace-deleted", { workspaceId, originId })` |

```rust
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessAddress { pub address: String, pub interface_name: String, pub loopback: bool }

#[serde(rename_all = "camelCase")]
pub struct RemoteAccessStatus {
    pub settings: RemoteAccessSettings,
    pub running: bool,
    pub error: Option<String>,          // 最近一次启动失败原因（中文）
    pub addresses: Vec<RemoteAccessAddress>, // 本机全部 IPv4（含 loopback，前端自行分组）
    pub token: String,                  // 空字符串表示尚未生成
    pub connected_clients: u32,
}
```

### PTY 回放缓冲

`PtyManager` 为每个终端维护 `OutputHistory { chunks: VecDeque<(u64, Vec<u8>)>（总计上限 256 KiB） }`：
按完整块淘汰；`spawn_reader` 每读到一块输出，在同一临界区分配递增的 `sequence`、写缓冲、
向 hub 发布，再向桌面 emit，避免回放与实时流乱序。
`terminal-output` 事件新增 `sequence` 字段（桌面端忽略）。`read_terminal_scrollback`
返回缓冲的 UTF-8（lossy）内容和**已包含的最后一个 sequence**，客户端据此丢弃重复的实时事件。
终端关闭时随 `PtyProcess` 一起移除。

## 前端（apps/desktop-ui）

### 运行模式

`core/services/tauri-runtime.ts`

```ts
export type RuntimeMode = 'desktop' | 'remote' | 'preview';
export function runtimeMode(): RuntimeMode;      // __TAURI_INTERNALS__ → desktop；meta[name=termexo-remote] → remote；否则 preview
export function isTauriRuntime(): boolean;       // 仅 desktop：原生窗口 / 对话框 / 通知插件可用
export function hasBackend(): boolean;           // desktop || remote：invoke 可用
export function remoteRuntimeInfo(): { version: string; secure: boolean } | null;
export function runtimeClientId(): string;       // 每次页面加载生成一次，作为 originId
```

`isTauriRuntime()` 的语义收窄为「有原生窗口」，凡是只需要后端命令的判断一律改用 `hasBackend()`。

### 传输适配层

`core/services/backend-bridge.ts` 导出与 Tauri 同形的 `invoke` / `listen`：

```ts
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
export interface BackendEvent<T> { event: string; payload: T }
export function listen<T>(event: string, handler: (event: BackendEvent<T>) => void): Promise<UnlistenFn>;
```

- desktop → `@tauri-apps/api/core` / `@tauri-apps/api/event`
- remote → `RemoteBridgeClient`（`core/services/remote-bridge-client.ts`）：WebSocket、请求 id 计数、
  事件订阅表、指数退避重连（1s→2s→…→15s）、`ping`。`invoke` 在持有令牌的连接 / 重连中排队；
  未授权或 `forget()` 时以 `未授权` 拒绝队列；连接断开时正在进行中的请求以 `连接已断开` 拒绝。
- preview → `invoke` 拒绝（`仅桌面应用可用`），`listen` 返回空的 unlisten。

所有 service 把 `import { invoke } from '@tauri-apps/api/core'` 换成从 `backend-bridge` 导入。

`core/services/remote-connection.service.ts`（Angular，给 UI 用）：

```ts
readonly mode: RuntimeMode;
readonly state: Signal<'idle' | 'connecting' | 'authenticating' | 'ready' | 'reconnecting' | 'unauthorized'>;
readonly error: Signal<string | null>;
readonly hasStoredToken: Signal<boolean>;
submitToken(token: string): void;   // 存入 localStorage['termexo.remote.token'] 并重连
forget(): void;                     // 清除令牌并断开
onReconnected(handler: () => void): () => void; // 重连成功后触发（首次连接不触发）
```

令牌来源优先级：URL fragment `#token=…` → URL query `?token=…` → localStorage。从 URL
取到后立即 `history.replaceState` 抹掉。

### 状态同步（两个客户端看同一份数据）

- `WorkspaceRepository.save/delete` 传 `originId: runtimeClientId()`；新增
  `watchChanges({ changed, deleted })` 订阅 `workspace-changed` / `workspace-deleted`，忽略
  `originId === runtimeClientId()` 的回声。
- `AppStateService.initialize()`：
  - desktop：保持现状（重启已恢复的终端、无数据时建默认工作空间、saveAll）。
  - remote：**附着**——直接使用数据库里的工作空间，不改 `runtimeRevision`、不改状态、
    无数据时保持为空、不 saveAll。
  - 两种模式都订阅变更：`applyExternalWorkspace(workspace)`（替换或追加后按 sortOrder 归一）、
    `removeExternalWorkspace(id)`（活动工作空间被删则切到相邻的）。
  - 外部变更应用绝不回写；remote `selectWorkspace` 不保存 `lastOpenedAt`。
  - remote 重连成功后整体 `reloadFromRepository()`。
- 终端状态（`TerminalSession.status`）随工作空间 JSON 一起传播，远程端因此能看到桌面端
  由 hook 事件推导出的状态。`sync_agent_events` 保存后广播非空 `agent-events` 批次；
  桌面和远程仅通过该事件应用新 hook 事件，命令返回值不再直接更新状态，避免一次性消费竞争。
- 工作空间使用整行 last-writer-wins；并发编辑同一工作空间时最后保存覆盖先前结果。

### 终端附着与回放

`TerminalGatewayService.connect()`（hasBackend 时）：订阅 `terminal-output` → 期间事件先缓存 →
`read_terminal_scrollback` → 校验 `runtimeRevision` 一致后把 `data` 交给 `onOutput` → 按
`sequence > replayed.sequence` 放行缓存的事件 → 之后直通。`start()` 返回 `TerminalStartResult`，
`TerminalPanelComponent` 在新启动或附着记录仍为 STARTING 时置为 RUNNING；附着时其余状态保留。
随后的 `fitTerminal → resize_terminal` 会让 TUI 型 Agent 整屏重绘。
收到 `resync` 或重连成功时：对每个已连接终端写入清屏序列 `\x1b[2J\x1b[H` 后重新回放。

已知限制：PTY 只有一个尺寸，最后一次 `resize_terminal` 生效；手机上打开终端会把桌面端的
同一终端改成手机的列数，回到桌面后重新 fit 即恢复。

### 非安全上下文兜底

- `core/models/identifiers.ts` 提供 `createId()`：`crypto.randomUUID?.() ?? 由 getRandomValues 拼出的 v4 UUID`；
  所有 `crypto.randomUUID()` 调用点改用它。
- 终端右键复制 / 粘贴：`navigator.clipboard?.…`，不可用时静默。
- 桌面通知：remote 模式改走浏览器 `Notification` API（需权限），不闪任务栏。
- 目录选择：remote 沿用现有的 `window.prompt` 兜底（与 preview 相同）。
- 版本号：remote 从 `remoteRuntimeInfo().version` 读取。

### UI

- 设置对话框新增「远程访问」标签页（`SettingsTab` 加 `'remote'`），内容是独立组件
  `dialogs/remote-access-panel.ts`，自行注入 `RemoteAccessService`：
  - 启用开关、绑定地址（所有网卡 / 各网卡 IPv4 / 仅本机）、端口、HTTPS 开关；
  - 运行状态与最近错误；访问地址列表（按当前选中的地址生成带令牌的 URL + 二维码）；
  - 令牌：显示 / 复制 / 重新生成（重新生成需要确认，会断开所有客户端）；
  - 安全提示：仅在可信网络使用、自签名证书需要在设备上确认一次、令牌等同密码。
- 远程模式专有组件（`remote/`）：
  - `RemoteAccessGateComponent`：未鉴权 / 连接中 / 重连中的全屏遮罩，可输入令牌；
  - `RemoteConnectionBadgeComponent`：顶栏里的连接状态徽标（仅 remote 模式渲染）。
- 顶栏窗口按钮在 remote 下自动隐藏（`WindowControlsService.available === false`）。

## 安全边界

- 只在用户显式启用后监听；默认绑定 `0.0.0.0` 但默认关闭。
- 令牌等同于本机 Termexo 的完整控制权（能在项目目录里启动 Agent），设置面板必须写明。
- 静态资源无鉴权，但所有命令必须经过鉴权后的 WebSocket 与显式白名单。
  本地 origin 的应用命令不由 Tauri ACL 保护，命令白名单是唯一的命令授权防线。
- 远程不能修改远程访问设置、执行原生文件导入导出或触发 npm 自更新。
- 令牌不进日志；`tracing` 只记录来源 IP、命令名和耗时。

## 后续可选项

- Tailscale 证书 / 用户自备证书；
- 按连接客户端取最小尺寸（tmux 风格）避免尺寸互相覆盖；
- Todo 面板迁入 SQLite 以便同步；
- 面向手机的紧凑布局。
