# 知乎：问题回答稿

## 建议问题

同时开多个 Claude Code 和 Codex 会话，怎样管理才不容易乱？

## 回答标题

我的做法：不要管理“窗口”，而要管理 Workspace、会话和 Agent 状态

## 回答

先说明身份：我是开源项目 Termexo 的维护者。这个回答来自我在 Windows 上并行使用 Claude Code 和 Codex 时遇到的问题，不是第三方测评。

多个 AI 编程终端真正让人混乱的，通常不是窗口数量，而是下面四件事：

1. 不知道哪个 Agent 在等输入或授权；
2. 记不住某条会话属于哪个项目、分支、账号和模型；
3. 重启后只能恢复终端布局，不能恢复 Agent 的原生上下文；
4. 切换第三方模型时，界面变了，但请求未必真的走到新的供应商。

我最后采用的是“Workspace + 真实 PTY + 原生会话恢复”的结构。

![Termexo 多 Agent 工作台](../assets/termexo-workbench.png)

每个 Workspace 绑定项目目录和终端布局，Claude Code / Codex 继续跑在真实 PTY 里。界面把它们的生命周期归一为运行、思考、等待输入、等待授权、完成和失败。这样我不需要不停切窗口，只要处理真正亮起提醒的 Agent。

恢复会话时，不复制聊天记录，也不自己模拟上下文。Termexo 只读扫描本机原生会话，然后调用 `claude --resume` 或 `codex resume`。

![Agent 会话中心](../assets/termexo-session-center.png)

模型供应商是另一个容易踩坑的地方。Claude Code 和 Codex 使用不同的配置入口；Codex 当前还需要供应商兼容 Responses API。Termexo V0.4.4 把模型配置按供应商组织，并分别保存两个 Agent 的模型与 Endpoint。切换前预检，失败时恢复原会话和原配置。

我也加了供应商余量和本地 Token 统计，但有一个原则：供应商没有公开额度接口时，就明确显示“估算”或“不可用”，不伪装成官方余额。

安全边界上，Workspace 和索引留在本机 SQLite，API Key 放进 Windows Credential Manager，Claude/Codex 原始会话文件只读，也不需要注册 Termexo 账号。

如果你使用 Windows 10/11 x64，可以直接体验：

```powershell
npx termexo@latest
```

GitHub：https://github.com/gemron/Termexo

这套方案未必适合只开一个 Agent 的人，但对多项目、多账号、多模型并行时很有帮助。欢迎在评论里分享你的工作流和最难受的环节；如果项目确实解决了问题，也欢迎在 GitHub Star 或提交 Issue。

## 建议话题

`人工智能` `编程` `开源软件` `Claude Code` `Codex`

## 发布声明

回答由项目维护者基于 V0.4.4 公开源码整理，使用 AI 辅助校对与封面生成，正文截图为真实产品界面。
