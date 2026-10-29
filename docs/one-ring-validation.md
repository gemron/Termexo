# One Ring 接入验证记录

日期：2026-10-24。环境：Linux，Node.js 24.21.0，Codex 0.163.0，One Ring 0.1.0。**未验证 Windows 桌面和 Worker 执行。**

| 验证 | 结果 |
| --- | --- |
| Angular 全量隔离测试 | 76 个文件、647 项通过 |
| 最终接入测试选集 | 面板、Codex 对话框及新增的 App 启动链路测试通过；覆盖工作区切换、取消后恢复普通启动、禁止自动确认 |
| Angular 生产构建 | 通过；有现有体积/样式预算警告 |
| Node MCP 桥接测试 | 5 项通过；真实 stdio 握手、参数传递、引号路径、拒绝写操作、工具错误及宿主请求处理 |
| Rust 连接/配置测试 | 通过；包括每终端连接固定、任务文件、配置解析及拒绝非法路径 |
| Rust 调用真实 One Ring | 通过；直接运行 Tauri 使用的连接函数，真实 doctor 和空库 list |
| 已有真实工作流查询 | doctor/list/status 成功，读到此前闭环的 COMPLETED / PASS，revision 21 |
| Codex 配置兼容性 | `codex -c ... mcp get ... --json` 成功识别临时 stdio、env 及 env_vars 配置，未修改全局配置 |
| 浏览器检查 | One Ring 入口与连接面板正常，无页面异常，800px 宽度无横向溢出 |

Rust 后端全量测试在本机为 **409 通过、5 失败、4 忽略**。在隔离 worktree 中对未改动的基线 `60e67f0` 执行相同全量测试，结果为 **407 通过、相同 5 项失败、4 忽略**。这些失败来自原有 Windows 路径/CLI 假设：

- `agent::antigravity::tests::sessions_are_filtered_by_the_workspace_they_were_opened_against`
- `cli::tests::a_second_copy_elsewhere_is_reported`
- `git::tests::rejects_paths_outside_the_worktree`
- `hooks::tests::keeps_the_antigravity_memory_file_inside_the_spool_directory`
- `storage::tests::an_unusable_recorded_location_falls_back_to_the_default`

排除这 5 项基线失败后，其余后端测试通过。额外真实插件测试默认忽略，需要显式指定本地插件，已在本机执行通过：

```sh
TERMEXO_ONE_RING_PLUGIN_DIR=/path/to/one-ring/plugins/codex \
  cargo test --lib one_ring::tests::connects_to_real_plugin -- --ignored
```

前端验证使用已安装的系统 Node 24 直接执行 Angular CLI：

```sh
cd apps/desktop-ui
node node_modules/@angular/cli/bin/ng.js test desktop-ui --watch=false --isolate
node node_modules/@angular/cli/bin/ng.js build
```

本次接入验证没有启动新的模型任务，没有代替用户接受计划或交付。已完成工作流的查询验证使用 One Ring 项目此前的真实测试记录，其人工确认来自测试客户端，不能视为 Windows PTY 已验证。

Windows 操作与预期见 [集成说明](one-ring-integration.md)。
