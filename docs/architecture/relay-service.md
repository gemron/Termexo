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
自建门槛最低。子域名模式（`<deviceId>.relay.example.com`）是可选的第二个入口，需要泛域名 DNS 和证书。

子域名模式由 `--subdomain-base <域名>`（`TERMEXO_RELAY_SUBDOMAIN_BASE`）开启。开启后：

* `<deviceId>.<base>` 的请求整台主机都属于该设备，路径不再带 `/d/<id>` 前缀，`X-Termexo-Base` 为 `/`；
* 中继对外通告的地址（`DeviceView.accessUrl`、`welcome.addresses`、通告给上游的地址）改为子域名
  形式，并带上 `public_url` 的端口，使两种入口落到同一个监听器；
* 路径形式 `/d/<id>/` **仍然可用**——已经发出去的链接不能失效，两种入口在同一台中继上同时有效；
* 控制台 `/console/*`、`/api/*` 与 `/tunnel` 只在基础域名本身上提供。

子域名路由必须在**所有路由之前**判断：`/`、`/api/health`、`/tunnel` 都是真实路由，否则会抢走设备
子域名上本应转发的请求。实现上是一层包在整个 Router 外面的 middleware。

Host 解析规则：去掉端口、去掉结尾的根点、大小写不敏感、**只认恰好一层**子域名，且该标签必须是
合法 deviceId（26 位小写 base32）。任何不满足的 Host 都落回普通路由。

TLS 需要泛域名证书：`--tls cert:` 由运维自备，`--tls self-signed` 会把 `*.<base>` 加进 SAN；已经
生成过证书的数据目录不会自动重签，需要删掉 `<data-dir>/tls/`（桌面端固定过指纹的要重新固定）。

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

`link` 子命令只换凭据并写设置，不启动服务；`serve` 每次启动时读 `relay_settings.upstream`，
有就自动接上。控制台走两个端点：

| 端点 | 行为 |
| --- | --- |
| `POST /api/admin/relays/upstream { url, code }` | 换凭据 → 写设置 → 启动链接 → `201 { upstream }`；换凭据失败时 4xx `{ error }` 且不写任何设置 |
| `DELETE /api/admin/relays/upstream` | 断开、删设置与凭据、把地址清单推回给本地设备 → `204` |
| `GET /api/admin/relays` | `{ upstream: { url, state, relayId, chain, error } \| null, downstreams: […] }`，`state` 为 `connecting \| connected \| error`；没有配置上游时 `upstream` 为 `null` |

B 侧的隧道与桌面端的是同一套：`hello { kind: "relay", relayId }`、20 秒 ping、60 秒空闲断开、
1s→30s 的退避重连（退避阶梯放在共用 crate 的 `tunnel::Backoff`）。关闭码语义也一致：4403 停止
重连并清除凭据与 `upstream` 设置，4401（或升级握手返回 4xx）停止重连但保留凭据等运维处理，其余
一律重连。数据面方向相反——上游是开流的一方，所以 B 在这条链接上跑 `yamux::Mode::Server`。

审计动作：`upstream-linked`、`upstream-unlinked`、`upstream-connected`、`upstream-disconnected`、
`upstream-loop-refused`、`upstream-revoked`；`detail` 只记地址与是否固定了证书（`pinned`），不含
凭据、接入码与指纹值。设备侧另有 `device-access-changed`，`detail` 只记新的访问策略。

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
  直连设备的 `via` 就是 `[自己的 relay_id]`，所以通告的构造在两种情况下是同一行代码。
* 下游中继链接本身不作为设备通告上去：它是链路不是终端，通告它只会给出一个打开中继而不是工作台
  的地址。上游看到的是它名下的设备。
* 同一设备可能短暂经两条路通告到（网络切换时的重叠）：以最新一次通告为准，`hops` 更短者优先。
* 通告过来的设备在上游没有数据库行，所以上游把「链接还在、设备下线」的设备名记在路由表里，
  `/d/<id>/` 因此仍能给出「设备离线」页而不是「设备不存在」；链接一断这份记忆也一起丢掉——那时
  上游已经无法分辨「离线」和「从来不在这条链路后面」。

### 环路防护

* `welcome.chain` 是上游一路到顶的 relay id 列表；B 若在其中（或在 `welcome.relayId` 里，也就是
  连到了自己）看到自己的 id，拒绝连接、记审计 `upstream-loop-refused`、状态置 `error` 并给出中文
  原因，**不重连**——重连只会被同样地拒绝；
