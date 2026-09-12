# Termexo 中继服务（Relay）设计

## 目标

现有远程访问只能在同一局域网 / VPN 里打开桌面端的工作台（见 `remote-access.md`）。中继服务把
这条路延伸到任意网络：

* 桌面端 Termexo **主动向外**连到一台中继（家里的 NAS、公司服务器、公有云主机），不需要公网
  IP，不需要在路由器上开端口；
* 中继给每台接入的桌面端一个**远程访问地址** `https://relay.example.com/d/<deviceId>/`，手机或
  另一台电脑打开它，看到的就是现在局域网里那份完整工作台（同一份 Angular 应用、同一批 PTY）；
* 桌面端用**中继签发的接入码**或**中继上的用户账号**接入；
* 中继自带**管理页面**：谁在线、哪台设备属于谁、签发 / 撤销接入、审计；
* 中继可以**再往上接一台中继**：办公室里的中继接到公网中继后，办公室里的所有桌面端在公网中继
  上也能访问到，层数不限。

不做的事（本版本明确不做）：不做直连打洞（STUN / ICE），所有流量都经过中继；不替代桌面端自己的
访问令牌——中继只决定「能不能到达这台机器」，「能不能操作它」仍由桌面端的令牌门决定；不做多租户
计费 / 配额；不做手机专用界面；不代理 Termexo 工作台以外的任何服务（它不是通用内网穿透工具）。

## 术语

| 术语 | 含义 |
| --- | --- |
| 设备（device） | 一台接入中继的桌面端 Termexo，或一台下游中继。中继内部用同一张表，`kind = desktop / relay` 区分 |
| 接入码（enrollment code） | 管理员在中继上签发的一次性短码，桌面端用它换取设备凭据 |
| 设备凭据（device credential） | 中继签发、桌面端保存在 keyring 里的长期凭据，用来建立隧道 |
| 隧道（tunnel） | 设备到中继的一条出站 WebSocket 连接，上面多路复用若干条流 |
| 流（stream） | 隧道里的一条双向字节流，承载一条 HTTP/1.1 连接 |
| 入口中继（entry relay） | 浏览器直接访问的那台中继：TLS 终止、路径路由、转发 |
| 上游 / 下游 | 中继 B 主动连到中继 A，则 A 是 B 的上游，B 是 A 的下游 |

## 总体架构

```
 手机 / 另一台电脑的浏览器
   https://relay-a.example.com/d/<deviceId>/#token=…
             │ TLS
             ▼
 ┌──────────── 中继 A（公网，termexo-relay）─────────────┐
 │ /console/*   管理页面（嵌入的 Angular 产物）             │
 │ /api/*       登录 / 用户 / 设备 / 接入码 / 审计         │
 │ /tunnel      设备与下游中继的入站隧道（WS）              │
 │ /d/<id>/*    反向代理：查路由表 → 打开一条流 → 转发     │
 │ 路由表  deviceId → 直连隧道 | 经下游中继 B              │
 └──────────────────────┬──────────────┬─────────────────┘
      出站隧道（B 主动连 A）│              │ 出站隧道（桌面端主动连 A）
                         ▼              ▼
 ┌──── 中继 B（办公室内网）────┐   ┌──── termexo.exe（家里的电脑）────┐
 │ 同一套二进制                │   │ remote::relay::RelayLink        │
 │ 把 A 打开的流按 target       │   │   ├─ 隧道客户端 + 多路复用        │
 │ 原样接到自己的设备隧道       │   │   └─ 每条流 → hyper 服务         │
 └──────────┬─────────────────┘   │          ↓ 同一个 axum Router     │
            │ 出站隧道              │   remote::server（/ws、静态资源） │
            ▼                     │   remote::bridge::dispatch       │
 ┌── termexo.exe（办公室电脑）──┐   └──────────────────────────────────┘
 └────────────────────────────┘
```

核心思路，四条：

