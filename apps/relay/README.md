# termexo-relay

Termexo 的中继服务。桌面端主动向它建立一条出站隧道，手机或另一台电脑就能通过
`https://<中继>/d/<deviceId>/` 打开那台电脑上完整的 Termexo 工作台——不需要公网 IP，也不需要在
路由器上开端口。

设计文档：[`docs/architecture/relay-service.md`](../../docs/architecture/relay-service.md)。
隧道协议与设备凭据格式在共用 crate [`termexo-relay-protocol`](../../crates/termexo-relay-protocol)。

## 启动

```bash
termexo-relay serve \
  --data-dir /var/lib/termexo-relay \
  --listen 0.0.0.0:8443 \
  --public-url https://relay.example.com \
  --tls cert:/etc/termexo/fullchain.pem,/etc/termexo/privkey.pem
```

每个参数都有环境变量等价物，方便容器部署：

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--data-dir` | `TERMEXO_RELAY_DATA_DIR` | `relay-data` | SQLite 数据库与自签名证书的存放目录 |
| `--listen` | `TERMEXO_RELAY_LISTEN` | `0.0.0.0:8443` | 监听地址 |
| `--public-url` | `TERMEXO_RELAY_PUBLIC_URL` | 由监听地址推导 | 浏览器访问中继用的公开地址 |
| `--tls` | `TERMEXO_RELAY_TLS` | `self-signed` | `self-signed`、`cert:<证书>,<私钥>` 或 `off` |
| `--trusted-proxy` | `TERMEXO_RELAY_TRUSTED_PROXY` | 无 | 受信任的反代网段，可重复；仅 `--tls off` 时生效 |

TLS 三种模式：

* `self-signed`：首次启动生成证书并保存到 `<data-dir>/tls/`，之后一直复用；启动日志会打印证书的
  SHA-256 指纹，桌面端首次接入时用它做指纹固定（TOFU）。适合没有域名的内网中继。
* `cert:<证书>,<私钥>`：加载已有的 PEM 证书链与私钥。
* `off`：明文 HTTP，放在 Caddy / nginx 后面用。只有这种模式下才会读取 `--trusted-proxy` 命中来源
  发来的 `X-Forwarded-For` / `X-Forwarded-Proto` / `X-Forwarded-Host`。

## 首次管理员密码

数据库里没有任何用户时，中继会创建 `admin` 账号并把一次性随机密码打印到终端——**只打印一次**：

```
────────────────────────────────────────────
控制台账号：admin
一次性密码：K7QD3MTR9WXF2HJN
请立即登录 /console/ 并修改密码，这条信息只显示一次。
────────────────────────────────────────────
```

忘记密码时重置（需要停止或不影响运行中的实例，直接读写同一个数据目录即可）：

```bash
termexo-relay admin reset-password --data-dir /var/lib/termexo-relay [--username admin]
```

重置会同时清掉该账号所有已登录的控制台会话。

## 签发接入码

登录控制台 `https://<中继>/console/` 后，在「接入码」页签发；也可以直接调接口：

```bash
curl -X POST https://relay.example.com/api/admin/enrollments \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -b cookies.txt \
  -d '{"kind":"desktop","ttlMinutes":15,"note":"给同事"}'
```

返回的 `code` 形如 `ABCD-EFGH-JKLM`，**只在这一次响应里出现**（数据库只存它的 SHA-256）。默认
15 分钟有效，最长 24 小时，一次性使用。把它交给桌面端用户，在 Termexo 的「远程访问 → 通过中继
访问」里填入中继地址和接入码即可接入。`kind` 取 `desktop`（桌面端）或 `relay`（下游中继）。

也可以让用户用中继上的账号密码直接接入，此时设备归属该用户。

## 放在 Caddy 后面

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:8443
}
```

对应的中继启动参数：

```bash
termexo-relay serve --tls off --listen 127.0.0.1:8443 \
  --public-url https://relay.example.com \
  --trusted-proxy 127.0.0.1/32
```

`--trusted-proxy` 必须填 Caddy 的来源地址，否则中继会把所有浏览器都当成同一个来源（反代的出口
IP），失败锁定会误伤。Caddy 默认会转发 WebSocket 升级，不需要额外配置。

## 容器

```bash
docker build -f apps/relay/Dockerfile -t termexo-relay .
docker run -d --name termexo-relay \
  -p 8443:8443 \
  -v termexo-relay-data:/var/lib/termexo-relay \
  -e TERMEXO_RELAY_PUBLIC_URL=https://relay.example.com \
  termexo-relay
```

首次启动的管理员密码用 `docker logs termexo-relay` 查看。

## 开发

```powershell
scripts\cargo-msvc.cmd test --manifest-path apps/relay/Cargo.toml
scripts\cargo-msvc.cmd clippy --manifest-path apps/relay/Cargo.toml --all-targets
```

控制台是 `apps/desktop-ui` 工作区里的第二个 Angular 应用，产物由 `build.rs` 通过 `include_dir`
嵌进二进制。产物不存在时会退回 `console-placeholder/`，因此 `cargo test` 不依赖前端构建。