* 通告里 `via` 含接收方自己 id 的条目直接丢弃，发送方也不会把这种条目发出去；
* 前导里 `hops` 含本中继自己的 id 即拒绝该流（说明成环），长度上限 8，追加自己后会超过上限的也
  拒绝。

### 地址在链上传播

设备的 `welcome.addresses` 由它直连的那台中继计算：自己的公开地址（`hops = 0`）+ 上游
`welcome.addresses` 逐级 `hops + 1`。上游链变化时（A 连上 / 断开 C），A 向所有下游推送
`addresses`，下游再推给自己的设备。桌面端面板因此始终列出「从哪里都能打开」的完整地址清单。

上游发给 B 的每条地址指向的是 **B 自己的链接设备 id**（`https://A/d/<B 的 deviceId>/`），B 把结尾
的 `/d/<自己的 deviceId>/` 换成 `/d/<目标设备 id>/` 就得到该设备在 A 上的地址。公开地址的形状由
协议固定，所以这个替换是精确的，不需要在 `Address` 里多加一个字段。推送范围是**直连**的隧道：
经下游中继来的设备由那台中继自己推，而它正是收到这一帧后去做的。

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
src/upstream/       作为下游时的出站隧道、通告、地址传播、上游开来的流的转发
                    mod 链接状态机与退避 / session 单次会话 / forward 流转发 /
                    addresses 上游地址链 / settings 持久化 / enroll 换凭据 / pinning 证书固定
                    （通告的内容由 registry 给出：announcements() 快照 + subscribe() 增量）
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

`/d/<id>/` 默认不需要中继登录（`access = public`）：链接本身不含秘密（枚举 `deviceId` 最多知道
「有这么一台设备在线 / 离线」），真正的门是桌面端令牌。设备可选 `access = relay-login`：浏览器
必须先登录中继并且是设备的**所有者**或**管理员**，中继才转发。

* 检查在查到设备记录之后、判断在线之前执行，因此不会向陌生人泄漏设备是否在线；
* 覆盖该设备的**全部**请求——首页、静态资源和 `/ws` 升级一视同仁；
* 未登录 → 302 到 `/console/login?next=<原路径>`（`next` 经百分号编码，控制台登录后跳回；控制台侧
  只接受本站绝对路径，挡住开放重定向）；已登录但无权 → 403 中文页面；
* 会话查询失败按「未登录」处理：宁可拒绝，也不让一次数据库抖动打开受限设备；
* 经下游中继通告来的设备在本中继没有数据库行，本中继按 `public` 对待，`PATCH` 它的 `access` 返回
  404（与 rename / revoke 一致）——它的策略由**它直连的那台中继**决定并在那一跳执行；
* 子域名入口上 `relay-login` 设备一律 302 回路径形式：控制台会话 cookie 是 host-only 的，不会发到
  设备子域名；放宽成 `Domain=.<base>` 又会让每台设备都收到这个 cookie。

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
  last_seen_at INTEGER, last_ip TEXT, last_version TEXT,
  access TEXT NOT NULL DEFAULT 'public');   -- public | relay-login
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
  [--subdomain-base relay.example.com]   # 子域名模式：<deviceId>.<base> 也能直接打开设备
