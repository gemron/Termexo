# 官网维护与访问统计

官网为静态 HTML/CSS/JavaScript；生产域名为 https://www.termexo.com/ 。
GitHub Pages 当前从 `gh-pages` 分支根目录发布。仅修改 `main` 下的 `website/` 不会自动上线。
发布时把经过验证的 `website/` 内容同步到 `gh-pages`，保留 CNAME 和 .nojekyll，等待 Pages 构建成功。

## Cloudflare Web Analytics 接入

当前状态：已提供加载器，但尚未配置真实站点 token，**不会发送访问统计请求**。

1. 在官网所有者的 Cloudflare 账号中进入 Web Analytics，添加 `www.termexo.com`。
2. 使用手动安装，复制官方代码中 `data-cf-beacon` 的 32 位 `token`。
3. 填入 `index.html` 的 `<meta name="termexo-analytics-token" content="...">`。
   这是可公开的站点标识，不是 Cloudflare API Token；不要提供账号密钥。
4. 发布到 `gh-pages`。不要同时开启自动注入和手动加载，避免重复统计。
5. 在真实域名打开官网，检查 beacon.min.js 加载和统计请求，再到 Web Analytics 查看页面访问和来源。
   广告拦截器可能阻止采集，统计结果不是服务器请求总数。

`analytics.js` 只在官网域名且 token 格式有效时加载官方脚本；本地预览不会计数。
它只用于宣传官网，不会进入桌面应用或局域网远程工作台。
配置 token 时同时补充官网可见的统计说明，区分官网统计与桌面产品的本地数据。

参考：[Cloudflare 官方接入说明](https://developers.cloudflare.com/pages/how-to/web-analytics/)。

## 推广归因

渠道链接见 `docs/promotion/campaign-2026-09.md`。
UTM 参数可用于支持活动参数的统计系统；Cloudflare Web Analytics 的具体展示维度以后台为准，
不要假定它支持下载按钮事件、Star 转化或每个 UTM 维度。
官网顶部和支持按钮跳转 GitHub 使用 `noopener` 和仅发送来源域名的 Referrer-Policy，便于 GitHub Traffic 识别官网来源。
访问或点击 GitHub 不等于用户已经 Star，新增 Star 应单独从仓库统计。

## 本地校验

```powershell
node --check website/app.js
node --check website/analytics.js
node --test scripts/website-analytics.test.mjs
```

`robots.txt` 与 `sitemap.xml` 用于发现官网；结构化数据不代表搜索引擎保证收录或展示增强结果。
