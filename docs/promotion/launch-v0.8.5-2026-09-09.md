# Termexo v0.8.5 更新推广

用户授权发布更新说明并推广到既有网站。以 v0.8.5 应用更新为主，同时介绍新版官网。

事实来源：https://github.com/gemron/Termexo/releases/tag/v0.8.5
正式发布时间：2026-09-09 15:35:45 UTC。

## 中文底稿

标题：Termexo v0.8.5：修复旧版 Windows 终端兼容问题，启动提示更清楚

我是 Termexo 的维护者。Termexo 是 MIT 开源的 Windows 多 Agent 工作台，可在一个窗口里使用 Claude Code、Codex CLI、OpenCode 和真实终端，也支持手机通过可信局域网或 VPN 访问电脑上的工作台。

v0.8.5 重点解决两类容易让人摸不着头脑的问题：同一套 Agent 在不同 Windows 版本上，快捷键和滚动表现不同；界面运行时过旧或缺失时，用户不知道为什么显示异常或无法启动。

### 1. 安装包自带 ConPTY，减少系统版本造成的差异

此前终端使用 Windows 自带的伪控制台。部分旧版 ConPTY 会在输入转换中丢失信息：Claude Code 收不到 Shift+Tab，OpenCode 的鼠标滚动报告也可能被丢弃。

现在 EXE、MSI 安装包和 npm 包都随附微软 MIT 许可的 conpty.dll 与 OpenConsole.exe，优先使用这份 ConPTY。安装包体积约增加 600 KB，用来减少这类兼容性差异。

### 2. 避免换行被重复重排

终端会识别实际使用的伪控制台。在旧版系统 ConPTY 已重排换行的情况下，前端不再重复重排，避免内容错乱。

### 3. WebView2 过旧或缺失时，说明原因和处理方法

WebView2 低于 Chromium 111 时，部分颜色和布局无法正常显示。现在提示会列出当前版本、所需版本、官方下载页和 winget 命令；浏览器打不开时仍可复制地址。运行时完全缺失时，也会在启动前说明。

### 官网也换了新样子

官网新增真实 Termexo 截图组成的电脑与手机示意、双向连接动画，以及可暂停的动效。图中的连接是场景示意，不是实时远程会话。手机远程访问是已有能力，本次官网更新让使用场景更直观。

### 下载与环境要求

Windows 10 build 17763 或更高；WebView2 Chromium 111 或更高。可下载 EXE / MSI 安装包，或运行 npx termexo@latest（需要 Node.js 环境）。使用 Agent 还需配置相应 CLI 与模型服务。

发布说明与安装包：https://github.com/gemron/Termexo/releases/tag/v0.8.5
源码：https://github.com/gemron/Termexo
新版官网：https://www.termexo.com/

远程访问默认关闭，仅用于可信局域网或 VPN；默认自签名 HTTPS 可能出现证书提示，访问令牌具有敏感控制权限，请妥善保管。欢迎反馈具体 Windows 版本与复现步骤。

本文由项目维护者提供，AI 根据正式 Release 整理。

## English article

Title: Termexo v0.8.5: making Windows terminal behavior more consistent

I maintain Termexo, an MIT-licensed Windows workbench for Claude Code, Codex CLI, OpenCode and real terminals. Version 0.8.5 focuses on compatibility problems that can make the same agent behave differently across Windows installations.

The release bundles Microsoft's MIT-licensed ConPTY components, conpty.dll and OpenConsole.exe, with both Windows installers and the npm package. Older system ConPTY builds can lose Shift+Tab and mouse reports during input conversion, affecting Claude Code shortcuts and OpenCode scrolling. Shipping a known ConPTY version reduces that dependency on the host Windows build, adding about 600 KB to the installer.

The frontend also detects which pseudo console it uses. When an older system ConPTY has already reflowed wrapped lines, the frontend avoids reflowing them a second time.

An outdated or missing WebView2 runtime now gets an actionable message. The notice shows the installed and required versions, the download page and a winget command. It keeps the address readable if the browser cannot be opened. A missing runtime is reported before startup.

Requirements: Windows 10 build 17763 or later, and a WebView2 runtime based on Chromium 111 or later. EXE and MSI installers are on the release page. The npm launcher is npx termexo@latest and needs Node.js. Agent CLIs and model services require their own configuration.

