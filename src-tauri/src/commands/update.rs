use tauri::{ipc::Channel, AppHandle, Manager, State};

use crate::update::{self, DownloadProgress, InstallMethod, StagedUpdate, UpdateCheck};

#[derive(Default)]
pub(crate) struct UpdateStore(tokio::sync::Mutex<Option<StagedUpdate>>);

#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    prefer_china: Option<bool>,
) -> Result<UpdateCheck, String> {
    update::check_for_update(
        &app.package_info().version.to_string(),
        prefer_china.unwrap_or(false),
    )
    .await
}

/// Only versioned release pages from the project can be opened by this command.
#[tauri::command(async)]
pub fn open_release_page(url: Option<String>) -> Result<(), String> {
    let target = url.unwrap_or_else(|| update::RELEASES_PAGE.to_owned());
    let tagged_release = target
        .strip_prefix(update::RELEASES_TAG)
        .and_then(|tag| tag.strip_prefix('v'))
        .is_some_and(|version| update::version_tag(version) == Some(version));
    if target != update::RELEASES_PAGE && !tagged_release {
        return Err("仅支持打开 Termexo 的发布页面。".into());
    }
    open_url(&target)
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    pending: State<'_, UpdateStore>,
    version: String,
    prefer_china: bool,
    progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let mut staged = pending.0.try_lock().map_err(|_| "更新正在进行中。")?;
    if staged
        .as_ref()
        .is_some_and(|saved| saved.version == version && saved.file.is_file())
    {
        return Ok(());
    }
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    let update = update::stage_update(
        &cache,
        &app.package_info().version.to_string(),
        &version,
        prefer_china,
        |event| {
            let _ = progress.send(event);
        },
    )
    .await?;
    *staged = Some(update);
    Ok(())
}

#[tauri::command]
pub async fn install_downloaded_update(
    app: AppHandle,
    pending: State<'_, UpdateStore>,
    version: String,
) -> Result<InstallMethod, String> {
    let mut staged = pending.0.try_lock().map_err(|_| "更新正在进行中。")?;
    let saved = staged
        .as_ref()
        .filter(|saved| saved.version == version && saved.file.is_file())
        .ok_or("请先下载该版本的安装包。")?;
    let file = saved.file.clone();
    let package = saved.package;
    let method = tauri::async_runtime::spawn_blocking(move || launch_installer(&file, package))
        .await
        .map_err(|error| error.to_string())??;
    if method == InstallMethod::Restart {
        // The Windows helper needs the verified file after Termexo exits.
        if let Some(saved) = staged.take() {
            let _ = saved.directory.keep();
        }
        app.exit(0);
    }
    Ok(method)
}