1. **中继不认识 Termexo 的协议。** 隧道里的每条流就是一条原始的 HTTP/1.1 连接（含 WebSocket
   升级后的字节）。入口中继把浏览器请求剥掉 `/d/<id>` 前缀后，用 hyper 客户端写进一条流；桌面端
   把每条流交给 `hyper::server::conn::http1::serve_connection(...).with_upgrades()`，跑的是
   **现有的 `remote::server::router`**——静态资源、`index.html` 注入、`/ws` 鉴权、命令白名单、
   事件推送一行不改。这和 `remote-access.md` 里「不写第二套后端」是同一个原则。
2. **一种隧道凭据，两条获得途径。** 不管是管理员签发接入码，还是用户拿账号密码登录，桌面端最终
   都拿到同一种「设备凭据」；隧道鉴权只认设备凭据。区别只在于设备记录由谁创建、归谁所有。
3. **下游中继就是一种设备。** 中继 B 用与桌面端相同的 `/tunnel` 协议连上 A，只是 `kind = relay`，
   并且会「通告」自己名下的设备；A 给这些设备的流写上目标设备 id，B 收到后原样接到对应的设备
   隧道上。级联因此不需要第二套协议，层数由递归天然支持。
4. **中继决定「能否到达」，桌面端决定「能否操作」。** 桌面端的访问令牌走 URL fragment，永远不会
   发到中继；中继上的用户 / 设备体系和桌面端的令牌门是两道独立的门。

## 仓库布局

```
crates/termexo-relay-protocol/          桌面端与中继共用：控制帧、流前导、凭据格式、
                                        WS ⇄ AsyncRead/AsyncWrite 适配、失败锁定表（从 remote/token.rs 迁出）
apps/relay/                             termexo-relay 二进制（axum + rusqlite + rustls + yamux），跨平台
apps/relay/migrations/                  中继自己的幂等迁移
apps/desktop-ui/projects/relay-console/ 管理页面：同一个 Angular 工作区里的第二个 application
src-tauri/src/remote/relay/             桌面端隧道客户端
docs/architecture/relay-service.md      本文
```

* 不建根级 Cargo workspace：`packages/termexo/scripts/stage-binary.mjs` 和 `tauri-msvc.cmd` 都以
  `src-tauri/target` 为准，改成 workspace 会挪走 target 目录。两个二进制各自以
  `path = "../crates/termexo-relay-protocol"` 依赖共用 crate；`cargo test` 分别按 manifest 跑。
* 共用 crate 不依赖 tauri / keyring / Windows API，中继才能在 Linux 上构建。
* 管理页面放进 `apps/desktop-ui` 的 Angular 工作区（`angular.json` 的 `newProjectRoot` 已是
  `projects`）：复用 pinned Node、Tailwind 4 + DaisyUI 5、`IconComponent`、`I18nService`，不再养
  第二份 `node_modules`。产物 `apps/desktop-ui/dist/relay-console/browser` 由 `apps/relay/build.rs`
  通过 `include_dir` 嵌进二进制。
* 版本号：`apps/relay/Cargo.toml` 加入 `CLAUDE.md`「Releasing」里那组需要同步的版本文件；隧道协议
  另有独立的 `protocol` 整数版本，在握手里协商。

## 身份与凭据

### 中继侧的对象

```
users             管理员和普通用户；密码 argon2id
devices           kind = desktop | relay；owner_user_id 可空（管理员直接签发的设备没有归属）
                  secret_hash（SHA-256；密钥本身 32 字节随机）；revoked_at 一旦非空即永久失效
enrollment_codes  一次性；kind、可选 owner、TTL（默认 15 分钟）、备注；只存哈希
```

角色两种：`admin`（全部管理操作）、`user`（登录后只看自己的设备，可改密码、给自己的设备改名 /
撤销）。

### 设备凭据

一个字符串：`tdc1.<deviceId>.<secret>`

* `deviceId`：16 字节随机数的小写 base32（26 字符，无填充）。它同时是公开地址里的路径段，所以要
  短、可读、不区分大小写；随机生成保证跨中继全局唯一，级联时不需要重命名。
* `secret`：32 字节随机数的 base64url；中继只存 SHA-256。密钥熵足够，不需要慢哈希。
* 桌面端存入 `CredentialStore`，target 常量 `RELAY_CREDENTIAL_TARGET = "relay-device-credential"`；
  和访问令牌一样，**只有 `deviceId` 允许回传给前端**，`secret` 不进日志、不进状态快照。