```

* 每个参数都有 `TERMEXO_RELAY_*` 环境变量等价物，便于容器；仓库提供 `apps/relay/Dockerfile`。
* 首次启动数据库里没有用户时，生成管理员 `admin` 与一次性密码，打印到日志一次；
  `termexo-relay admin reset-password` 可重置。
* `self-signed` 模式下桌面端首次接入时把证书指纹随 url 存进 `app_settings`（TOFU），之后指纹不符即
  拒连——面向没有域名的内网中继。
* ACME（Let's Encrypt）自动证书**不内置**：签发需要一个公网可达的域名才能完成验证，无法在本机
  验证，而未经验证的取证代码比没有更糟。公网部署放在 Caddy 后面以 `--tls off` 运行，由它申请与
  续期（含子域名模式的泛域名 DNS-01）；内网用 `--tls self-signed` 加指纹固定。
  `apps/relay/README.md` 有可直接抄的 Caddy 与 nginx 配置。

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
* 安全提示：经中继的终端内容已端到端加密，中继运营者看不到；但它知道设备何时在线，也能随时断开。
* `remote.i18n.ts` 加 `remote.relay*` 键，7 种语言表都补。

## 安全边界

* **中继看得到什么。** 端到端加密落地后（见「端到端加密」），经中继的 `/ws` 帧全部封装在
  AES-256-GCM 里：中继只看得到流量的时间与大小，看不到终端输出与命令参数，也拿不到访问令牌。
  它仍然知道哪台设备在线、哪个浏览器 IP 在访问，并且随时可以断开连接——「中继决定能否到达」这一条
  没有变。静态资源仍是明文，它们是公开的应用代码。
* 桌面端令牌走 fragment，浏览器不会把它发给任何服务器；中继的日志、审计、数据库里都不会出现它。
* 设备凭据只存哈希；泄露数据库不能冒充设备。
* 撤销立即生效：在线隧道被关闭，浏览器侧所有经该设备的流一起断。禁用用户级联撤销设备。
* 中继出口 IP 不会被桌面端锁定：锁定按 `X-Forwarded-For` 计数，而这个头只在隧道路由上被读取。
* 下游中继对上游只是一台「会通告设备的设备」：上游拿不到下游的用户表，也不能撤销下游的设备，
  只能断开经自己的流。信任是单向的：B 信任 A 能看到 B 名下设备的流量，A 不需要信任 B。
* 中继的控制台会话 cookie 不会进隧道：控制台与 `/d/<id>/` 同源，浏览器会把它带到设备请求上，所以
  代理在转发前剥掉该 cookie（其它 cookie 保留），并剥掉设备响应里同名的 `Set-Cookie`。否则设备
  运营者能拿到管理员的控制台会话，或对共享 origin 做会话固定。
* `access = relay-login` 只决定「能不能到达」，不改变「能不能操作」：桌面端令牌仍然是第二道独立的门。
* 所有 `/api/*` 错误信息与隧道关闭原因用中文；审计 `detail` 不含密码、凭据、令牌。

## 端到端加密（第三阶段，已交付）

前提已经具备：浏览器与桌面端共享一个中继不知道的秘密（访问令牌）。`/ws` 握手升级为 **v2**，
握手之后的每一帧都封装在 AES-256-GCM 里，中继（以及任何中间人）只转发它读不懂的密文。

### 握手

```
S→C  { "type": "challenge", "protocol": 2, "nonceS": <base64url, 32 B> }
C→S  { "type": "auth", "protocol": 2, "clientId": "<uuid>", "nonceC": <base64url, 32 B>,
       "proof": <base64url, HMAC-SHA256(authKey, nonceS ‖ nonceC)> }
S→C  { "type": "ready", "serverVersion": "x.y.z" }        ← 这一帧起全部封装
```

三把密钥都由 HKDF-SHA256 从令牌派生，**salt 固定为 `nonceS ‖ nonceC`**，`info` 只用来区分用途：

| 密钥 | `info` | 用途 |
| --- | --- | --- |
| `authKey` | `termexo-auth` | 计算 / 校验 `proof` |
| `c2sKey` | `termexo-c2s` | 浏览器 → 桌面端的帧 |
| `s2cKey` | `termexo-s2c` | 桌面端 → 浏览器的帧 |

* IKM 是令牌的 UTF-8 字节，输出长度 32 字节。
* 服务端在连接建立后**立即**发出 `challenge`，客户端必须在 `AUTH_TIMEOUT`（5 秒）内回 `auth`，
  否则关闭 4408。由服务端先说话，会话密钥才能同时覆盖两侧的随机数。
* `proof` 用 HMAC 的 `verify_slice` 常量时间比较；不匹配按现有 `RemoteAuth` 的来源 IP 失败锁定
  计数（10 分钟 5 次，锁 10 分钟），回 `{"type":"auth-failed","reason":"…"}` 并关闭 4401。
  校验与派生都在 `RemoteAuth::authorize_with` 的闭包里完成，令牌不会被交回调用方。
* **令牌本身不再出现在任何帧里**，LAN 直连一并受益。

### 封装帧

```
{ "type": "sealed", "n": <整数，从 0 递增>, "c": <base64url, AES-256-GCM 密文+标签> }
```

* 明文就是原来的 JSON 帧原文（`invoke` / `result` / `event` / `ping` / `pong` / `resync` /
  `ready`），一行没改：封装层套在外面，上层协议不知道自己被加密了。
* nonce（12 字节）= 4 字节 0 + 8 字节大端 `n`。方向已经由密钥区分，nonce 不必再编码方向。
* AAD 为空。
* 接收方要求 `n` **严格递增**（WebSocket 可靠有序）。重复或倒退的 `n`、解密失败、加密会话上收到
  未封装帧、封装帧里再嵌套封装帧——一律按攻击处理：关闭连接（1002）并记日志；日志只记原因，
  不记帧内容、令牌、nonce 或密钥。
* 发送计数器是 u64，按每秒十亿帧算也要几百年才会回绕，因此**不做回绕处理**（代码注释写明原因）。
* Close 帧不封装：关闭码属于 WebSocket 层，浏览器在密钥已经失效时也要能读到它。
* 隧道层不变：中继对 `sealed` 帧仍然只是对拷。静态资源仍是明文——它们是公开的应用代码。

### 与早期草案的三处不同

1. **按方向派生两把密钥**，而不是双方共用一把 `k`。共用一把时，服务端的第 n 帧与客户端的第 n 帧
   会落在同一组 (key, nonce) 上；AES-GCM 在 nonce 重用下会泄露两段明文的异或，并暴露 GHASH 的
   认证密钥使标签可被伪造。这是必须修的缺陷，不是风格选择。
2. **两个 nonce 放进 HKDF 的 salt**（`nonceS ‖ nonceC`），`info` 只留给用途标签。效果与放在 `info`
   里等价，但 salt 才是 nonce 的标准位置，也让三把密钥的区分只由 `info` 承担。
3. **v2 的适用范围按页面上下文决定**：
   * 页面处于安全上下文（https；经中继必然如此）→ **强制 v2**，服务端直接拒绝 v1 的 `auth` 帧。
     否则中间人只要把握手打回 v1 就能读到明文令牌——不堵死降级，加密就只是摆设。
   * 明文 HTTP 的局域网直连（`RemoteAccessSettings.tls == false` 且不经中继）→ 保留 v1：浏览器在
     非安全上下文里根本不提供 `crypto.subtle`，而这条链路本来就没有机密性，v1 不损失任何东西。
   * 服务端的判断：`via_relay == true`，或请求是 https（隧道路由看 `X-Forwarded-Proto`，LAN 路由
     看自身 `tls` 设置）→ 只接受 v2；否则两者皆可。
   * 浏览器侧对应：`crypto.subtle` 不可用时回退 v1；被服务端拒绝时，未授权遮罩直接显示服务端给
     的中文原因「此连接要求加密握手，请改用 HTTPS 打开远程工作台。」

### 实现与一致性

| 位置 | 内容 |
| --- | --- |
| `src-tauri/src/remote/session_crypto.rs` | HKDF 派生、`proof` 校验、封装 / 解封装、计数器递增校验 |
| `src-tauri/src/remote/server.rs` | `challenge` → `auth` 握手；封装层夹在唯一持有 sink 的写任务与读循环之间，沿用「一个任务拥有 sink」的结构 |
| `src-tauri/src/remote/token.rs` | `authorize_with`：把「怎么比对」交给调用方，失败锁定与中文文案不变 |
| `apps/desktop-ui/src/app/core/services/remote-session-crypto.ts` | WebCrypto 版同一套算法；`CryptoKey` 在握手时导入一次并缓存 |
| `apps/desktop-ui/src/app/core/services/remote-bridge-client.ts` | 等到 `challenge` 才应答；收发各串一条 promise 链 |

`crypto.subtle.encrypt` / `decrypt` 都是异步的，多个 promise 可能乱序 resolve。因此浏览器侧
**发送与接收各串一条 promise 链**：下一帧的密码学操作要等上一帧 resolve 之后才开始，于是写出的
`n` 与实际发送顺序一致，解出的帧也按 `n` 顺序交付给上层。

两端互通由一组写死的常量证明：同一份 token / nonceS / nonceC / 明文，Rust 与前端的测试断言同一个
`proof`、同一个 c2s 密文、同一个 s2c 密文（`session_crypto.rs` 的
`the_wire_format_matches_the_pinned_cross_language_vector`，以及
`remote-session-crypto.fixtures.ts` 的 `SESSION_VECTOR`）。任何一侧改了派生、salt 或 nonce 布局，
失败的是测试而不是线上连接。

## 分阶段交付

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| 一：可用的中继 | 共用 crate；`termexo-relay serve`（隧道、`/d/` 代理、SQLite、`/api/*`、控制台的设备 / 用户 / 接入码 / 审计页）；桌面端 `RelayLink`、接入 UI、地址清单；隧道路由的转发头、base href、按 base 分键、ETag | 桌面端用接入码接入 → 手机在 4G 下打开 `https://relay/d/<id>/#token=…` → 看到工作台、终端实时交互、刷新后回放；控制台看到设备在线，撤销后手机被断开且桌面端不再重连；账号密码接入的设备出现在该用户名下；错误密码 5 次后锁定 |
| 二：级联（已交付） | `upstream/`（出站隧道、通告、地址传播、流转发）、路由表变更订阅、环路防护、`/api/admin/relays/upstream`、`termexo-relay link`、控制台「中继」页接真实数据 | B 接入 A 后，A 的控制台列出 B 的设备并标注「经 B」；`https://A/d/<id>/` 可打开 B 名下的桌面端（含 WebSocket）；桌面端面板同时列出 A、B 两条地址；把 A 配成 B 的下游时被拒绝。`apps/relay/tests/relay_cascade.rs` 起两台真中继逐条验证 |
| 三：加固（已交付） | `/ws` v2 端到端加密；`access = relay-login`；子域名模式；上游自签名证书的指纹入口（补第二阶段遗留）；ACME 不做，见「配置与部署」 | 中继上抓包看不到终端明文、也看不到令牌；未登录中继时打开受限设备得到登录页，登录后跳回；`<deviceId>.<base>` 与 `/d/<id>/` 同时可达。`apps/relay/tests/relay_access.rs` 与两端的跨语言加密向量逐条验证 |

第一阶段内部再拆三条并行线：共用 crate + 中继二进制（一个 agent）；桌面端 Rust（一个 agent，依赖
共用 crate 的接口）；控制台 + 面板 UI（一个 agent，依赖 `/api/*` 契约与 `RemoteAccessStatus`
的形状，本文已定）。协议以本文为准，改协议先改文档。

## 验证

* Rust（`apps/relay`）：前导编解码、路由表与环路防护、凭据格式与哈希校验、接入码一次性 + TTL、
  `/api/admin/*` 权限；进程内集成测试：起中继 + 假设备（yamux + hyper 小路由）→ 经 `/d/<id>/`
  GET 得到设备的响应、WS 回显经代理成功；级联另起**两台真中继** A 与 B，B 经
  `/api/admin/relays/upstream` 接入 A，假设备接入 B，验证 A 上的 `/d/<id>/`、设备列表的
  `via` / `viaNames`、两条 `welcome.addresses`、设备离线后的 503、断开上游后的 `addresses` 推送，
  以及让 A 反过来接 B 时的环路拒绝。
* Rust（`src-tauri`）：隧道路由读 `X-Forwarded-*` 而 LAN 路由忽略它、base href 注入、`target`
  不匹配的流被拒、4403 后不重连且凭据被清、ETag 命中回 304。
* 前端：ws 地址随 `baseURI`、存储键按 base 分、面板接入流程（假 invoke）；控制台各页 spec。
* 会话加密：Rust 侧派生向量、`proof` 通过 / 失败、封装往返、`n` 倒退或重复被拒、解密失败被拒、
  两个方向密钥不同、v1 在强制 v2 的上下文里被拒而在明文 LAN 上被接受；前端侧完整 v2 握手、
  乱序 resolve 时仍按 `n` 顺序交付、非安全上下文回退 v1；两侧共用同一组跨语言常量。
* 端到端：按「分阶段交付」的验收列。用 Chrome MCP 对远程页面与控制台截图并检查控制台无报错。

## 已知限制与后续可选项

* 所有流量经中继，没有直连；延迟等于到中继的往返。
* 静态资源经中继时仍是明文（公开的应用代码）；`/ws` 的帧自 v2 起已端到端加密。
* 一台桌面端只接一台中继；多中继冗余留作后续。
* 不内置 ACME：见「配置与部署」。公网部署放在反代后面，内网用自签名加指纹固定。
* 子域名模式需要泛域名 DNS 与证书；`--tls self-signed` 生成过的证书不会因为后来加了
  `--subdomain-base` 而自动重签。
* `access = relay-login` 的设备在子域名入口上只能经 302 回路径形式访问（cookie 作用域所致）。
* 上游被撤销（4403）后 `upstream` 设置连同凭据一起清掉，控制台的上游卡片回到未接入状态，原因只
  留在审计里。
* 手机专用布局、设备上下线的桌面通知——后续可选。

## 设计文档修订

实施时同步修改 `docs/architecture/remote-access.md`：「HTTP 路由」加转发头、`via_relay` 路由与
ETag；「WebSocket 协议」加隧道下的 Origin 校验规则与 v2 握手（第三阶段）；「安全边界」加
「中继出口 IP 不计入锁定」；「前端」加 base 相对的 ws 地址与分键存储。`CLAUDE.md`「Releasing」
加 `apps/relay/Cargo.toml`，「Commands」加 `cargo test --manifest-path apps/relay/Cargo.toml`。