#[cfg(windows)]
fn launch_installer(
    file: &std::path::Path,
    package: update::PackageKind,
) -> Result<InstallMethod, String> {
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use update::PackageKind;

    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut helper = Command::new("powershell.exe");
    let mode = match package {
        PackageKind::Npm => {
            let prefix =
                update::windows_npm_prefix(&executable).ok_or("无法确定 npm 安装路径。")?;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let output = Command::new("cmd.exe")
                .args(["/D", "/C", "npm.cmd prefix --global"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|error| format!("无法运行 npm：{error}"))?;
            let configured = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
            let expected = prefix.canonicalize().ok();
            let configured = configured.canonicalize().ok();
            if !output.status.success() || expected.is_none() || expected != configured {
                return Err(
                    "当前 npm 的全局目录与 Termexo 的安装目录不同，请从原安装环境更新。".into(),
                );
            }
            helper.env("TERMEXO_UPDATE_PREFIX", prefix);
            "npm"
        }
        PackageKind::WindowsExe => "exe",
        PackageKind::WindowsMsi => "msi",
        _ => return Err("当前平台无法运行此安装包。".into()),
    };

    // Pass paths by environment rather than interpolating file names into PowerShell source.
    // The helper waits for the running executable to unlock and reports failures after exit.
    let script = r#"
$ErrorActionPreference = 'Stop'
$termexoUpdatePid = [int]$env:TERMEXO_UPDATE_PID
$termexoPackage = $env:TERMEXO_UPDATE_PACKAGE
$termexoLog = Join-Path (Split-Path -Parent $termexoPackage) 'install.log'
$termexoFailed = $false
try {
    Wait-Process -Id $termexoUpdatePid -Timeout 60 -ErrorAction SilentlyContinue
    if (Get-Process -Id $termexoUpdatePid -ErrorAction SilentlyContinue) {
        throw 'Termexo did not exit in time.'
    }
    switch ($env:TERMEXO_UPDATE_MODE) {
        'npm' {
            & npm.cmd install --global --offline --ignore-scripts --no-audit --no-fund --prefix $env:TERMEXO_UPDATE_PREFIX $termexoPackage *> $termexoLog
            if ($LASTEXITCODE -ne 0) { throw "npm exited with code $LASTEXITCODE." }
        }
        'exe' {
            $termexoInstaller = Start-Process -FilePath $termexoPackage -WindowStyle Normal -PassThru -Wait
            if ($termexoInstaller.ExitCode -notin @(0, 1, 2)) {
                throw "Installer exited with code $($termexoInstaller.ExitCode)."
            }
        }
        'msi' {
            $termexoInstaller = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -ArgumentList ('/i "' + $termexoPackage + '"') -WindowStyle Normal -PassThru -Wait
            if ($termexoInstaller.ExitCode -notin @(0, 1602, 1641, 3010)) {
                throw "Windows Installer exited with code $($termexoInstaller.ExitCode)."
            }
        }
    }
} catch {
    $termexoFailed = $true
    Add-Content -LiteralPath $termexoLog -Value ([string]$_) -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("Termexo update failed.$([Environment]::NewLine)$([string]$_)$([Environment]::NewLine)$termexoLog", 'Termexo') | Out-Null
} finally {
    if ((Test-Path -LiteralPath $env:TERMEXO_UPDATE_EXE) -and !(Get-Process -Name 'termexo' -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath $env:TERMEXO_UPDATE_EXE -WindowStyle Normal
    }
    Remove-Item -LiteralPath $termexoPackage -ErrorAction SilentlyContinue
    if (!$termexoFailed) {
        Remove-Item -LiteralPath $termexoLog -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath (Split-Path -Parent $termexoPackage) -ErrorAction SilentlyContinue
    }
}
"#;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    helper
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ])
        .env("TERMEXO_UPDATE_PID", std::process::id().to_string())
        .env("TERMEXO_UPDATE_MODE", mode)
        .env("TERMEXO_UPDATE_PACKAGE", file)
        .env("TERMEXO_UPDATE_EXE", executable)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("无法启动更新程序：{error}"))?;
    Ok(InstallMethod::Restart)
}

#[cfg(not(windows))]
fn launch_installer(
    file: &std::path::Path,
    _package: update::PackageKind,
) -> Result<InstallMethod, String> {
    let opener = if cfg!(target_os = "macos") {
        "/usr/bin/open"
    } else {
        "xdg-open"
    };
    let status = std::process::Command::new(opener).arg(file).status();
    if status.is_ok_and(|status| status.success()) {
        Ok(InstallMethod::OpenInstaller)
    } else {
        Err(format!(
            "无法打开安装包，请在文件管理器中打开：{}",
            file.display()
        ))
    }
}

#[cfg(windows)]
pub(crate) fn open_url(url: &str) -> Result<(), String> {
    use std::process::Command;
    // `rundll32 url.dll,FileProtocolHandler` hands the URL to the default browser without
    // going through a shell, so the URL is never parsed as a command line.
    Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开发布页面：{error}"))
}

#[cfg(target_os = "macos")]
pub(crate) fn open_url(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开发布页面：{error}"))
}

#[cfg(target_os = "linux")]
pub(crate) fn open_url(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开链接，请确认已安装 xdg-utils：{error}"))
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub(crate) fn open_url(_url: &str) -> Result<(), String> {
    Err("当前平台不支持打开发布页面。".into())
}
