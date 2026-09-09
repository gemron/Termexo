//! Whether the installed WebView2 runtime can render Termexo's interface.
//!
//! The whole window is a WebView2, so its Chromium version decides what the stylesheets are
//! allowed to say. A runtime that is missing entirely leaves nothing to show a message in, and
//! one that is merely too old renders a window whose colours quietly fall apart — neither
//! explains itself, so both are reported here and answered with the download page.

use serde::Serialize;

/// Lowest Chromium major the interface renders correctly on.
///
/// The stylesheets state colours through `color-mix()` and `oklch()`, which Chromium evaluates
/// only from 111; below that it drops every declaration using them and those surfaces fall back
/// to whatever was declared before. Container queries and `:has()`, which the terminal layout
/// leans on, landed earlier at 105, so 111 is the binding constraint.
const MINIMUM_CHROMIUM_MAJOR: u32 = 111;

/// Microsoft's own page for the Evergreen runtime, which is where an upgrade has to come from.
pub const DOWNLOAD_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

/// What the frontend needs to explain a runtime it cannot render on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewStatus {
    /// Full runtime version, absent when no WebView2 is installed at all.
    pub version: Option<String>,
    /// Chromium major taken from that version; absent for the same reason.
    pub major: Option<u32>,
    pub minimum_major: u32,
    /// False when the runtime is missing, unreadable, or older than the minimum.
    pub supported: bool,
    pub download_url: &'static str,
}

/// Reports the runtime this process is rendering on.
pub fn status() -> WebviewStatus {
    let version = tauri::webview_version().ok();
    let major = version.as_deref().and_then(chromium_major);
    WebviewStatus {
        version,
        major,
        minimum_major: MINIMUM_CHROMIUM_MAJOR,
        // An unreadable version is treated as unsupported: the alternative is staying silent
        // about a runtime that may well be the reason the window looks wrong.
        supported: major.is_some_and(|major| major >= MINIMUM_CHROMIUM_MAJOR),
        download_url: DOWNLOAD_URL,
    }
}

/// The leading component of a `major.minor.build.patch` runtime version.
fn chromium_major(version: &str) -> Option<u32> {
    version.split('.').next()?.trim().parse().ok()
}

/// Warns, outside the window, that there is no runtime to open a window in.
///
/// Nothing else reports this: Tauri fails to build the webview and the process dies with a
/// message no one sees, which is exactly what a user who installed Termexo from npm — and so
/// never ran an installer that could deploy WebView2 — is left with.
#[cfg(windows)]
pub fn warn_runtime_missing() {
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, IDYES, MB_ICONERROR, MB_YESNO, MB_SYSTEMMODAL,
    };

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let text = wide(&format!(
        "Termexo 需要 Microsoft Edge WebView2 运行时，这台电脑上没有找到它。\n\n\
         安装方式（任选其一）：\n\
         1. 点“是”打开下载页，下载 Evergreen Bootstrapper 后运行；\n\
         2. 在终端执行 winget install --id Microsoft.EdgeWebView2Runtime\n\n\
         安装完成后重新启动 Termexo。\n\n\
         下载地址：{DOWNLOAD_URL}\n\n\
         现在打开下载页吗？"
    ));
    let caption = wide("Termexo 无法启动");

    // SAFETY: both buffers are NUL-terminated and outlive the call, and a null owner window is
    // valid for a dialog raised before any window exists.
    let choice = unsafe {
        MessageBoxW(
            None,
            PCWSTR(text.as_ptr()),
            PCWSTR(caption.as_ptr()),
            MB_YESNO | MB_ICONERROR | MB_SYSTEMMODAL,
        )
    };
    if choice == IDYES {
        let _ = crate::commands::update::open_url(DOWNLOAD_URL);
    }
}

#[cfg(not(windows))]
pub fn warn_runtime_missing() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_chromium_major_from_a_runtime_version() {
        assert_eq!(chromium_major("152.0.4191.66"), Some(152));
        assert_eq!(chromium_major("111.0.1661.44"), Some(111));
    }

    #[test]
    fn refuses_a_version_it_cannot_read() {
        assert_eq!(chromium_major(""), None);
        assert_eq!(chromium_major("unknown"), None);
    }

    #[test]
    fn a_runtime_below_the_minimum_is_not_supported() {
        let status = status();
        if let Some(major) = status.major {
            assert_eq!(status.supported, major >= MINIMUM_CHROMIUM_MAJOR);
        } else {
            assert!(!status.supported);
        }
    }
}