* 下游中继的凭据存在它自己的数据库 `relay_settings` 表（`upstream` 键，JSON）：中继是无人值守的
  服务进程，没有 keyring，数据目录靠文件权限保护。

### 两条接入途径

| 途径 | 谁操作 | 流程 | 设备归属 |
| --- | --- | --- | --- |
| 接入码 | 管理员在控制台签发 → 把码交给桌面端用户 | 桌面端 `POST /api/enroll { method: "code", code, name }` → 中继校验（未过期、未使用、哈希匹配）→ 建 `devices` 记录 → 返回凭据 → 标记已使用 | 签发时可指定归属用户，也可无归属 |
| 账号密码 | 用户自己 | 桌面端 `POST /api/enroll { method: "password", username, password, name }` → 校验密码、账号未禁用 → 建设备记录 → 返回凭据 | 该用户 |

两条途径共用一个端点，请求体按 `method` 标签区分。密码只在这一次请求里出现，桌面端**不保存密码**，
之后只用设备凭据。`/api/enroll`、`/api/auth/login` 和 `/tunnel` 的鉴权都过按来源 IP 的失败锁定
（10 分钟 5 次，锁 10 分钟，逻辑复用 `token.rs` 现有的 `FailureRecord` 表，迁到共用 crate）。

### 撤销

撤销 = `devices.revoked_at` 置值 + 若在线则发控制帧 `revoked` 并关闭隧道（关闭码 4403）。
桌面端收到 4403 后**不再重连**，清掉 keyring 里的凭据，面板显示「接入已被中继撤销」。
禁用用户会级联撤销该用户名下的所有设备。

## 隧道协议

一条隧道 = 一个出站 WebSocket：`GET /tunnel`，`Authorization: Bearer tdc1.…`。凭据在升级前校验
（失败 401 并计入锁定），升级后 5 秒内必须收到 `hello`。

* **文本帧 = 控制面**（JSON，`type` 字段区分，kebab-case，与 `/ws` 现有帧同风格）；
* **二进制帧 = 数据面**：把全部二进制帧串成一条字节流，跑 `yamux`（带每流窗口的流控）。中继为
  `Mode::Client`（只有它会打开流），设备为 `Mode::Server`。选 yamux 而不是自写分帧，是为了免费
  拿到每流独立的流控：一个卡住的手机页面不会把同一隧道上其他浏览器的终端输出一起堵死。

### 控制帧

| 方向 | 帧 | 说明 |
| --- | --- | --- |
| 设备→中继 | `hello { protocol: 1, kind: "desktop" \| "relay", version, name, relayId? }` | 升级后第一帧；`relayId` 仅下游中继填 |
| 中继→设备 | `welcome { deviceId, relayId, addresses: [Address], chain: [relayId…] }` | `addresses` 是这台设备在整条中继链上的全部公开地址（见「级联」）；`chain` 是上游一路到顶的 id，用于环路检测 |
| 中继→设备 | `addresses { addresses }` | 上游链变化时推送 |
| 中继→设备 | `revoked { reason }` | 随后关闭 4403 |
| 下游中继→上游 | `announce { devices: [{ id, name, online, via: [relayId…] }] }` | 全量快照，连上后立即发 |
| 下游中继→上游 | `device-online { id, name, via }` / `device-offline { id }` | 增量 |
| 双向 | `ping` / `pong` | 20 秒一次；60 秒无任何帧关闭（与 `/ws` 一致） |

`Address = { relayId, relayName, url: "https://relay-a.example.com/d/<deviceId>/", hops }`。

协议版本不匹配（`protocol` 低于中继支持的最低版本，或高于它认识的最高版本）时中继回
`auth-failed { reason }` 并关闭 4401，桌面端面板显示「中继版本过旧 / 过新」。

### 流前导

中继每打开一条流，先写 4 字节大端长度 + 一段 JSON：

```json
{ "v": 1, "target": "<deviceId>", "hops": ["relay_a", "relay_b"] }
```

