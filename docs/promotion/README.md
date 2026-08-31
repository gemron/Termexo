# Termexo V0.4.4 多平台推广包

这套内容以“真实技术经验 + 可验证产品能力”为主，不采用刷屏、互赞、夸大性能或伪装第三方报道的方式获取 Star。

## 统一信息

- 项目：Termexo
- 定位：Windows 上的 Claude Code / Codex 本地多 Agent 工作台
- 当前版本：V0.4.4
- 许可证：MIT
- GitHub：https://github.com/gemron/Termexo
- Release：https://github.com/gemron/Termexo/releases/tag/v0.4.4
- npm：https://www.npmjs.com/package/termexo
- 快速体验：`npx termexo@latest`
- 环境：Windows 10/11 x64、WebView2、Node.js 18.18+

## 素材清单

| 文件 | 用途 | 建议位置 |
| --- | --- | --- |
| `assets/termexo-cover-landscape.png` | 横版主封面 | OSCHINA、掘金、CSDN、思否、知乎、IT之家投稿 |
| `assets/termexo-cover-square.png` | 方形信息流封面 | 动态、朋友圈、社区短帖 |
| `assets/termexo-workbench.png` | 真实多终端工作台 | 正文第一个功能段 |
| `assets/termexo-session-center.png` | 真实会话中心 | 会话恢复段 |
| `assets/termexo-models.png` | 真实模型 Profile | 模型供应商段 |
| `assets/termexo-attention.png` | 真实状态提醒 | Agent 状态段 |

封面由 OpenAI 图像模型基于 Termexo 真实界面生成；正文截图来自项目仓库。平台提供 AIGC 标注时，封面应选择“AI 辅助生成”。

## 发布顺序

1. OSCHINA：先投“软件收录/更新资讯”，再发技术博客，避免重复营销。
2. 掘金：发布工程实践版，选择“人工智能 / 开发工具 / Rust”标签。
3. CSDN：发布 PTY、会话恢复和 Profile 设计版；只保留必要的 GitHub 源码链接。
4. SegmentFault：发布架构复盘版，强调问题、取舍和边界。
5. 知乎：回答“多个 AI 编程终端如何管理”这一真实问题，明确项目维护者身份。
6. V2EX：在“分享创造”节点发短帖，邀请真实反馈，不要求互 Star。
7. IT之家：走投稿入口，使用第三人称新闻稿，不把它当个人博客直接发布。

## 平台合规原则

- 标题只描述实际能力，不使用“最强、神器、吊打、必装”等无法证明的词。
- 正文明确“项目维护者”身份；不冒充媒体测评或普通用户推荐。
- 不承诺所有第三方模型都兼容。Codex 第三方 Endpoint 需要兼容 Responses API。
- 不公开 API Key、账号、私有项目路径或真实会话内容。
- 每个平台使用独立切入角度，避免批量发布完全相同的文章。
- CTA 统一为“欢迎试用、反馈、贡献；如果确实有帮助可 Star”，不做互赞或奖励诱导。

## 文章文件

- `articles/01-oschina.md`
- `articles/02-juejin.md`
- `articles/03-csdn.md`
- `articles/04-segmentfault.md`
- `articles/05-zhihu.md`
- `articles/06-v2ex.md`
- `articles/07-ithome-submission.md`
- `articles/08-short-posts.md`

## V0.6.0 补充素材

- 平台中立图文软文：`articles/09-v0.6-soft-article.md`
- 掘金工程实践稿：`articles/10-juejin-v0.6.md`
- CSDN 功能与安装稿：`articles/11-csdn-v0.6.md`
- 知乎问题回答稿：`articles/12-zhihu-v0.6.md`
- Medium 英文技术稿：`articles/13-medium-v0.6.md`
- Product Hunt V0.6 发布字段：`articles/14-product-hunt-v0.6.md`
- OSCHINA 开源项目稿：`articles/15-oschina-v0.6.md`
- 微信公众号图文稿：`articles/16-wechat-v0.6.md`
- 微信公众号可粘贴排版稿：`articles/16-wechat-v0.6.html`
- V0.6 横版封面：`assets/termexo-cover-v0.6.png`
- 任务看板真实截图：`assets/termexo-task-board.png`

### V0.6 演示录屏

由 `npm run capture:demo` 对真实桌面构建录制（不是演示动画），每个场景同时产出 MP4 与 GIF。
MP4 用于官网、视频号与 Release Notes；GIF 用于公众号与 README，均已压到 10 MB 以内。

| 文件（`media/`） | 内容 | 时长 | GIF 体积 |
| --- | --- | --- | --- |
| `termexo-workbench.mp4` / `.gif` | Claude Code 与 OpenCode 并排跑在网格里，标签与右侧状态面板实时变化 | 24 秒 | 2.1 MB |
| `termexo-tasks.mp4` / `.gif` | 建任务 → 起真实 Agent 终端 → 回看板看流转 → 人工验收 | 21 秒 | 2.0 MB |
| `termexo-sessions.mp4` / `.gif` | 会话中心列出本机原生会话，逐条可恢复 | 9 秒 | 0.7 MB |
| `termexo-models.mp4` / `.gif` | 模型 Profile 与供应商配置 | 8 秒 | 1.0 MB |

录制约束（脚本已强制，不要绕过）：

- 全程在挪开真实数据库、且独立 WebView2 profile 的一次性实例中进行，画面里只有演示工作区
  `shop-api`（`D:\devlop\termexo-demo`），不会出现真实项目名、路径或任务。
- 终端里跑的是真实 Claude Code 与 OpenCode，工具调用和耗时都是实际发生的。
- 中断后若残留 stash，用 `npm run capture:demo -- --restore` 还原真实数据库。

补充文章覆盖 V0.4.4 之后的 V0.4.5、V0.5.0 与 V0.6.0，适合在公众号、掘金、知乎、
OSCHINA 或 CSDN 按平台格式稍作调整后发布。封面由 OpenAI 图像模型参考 Termexo 当前界面生成；
正文截图来自项目仓库。
