//! Facts about the host OS that the rest of the crate would otherwise have to guess at.
//!
//! Windows keeps working exactly as before; the Unix branches exist so the same code can run in a
//! macOS app bundle, which differs in three ways that matter here: the user's shell is zsh or
//! bash rather than PowerShell, a GUI app does not inherit the shell's `PATH`, and application
//! data lives under `~/Library/Application Support`.

use std::path::PathBuf;

#[cfg(unix)]
use std::env;

/// The shell Termexo opens when nothing more specific was asked for.
#[cfg(windows)]
pub const FALLBACK_SHELL: &str = "powershell.exe";
#[cfg(unix)]
pub const FALLBACK_SHELL: &str = "/bin/zsh";

/// Directory name for application data on macOS, deliberately not the bundle identifier.
#[cfg(target_os = "macos")]
const MACOS_DATA_DIRECTORY: &str = "Termexo";

/// The current user's home directory.
pub fn home_dir() -> Option<PathBuf> {
    std::env::home_dir()
}

/// The user's own shell: `$SHELL` when it points at something runnable, otherwise the fallback.
#[cfg(unix)]
pub fn default_shell() -> String {
    env::var("SHELL")
        .ok()
        .filter(|shell| std::path::Path::new(shell).is_file())
        .unwrap_or_else(|| FALLBACK_SHELL.into())
}

#[cfg(windows)]
pub fn default_shell() -> String {
    FALLBACK_SHELL.into()
}

/// Turns the shell a terminal was saved with into one this machine can start.
///
/// Workspaces store `powershell.exe` as the shell, and a workspace written on Windows (or by the
/// frontend's default) must still open here, so Windows-only shells map to the user's own shell.
pub fn resolve_shell(requested: &str) -> String {
    #[cfg(unix)]
    {
        let name = requested
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(requested)
            .to_ascii_lowercase();
        let windows_only = name.starts_with("powershell") || name == "cmd" || name == "cmd.exe";
        if requested.trim().is_empty() || windows_only {
            return default_shell();
        }
    }
    requested.to_owned()
}

/// Quotes a value as one literal argument for the shell a terminal runs.
///
/// PowerShell and POSIX shells both use single quotes, but escape an embedded quote differently.
pub fn shell_quote(value: &str) -> String {
    #[cfg(windows)]
    return format!("'{}'", value.replace('\'', "''"));
    #[cfg(unix)]
    return format!("'{}'", value.replace('\'', "'\\''"));
}

/// Runs the program at `executable`: PowerShell needs the call operator to treat a quoted path as
/// a command rather than a string, a POSIX shell takes the quoted word as is.
pub fn shell_invoke(executable: &str) -> String {
    #[cfg(windows)]
    return format!("& {}", shell_quote(executable));
    #[cfg(unix)]
    return shell_quote(executable);
}

/// `~/Library/Application Support/Termexo`, the macOS home of everything Termexo stores.
#[cfg(target_os = "macos")]
pub fn macos_data_dir() -> Option<PathBuf> {
    home_dir().map(|home| {
        home.join("Library")
            .join("Application Support")
            .join(MACOS_DATA_DIRECTORY)
    })
}

/// Application data directory under the macOS convention, or the one Tauri chose elsewhere.
pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    #[cfg(target_os = "macos")]
    if let Some(directory) = macos_data_dir() {
        return Ok(directory);
    }
    app.path().app_data_dir().map_err(|error| error.to_string())
}

/// Directories agents are usually installed into, searched in addition to `PATH`.
#[cfg(target_os = "macos")]
fn well_known_bin_directories() -> Vec<PathBuf> {
    let mut directories = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(home) = home_dir() {
        directories.extend([
            home.join(".local").join("bin"),
            home.join(".npm-global").join("bin"),
            home.join(".bun").join("bin"),
            home.join(".cargo").join("bin"),
        ]);
    }
    directories
}

