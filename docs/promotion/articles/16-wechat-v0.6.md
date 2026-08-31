<!--
平台：微信公众号
类型：图文推送（原创）
版本：V0.6.0
发布声明：项目维护者原创；封面由 AI 辅助生成，正文截图为真实界面。
排版提示：公众号正文中的 https 链接不可点击，域名以纯文本呈现，仓库地址放到「阅读原文」。
-->

# 微信公众号：V0.6.0 图文推送

## 标题

主选：三个编程 Agent 同时开工，我把它们收进了一个 Windows 窗口

备选一：Claude Code、Codex、OpenCode 一起用，终端开成一排之后我做了个工具
备选二：让 AI 写代码之后，我花在「找终端」上的时间反而变多了

## 摘要（公众号摘要栏，建议 120 字以内）

Termexo 是一个 MIT 开源、本地运行的 Windows 多 Agent 工作台：三个编程 Agent 跑在真实终端里，任务能直接跑起来，昨天的会话今天还能原样接上。

## 封面建议

- 主图：`assets/termexo-cover-v0.6.png`（16:9 大图封面）
- 小图封面：`assets/termexo-cover-square.png`
- 平台若提供 AIGC 标注，封面选择「AI 辅助生成」

---

## 正文

### 一、Agent 变多之后，真正被消耗的是注意力

如果你已经把 Claude Code、Codex 或 OpenCode 用进日常开发，大概经历过这样的场面。

几个项目同时推进，终端开了一排。这个 Agent 在跑测试，那个 Agent 停在那儿等你确认，昨天有一段重要会话，你已经想不起来它在哪个窗口里。

AI 写代码越来越快，但开发者的注意力并没有跟着变多。

真正花掉时间的，不再是敲代码，而是在一排终端之间来回确认「谁在干活、谁卡住了、我刚才那段上下文去哪了」。

这就是我做 Termexo 的原因：把散落的编程 Agent 收进一个可观察、可恢复、能真正承接任务的 Windows 工作台。

> 配图：`assets/termexo-cover-v0.6.png`
> 图注：Termexo V0.6，一个窗口装下所有编程 Agent

### 二、它不是又一个聊天框

先说清楚它不做什么。

Termexo 不替换 Claude Code、Codex 和 OpenCode，也不重新包装它们的对话界面。三个 Agent 仍然运行在真实 PTY 终端里，你看到的输出和原生 CLI 完全一致。

Termexo 负责的是上面那一层：工作空间、布局、状态、会话与任务。

你可以为不同项目建立 Workspace，在一个窗口里打开多个 Agent 终端，再按需要排成 1 到 6 行或列的网格。项目目录、终端标签、布局、模型和主题都会保留下来。

哪个 Agent 正在思考、在等输入、在等授权、已经完成还是执行失败，可以直接从标签、提示条和右侧状态面板看到。

当某个 Agent 真正需要人的时候，Windows 系统通知和任务栏提醒会把你带回对应的终端。

工作方式于是从「轮流点开每个窗口看看」，变成「只处理需要我介入的地方」。

> 配图：`media/termexo-workbench.gif`（2.1 MB，24 秒）
> 备选静图：`assets/termexo-workbench.png`
> 图注：Claude Code 与 OpenCode 并排运行，状态随 Agent 实时变化

### 三、V0.6 最大的变化：任务能直接跑起来

这一版把 OpenCode 升级成了和 Claude Code、Codex 并列的一等 Agent。启动、会话发现与恢复、重启还原、状态识别、自动确认，全部走同一套工作流。

更关键的是新增的任务看板。

每条任务可以带上项目、优先级、验收标准、目标 Agent 和模型。点击「开始执行」，任务会创建一个真实的 Agent 终端，并随着终端状态在待办、执行中、已完成和已验收之间流转。

也就是说，看板不只是手工拖卡片：任务、Agent 会话和验收结果属于同一条链路。

Agent 做完之后，人仍然可以选择「验收通过」或者「继续修改」——最终判断权留在自己手里。

> 配图：`media/termexo-tasks.gif`（2.0 MB，21 秒）
> 备选静图：`assets/termexo-task-board.png`
> 图注：任务可直接运行成 Agent 终端，并从待办流转到验收

三个 Agent 也统一支持可选的自动确认模式，终端会用一致的 `AUTO` 标记提示当前状态。

这里想多说一句：自动确认适合你完全信任的仓库和边界明确的任务。涉及未知脚本、敏感数据或者高权限操作时，还是应该保留人工确认。

### 四、提示词和上下文，可以当成资产来用

Agent 多起来之后，下一个麻烦不是「怎么启动」，而是「怎么把上下文带走」。

Termexo 会按终端保存实时输入。窗口意外关闭时，还没发出去的草稿可以恢复；已经提交过的提示词可以搜索、收藏、置顶、删除和再次使用。

那些反复输入的测试要求、代码审查清单、发布步骤，不用再散落在剪贴板和聊天记录里。

更进一步的是会话交接。

Termexo 可以按当前终端或整个 Workspace 生成交接包，把任务状态、会话摘要、最近提示词、终端输出、Git 状态与 Diff、变更文件、验证结果、风险和下一步整理到一起。

交接内容既能导出成 Markdown，也能保存为机器可读的 JSON，还可以直接发送给另一个 Agent 继续处理。

为了避免交接包越滚越大，它支持 Token 预算，并且会在不破坏 UTF-8 字符的前提下截断过长内容；写入前还会清除常见的 API Key、Bearer Token、密码和 Secret。

