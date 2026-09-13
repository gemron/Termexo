# 官网维护与访问统计

官网为静态 HTML/CSS/JavaScript；生产域名为 https://www.termexo.com/ 。
GitHub Pages 从 `gh-pages` 分支根目录发布。仅修改 `main` 下的 `website/` 不会自动上线。
发布时将经过验证的官网文件同步到 `gh-pages`，保留 CNAME 和 .nojekyll，等待 Pages 构建成功。

## 公开访问计数器

使用[不蒜子原版服务](https://busuanzi.ibruce.info/)，无需注册、站点 ID 或 API 密钥。
页脚显示服务返回的累计访问次数（PV），提供中英文标签与第三方统计说明。

- `analytics.js` 只在 `www.termexo.com` 和 `termexo.com` 加载服务，本地预览、局域网地址不计数。
- 使用官方 HTTPS 异步脚本，数字写入 `busuanzi_value_site_pv`。
- 每次页面访问可能增加 PV；PV 不是独立访客数，也不是 GitHub Star 或下载量。
- 首次接入前的历史访问量无法补算；不手动填充或抬高计数。
- 初始值为“—”，服务慢、不可用或被拦截时保留该占位，不伪造为 0。
- 统计请求直接发往第三方服务，会暴露正常网络请求信息（例如 IP 与官网来源）。
  此脚本只存在于宣传官网，不进入桌面应用或远程工作台，也不读取应用会话或凭据。
- 数值依赖第三方可用性及其统计口径，不能用作精确结算或审计数据。
- 当前没有访问来源后台、UTM 活动报表或下载事件统计；如需这些指标应另行接入分析服务。
- 官网域名尽量统一为 www.termexo.com，服务可能按不同来源主机名分别计数。

[官方用法及 PV 说明](https://ibruce.info/2015/04/04/busuanzi/)。

## 推广归因

渠道链接见 `docs/promotion/campaign-2026-09.md`。
这些 UTM 参数为后续分析约定命名；公开 PV 计数器不会生成渠道转化报表。
官网顶部和支持按钮跳转 GitHub 使用 `noopener` 与仅发送来源域名的 Referrer-Policy，
便于 GitHub Traffic 识别官网来源。新增 Star 应单独从仓库统计。

## 使用说明与 PDF

- 中文在线入口：`https://www.termexo.com/guide.html`；英文入口：`https://www.termexo.com/guide.en.html`。
- 中文 PDF：`https://www.termexo.com/downloads/termexo-user-guide.pdf`；英文 PDF：
  `https://www.termexo.com/downloads/termexo-user-guide-en.pdf`。
- `guide.html` / `guide.en.html` 分别是中英文正文源；`guide.css` 提供共用阅读、手机和打印布局。
- 每页菜单、正文、PDF 均为该页语言；互链使用真实链接，禁用 JavaScript 仍可阅读和下载。
  `guide.js` 记录语言偏好并在切换时保留章节锚点。显式访问的语言网址优先，不按旧偏好重定向。
- 首页导航和页脚的使用说明链接随首页语言变化，与文档共用 `termexo.website.language` 偏好。
- 更新正文时同步维护两个语言版本，运行 `scripts/build-user-guide.py --language zh` / `--language en`
  从对应 HTML 重新生成 PDF；不要单独修改 PDF 内容。
- 构建需要 Python 与 `reportlab`，中文默认使用 Windows 微软雅黑，英文使用 Arial，均嵌入字体子集；其他系统用
  `--font` / `--bold-font` 指定支持中文且允许嵌入的 TrueType 字体。
- 版本变更时同时更新正文版本、下载文件名及脚本页脚版本；使用 `data-pdf-page` 控制 PDF 分页。
- 发布前将 PDF 每页渲染成图片检查中文与分页，并确认目录链接、下载文件、正文版本一致。
- `scripts/verify-user-guide.py` 使用 `pypdf` 验证正文完整性、书签和中文文本，使用 `pymupdf`
  检查页面文字边界；传入 `--render-dir` 可渲染全部页面供人工检查。
- 部署需要同步两份指南 HTML、`guide.css`、`guide.js` 和整个 `downloads/` 文档目录，保留其余官网资源。
  两份页面各有独立 canonical 和互相对应的 hreflang，并包含在 sitemap 中。

```powershell
python scripts/build-user-guide.py
python scripts/build-user-guide.py --language en
python scripts/verify-user-guide.py --render-dir .tooling/guide-qa
python scripts/verify-user-guide.py --language en --render-dir .tooling/guide-qa-en
node --test scripts/website-guide.test.mjs
```

## 校验与发布命令

首页采用浅色冰蓝主题，动效由原生 CSS 与 `app.js` 驱动，无动画库或视频依赖。
设计参考 CBDC 的玻璃材质与悬浮构图：
https://dribbble.com/shots/24093396-CBDC-Web-Design-for-Digital-Currency-Website
参考页视频受访问验证限制，本实现是基于封面构图重新设计的动效，不是逐帧复刻。

- 鼠标视差只在精确指针设备启用；滚动使用浏览器原生行为。
- 首屏可暂停动效；系统开启减少动态效果时自动关闭动画。
- 首屏设备使用真实桌面截图与手机截图的 SVG 视口裁切，显示器和手机外壳由 CSS 绘制；双向连接光点仅作场景示意，随全局动效控制暂停。
- 离开视口或切到后台时暂停相关循环动画；JavaScript 不可用时保持静态内容可读。
- `styles.css` 同时供中英文指南使用，调整主题时需检查指南的页头和正文对比度。

```powershell
node --check website/app.js
node --check website/analytics.js
node --test scripts/website-hero.test.mjs scripts/website-guide.test.mjs scripts/website-analytics.test.mjs
```

在本地验证布局与未加载第三方脚本；使用模拟响应验证中英文切换不会改动数字。
上线后正常打开官网一次，确认服务请求成功并显示数字，避免通过重复刷新制造测试流量。
`robots.txt` 和 `sitemap.xml` 用于发现官网；结构化数据不保证搜索引擎收录或展示增强结果。
