<!--
平台：微博 / 朋友圈 / X（Twitter）/ 掘金沸点 / Telegram · Discord 群公告
标题：Termexo V0.8.1 短帖合集（远程访问）
分类：社交平台短文案
标签：开源、Windows、ClaudeCode、Codex、远程访问
发布声明：项目维护者原创；配图为真实界面截图，无 AI 生成内容。
-->

# Termexo V0.8.1 短帖合集

每段可直接复制粘贴。配图统一用 `assets/termexo-remote-v0.8.png`（手机远程打开工作台），
需要桌面视角时改用 `assets/termexo-workbench-v0.8.png`，讲 Git 时用 `assets/termexo-git-v0.8.png`。
不使用「最强 / 神器 / 吊打 / 必装」这类措辞。

---

## 微博

Termexo V0.8.1 发布：设置里打开远程访问后，同一局域网或 VPN 内的手机、平板、另一台电脑用浏览器就能读写桌面上正在运行的同一批终端，不是只读镜像。自签名 HTTPS + 访问令牌，可扫码进入。Git 视图改为跟随当前终端。MIT 开源，仅 Windows。

`npx termexo@latest`

https://github.com/gemron/Termexo

#开源软件 #AI编程 #ClaudeCode #Codex

> 配图：`assets/termexo-remote-v0.8.png`

---

## 朋友圈

Agent 跑到一半停在「是否允许」，人却在客厅——这就是我给 Termexo 加远程访问的原因。

打开开关，手机浏览器扫码进来，操作的是电脑上正在跑的同一批终端，授权顺手点掉就行。V0.8.1，MIT 开源，仅 Windows，一条命令试：`npx termexo@latest`

> 配图：`assets/termexo-remote-v0.8.png`

---

## X / Twitter（English，约 272 字符，含链接计数）

Termexo v0.8.1: turn on remote access and your phone reads and writes the same PTYs running on your desktop — not a read-only mirror. Access token over self-signed HTTPS. Git view now follows the active terminal. MIT, Windows only.

npx termexo@latest
github.com/gemron/Termexo

> Image: `assets/termexo-remote-v0.8.png`

---

## 掘金沸点

Termexo V0.8.1 把远程访问做进去了。开关一开，手机浏览器进来操作的就是桌面上正在跑的同一批 PTY，不另开会话。

实现上没另写一套后端：socket 请求转成 `InvokeRequest` 交给主 webview，走同一张命令表；白名单是唯一的授权边界，npm 自更新和原生文件读写都挡在外面。仅 Windows，MIT 开源。

`npx termexo@latest`
https://github.com/gemron/Termexo

---

## Telegram / Discord 群公告

**Termexo V0.8.1 已发布**

- 新增远程访问：设置里打开后，同一局域网或 VPN 内的手机、平板、另一台电脑用浏览器打开完整工作台，读写桌面上正在运行的同一批终端；自签名 HTTPS + 访问令牌，可扫码进入。
- Git 视图改为跟随当前终端，以启动时的 HEAD 为基线看变更与 Diff。
- 首次启动改为新手引导，不再种示例工作空间。
- 注意：仅 Windows；令牌等同于该机 Termexo 的完整控制权，请只在可信网络使用。

`npx termexo@latest`

Release：https://github.com/gemron/Termexo/releases/tag/v0.8.1
GitHub：https://github.com/gemron/Termexo

欢迎试用、反馈、贡献；如果确实有帮助，也欢迎 Star。
