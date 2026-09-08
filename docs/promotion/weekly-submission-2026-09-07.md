我是 Termexo 的维护者，推荐这个 MIT 开源的 Windows 多 Agent 编程工作台。

项目地址：https://github.com/gemron/Termexo

Termexo 将 Claude Code、Codex CLI、OpenCode 和普通 Shell 放进同一个窗口，用真实 PTY 运行它们，集中查看多个终端和等待输入的状态，并提供原生会话恢复、模型配置、任务看板及 Git 变更视图。它不是另一个模型服务，也不要求注册 Termexo 账号；Agent 自身仍需相应的安装、账号或模型服务配置。

V0.8 的新增功能是手机远程访问：桌面端启用后，可以从可信局域网或 VPN 内的浏览器操作 Windows 主机上正在运行的同一批终端，不是只读截图，也不是另开一批进程。当前最新发布为 V0.8.1。

![Termexo V0.8 真实工作台截图：演示项目中的两个 Shell 终端](https://raw.githubusercontent.com/gemron/Termexo/main/docs/promotion/assets/termexo-workbench-v0.8.png)

### 体验与文档

- [Windows 安装包](https://github.com/gemron/Termexo/releases/tag/v0.8.1)；也可运行 `npx termexo@latest`（需要 Node.js 18.18+）。
- 环境：Windows 10/11 x64、WebView2；目前没有 macOS / Linux 构建。
- [官网](https://www.termexo.com/)、[中文使用说明](https://www.termexo.com/guide.html)、[English guide](https://www.termexo.com/guide.en.html)。两种语言的指南均支持在线阅读及 PDF 下载。

### 使用边界

远程访问默认关闭，使用自签名 HTTPS 与访问令牌，面向可信网络；主机必须保持运行，令牌和二维码不能公开分享。历史会话恢复不等于让已退出的进程继续运行，Agent 产生的代码修改仍需人工检查。

欢迎试用并反馈安装、多终端管理和远程操作中的具体问题。本投稿由项目维护者发起，文字由 AI 辅助整理。
