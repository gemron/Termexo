<!--
平台：OSCHINA
标题：Termexo V0.8.1 发布：本地多 Agent 工作台加入远程访问与会话级 Git 视图
分类：开源项目 / 软件更新
标签：开源软件、AI 编程、Claude Code、Codex、OpenCode、Tauri、Rust、Windows
发布声明：项目维护者原创；正文截图为真实产品界面，封面待补（本次未生成 AI 封面）。
-->

# Termexo V0.8.1 发布：本地多 Agent 工作台加入远程访问与会话级 Git 视图

## 摘要

Termexo 是一个 MIT 开源、仅在本地运行的 Windows 多 Agent 编程工作台，把 Claude Code、Codex CLI 与 OpenCode 放进同一套工作空间与终端网格中管理。V0.8 的主线是远程访问：打开开关后，同一局域网或 VPN 内的手机、平板、另一台电脑用浏览器即可打开完整工作台，实时读写桌面上正在运行的同一批 PTY 进程。V0.8.1 补上了首次启动引导，并把「新建终端」归位到标签栏。

## 版本要点

- **远程访问**：局域网或 VPN 内的任意浏览器打开完整工作台，同一批工作空间、同一批终端，不是只读镜像，也不是另开一套会话。
- **手机端布局与手指滚动**：640px 以下收成单终端，面板浮在工作区之上；拖拽合成滚轮事件交给 xterm 分发，全屏 TUI 行为与桌面滚轮一致。
- **会话级 Git 视图**：跟随当前终端，以该终端启动时的 HEAD 为基线，显示本次会话的变更、提交与 Diff。
- **V0.8.1 新手引导**：新安装不再种入示例工作空间，改为从空开始并说明前三步。
- **V0.8.1「新建」归位**：接管标签栏的 `+`，Agent 菜单一并带过去，新建后直接切回终端视图并显出新终端。

## 远程访问：复用同一张命令表

这是本次发布的主角。在设置里打开远程访问后，Termexo 在本机监听，默认自签名 HTTPS，凭访问令牌进入；设置面板可以显示令牌、生成二维码、随时更换，并带上「已连接设备」计数。

![手机通过远程访问打开工作台](../assets/termexo-remote-v0.8.png)

实现上没有为远程端另写一套后端。从 socket 收到的请求被转成 `InvokeRequest` 交给主 webview，走与本地完全相同的命令与反序列化路径，因此远程与本地不会出现行为分叉。代价是授权模型必须自己扛：Tauri 的 ACL 在本地来源下不覆盖应用命令，而桥接必然声称本地来源，所以**显式白名单是唯一的授权边界**——npm 自更新、原生文件读写、以及修改远程访问设置本身都被拒绝。

还有两个工程细节值得一提。其一，xterm 6 把缓冲区画在 canvas 上并自绘滚动条，手指拖拽本来触达不到任何可滚动元素，现在改为把拖拽合成滚轮事件交给 xterm 分发，松手带惯性。其二，一个 PTY 只有一个尺寸，它属于「正在使用的那一端」：在电脑上操作就用电脑的宽度，拿起手机就换成手机的，其余客户端渲染同一网格、装不下时横向平移。

## 会话级 Git 视图

Git 视图跟随当前终端，以该终端启动时的 HEAD 为基线，显示这次会话动过哪些文件、提交了哪些内容，任意文件可看单栏或双栏 Diff 并显示 +N / −N 行数。停留在该视图时会持续读取仓库，不用手动刷新；切换当前终端或读取失败都不会把你弹回终端视图，读不到时会说明原因；离开再回来仍停在原来的文件和 Diff 布局上。

![会话级 Git 视图](../assets/termexo-git-v0.8.png)

Agent 的原生会话文件（`~/.claude/projects/**/*.jsonl`、`CODEX_HOME/sessions`）始终只读，Termexo 自己的元数据存进自己的库。

## 一直成立的部分

![V0.8 桌面工作台](../assets/termexo-workbench-v0.8.png)

一个 Workspace 等于一个项目目录加上在里面运行的终端，目录、标签、布局、模型与主题都会持久化；终端数量不限，可配 1–6 行列自定义网格；Agent 事件统一映射为运行、思考、等待输入、等待授权、完成与失败，配常驻提示条、Windows 通知与任务栏闪烁；会话中心可搜索本机会话并用各自 CLI 的原生方式恢复；任务看板的任务可跑成真实 Agent 终端。界面支持简体中文、英语、西班牙语、法语、德语、日语、韩语。

技术栈为 Angular 22 前端加 Tauri 2 / Rust 外壳，终端是真实 PTY，数据存本机 SQLite，API Key 只进 Windows Credential Manager，前端拿不到明文。项目采用 **MIT 许可证**。

## 边界

- **仅 Windows**，没有 macOS / Linux 版本。
- 远程访问面向可信网络（家庭局域网或 VPN）。自签名证书会让浏览器提示不安全，每台设备需手动确认一次；访问令牌等同于这台电脑上 Termexo 的完整控制权。
- 远程端不能修改远程访问设置本身，也不能导入导出网络配置或触发 npm 自更新。
- 终端只有一个尺寸，以最后一次调整为准，手机上打开终端会同时改变桌面端的列数。
- 任务看板不同步，任务保存在各自浏览器本地。
- Codex 第三方 Endpoint 需要兼容 Responses API，不承诺所有第三方模型都兼容。
- 本地优先不等于离线：Agent 仍会按所选供应商访问模型服务；远程访问是唯一一条对外连接，且由用户自己打开、自己发令牌、随时可关。

## 安装与体验

Windows 10/11 x64 用户可以直接运行：

```powershell
npx termexo@latest
```

也可以从 GitHub Release 下载安装包，或全局安装：

```powershell
npm install --global termexo@latest
termexo
```

通过 npm 运行需要 Node.js 18.18 或更高版本，应用依赖 Windows WebView2；从源码构建另需 Rust 与 Visual Studio C++ 生成工具。

- 官网：https://www.termexo.com
- GitHub：https://github.com/gemron/Termexo
- Release：https://github.com/gemron/Termexo/releases/tag/v0.8.1
- npm：https://www.npmjs.com/package/termexo

欢迎试用、反馈与贡献，Issue、复现报告与 PR 都很欢迎；如果 Termexo 确实改善了你的多 Agent 工作流，也欢迎在 GitHub 留下一个 Star。

## 建议标签

`开源软件` `AI 编程` `Claude Code` `Codex` `OpenCode` `Tauri` `Rust` `Windows` `远程访问`
