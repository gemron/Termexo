use tauri::AppHandle;

use crate::notification;

/// Shows a desktop toast, returning an error when the shell refuses to deliver it.
///
/// The frontend falls back to a system dialog on failure, which only works because this
/// command propagates the delivery result instead of discarding it.
#[tauri::command]
pub fn show_desktop_notification(
    title: String,
    body: String,
    app: AppHandle,
) -> Result<(), String> {
    notification::show_toast(app.config(), &title, &body)
}
