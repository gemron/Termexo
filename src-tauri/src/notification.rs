//! Windows toast notification registration.
//!
//! Windows only routes a toast to the Action Center when the sending process carries an
//! AppUserModelID (AUMID) that is registered on the machine. The MSI/NSIS installers register
//! one through the Start Menu shortcut they create, but Termexo launched from the npm package
//! runs `termexo.exe` straight out of `node_modules` — no installer ran, so no AUMID exists and
//! every toast is dropped silently by the shell.
//!
//! Registering the AUMID under `HKCU\Software\Classes\AppUserModelId` and calling
//! `SetCurrentProcessExplicitAppUserModelID` makes the shell accept toasts from any launch
//! method. Both are per-user and need no elevation.

use std::path::Path;

use tauri::utils::config::Config;

#[cfg(windows)]
mod platform {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    /// Registry path holding the per-user toast registrations the shell reads.
    const APP_USER_MODEL_ID_ROOT: &str = "Software\\Classes\\AppUserModelId";

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// Bytes of a REG_SZ payload, including the terminating NUL the registry expects.
    fn reg_sz_bytes(value: &str) -> Vec<u8> {
        wide(value)
            .iter()
            .flat_map(|unit| unit.to_le_bytes())
            .collect()
    }

    /// Writes `DisplayName` and `IconUri` so the toast shows the product name and icon rather
    /// than the raw identifier.
    pub fn register_app_user_model_id(
        identifier: &str,
        display_name: &str,
        icon: Option<&Path>,
    ) -> Result<(), String> {
        let subkey = wide(&format!("{APP_USER_MODEL_ID_ROOT}\\{identifier}"));
        let mut key = HKEY::default();

        // SAFETY: `subkey` is a NUL-terminated wide string that outlives the call, and `key` is
        // a valid out-pointer closed below on every success path.
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(subkey.as_ptr()),
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                None,
                &mut key,
                None,
            )
        };
        if status.is_err() {
            return Err(format!("注册通知标识失败：错误码 {}", status.0));
        }

        let write = |name: &str, value: &str| {
            let name = wide(name);
            let data = reg_sz_bytes(value);
            // SAFETY: `key` is open, and both buffers outlive the call.
            unsafe {
                let _ = RegSetValueExW(key, PCWSTR(name.as_ptr()), None, REG_SZ, Some(&data));
            }
        };
        write("DisplayName", display_name);
        // Tauri resolves resources to extended-length paths (`\\?\C:\...`), which the shell does
        // not accept when reading IconUri, so the prefix is stripped.
        if let Some(icon) = icon.and_then(|path| path.to_str()) {
            write("IconUri", icon.strip_prefix(r"\\?\").unwrap_or(icon));
        }

        // SAFETY: `key` was opened above and is not used afterwards.
        unsafe {
            let _ = RegCloseKey(key);
        }
        Ok(())
    }

    /// Binds the running process to the AUMID so toasts it raises are attributed to Termexo.
    pub fn bind_process_to_app_user_model_id(identifier: &str) -> Result<(), String> {
        let identifier = HSTRING::from(identifier);
        // SAFETY: `identifier` owns its buffer for the duration of the call.
        unsafe { SetCurrentProcessExplicitAppUserModelID(&identifier) }
            .map_err(|error| format!("绑定通知标识失败：{error}"))
    }

    /// Shows a toast, reporting whether the shell accepted it.
    ///
    /// `tauri-plugin-notification` spawns the toast and drops the result, so a rejected toast
    /// is indistinguishable from a delivered one. Calling the underlying builder directly is
    /// what lets the frontend fall back to a dialog when delivery actually fails.
    pub fn show_toast(identifier: &str, title: &str, body: &str) -> Result<(), String> {
        tauri_winrt_notification::Toast::new(identifier)
            .title(title)
            .text1(body)
            .show()
            .map_err(|error| format!("系统通知发送失败：{error}"))
    }
}

/// Makes Windows accept toast notifications from this process regardless of how it was started.
///
/// Failures are reported to the caller rather than aborting startup: without the AUMID the app
/// still runs and falls back to in-app notices.
#[cfg(windows)]
pub fn register_toast_identity(config: &Config, icon: Option<&Path>) -> Result<(), String> {
    let identifier = &config.identifier;
    platform::register_app_user_model_id(identifier, &config.product_name(), icon)?;
    platform::bind_process_to_app_user_model_id(identifier)
}

#[cfg(not(windows))]
pub fn register_toast_identity(_config: &Config, _icon: Option<&Path>) -> Result<(), String> {
    Ok(())
}

/// Sends a desktop toast, surfacing delivery failures so the caller can fall back.
#[cfg(windows)]
pub fn show_toast(config: &Config, title: &str, body: &str) -> Result<(), String> {
    platform::show_toast(&config.identifier, title, body)
}

#[cfg(not(windows))]
pub fn show_toast(_config: &Config, _title: &str, _body: &str) -> Result<(), String> {
    Err("当前平台不支持系统通知。".into())
}

trait ProductName {
    fn product_name(&self) -> String;
}

impl ProductName for Config {
    fn product_name(&self) -> String {
        self.product_name
            .clone()
            .unwrap_or_else(|| "Termexo".into())
    }
}
