use crate::webview::{self, WebviewStatus};

/// Reports the WebView2 runtime the window is rendering on, so the interface can say so when it
/// is too old to draw itself correctly.
#[tauri::command]
pub fn get_webview_status() -> WebviewStatus {
    webview::status()
}

/// Opens Microsoft's WebView2 download page in the default browser.
///
/// The address is fixed rather than taken from the caller, so this can never become a launcher
/// for an arbitrary URL.
#[tauri::command(async)]
pub fn open_webview_download() -> Result<(), String> {
    super::update::open_url(webview::DOWNLOAD_URL)
}