* 桌面端读完前导，校验 `target == 自己的 deviceId`（防错路），然后把流的剩余部分交给 hyper；
* 下游中继读完前导，按 `target` 查路由表，向下一跳打开新流，写入同样的前导（`hops` 追加自己），
  然后 `tokio::io::copy_bidirectional` 原样对拷——**中间中继不解析 HTTP**；
* 用定长头而不是按行读，是为了避免 `BufReader` 多读走属于 HTTP 的字节。

### 流里的 HTTP

入口中继对每个 `/d/<deviceId>/<rest>` 请求：

1. 查路由表，不在线 → `503` 页面「设备离线」（含设备名、最近在线时间）；
2. 把请求 URI 改写为 `http://<deviceId>.termexo-tunnel/<rest>`，交给
   `hyper_util::client::legacy::Client`；它的 `Connect` 实现按 authority 里的 `deviceId`
   向对应隧道打开一条流并写前导。连接池因此天然按设备分组，keep-alive 复用同一条流。
   同时设置：

   | 头 | 值 |
   | --- | --- |
   | `X-Forwarded-For` | 浏览器 IP |
   | `X-Forwarded-Proto` / `X-Forwarded-Host` | 入口中继的协议与 Host |
   | `X-Termexo-Base` | `/d/<deviceId>/` |

3. WebSocket：请求带 `Upgrade` 时，用 `hyper::upgrade::on` 同时拿到浏览器侧和流侧的升级连接，
   对拷；
4. 响应原样回给浏览器。

桌面端为隧道单独构造一份 `Router`：`server::router(context)` 里 `ServerContext` 新增
`via_relay: bool`，LAN 监听与隧道各持一份 context。两份路由同一套 handler，只有三处按它分支：

* `validate_request_origin`：LAN 路由比较 `Host` 与自身端口（现状）；隧道路由比较 `Origin` 与
  `X-Forwarded-Proto://X-Forwarded-Host`。**LAN 路由永远不读 `X-Forwarded-*`**——判断依据是
  「这条连接来自哪个监听器」，不是「有没有这个头」，局域网里伪造头没有用。
* 来源 IP：LAN 路由用 `ConnectInfo`；隧道路由用 `X-Forwarded-For`。失败锁定因此按真实浏览器 IP
  计数；否则中继的出口 IP 会被锁，所有经中继的浏览器一起被挡在门外。
* `index.html` 注入：隧道路由额外把 `<base href="/">` 改写为 `X-Termexo-Base` 的值，
  `termexo-remote` meta 的 `secure` 取 `X-Forwarded-Proto == https`。

另外给静态资源加 `ETag`（版本号 + 路径）：现有 `Cache-Control: no-cache` 允许条件请求，浏览器带
`If-None-Match` 时回 304，1.5 MB 的前端产物每个版本只过一次隧道，而不是每次刷新都过。

## 路由与访问地址

地址形态：`https://<中继>/d/<deviceId>/#token=<桌面端访问令牌>`。

选路径前缀而不是每设备一个子域名，是因为它只要一个域名、一张普通证书，能放在 Caddy / nginx 后面，
自建门槛最低。子域名模式（`<deviceId>.relay.example.com`）留作可选项，需要泛域名 DNS 和证书。

路径前缀带来两处前端改动：

* `remote-bridge-client.ts` 的 `BRIDGE_PATH` 不再是固定的 `/ws`，改为 `new URL('ws', document.baseURI)`
  再把 scheme 换成 ws / wss；
* `remote-token.ts` 的存储键按 base path 区分：base 为 `/`（LAN 直连）时仍是 `termexo.remote.token`
  以保持兼容，其余为 `termexo.remote.token:/d/<deviceId>/`。否则同一中继上两台设备会在浏览器里
  互相覆盖令牌。

Angular 路由与相对资源路径本来就跟着 `<base href>` 走，无需其他改动。远程页面不知道也不需要
知道自己是经 LAN 还是经中继打开的。

## 中继级联

### 建立上游链接

中继 A 的管理员签发一个 `kind = relay` 的接入码；B 的运维执行
`termexo-relay link --upstream https://relay-a.example.com --code XXXX-XXXX-XXXX`
（或在 B 的控制台「中继」页填写）。B 用与桌面端相同的 `/api/enroll` 换到凭据，存进
`relay_settings.upstream`，随后维持一条到 A 的出站隧道。

