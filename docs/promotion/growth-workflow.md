# 试用反馈与增长记录

目标是让真实 Windows CLI 用户完成首次使用，并根据问题改善产品。先收集 10 份有效反馈作为第一轮目标，不将 Star 作为试用或反馈条件。

## 反馈入口

[首次试用反馈](https://github.com/gemron/Termexo/issues/new?template=first-use.yml)

表单仅必填“到了哪一步”和具体体验。版本、安装方式、来源及改进建议选填，不收集邮箱或联系方式。
这是公开 Issue；用户在提交前会看到移除令牌、二维码、API Key 与私人内容的提示。

维护者处理方式：

1. 按安装失败、Agent 启动、手机连接、手机操作和已成功分类。
2. 缺少必要复现信息时，围绕用户遇到的问题补问一次。
3. 能重现的问题建立修复，向原反馈者说明验证方法和修复版本。
4. 引用反馈作为公开推荐前，单独征得原作者同意。

## 统计采集

预先安装并登录 GitHub CLI，账号需有本仓库 Traffic 的读取权限。随后在仓库根目录运行：

```powershell
npm run growth:collect
```

每次保存带 UTC 时间戳的 JSON 快照与 `.tooling/growth/latest.md` 报告。该目录已被 Git 忽略，内部 Traffic 不会随代码提交。
命令读取 Star、Fork、访问量、克隆量、来源和 Release 下载计数，不安装定时任务，不向桌面应用增加统计。
部分接口不可用时保留其他已采集数据，明确标为 unavailable，退出码为 1；不会把失败写成 0。

建议每天同一时刻采集一次，连续两周。另行记录当天发布的文章链接、主题及用户反馈数。
两次快照给出的是 Star 净变化，取消 Star 也会影响结果，不能据此归因到某条推广帖。

## 每周复盘

| 现象 | 下一步 |
| --- | --- |
| 访问少，反馈也少 | 将一个真实使用场景发布到确有目标用户的渠道 |
| 有访客，但没有试用反馈 | 检查安装入口、平台要求和首次启动过程 |
| 安装成功，Agent 启动失败 | 改善 CLI 检测、配置提示与错误说明 |
| 电脑可用，手机连接失败 | 优先改进连接引导和错误定位 |
| 用户完成日常任务 | 征得同意后整理为真实案例 |

GitHub Traffic 返回窗口可能滞后，来源列表不涵盖所有访问，UV 也不可跨来源相加。
安装包下载次数包含重复下载，不代表安装成功；累计 Star 除以窗口 UV 不是真实转化率。
当前官网只有 PV 计数，UTM 链接只是命名约定，没有点击事件与渠道转化后台。

接口与表单格式参考：[GitHub Traffic](https://docs.github.com/en/rest/metrics/traffic)、[GitHub CLI api](https://cli.github.com/manual/gh_api)、[Issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)。
