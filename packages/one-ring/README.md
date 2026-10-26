# Termexo 内置 One Ring 引擎

本目录是 Termexo 的内部引擎包，源码、锁定依赖、Skill 和测试均随 Termexo 仓库维护，不要求用户安装独立插件或获取其他仓库。

桌面构建运行根目录的 `npm run one-ring:stage`，将单文件服务、内部 Skill 和固定 Node 运行时准备到 Tauri 资源目录。运行时由 Termexo 自动选择这些资源，状态存储在应用数据目录。

开发检查：`npm --prefix packages/one-ring test`、`npm --prefix packages/one-ring run build`。正常用户无需运行这些命令。
