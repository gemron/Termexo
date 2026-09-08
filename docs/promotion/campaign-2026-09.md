# Termexo：2026 年 9 月推广执行包

状态：2026-09-07 用户授权由代理选择渠道。已确认 OSCHINA、掘金均已有 V0.8 相关内容，Product Hunt 已有产品页，不重复投递。本轮掘金文档补充评论已提交，作者刷新后可见、匿名暂不可见；OSCHINA 返回新闻已关闭评论，提交失败。下面的数字来自 GitHub API，不是官网访问量。

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

1. **OSCHINA**：已确认 [V0.8.1 资讯](https://www.oschina.net/news/502333) 存在。
   不重复投递 `articles/27-oschina-news-v0.8.md`；本次尝试补充指南时被告知新闻已关闭评论，未发布。保留为以后有实质更新时的资讯渠道。
2. **掘金**：优先技术内容；[V0.8 工程文章](https://juejin.cn/post/7682046779554463795) 和沸点此前已发布，本轮只补充双语指南与 PDF 入口，公开可见性待确认。
3. **V2EX 分享创造**：账号需要激活，本轮暂缓；不购买邀请码或代币。
4. **英文开发者社区**：优先更新已有产品介绍或在指定社交账号发布，不重复创建同一产品。
   HN 当前规则禁止 AI 生成或 AI 润色的发言，因此本包稿件不用于 HN 帖子或评论，也不由代理代发。

参考：[HN 官方规则](https://news.ycombinator.com/newsguidelines.html)、[Show HN 官方规则](https://news.ycombinator.com/showhn.html)、[V2EX FAQ](https://www.v2ex.com/faq)。
已确认 [Product Hunt 产品页](https://www.producthunt.com/products/termexo) 存在，并有两次发布记录，不重复创建同一产品。

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

2026-09-07 晚间新增两份开源自荐，均已验证公共页面可见；仍待编辑决定是否收录，并非获得周刊/月刊推荐。

| 平台 | 发布链接 | 发布时刻 | 7 天后反馈 |
| --- | --- | --- | --- |
| OSCHINA | https://www.oschina.net/news/502333（检查时发现已发布；非本次新增） | 页面显示 2026-09-07 01:19:00 | 待记录 |
| 阮一峰周刊 | https://github.com/ruanyf/weekly/issues/11547（本次新增自荐，公开可见） | 2026-09-07 19:21:26 北京时间 | 待编辑反馈 |
| HelloGitHub | https://github.com/521xueweihan/HelloGitHub/issues/3653（本次新增自荐，公开可见） | 2026-09-07 19:23:05 北京时间 | 待编辑反馈 |
| V2EX | 尚未在本轮发布 | — | — |
| Reddit r/SideProject | https://www.reddit.com/r/SideProject/comments/1w9qpj8/i_built_termexo_a_windows_workbench_for_coding/（已提交，随后被 Reddit 过滤器移除，未重发） | 2026-09-07 | 非公开推广成功 |
| AlternativeTo | 已提交 Termexo；[审核列表](https://alternativeto.net/my-submissions/)，条目目前仅提交者可见 | 2026-09-07 | 普通免费队列待审核，尚未公开 |
| X | https://x.com/gemronguo/status/2096933754615034116（英文更新帖，匿名可见，AI 标识） | 2026-09-07 20:09 北京时间 | 待记录 |
| 微博 | https://weibo.com/1906408514/Rh2k49plz（中文更新帖，匿名可见，AI 标识） | 2026-09-07 20:08 北京时间 | 待记录 |
| 掘金 | https://juejin.cn/post/7682046779554463795；补充评论 ID 7682722130681643802，已提交、匿名暂不可见 | 2026-09-07 | 待确认公开可见性 |
| Reddit r/ClaudeAI | https://www.reddit.com/r/ClaudeAI/comments/1w5q6dx/comment/p8c4nev/（每周分享串评论，公共可见） | 2026-09-07 | 待记录 |
| DEV | https://dev.to/gemron_guo_d4c2e5a892fb40/one-pty-two-screens-choosing-who-controls-terminal-size-3hde（独立技术文章，公共可见） | 2026-09-07 | 待记录 |

第三轮用户完成 Reddit 登录后，已在管理员每周项目串发布；独立展示帖的 Karma 门槛尚未达到。DEV 按 AI 内容指南发布不含产品宣传或引流的终端尺寸技术文章，并选择 Fully Autonomous 披露。详情见执行记录。

本次执行结果、受阻原因与实际提交正文见 [launch-2026-09-07.md](launch-2026-09-07.md)。
