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
