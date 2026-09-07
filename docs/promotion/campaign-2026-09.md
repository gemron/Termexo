# Termexo：2026 年 9 月推广执行包

状态：稿件与渠道链接已准备；本轮尚未向社区发布。下面的数字来自 GitHub API，不是官网访问量。

## 基线（2026-09-07）

| 指标 | 当前值 |
| --- | ---: |
| GitHub Star | 25 |
| Fork | 2 |
| GitHub 最近 14 天访问次数 | 458 |
| GitHub 最近 14 天独立访客 | 88 |
| OSCHINA 来源访问 / 独立访客 | 35 / 13 |
| Bing 来源访问 / 独立访客 | 13 / 8 |
| 掘金来源访问 / 独立访客 | 4 / 1 |
| CSDN 来源访问 / 独立访客 | 3 / 1 |

这是一组起点，不是本轮推广成果。GitHub 的独立访客不可跨来源直接相加，Star 也不能归因给某个点击。
每周记录一次新增 Star、仓库独立访客、官网访问来源和有效反馈；不承诺具体增长数。

## 本轮选择

1. **OSCHINA**：已有可见引流，优先复用 `articles/27-oschina-news-v0.8.md` 更新资讯稿。
   先核对 V0.8.1 是否已投稿或审核中，避免重复投递；正文聚焦手机接手同一批 PTY 与会话 Git 视图。
2. **V2EX 分享创造**：复用 `articles/25-v2ex-v0.8.md`，围绕「离开工位后处理 Agent 等待授权」交流使用体验。
3. **掘金**：复用 `articles/18-juejin-v0.8.md`，重点是复用 Tauri 命令表、白名单和终端尺寸取舍。
4. **英文开发者社区**：先用下方短帖介绍可运行的项目。Show HN 只在适合首次介绍项目、维护者能参与讨论且没有重复投稿时使用；常规版本更新不直接当作新的 Show HN。

参考：[Show HN 官方规则](https://news.ycombinator.com/showhn.html)、[V2EX 帮助](https://www.v2ex.com/help)。
已有 Product Hunt 官网徽章，先检查原产品页，不重复创建同一产品。

## 渠道链接

各平台正文同时保留 GitHub 源码链接和官网链接。下面的 UTM 是预先约定的命名，
是否能在后台按其筛选取决于最终统计服务；链接本身不会创建统计记录。

| 渠道 | 官网链接 |
| --- | --- |
| OSCHINA | https://www.termexo.com/?utm_source=oschina&utm_medium=community&utm_campaign=v081_remote |
| V2EX | https://www.termexo.com/?utm_source=v2ex&utm_medium=community&utm_campaign=v081_remote |
| 掘金 | https://www.termexo.com/?utm_source=juejin&utm_medium=article&utm_campaign=v081_remote |
| X | https://www.termexo.com/?utm_source=x&utm_medium=social&utm_campaign=v081_remote |

## 中文短帖（可直接发布）

**把 Claude Code、Codex 和 OpenCode 放在同一工作台，也能从手机接着操作**

我是 Termexo 的维护者。做这个项目是因为同时开多个 Agent 时，很容易漏掉某个终端正在等待输入或授权。

Termexo 把真实终端、原生会话恢复和任务看板放进一个 Windows 工作台。V0.8 加入远程访问后，
手机在同一局域网或 VPN 内通过浏览器操作的，就是电脑上正在运行的那批终端。

Windows 10/11 x64 可用 `npx termexo@latest` 体验，也可以直接下载 GitHub 安装包。项目采用 MIT 许可证。
远程访问默认关闭；启用后使用自签名 HTTPS 和访问令牌。仅面向可信网络，令牌等同该机 Termexo 的完整控制权。

源码：https://github.com/gemron/Termexo
官网：https://www.termexo.com/

希望听听你管理多个 Agent 时最常遇到的问题。如果项目确实帮到了你，也欢迎在 GitHub 点个 Star。

配图：`assets/termexo-remote-v0.8.png`。发布时用上表对应渠道官网链接替换通用链接。

## English short post

I built Termexo to keep Claude Code, Codex and OpenCode in one Windows workspace. It runs real terminals, restores native sessions, and lets a phone connect to the same live workbench over your LAN or VPN. MIT licensed. Try it: `npx termexo@latest`.

https://github.com/gemron/Termexo

Use the real screenshot `assets/termexo-remote-v0.8.png`. For longer posts add: remote access is off by default, uses self-signed HTTPS and a token, and is intended for trusted networks. The token grants full control of Termexo on the host.

## GitHub About 建议文本

Local-first Windows workspace for Claude Code, Codex and OpenCode: real terminals, session recovery, task boards and remote access from your phone.

官网字段保持 https://www.termexo.com 。已有 topics 覆盖工具、技术栈与 Windows，无需堆叠无关关键词。

## 发布记录

| 平台 | 发布链接 | 发布时刻 | 7 天后反馈 |
| --- | --- | --- | --- |
| OSCHINA | 尚未在本轮发布 | — | — |
| V2EX | 尚未在本轮发布 | — | — |
| 掘金 | 尚未在本轮发布 | — | — |
| 英文社区 | 尚未在本轮发布 | — | — |