这里迁移的是经过脱敏的工作上下文，不会去改 Agent 自己的原生会话记录。

### 五、昨天的会话，今天还能原样接上

Termexo 会跨项目、账号、分支和模型发现本机的原生会话，然后调用 Agent 自己的恢复能力：

- Claude Code 用 `claude --resume`
- Codex 用 `codex resume`
- OpenCode 用 `opencode --session`

原始会话文件始终保持只读。

Termexo 不会为了统一界面去改写 JSONL，也不会把历史对话伪装成一段新提示词丢回去。

这一点看起来不够「魔法」，但工具调用、上下文压缩和 Agent 自己维护的状态都会更可靠。

> 配图：`media/termexo-sessions.gif`（0.7 MB，9 秒）
> 备选静图：`assets/termexo-session-center.png`
> 图注：跨项目搜索并恢复本机 Agent 原生会话

### 六、模型、代理和账号，按 Workspace 隔离

如果你在用代理、企业网络或者不同的模型供应商，这部分可能更有用。

全局或 Workspace 级的网络 Profile 可以管理 HTTP、HTTPS、SOCKS、`NO_PROXY`、npm registry 和企业 CA。CLI 的安装与升级会先预览、确认并检查网络，失败之后尽量恢复原版本。

模型、Endpoint 和凭据被收进供应商 Profile。Claude Code 可以切换 Anthropic、DeepSeek、MiniMax、GLM 或自定义的 Anthropic 兼容端点，API Key 交给 Windows Credential Manager 保存。

模型切换会先做预检，部分失败时恢复原命令、原会话和原 Profile，尽量避免「界面显示已经切换，实际请求还发往旧地址」这种情况。

本地 Token 统计、速率曲线和 Plan 额度提醒也在这一层。没有公开配额接口的供应商会明确标成「估算」或「不可用」，不会拿一个看起来很精确的数字冒充官方数据。

> 配图：`media/termexo-models.gif`（1.0 MB，8 秒）
> 备选静图：`assets/termexo-models.png`
> 图注：模型、Endpoint 与供应商 Profile 集中管理

### 七、本地优先，是它刻意保留的边界

Termexo 不需要注册账号，也没有自己的云端中转服务。

Workspace、终端配置、会话索引和事件保存在本机 SQLite；API Key 保存在 Windows Credential Manager；Agent 原始会话只读。

需要说明的是，「本地优先」不等于模型请求不联网。Claude Code、Codex 和 OpenCode 仍然会按照你选择的供应商及其隐私政策访问对应的模型服务。Termexo 做的是本地的管理与编排，不替供应商中转请求。

### 八、它适合谁，不适合谁

比较适合这些情况：

- 同时维护多个项目，经常并行运行两个以上编程 Agent
- 需要频繁恢复历史会话，或者管理多个隔离账号
- 使用代理、企业网络或不同模型供应商，希望按 Workspace 隔离配置
- 想让任务、提示词、Git 上下文和 Agent 终端形成一套可追踪的工作流

如果你只是偶尔打开一个 CLI，完成一轮对话就退出，原生终端可能已经够用了。

Termexo 的价值，主要出现在 Agent 数量、项目数量和上下文切换开始消耗注意力之后。

### 九、一条命令就能试

Termexo 目前面向 Windows 10/11 x64，MIT 许可证开源。装好 Node.js 18.18+ 和 WebView2 之后，可以直接运行完整桌面应用：

```
npx termexo@latest
```

也可以从 GitHub Release 下载 EXE 或 MSI 安装包。

官网 www.termexo.com
GitHub github.com/gemron/Termexo
npm npmjs.com/package/termexo

仓库地址放在文末「阅读原文」。

如果你也在同时用 Claude Code、Codex 或 OpenCode，欢迎把真实的工作流和失败案例带到 Issue 里。

Termexo 还在快速迭代，但它想解决的问题一直很具体：让多个 Agent 帮你写代码，而不是让你花更多时间去管理一排终端。

---

*本文由 Termexo 项目维护者基于 V0.6.0 的公开源码与已发布功能整理。封面使用 AI 辅助生成，正文均为真实产品截图。*

---

## 发布设置

| 项目 | 内容 |
| --- | --- |
| 原文链接（阅读原文） | https://github.com/gemron/Termexo |
| 声明 | 原创 |
| 话题标签 | #AI编程 #ClaudeCode #开源项目 #开发工具 #Windows |
| 留言引导 | 你现在同时开着几个编程 Agent？评论区聊聊你的做法。 |
| 定时建议 | 工作日 12:00 或 20:00 推送 |

## 排版注意事项

- 公众号正文里的 https 链接不可点击，正文只保留纯文本域名，完整仓库地址放到「阅读原文」。
- 四段 GIF 均为真实界面录屏（`docs/promotion/media/`），全部在 10 MB 上限内，可直接上传。
  GIF 在手机上自动播放且不可暂停，正文里最多放三段，其余用静图，避免整篇都在动。
- 每张配图上传后建议保留图注，图注使用灰色小字。
- 代码块只有 `npx termexo@latest` 一行，可以用「代码」样式或等宽字体，避免长代码在手机上横向滚动。
- 小标题保持二级即可，不要再往下分层；段落尽量控制在三行以内。
- 首图与摘要要能独立说清「是什么」，因为很多人只看推送卡片。
- 不使用「最强、神器、吊打、必装」这类无法证明的措辞，与其他平台稿保持一致。
