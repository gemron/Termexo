# v0.10.6 原生桌面实录

录制日期：2026-09-25（Asia/Shanghai）。官网素材已经替换为本次录屏，并于同日发布至 https://www.termexo.com/ 。

发布提交：`b86c638bd1abf606d5fcc8de88529ac6e21138a9`（`gh-pages`）。GitHub Pages 部署成功，线上页面、脚本、样式、视频、封面及中英文指南与本地发布内容一致。

## 实际内容

30 秒，两个真实 Antigravity 会话在同一个 `demo-web` 工作区中处理文档和代码检查任务。

| 成片时间 | 实际画面 |
| --- | --- |
| 0–4 秒 | 全局 Agent 提示列出已完成的文档、代码检查会话 |
| 4–9 秒 | 点击文档会话，回到 Agent 提出的受众问题 |
| 9–16 秒 | 输入「面向新贡献者」及文档要求 |
| 16–22 秒 | 提交回复，状态变为思考中、运行中，出现真实后续输出 |
| 22–30 秒 | 分屏查看两个会话的结果，展示项目入口 |

Antigravity 在提出问题后报告的状态是「已完成」。本片按这个真实状态描述；没有把它改成等待审批，也没有注入状态事件或替换终端输出。
画面是单项目的两个会话，本片不作为跨项目跳转或手机远程控制的实录证据。

## 环境和隔离

- 应用：Termexo v0.10.6，基于 `cc31a45` 及当前工作区改动构建。
- 系统：Windows 11 Pro，10.0.26200。
- 实际 CLI 标题：Antigravity CLI 1.2.10；模型：Gemini 3.8 Flash (High)。
- 独立应用标识：`dev.termexo.recording20260925`；窗口标题：`Termexo Recording`。
- 独立用户目录、应用数据库与 WebView2 数据目录位于被 Git 忽略的 `.tooling/recording-20260925/`。未移动、替换或清空日常应用数据库。
- 演示项目只有示例商品数据和 README，Agent 任务仅要求读取、分析和生成文字。
- 自动确认关闭。首次目录信任、剪贴板权限和隐私选项由用户操作。
- Claude 的原有 AI Gateway 返回了要求绑定支付方式的 403，因此正式素材使用可用的 Antigravity 会话。

## 原片和剪辑

原片保留在本机 `.tooling/recording-20260925/native-take-04.mp4`，时长 194 秒。
原片未采用的开头包含账号信息，**不要上传原片**。成片从原片第 98 秒开始取材，账号开场已经剪去。

原片 SHA-256：

```text
d114f8498ac0c29e470d76432b571f14e9f048fedf10c101aec7572143dfeeb4
```

采用的原片区间（秒）：`98–107`、`120–127`、`138–144`、`156–160`、`176–180`，保持发生顺序，总计 30 秒。
只剪去间隔并在原生窗口下方增加中英字幕；窗口画面未合成，未加速，未伪造操作结果。

Windows 安装 FFmpeg 后，在仓库根目录运行：

```powershell
node scripts/render-website-demo.mjs
```

脚本校验原片哈希，输出到 `.tooling/recording-20260925/export/`：

- `termexo-workbench-demo.mp4`：H.264，1440×1000，30 fps，30 秒，无音轨，faststart。
- `termexo-workbench-demo.png`：成片 26.5 秒处的同源封面。
- `captions.ass`：中英字幕。
- `recording-metadata.json`：版本、原片哈希、剪辑区间与 ffprobe 结果。

官网使用 `assets/termexo-workbench-demo.mp4` 和同名 PNG。旧 v0.6 素材保留在本机 `.tooling/recording-20260925/previous-v06/`。

## 验收

- 原片、关键帧、字幕和封面经过目视复核；发布素材不含开场账号信息。
- 视频完整解码及 ffprobe 检查；官网以可见浏览器检查播放、时长和中英文说明。
- 首次创建项目流程相关 70 项测试通过，前端与隔离原生应用构建通过。
- 项目保存成功后才启动 Agent；保存失败保留名称、路径和 Agent 选择，允许重试。
- 官网资源指纹通过 `node scripts/version-website-assets.mjs` 更新，运行 `node --test scripts/website-*.test.mjs`。

用户确认「发布」后执行官网部署；仅发布静态官网文件，原片和独立录制环境保留在本机。
