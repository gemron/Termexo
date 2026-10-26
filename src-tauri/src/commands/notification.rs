use tauri::AppHandle;

use crate::notification;

/// Keeps the taskbar flashing until the workbench has no unacknowledged terminal notices.
#[tauri::command]
pub fn set_taskbar_attention(window: tauri::Window, active: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            FlashWindowEx, FLASHWINFO, FLASHW_STOP, FLASHW_TIMER, FLASHW_TRAY,
        };

        let info = FLASHWINFO {
            cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
            hwnd: window.hwnd().map_err(|error| error.to_string())?,
            // TIMERNOFG stops as soon as the window is activated, before the notice is handled.
            dwFlags: if active {
                FLASHW_TRAY | FLASHW_TIMER
            } else {
                FLASHW_STOP
            },
            uCount: 0,
            dwTimeout: 0,
        };
        // The return value reports the previous active state, not whether the call succeeded.
        unsafe {
            let _ = FlashWindowEx(&info);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    window
        .request_user_attention(active.then_some(tauri::UserAttentionType::Critical))
        .map_err(|error| error.to_string())
}

/// Shows a desktop toast, returning an error when the shell refuses to deliver it.
///
/// The frontend falls back to a system dialog on failure, which only works because this
/// command propagates the delivery result instead of discarding it.
#[tauri::command(async)]
pub fn show_desktop_notification(
    title: String,
    body: String,
    app: AppHandle,
) -> Result<(), String> {
    notification::show_toast(&app, &title, &body)
}