### 通告与路由表

* B 连上 A 后发 `announce`（全量），之后每台设备上下线发增量；A 的路由表：

  ```rust
  enum Route {
      Direct(TunnelHandle),
      Via { link: TunnelHandle, hops: Vec<RelayId> },
  }
  // deviceId -> Route
  ```

* A 若自己也有上游 C，把收到的通告在 `via` 前面加上自己的 id 后再转发上去。递归到任意层。
* 同一设备可能短暂经两条路通告到（网络切换时的重叠）：以最新一次通告为准，`hops` 更短者优先。

### 环路防护

* `welcome.chain` 是上游一路到顶的 relay id 列表；B 若在其中看到自己的 id，拒绝连接并记审计；
* 通告里 `via` 含接收方自己 id 的条目直接丢弃；
* 前导里 `hops` 长度上限 8，超过即拒绝。

### 地址在链上传播

设备的 `welcome.addresses` 由它直连的那台中继计算：自己的公开地址（`hops = 0`）+ 上游
`welcome.addresses` 逐级 `hops + 1`。上游链变化时（A 连上 / 断开 C），A 向所有下游推送
`addresses`，下游再推给自己的设备。桌面端面板因此始终列出「从哪里都能打开」的完整地址清单。

设备只在**直连的那台中继**上有归属和撤销权；上游只能看到它（只读），并断开经自己的流。

## 中继服务端（apps/relay）

### 模块

```
src/main.rs         CLI：serve | admin reset-password | link
src/config.rs       监听地址、public_url、TLS 模式、数据目录、受信代理 CIDR
src/db/             rusqlite + 幂等迁移（与桌面端同一套做法）
src/auth/           密码（argon2id）、控制台会话、失败锁定（共用 crate）
src/registry.rs     在线设备表 + 路由表（内存）
src/tunnel/         /tunnel 升级、hello / welcome、yamux 会话、流的打开与前导
src/proxy.rs        /d/<id>/* 反向代理（hyper 客户端 + 自定义 Connect + WS 升级对拷）
src/upstream.rs     作为下游时的出站隧道、通告、地址传播
src/api/            /api/* handlers
src/console.rs      嵌入的管理页面静态资源
src/audit.rs        审计写入
```

### HTTP 路由

| 路径 | 鉴权 | 说明 |
| --- | --- | --- |
| `GET /api/health` | 无 | `{ version, relayId, protocol }` |
| `POST /api/enroll` | 接入码或密码 | 换取设备凭据 |
| `GET /tunnel` | Bearer 设备凭据 | 设备 / 下游中继隧道 |
| `GET /d/<deviceId>/*` | 无（见下） | 反向代理到设备 |
| `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me`、`POST /api/me/password` | Cookie 会话 | 控制台登录与自助 |
| `/api/admin/{users,devices,enrollments,relays,audit,settings}` | admin | 管理 |
| `GET/PATCH/DELETE /api/devices` | user | 用户自己的设备 |
| `GET /console/*`、`GET /` | 无（页面本身） | 管理页面，`/` 302 到 `/console/` |

`/d/<id>/` 默认不需要中继登录：链接本身不含秘密（枚举 `deviceId` 最多知道「有这么一台设备在线 /
离线」），真正的门是桌面端令牌。设备可选 `access = relay-login`：浏览器必须先登录中继并且是设备的
所有者或管理员，中继才转发——第三阶段的可选加固。

控制台会话：`HttpOnly; Secure; SameSite=Strict` cookie，修改类请求额外要求
`X-Requested-With: termexo-console` 头，两者一起挡 CSRF。会话持久化，中继重启不掉线。
控制台与 `/d/<id>/` 同源：cookie 是 `HttpOnly`，工作台脚本读不到；工作台的 localStorage 键都带
`termexo.` 前缀且按 base 分键，两者互不干扰。

### 持久化