/// Markers around the printed `PATH`, because a login shell may print anything else it likes.
#[cfg(target_os = "macos")]
const PATH_MARKER: &str = "__TERMEXO_LOGIN_PATH__";

#[cfg(target_os = "macos")]
const LOGIN_SHELL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// The `PATH` an interactive login shell would have, as the user's dotfiles build it.
#[cfg(target_os = "macos")]
fn login_shell_path() -> Option<String> {
    let mut command = std::process::Command::new(default_shell());
    command.args([
        "-ilc",
        &format!("printf '{PATH_MARKER}%s{PATH_MARKER}' \"$PATH\""),
    ]);
    let output = crate::process::run_with_timeout(&mut command, LOGIN_SHELL_TIMEOUT).ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let (_, rest) = stdout.split_once(PATH_MARKER)?;
    let (path, _) = rest.split_once(PATH_MARKER)?;
    (!path.trim().is_empty()).then(|| path.trim().to_owned())
}

/// Puts `login`'s entries first, then whatever `current` adds, then the existing well-known
/// directories that are still missing. Duplicates keep their first position.
#[cfg(target_os = "macos")]
fn merge_paths(login: Option<&str>, current: &str, extra: &[PathBuf]) -> String {
    let mut merged: Vec<PathBuf> = Vec::new();
    let mut push = |directory: PathBuf| {
        if !directory.as_os_str().is_empty() && !merged.contains(&directory) {
            merged.push(directory);
        }
    };
    for directory in login.map(env::split_paths).into_iter().flatten() {
        push(directory);
    }
    for directory in env::split_paths(current) {
        push(directory);
    }
    for directory in extra.iter().filter(|directory| directory.is_dir()) {
        push(directory.clone());
    }
    env::join_paths(merged)
        .map(|joined| joined.to_string_lossy().into_owned())
        .unwrap_or_else(|_| current.to_owned())
}

/// Gives this process the `PATH` the user sees in a terminal.
///
/// An app launched from Finder or the Dock inherits launchd's minimal `PATH`, so `claude`,
/// `codex` and `node` installed through Homebrew or npm would not be found, neither by detection
/// nor by the terminals that inherit this environment. Must run before other threads start.
///
/// The probe waits for the user's shell dotfiles, so a slow `.zshrc` delays the window by up to
/// `LOGIN_SHELL_TIMEOUT`; after that the current `PATH` is kept and the well-known directories are
/// added anyway.
#[cfg(target_os = "macos")]
pub fn inherit_login_environment() {
    let current = env::var("PATH").unwrap_or_default();
    let merged = merge_paths(
        login_shell_path().as_deref(),
        &current,
        &well_known_bin_directories(),
    );
    env::set_var("PATH", merged);
}

#[cfg(not(target_os = "macos"))]
pub fn inherit_login_environment() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn windows_shells_resolve_to_the_users_shell() {
        for shell in ["powershell.exe", "powershell", "PowerShell.EXE", "cmd.exe", ""] {
            assert_eq!(resolve_shell(shell), default_shell(), "{shell}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn posix_quoting_survives_embedded_quotes() {
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
        assert_eq!(shell_invoke("/bin/a b"), "'/bin/a b'");
    }

    #[cfg(unix)]
    #[test]
    fn other_shells_are_left_alone() {
        assert_eq!(resolve_shell("/bin/bash"), "/bin/bash");
        assert_eq!(resolve_shell("/opt/homebrew/bin/pwsh"), "/opt/homebrew/bin/pwsh");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn login_entries_lead_and_duplicates_collapse() {
        let merged = merge_paths(Some("/a:/b"), "/usr/bin:/b", &[]);
        assert_eq!(merged, "/a:/b:/usr/bin");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_failed_login_shell_keeps_the_current_path() {
        assert_eq!(merge_paths(None, "/usr/bin:/bin", &[]), "/usr/bin:/bin");
    }
}