The website has also been redesigned with actual Termexo screenshots inside desktop and phone illustrations, a two-way connection animation, and a motion pause control. The animation illustrates an existing remote workflow; it is not a live session or a newly introduced remote feature. Remote access is off by default and is intended for trusted LAN/VPN connections. It uses self-signed HTTPS by default and an access token with sensitive control permissions.

Release notes and downloads: https://github.com/gemron/Termexo/releases/tag/v0.8.5
Source: https://github.com/gemron/Termexo
Website: https://www.termexo.com/

Feedback with the Windows version and reproduction steps is welcome. Written by the maintainer with AI assistance, based on the official release notes.

## 发布结果

| 渠道 | 状态 | 链接与核验 |
| --- | --- | --- |
| X | 已发布 | https://x.com/gemronguo/status/2097712297712177320 ；提示“你的帖子已发送”，个人页显示全文、Release 卡片与 AI 标识 |
| 知乎 | 已发布 | https://zhuanlan.zhihu.com/p/2081165836732179262 ；文章页显示标题、正文及链接；选择“包含 AI 辅助创作” |
| OSCHINA | 已投稿，审核中 | https://my.oschina.net/gemron?key=news ；“操作成功”，我的资讯增至 23，新标题显示审核中，2026-09-09 23:44:20 |
| CSDN | 已提交，审核中 | https://blog.csdn.net/guomengyue1987/article/details/164758263 ；成功页明确显示“发布成功！正在审核中”；标签 windows，声明部分内容由 AI 辅助生成 |

| 掘金 | 已发布 | https://juejin.cn/spost/7683416533934817331 ；成功页显示“发布成功”；标题《Shift+Tab 为什么变成了 Tab？Termexo v0.8.5 的 ConPTY 兼容性修复》，分类开发工具，标签 GitHub |
| Product Hunt | 已发布 | https://www.producthunt.com/p/termexo/termexo-v0-8-5-bundled-conpty-clearer-startup-notices-and-a-new-website ；现有产品论坛的新更新帖，已核验公开帖标题 |
| Medium | 已发布 | https://medium.com/@guomengyue1987/termexo-v0-8-5-making-windows-terminal-behavior-more-consistent-1751503b2423 ；已进入正式文章页；主题 Software Development，关闭订阅者通知 |
| 微博 | 已发布 | https://weibo.com/1906408514/RhmDD2cU8 ；首页出现本人新微博及正文，时间 2026-09-09 23:52，标注 AI 生成 |

| SegmentFault | 已发布 | https://segmentfault.com/a/1190000048285864 ；正式文章页显示全文、作者 gemron、windows 标签；技术复盘稿，不含官网推广号召 |

本轮共处理 9 个渠道：7 个发布成功，2 个已提交待审核。审核中不等于已公开收录；发布成功依据平台成功提示及登录会话中的正式文章页核验，不代表已被搜索引擎收录或获得曝光。

## 未投放渠道

沿用本次会话中既有核验记录（见 launch-2026-09-09.md），未重新尝试受阻入口：

- V2EX：账号仍有邀请码激活的既有阻塞记录，本轮未发。
- 微信公众号：浏览器站点安全策略曾禁止访问 mp.weixin.qq.com，本轮未尝试绕过。
- AlternativeTo、HelloGitHub、阮一峰周刊：此前项目自荐尚待审核或编辑反馈，本轮未重复提交。
- Reddit：此前独立展示帖遭过滤，每周分享串已有投稿，本轮未重复投放。
- HN、DEV：依照此前核验的 AI 文稿或产品推广限制，本轮未提交推广文。

## 渠道文案处理

- X、微博：精简更新说明，列出 ConPTY 修复、WebView2 提示及新版官网；明确维护者身份与 AI 辅助。
- 知乎、掘金、CSDN：以 Windows 终端兼容性问题为切入点，保留环境要求和正式 Release 链接。
- OSCHINA：软件更新资讯，已进入审核队列。
- Product Hunt：在既有 Termexo 产品论坛发布更新帖，没有创建重复产品或发起新 Launch。
- Medium：英文技术文章，主题 Software Development；发布时关闭订阅者邮件通知。
- SegmentFault：标题《Windows 终端兼容性复盘：Shift+Tab 丢失、鼠标报告与重复换行重排》，介绍输入转换、随包分发 ConPTY、避免重复重排及区分 WebView2 故障；正式 Release 作为技术来源。