```sql
CREATE TABLE IF NOT EXISTS relay_settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_login_at INTEGER);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id), secret_hash TEXT NOT NULL, note TEXT,
  created_at INTEGER NOT NULL, revoked_at INTEGER,
  last_seen_at INTEGER, last_ip TEXT, last_version TEXT);
CREATE TABLE IF NOT EXISTS enrollment_codes (
  id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  owner_user_id TEXT, created_by TEXT NOT NULL, note TEXT,
  expires_at INTEGER NOT NULL, used_at INTEGER, used_by_device_id TEXT);
CREATE TABLE IF NOT EXISTS console_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
  actor_kind TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL,
  target_kind TEXT, target_id TEXT, ip TEXT, detail TEXT);
```

在线 / 离线是内存状态（`registry`），只把 `last_seen_at` 落库。`relay_settings` 存 `relay_id`
（首次启动生成）、`public_url`、`upstream`。

### 配置与部署

```
termexo-relay serve --data-dir /var/lib/termexo-relay --listen 0.0.0.0:8443 \
  --public-url https://relay.example.com \
  --tls cert:/etc/termexo/fullchain.pem,/etc/termexo/privkey.pem \   # 或 self-signed | off
  [--trusted-proxy 10.0.0.0/8]   # 仅 --tls off 且前面有反代时读取反代的 X-Forwarded-*
```

* 每个参数都有 `TERMEXO_RELAY_*` 环境变量等价物，便于容器；仓库提供 `apps/relay/Dockerfile`。
* 首次启动数据库里没有用户时，生成管理员 `admin` 与一次性密码，打印到日志一次；
  `termexo-relay admin reset-password` 可重置。
* `self-signed` 模式下桌面端首次接入时把证书指纹随 url 存进 `app_settings`（TOFU），之后指纹不符即
  拒连——面向没有域名的内网中继。
* ACME（Let's Encrypt）自动证书留作可选项；公网部署首选放在 Caddy 后面。

### 资源上限

| 项 | 值 |
| --- | --- |
| 每设备并发流 | 64 |
| yamux 每流接收窗口 | 256 KiB |
| 请求体 | 1 MiB（桌面端只在 `/ws` 收数据，静态资源全是 GET） |
| 隧道鉴权 / 登录 / 接入失败锁定 | 同来源 IP 10 分钟 5 次，锁 10 分钟 |
| 接入码 TTL | 默认 15 分钟，最长 24 小时 |
| 控制台会话 | 7 天滑动过期 |

## 管理页面（relay-console）

登录后按角色显示：

| 页面 | 管理员 | 用户 |
| --- | --- | --- |
| 概览 | 在线设备数 / 用户数 / 上游状态 / 最近审计 | 自己的设备 |
| 设备 | 全部设备：名称、类型、归属、在线、接入时间、来源 IP、桌面端版本、经由哪台下游中继；改名 / 撤销 / 断开当前隧道 / 复制访问地址（不含令牌） | 自己的：改名 / 撤销 |
| 用户 | 新建、禁用、重置密码、改角色 | 改自己的密码 |
| 接入码 | 签发（类型、归属、TTL、备注）→ 码只显示一次；列表显示未用 / 已用 / 过期，可作废 | — |
| 中继 | 上游：地址、状态、链；下游：已接入的中继及各自通告的设备数；填接入码建立上游链接 | — |
| 审计 | 登录、接入、撤销、隧道建立 / 断开、上游链接变化；按时间 / 对象筛选 | — |

在线状态由 `GET /api/admin/devices` 每 10 秒轮询；不做 SSE，页面本来就是低频操作。
用户可见字符串中文，沿用 `I18nService` 的键表。动手写页面前先调用 `frontend-standard` skill。

## 桌面端改动（src-tauri / desktop-ui）

### 设置与状态

```rust
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessSettings {
    pub enabled: bool, pub bind_address: String, pub port: u16, pub tls: bool, // LAN 监听，原样
    #[serde(default)]
    pub relay: RelaySettings,
}

#[serde(rename_all = "camelCase")]
pub struct RelaySettings {
    pub enabled: bool,
    pub url: String,
    pub certificate_fingerprint: Option<String>, // self-signed 中继的 TOFU 指纹
}

pub struct RemoteAccessStatus {
    // …现有字段…
    pub relay: RelayStatus,
}

#[serde(rename_all = "camelCase")]
pub struct RelayStatus {
    pub state: RelayLinkState, // disabled | connecting | connected | revoked | error
    pub error: Option<String>,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub addresses: Vec<RelayAddress>, // welcome / addresses 帧的内容
    pub connected_since: Option<i64>,
}
```

