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
