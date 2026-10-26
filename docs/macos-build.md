# 在 GitHub Actions 构建 macOS 安装包

Windows 的 EXE、MSI 构建见 [Windows 打包说明](windows-build.md)。

在仓库的 **Actions → Build macOS installers → Run workflow** 中选择分支并启动。
工作流会分别在 macOS 主机上构建 Apple Silicon 和 Intel 版本，不需要本地 Mac。

构建完成后，在该次运行页面的 **Artifacts** 下载：

| 产物                                 | 适用设备                    |
| ------------------------------------ | --------------------------- |
| `Termexo-macOS-aarch64-apple-darwin` | Apple Silicon（M 系列芯片） |
| `Termexo-macOS-x86_64-apple-darwin`  | Intel Mac                   |

每份产物包含 `.dmg` 安装包、保留权限和符号链接的 `.app.tar.gz`、
`SHA256SUMS.txt` 和记录源码提交、目标架构、签名状态的 `build-info.json`。
下载保留 14 天；需要时可以重新手动构建。

工作流运行 Rust 单元测试，再调用 `npm run tauri:build:mac`，自动使用
`src-tauri/tauri.macos.conf.json` 和 Angular 的 `macos` 配置。
完成后检查二进制架构、应用签名和 DMG 完整性。

目前产物采用 ad-hoc 临时签名，没有 Apple Developer ID 签名和公证。
这适合测试构建；首次运行可能需要在 macOS 的“隐私与安全性”中允许打开。
正式分发前仍需接入 Apple 签名、公证并完成 Mac 真机测试。
工作流只上传 Actions 产物，不创建或修改 GitHub Release。

也可以通过已登录的 GitHub CLI 启动：

```bash
gh workflow run macos-build.yml --ref main
gh run list --workflow macos-build.yml
gh run download RUN_ID --dir macos-installers
```