* `enabled`（LAN）与 `relay.enabled` 互相独立：可以不开任何本地端口只走中继。任一打开都会
  `ensure_token()`。
* `connected_clients` 自然包含经隧道来的会话——它们走的是同一个 `handle_connection` 和
  `hub.register_client()`。
* 旧设置 JSON 没有 `relay` 字段，`serde(default)` 兜底，不需要迁移。

### RelayLink（`src-tauri/src/remote/relay/`）

```
mod.rs      RelayLink：按设置启停、状态快照、退避重连（1s → 30s）、收到 4403 停止重连并清凭据
client.rs   出站 WSS（tokio-tungstenite + rustls；指纹固定）、hello / welcome、ping
mux.rs      yamux 会话；每条入站流：读前导 → 校验 target →
            hyper serve_connection(tunnel_router).with_upgrades()
enroll.rs   调用 /api/enroll、写 keyring
```

`RemoteAccessManager` 持有 `RelayLink`，`update_settings` 里按 `relay` 字段变化启停；`launch()`
里的 `ServerContext` 构造抽成 `build_context(via_relay)`，LAN 与隧道各一份。

### 命令

| 命令 | 说明 | 远程可调用 |
| --- | --- | --- |
| `enroll_relay_device({ url, method, name })` | 换凭据、存 keyring、写设置、启动链接，返回 `RemoteAccessStatus` | 否（`REMOTE_DENIED`，与改远程访问设置同一条理由） |
| `disconnect_relay()` | 断开、删凭据、`relay.enabled = false` | 否 |
| `get_remote_access_status()` | 扩展返回 `relay` | 是（现状） |

`every_registered_command_is_classified` 测试会强制给新命令归类。

### 面板

`remote-access-panel.ts` 新增「通过中继访问」段：

* 中继地址输入；接入方式二选一（接入码 / 账号密码）；设备名（默认主机名）；「接入」按钮；
* 状态行（连接中 / 已连接 · 设备 id / 已撤销 / 错误原因）与「断开并忘记」；
* 访问地址：每条中继地址（`hops > 0` 时标注「经 relay-a」）与现有 LAN 地址并列进同一个地址
  选择器，选中后生成 `${url}#token=…` 和二维码——复用现在的 `render_remote_access_qr` 和令牌
  展示逻辑，不另做一套；
* 安全提示补一句：中继运营者能看到经它的终端内容（端到端加密落地前）。
* `remote.i18n.ts` 加 `remote.relay*` 键，7 种语言表都补。

## 安全边界

* **中继看得到什么。** 第一、二阶段里中继在自己这一跳终止 TLS，能看到 `/ws` 上的明文帧（终端
  输出、命令参数）。自建中继时运营者就是用户自己，可以接受；接到别人运营的上游中继时则不是——
  第三阶段的端到端加密解决这个问题。文档和面板都必须写明。
* 桌面端令牌走 fragment，浏览器不会把它发给任何服务器；中继的日志、审计、数据库里都不会出现它。
* 设备凭据只存哈希；泄露数据库不能冒充设备。
* 撤销立即生效：在线隧道被关闭，浏览器侧所有经该设备的流一起断。禁用用户级联撤销设备。
* 中继出口 IP 不会被桌面端锁定：锁定按 `X-Forwarded-For` 计数，而这个头只在隧道路由上被读取。
* 下游中继对上游只是一台「会通告设备的设备」：上游拿不到下游的用户表，也不能撤销下游的设备，
  只能断开经自己的流。信任是单向的：B 信任 A 能看到 B 名下设备的流量，A 不需要信任 B。
* 所有 `/api/*` 错误信息与隧道关闭原因用中文；审计 `detail` 不含密码、凭据、令牌。

## 端到端加密（第三阶段）

前提已经具备：浏览器与桌面端共享一个中继不知道的秘密（访问令牌）。把 `/ws` 握手升级为 v2：

