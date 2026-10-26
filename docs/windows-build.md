# 在 GitHub Actions 构建 Windows 安装包

在仓库的 **Actions → Build Windows installers → Run workflow** 中选择分支并启动。
工作流在 Windows x64 主机上准备 Node.js、Rust 和 MSVC，运行 Rust 单元测试，
再构建 NSIS EXE 和 MSI 两种安装包。

完成后在该次运行页面的 **Artifacts** 下载
`Termexo-Windows-x86_64-pc-windows-msvc`，其中包含：

- `Termexo_版本号_x64-setup.exe`
- `Termexo_版本号_x64_en-US.msi`
- `SHA256SUMS.txt`
- 记录版本、源码提交、架构和签名状态的 `build-info.json`

工作流检查应用的 x64 PE 架构、可执行文件版本、MSI 版本和架构，并生成 SHA-256 校验和。
下载保留 14 天；需要时可以重新手动构建。当前没有配置 Windows 代码签名证书。
工作流只上传 Actions 产物，不安装应用，也不创建或修改 GitHub Release。

工作流直接调用跨平台 Tauri CLI 包装脚本，通过 MSVC Action 获取构建环境，
不依赖本机 `scripts/tauri-msvc.cmd` 中固定的 Visual Studio 路径。

也可以通过已登录的 GitHub CLI 启动：

```bash
gh workflow run windows-build.yml --ref main
gh run list --workflow windows-build.yml
gh run download RUN_ID --dir windows-installers
```

macOS 的 Apple Silicon 和 Intel 构建见 [macOS 打包说明](macos-build.md)。
