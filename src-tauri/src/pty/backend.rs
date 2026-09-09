//! Which pseudo console the terminals run on, and what the frontend has to know about it.
//!
//! `portable-pty` creates every PTY through `CreatePseudoConsole`. It prefers a `conpty.dll`
//! sitting beside the executable and falls back to the one exported by `kernel32.dll`, which is
//! whatever ConPTY the user's Windows build happens to carry. That distinction is not cosmetic:
//! ConPTY re-synthesises terminal input as Win32 key records before the client reads it back as
//! VT, and older builds lose sequences in that round trip — `CSI Z` arrives as a plain Tab, so
//! Claude Code never sees Shift+Tab, and mouse reports are dropped, so OpenCode cannot be
//! scrolled. The same builds also reflow wrapped lines themselves, which xterm then reflows a
//! second time.
//!
//! Termexo ships its own ConPTY next to `termexo.exe` so every install behaves the same. This
//! module reports which one is in play, so the frontend can configure xterm to match and the
//! diagnostics can say what a terminal is actually running on.

use serde::Serialize;

/// Windows build at which ConPTY stopped reflowing wrapped lines on its own.
///
/// xterm gates its own reflow on this number: below it ConPTY rewrites the wrapped lines and a
/// second reflow in the terminal corrupts them. The bundled ConPTY behaves as this build or newer
/// whatever Windows it runs on, so that is what a bundled backend reports.
const CONPTY_REFLOW_BUILD: u32 = 21376;

/// Build reported when Windows will not say which one it is running.
///
/// ConPTY exists at all only from build 17763, so a process that got this far is at least there.
const MINIMUM_CONPTY_BUILD: u32 = 17763;

/// The pseudo console backing every terminal, as the frontend needs to see it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyBackendInfo {
    /// Always `conpty` on Windows; `portable-pty` offers no other backend there.
    pub backend: &'static str,
    /// Windows build number, which decides how much of the terminal's own behaviour is safe.
    pub build_number: u32,
    /// Whether the ConPTY beside the executable is in use rather than the system's own.
    pub bundled: bool,
}

/// Describes the pseudo console this process will open terminals with.
pub fn describe() -> PtyBackendInfo {
    let bundled = bundled_conpty_present();
    let system_build = windows_build_number().unwrap_or(MINIMUM_CONPTY_BUILD);
    PtyBackendInfo {
        backend: "conpty",
        // A bundled ConPTY is never older than the system's, so the higher of the two describes
        // what the terminal will actually be talking to.
        build_number: if bundled {
            system_build.max(CONPTY_REFLOW_BUILD)
        } else {
            system_build
        },
        bundled,
    }
}

/// Whether a `conpty.dll` sits beside the executable, which is where `portable-pty` looks first.
fn bundled_conpty_present() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("conpty.dll")))
        .is_some_and(|dll| dll.is_file())
}

#[cfg(windows)]
fn windows_build_number() -> Option<u32> {
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
    };

    /// Where Windows records its own build, as a REG_SZ of decimal digits.
    const VERSION_KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    const BUILD_VALUE: &str = "CurrentBuildNumber";
    /// Room for the digits plus the terminating NUL; a build number is never near this long.
    const BUFFER_CHARS: usize = 32;

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let key = wide(VERSION_KEY);
    let value = wide(BUILD_VALUE);
    let mut buffer = [0u16; BUFFER_CHARS];
    let mut size = (buffer.len() * std::mem::size_of::<u16>()) as u32;

    // SAFETY: both name buffers are NUL-terminated and outlive the call, and the output buffer is
    // described by `size` in bytes, which the call updates rather than exceeds.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(key.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if status.is_err() {
        return None;
    }

    let chars = (size as usize / std::mem::size_of::<u16>()).min(buffer.len());
    String::from_utf16_lossy(&buffer[..chars])
        .trim_end_matches('\0')
        .parse()
        .ok()
}

#[cfg(not(windows))]
fn windows_build_number() -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bundled_backend_never_reports_a_build_that_reflows() {
        let info = describe();
        if info.bundled {
            assert!(info.build_number >= CONPTY_REFLOW_BUILD);
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_reports_a_build_that_supports_conpty() {
        let build = windows_build_number().expect("Windows records its own build number");
        assert!(build >= MINIMUM_CONPTY_BUILD);
    }
}
