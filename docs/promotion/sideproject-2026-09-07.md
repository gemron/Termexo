# r/SideProject 实际提交（2026-09-07）

状态：已提交一次，但随后被 Reddit 过滤器移除，不能算公开推广成功。未删除重发、未修改以规避过滤、未给管理员发送申诉。

链接：https://www.reddit.com/r/SideProject/comments/1w9qpj8/i_built_termexo_a_windows_workbench_for_coding/

账号：Equivalent-Season594。账号全部 submitted 记录中未发现此前的 Termexo 或 SideProject 帖子（after=null）；社区搜索返回近似内容，但未发现 Termexo 项目帖。规则接口返回空社区规则列表，投稿页说明用于分享项目与接收建设性反馈；未向置顶的 Not-AI 专题串投稿。

验证：点击 Post 后返回社区页并展示新帖；打开永久链接后，作者会话显示完整正文及 `Sorry, this post was removed by Reddit’s filters.`。公共 Web 读取也显示同一移除提示，正文不公开。独立浏览器遇到人机验证，未尝试绕过。平台未说明具体触发原因，不推断是 AI、链接或 Karma 导致。

## 标题

I built Termexo: a Windows workbench for coding agents, with phone access to live terminals

## 正文

Termexo is my MIT-licensed side project for keeping Claude Code, Codex CLI, OpenCode and ordinary shells in one Windows workspace.

The problem it addresses is coordination: with several CLI sessions open, which one needs input, which is waiting for approval, and which earlier session should you resume? Termexo runs real PTYs, surfaces session status, and reads the agents' native history for resume. It also includes a task board and Git change inspection.

The recent addition is phone access. Open the remote page in a mobile browser on a trusted LAN or VPN, and you're interacting with the terminal process already running on the Windows PC. The PC must stay on. This isn't a cloud runner or a way to bring an exited process back to life.

One design tradeoff: a shared PTY only has one row/column size. The active viewer controls that size; the other screen follows the same grid rather than giving each device an independent terminal layout.

Current release is V0.8.1, Windows 10/11 x64 only. The app is free; agent CLIs still require their own installation and account/provider setup. Remote access is off by default and uses self-signed HTTPS plus a token. Keep the token and QR code private.

Source, screenshots and downloads: https://github.com/gemron/Termexo
English guide, with downloadable PDF: https://www.termexo.com/guide.en.html

For developers running several agents, what would you want visible in a phone view: sessions needing input, recent output, or the task board?

Disclosure: I maintain Termexo. This post was written by AI using the project's implementation and documentation.
