# AlternativeTo 实际提交资料（2026-09-07）

状态：已提交，普通免费队列待审核，目前仅提交账号可见，不作为公开收录宣传。账号 guomengyue1987-beep；投稿前 My submissions 为空，表单未要求补充邮箱验证。仅提交一次，未购买加急审核。

- 条目 ID：a73d62f1-3c38-4e7b-9db2-c81fecd2629a
- 内部预览：https://alternativeto.net/software/termexo/about/ （平台明确提示审核前不要对外分享）
- 状态入口：https://alternativeto.net/my-submissions/
- 核验：My submissions 显示 `Submitted Sep 7, 2026 · In the normal queue, which is very long`；条目页显示 `Your submission is waiting to be reviewed` 以及 `Only you can see this app right now`。
- 已保存官网、源码、完整英文介绍、MIT/Free、Windows、中英文、Dark Mode、图标及两张截图；最终条目页均能读取。
- 作者字段选择创建 gemron；保存后的详情页显示 Guo Mengyue，源码元数据显示 TypeScript。未改写用户账号。
- 已建议 Wave Terminal 为一个相近终端工作台，并在关联页看到 1 个替代项；没有批量添加其他应用、点赞或评论。用途依据：https://www.waveterm.dev/ 。详情摘要一度显示 0 alternatives，可能未同步，未据此重复提交。

规则：https://alternativeto.net/faq/ 。本轮已阅读 FAQ 与使用条款；描述不放网址，官网不加 UTM，只选免费普通审核。官方表示普通审核可能等待数月，提交不代表收录。对基础 AI 工具和 LLM 包装器等有拒收政策；本项目按真实 PTY 工作台如实描述，由编辑判断是否符合收录标准。

## 实际字段

- Name: Termexo
- Official website: https://www.termexo.com/
- Source code: https://github.com/gemron/Termexo
- Cost: Free
- Open source: Yes (MIT)
- Platform: Windows (Windows 10/11 x64)
- Languages: English, Chinese
- Tags: terminal-emulator, developer-tools；勾选 Dark Mode 后自动增加 night-mode
- Windows note: Windows 10/11 x64; WebView2 required.
- Microsoft Store 链接留空，未将 GitHub releases 冒充商店链接。
- 图标：src-tauri/icons/icon.png（512×512）
- 截图：docs/promotion/assets/termexo-workbench-v0.8.png、termexo-remote-v0.8.png；上传前目视检查，均小于 3MB，预览和保存后的图片均正常。
- 图片说明分别为普通 Shell 演示工作区和手机尺寸远程 Git 面板，不冒充 Agent 实测截图。

## Short description

Windows terminal workbench for coding-agent sessions, tasks and Git changes, with optional phone access over a trusted LAN or VPN.

## Description

Termexo is an MIT-licensed Windows desktop application that brings Claude Code, Codex CLI, OpenCode and ordinary shells into a single workspace. Sessions run in real pseudo-terminals. The workbench provides input and approval status indicators, native session history and resume, model/provider configuration, a task board and Git change inspection.

Optional remote access lets a phone browser interact with the same terminal processes running on the Windows host. The host must remain running. Remote access is disabled by default, uses self-signed HTTPS and an access token, and is intended for trusted LAN or VPN use. Historical session resume does not revive exited processes.

The application is free and currently supports Windows 10/11 x64. Agent CLIs must be installed and configured separately and may require provider accounts or paid services. English and Chinese user guides are available online and as downloadable PDFs.

## Reviewer note（已填入 Note about your changes）

Submitted by the project maintainer. Description prepared with AI from project documentation. This is a terminal/session workbench around existing agent CLIs; it does not provide its own hosted LLM service.