```
S→C   challenge { nonceS }
C→S   auth { clientId, nonceC, proof: HMAC-SHA256( HKDF(token, "termexo-auth"), nonceS ‖ nonceC ) }
双方  k = HKDF(token, "termexo-session", nonceS ‖ nonceC)
之后  每帧 { "type": "sealed", "n": <递增计数>, "c": base64( AES-256-GCM(k, nonce = n, 明文帧) ) }
```

* `proof` 错误按现有失败锁定计数；令牌本身不再以明文出现在任何帧里，LAN 直连一并受益。
* 浏览器用 WebCrypto（经中继一定是 https，安全上下文可用）；Rust 用 `aes-gcm` + `hkdf` + `hmac` + `sha2`。
* 静态资源仍是明文——它们是公开的应用代码。
* 隧道层不变：中继对 `sealed` 帧仍然只是对拷。

## 分阶段交付

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| 一：可用的中继 | 共用 crate；`termexo-relay serve`（隧道、`/d/` 代理、SQLite、`/api/*`、控制台的设备 / 用户 / 接入码 / 审计页）；桌面端 `RelayLink`、接入 UI、地址清单；隧道路由的转发头、base href、按 base 分键、ETag | 桌面端用接入码接入 → 手机在 4G 下打开 `https://relay/d/<id>/#token=…` → 看到工作台、终端实时交互、刷新后回放；控制台看到设备在线，撤销后手机被断开且桌面端不再重连；账号密码接入的设备出现在该用户名下；错误密码 5 次后锁定 |
| 二：级联 | `upstream.rs`、通告与路由表、环路防护、地址传播、控制台「中继」页 | B 接入 A 后，A 的控制台列出 B 的设备并标注「经 B」；`https://A/d/<id>/` 可打开 B 名下的桌面端；桌面端面板同时列出 A、B 两条地址；把 A 配成 B 的下游时被拒绝 |
| 三：加固（可选） | `/ws` v2 端到端加密；`access = relay-login`；子域名模式；ACME | 中继上抓包看不到终端明文；未登录中继时打开受限设备得到登录页 |

第一阶段内部再拆三条并行线：共用 crate + 中继二进制（一个 agent）；桌面端 Rust（一个 agent，依赖
共用 crate 的接口）；控制台 + 面板 UI（一个 agent，依赖 `/api/*` 契约与 `RemoteAccessStatus`
的形状，本文已定）。协议以本文为准，改协议先改文档。

## 验证

* Rust（`apps/relay`）：前导编解码、路由表与环路防护、凭据格式与哈希校验、接入码一次性 + TTL、
  `/api/admin/*` 权限；进程内集成测试：起中继 + 用 `tokio::io::duplex` 假设备（hyper 服务）→
  经 `/d/<id>/` GET 得到设备的响应、WS 回显经代理成功、A ← B ← 假设备三级链路成功。
* Rust（`src-tauri`）：隧道路由读 `X-Forwarded-*` 而 LAN 路由忽略它、base href 注入、`target`
  不匹配的流被拒、4403 后不重连且凭据被清、ETag 命中回 304。
* 前端：ws 地址随 `baseURI`、存储键按 base 分、面板接入流程（假 invoke）；控制台各页 spec。
* 端到端：按「分阶段交付」的验收列。用 Chrome MCP 对远程页面与控制台截图并检查控制台无报错。

## 已知限制与后续可选项

* 所有流量经中继，没有直连；延迟等于到中继的往返。
* 第一、二阶段中继可见明文（见「安全边界」）。
* 一台桌面端只接一台中继；多中继冗余留作后续。
* 子域名模式、ACME、浏览器侧中继登录、手机专用布局、设备上下线的桌面通知——后续可选。

## 设计文档修订

实施时同步修改 `docs/architecture/remote-access.md`：「HTTP 路由」加转发头、`via_relay` 路由与
ETag；「WebSocket 协议」加隧道下的 Origin 校验规则与 v2 握手（第三阶段）；「安全边界」加
「中继出口 IP 不计入锁定」；「前端」加 base 相对的 ws 地址与分键存储。`CLAUDE.md`「Releasing」
加 `apps/relay/Cargo.toml`，「Commands」加 `cargo test --manifest-path apps/relay/Cargo.toml`。
