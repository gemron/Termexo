# 电脑运行，手机接着操作：30 秒实录

状态：分镜及字幕已准备，真实双端素材尚未录制。不要把现有官网连接动画、静态截图或浏览器模拟终端标为实时远程演示。

## 录制准备

- 使用当前稳定版 Termexo、一个无私密文件的演示项目和已配置的 Agent。
- 电脑保持唤醒，手机连接同一可信局域网或 VPN；远程访问由操作者启用。
- 双端同时录屏。不要录入访问令牌、连接二维码、API Key、个人目录或真实客户内容。
- 先连接，再开始录制；若遇到自签名证书警告，由操作者核实并处理。
- 给 Agent 一个简单、可验证的任务，例如给演示项目添加一项测试。保留人工审批，不自动同意。

## 分镜

| 时间 | 实际画面与操作 | 中文字幕 | English caption |
| --- | --- | --- | --- |
| 00–05 秒 | 电脑工作台内提交任务，终端开始处理 | 编程 Agent，在电脑上运行 | Your coding agent runs on your PC. |
| 05–10 秒 | 终端出现真实的审批请求；停留到能读清 | 它需要确认时，你不用一直守在桌前 | When it needs approval, you can respond from your phone. |
| 10–16 秒 | 手机已连接同一个工作台，看到相同请求 | 手机浏览器，打开同一个终端 | Open the same terminal in your phone's browser. |
| 16–22 秒 | 手机点击或输入该 CLI 实际要求的确认操作 | 手机上确认，电脑接着执行 | Approve on your phone. The PC continues. |
| 22–27 秒 | 双端分屏显示同一段后续输出 | 同一个会话，无需迁移或重开 | Same session. No transfer or restart. |
| 27–30 秒 | 清晰结束卡：项目名、GitHub 地址 | Termexo · Windows · MIT 开源 | Termexo · Windows · MIT open source |

字幕模板：`phone-demo.zh.srt`、`phone-demo.en.srt`，时间轴需根据实录调整。
画面常驻小字：`电脑需保持运行 · 可信局域网 / VPN` / `PC stays on · Trusted LAN / VPN`。
如果实际任务等待时间更长，可剪掉等待片段并标注“等待已剪辑”，不把剪辑后的时长当作性能指标。

## 交付与核验

1. 导出 1920×1080 MP4（H.264）及中英文字幕各一版，终端文字放大到手机上也能读清。
2. 检查审批前后双端输出是否一致；确认手机操作真的改变了电脑上的同一会话。
3. 检查每一帧是否有凭据、二维码、连接地址或私人内容。
4. 上传并验证视频后，才把 README 首张截图替换成可点击的视频封面。
5. 对外配文注明：维护者演示；视频字幕与文案由 AI 辅助整理。

中文配文：

> Agent 还在电脑上跑，人离开桌面后怎么接着操作？这是 Termexo 的实际使用流程：手机浏览器打开同一终端，回复审批，电脑继续执行。Windows / MIT 开源，需可信局域网或 VPN，电脑保持运行。源码：https://github.com/gemron/Termexo

English copy:

> My coding agent stays on my Windows PC. I open the same terminal on my phone, respond to an approval, and the PC continues. Termexo is MIT-licensed and works over a trusted LAN or VPN with the PC kept awake. Source: https://github.com/gemron/Termexo
