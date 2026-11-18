//! Dedicated Tauri windows that open remote Termexo workbenches.
//!
//! Each remote host gets its own window (`remote-<hostId>`) pointing at the remote URL with
//! `#token=…` in the fragment. Keeping the label prefix distinct from `main` guarantees that
//! `capabilities/default.json` (which only lists `"windows": ["main"]`) grants zero local Tauri
//! permissions to the remote page.

use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use super::store::RemoteHost;

pub const REMOTE_WINDOW_LABEL_PREFIX: &str = "remote-";
const DEFAULT_WINDOW_WIDTH: f64 = 1360.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 860.0;
const MIN_WINDOW_WIDTH: f64 = 960.0;
const MIN_WINDOW_HEIGHT: f64 = 620.0;

pub fn window_label(host_id: &str) -> String {
    format!("{REMOTE_WINDOW_LABEL_PREFIX}{host_id}")
}

pub fn is_window_open(app: &AppHandle, host_id: &str) -> bool {
    app.get_webview_window(&window_label(host_id)).is_some()
}

pub fn focus_if_open(app: &AppHandle, host_id: &str) -> Result<bool, String> {
    let Some(window) = app.get_webview_window(&window_label(host_id)) else {
        return Ok(false);
    };
    let _ = window.unminimize();
    window
        .set_focus()
        .map_err(|error| format!("无法聚焦远程主机窗口：{error}"))?;
    Ok(true)
}

pub fn close_window(app: &AppHandle, host_id: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&window_label(host_id)) {
        window
            .close()
            .map_err(|error| format!("无法关闭远程主机窗口：{error}"))?;
    }
    Ok(())
}

pub fn open_or_focus_window<F>(
    app: &AppHandle,
    host: &RemoteHost,
    token: &str,
    on_closed: F,
) -> Result<(), String>
where
    F: FnOnce() + Send + 'static,
{
    if focus_if_open(app, &host.id)? {
        return Ok(());
    }
    let target_url = build_launch_url(&host.url, token)?;
    let title = format!("{} — Termexo 远程", host.name);
    let window = WebviewWindowBuilder::new(
        app,
        window_label(&host.id),
        WebviewUrl::External(target_url),
    )
    .title(title)
    .inner_size(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
    .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    .center()
    .build()
    .map_err(|error| format!("无法打开远程主机窗口：{error}"))?;

    let close_callback = Mutex::new(Some(on_closed));
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut guard) = close_callback.lock() {
                if let Some(callback) = guard.take() {
                    callback();
                }
            }
        }
    });
    Ok(())
}

/// Builds `<base>#token=<percent-encoded>`, keeping the token in the fragment so it is never sent
/// in an HTTP request line or `Referer` header.
pub fn build_launch_url(base_url: &str, token: &str) -> Result<Url, String> {
    let mut parsed =
        Url::parse(base_url).map_err(|error| format!("远程主机地址无效：{error}"))?;
    let encoded_token: String =
        url::form_urlencoded::byte_serialize(token.trim().as_bytes()).collect();
    parsed.set_fragment(Some(&format!("token={encoded_token}")));
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_the_encoded_token_in_the_fragment_only() {
        let url = build_launch_url("https://relay.example.com/d/abcdefghijklmnopqrstuvwxyz/", "a+b/c=1")
            .expect("launch url");

        assert_eq!(
            url.as_str(),
            "https://relay.example.com/d/abcdefghijklmnopqrstuvwxyz/#token=a%2Bb%2Fc%3D1"
        );
        assert!(url.query().is_none());
    }

    #[test]
    fn remote_window_labels_never_collide_with_the_main_window() {
        assert_ne!(window_label("main"), "main");
        assert!(window_label("host-1").starts_with(REMOTE_WINDOW_LABEL_PREFIX));
    }
}
