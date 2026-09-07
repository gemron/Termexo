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

- 在线入口：`https://www.termexo.com/guide.html`；首页导航和页脚均有「使用说明」。
- 下载地址：`https://www.termexo.com/downloads/termexo-user-guide.pdf`。
- `guide.html` 是唯一正文源；`guide.css` 提供阅读、手机和打印布局。文档目前为中文。
- 修改正文后运行 `scripts/build-user-guide.py`，从同一份 HTML 重新生成 PDF；不要单独修改 PDF 内容。
- 构建需要 Python 与 `reportlab`，默认使用 Windows 微软雅黑并嵌入字体子集；其他系统用
  `--font` / `--bold-font` 指定支持中文且允许嵌入的 TrueType 字体。
- 版本变更时同时更新正文版本、下载文件名及脚本页脚版本；使用 `data-pdf-page` 控制 PDF 分页。
- 发布前将 PDF 每页渲染成图片检查中文与分页，并确认目录链接、下载文件、正文版本一致。
- `scripts/verify-user-guide.py` 使用 `pypdf` 验证正文完整性、书签和中文文本，使用 `pymupdf`
  检查页面文字边界；传入 `--render-dir` 可渲染全部页面供人工检查。
- 部署需要同步 `guide.html`、`guide.css` 和整个 `downloads/` 文档目录，保留其余官网资源。

```powershell
python scripts/build-user-guide.py
python scripts/verify-user-guide.py --render-dir .tooling/guide-qa
node --test scripts/website-guide.test.mjs
```

## 校验与发布命令

```powershell
node --check website/app.js
node --check website/analytics.js
node --test scripts/website-analytics.test.mjs
```

在本地验证布局与未加载第三方脚本；使用模拟响应验证中英文切换不会改动数字。
上线后正常打开官网一次，确认服务请求成功并显示数字，避免通过重复刷新制造测试流量。
`robots.txt` 和 `sitemap.xml` 用于发现官网；结构化数据不保证搜索引擎收录或展示增强结果。
