### 项目地址

https://github.com/gemron/Termexo

### 类别

人工智能

### 项目标题

可从手机操作的 Windows 多 Agent 编程工作台

### 项目描述

同时运行多个编程助手时，很容易忘记哪个终端在等待输入。Termexo 将 Claude Code、Codex CLI、OpenCode 和 Shell 集中到 Windows 工作台，保留真实终端交互，提供状态提示、原生会话恢复和 Git 变更检查。远程访问开启后，手机可在可信局域网或 VPN 内操作主机上的同一批终端。项目采用 MIT 许可证，适合多项目、多 Agent 并行开发，也可作为学习 Tauri、Rust 与 PTY 集成的实例。

### 亮点

- 不是聊天界面套壳：Agent 运行在真实 PTY 中，保留原有 CLI 交互。
- 远程端操作主机上仍在运行的终端，不另起会话；桌面和手机共享同一 PTY 尺寸，需要接受窗口尺寸切换的取舍。
- 会话恢复使用 Agent 原生机制，不修改其历史会话文件，也不假装已退出的进程仍在运行。
- 已有中英文完整使用说明，两种语言均可在线查看或下载 PDF：[中文](https://www.termexo.com/guide.html)、[English](https://www.termexo.com/guide.en.html)。

当前发布版本 V0.8.1，仅支持 Windows 10/11 x64，需要 WebView2。远程功能默认关闭，使用自签名 HTTPS 和访问令牌，只适合可信网络；请勿公开令牌或二维码，主机需要保持运行。Agent 本身仍需安装和相应账号/模型服务配置。

### 示例代码

```powershell
npx termexo@latest
```

上述方式需要 Node.js 18.18+；也可直接下载 [Windows 安装包](https://github.com/gemron/Termexo/releases/tag/v0.8.1)。

### 截图或演示视频

![真实工作台截图，展示演示项目中的两个 Shell 终端](https://raw.githubusercontent.com/gemron/Termexo/main/docs/promotion/assets/termexo-workbench-v0.8.png)

我是项目维护者。本次为自荐，描述按此模板单独整理，文字使用 AI 辅助；不是第三方测评或用户背书。
