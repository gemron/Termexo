use tauri::AppHandle;

use crate::update::{self, UpdateCheck};

/// Reports whether a newer Termexo release is published.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateCheck, String> {
    update::check_for_update(&app.package_info().version.to_string()).await
}

/// Opens the release page in the default browser so the user can download the new version.
#[tauri::command]
pub fn open_release_page(url: Option<String>) -> Result<(), String> {
    let target = url.unwrap_or_else(|| update::RELEASES_PAGE.to_owned());
    // Only the project's own release pages are ever opened, so a caller cannot turn this into
    // a launcher for arbitrary URLs or local programs.
    if !target.starts_with("https://github.com/gemron/Termexo/") {
        return Err("仅支持打开 Termexo 的发布页面。".into());
    }
    open_url(&target)
}

/// Runs `npm install --global termexo@latest` after this process exits, then relaunches.
///
/// Windows locks a running executable, so npm cannot overwrite it while Termexo is open — the
/// install would fail partway and could leave a broken copy. A detached helper waits for the
/// process to exit first, which is why the app closes as part of this command.
#[cfg(windows)]
#[tauri::command]
pub fn update_via_npm(app: AppHandle) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    if !update::is_npm_installation() {
        return Err("当前不是通过 npm 安装的版本，请从发布页面下载安装包。".into());
    }
    let executable =
        std::env::current_exe().map_err(|error| format!("无法确定当前程序路径：{error}"))?;
    let package = update::NPM_PACKAGE;

    // Waits for the PID to disappear before installing, then starts the new build. Quoting the
    // paths keeps a directory with spaces (the default under AppData) from splitting the command.
    let script = format!(
        "$ErrorActionPreference='Stop'; \
         try {{ Wait-Process -Id {pid} -Timeout 60 -ErrorAction SilentlyContinue }} catch {{}}; \
         Start-Sleep -Milliseconds 800; \
         npm install --global {package}@latest --no-fund --no-audit; \
         if ($LASTEXITCODE -eq 0) {{ Start-Process -FilePath '{exe}' }}",
        pid = std::process::id(),
        exe = executable.to_string_lossy().replace('\'', "''"),
    );

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &script,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // Detached so the helper outlives the app it is waiting on.
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .spawn()
        .map_err(|error| format!("无法启动更新程序：{error}"))?;

    app.exit(0);
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn update_via_npm(_app: AppHandle) -> Result<(), String> {
    Err("当前平台不支持自动更新。".into())
}

#[cfg(windows)]
fn open_url(url: &str) -> Result<(), String> {
    use std::process::Command;
    // `rundll32 url.dll,FileProtocolHandler` hands the URL to the default browser without
    // going through a shell, so the URL is never parsed as a command line.
    Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开发布页面：{error}"))
}

#[cfg(not(windows))]
fn open_url(_url: &str) -> Result<(), String> {
    Err("当前平台不支持打开发布页面。".into())
}
