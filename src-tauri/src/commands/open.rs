use std::path::{Path, PathBuf};

/// Extensions Windows runs rather than displays, either directly or through a script host.
///
/// A deny list is the only shape this rule can take: any extension can be registered to any
/// program, so there is no set of names that is provably safe to open. These are the ones whose
/// whole purpose is to execute, and a path naming one is revealed instead of opened.
const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "msi", "msp", "cpl", "reg", "lnk", "hta", "ps1",
    "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "jar",
];

/// Whether the path names something Windows would run if it were opened.
fn is_executable_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            EXECUTABLE_EXTENSIONS
                .iter()
                .any(|known| extension.eq_ignore_ascii_case(known))
        })
}

/// Schemes a browser may be handed. Terminal output is written by an agent, not by the user, so
/// anything else — a custom protocol registered on this machine above all — is refused rather
/// than trusted to be harmless.
const ALLOWED_URL_SCHEMES: &[&str] = &["http://", "https://"];

/// Opens an address from terminal output in the default browser.
#[tauri::command(async)]
pub fn open_terminal_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !ALLOWED_URL_SCHEMES
        .iter()
        .any(|scheme| url.len() > scheme.len() && url.to_ascii_lowercase().starts_with(scheme))
    {
        return Err("只能打开 http 或 https 链接。".into());
    }
    super::update::open_url(url)
}

/// Opens a file or folder named in terminal output.
///
/// Relative paths are resolved against the terminal's working directory, which is where the agent
/// that printed them was standing. A path that names an executable or a script is revealed in the
/// file explorer rather than opened: the text came from an agent's output, and a mis-aimed click
/// must not be able to run a program.
#[tauri::command(async)]
pub fn open_terminal_path(path: String, working_directory: Option<String>) -> Result<(), String> {
    let resolved = resolve(&path, working_directory.as_deref())?;
    if resolved.is_dir() || is_executable_extension(&resolved) {
        return reveal(&resolved);
    }
    open_with_default_program(&resolved)
}

/// Resolves what the terminal printed into a path that exists on this machine.
fn resolve(path: &str, working_directory: Option<&str>) -> Result<PathBuf, String> {
    let trimmed = path.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err("路径为空。".into());
    }
    let candidate = Path::new(trimmed);
    let resolved = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        let base = working_directory
            .map(PathBuf::from)
            .ok_or_else(|| format!("找不到 {trimmed}：这个终端没有工作目录可供解析相对路径。"))?;
        base.join(candidate)
    };
    // Canonicalising also proves the path exists, and collapses the `..` an agent may have
    // printed, so what is opened is what the explorer is later asked to select.
    resolved
        .canonicalize()
        .map_err(|_| format!("找不到 {}。", resolved.to_string_lossy()))
}

#[cfg(windows)]
fn reveal(path: &Path) -> Result<(), String> {
    use std::process::Command;
    // `/select,` needs the path in the same argument, and the extended-length prefix
    // `canonicalize` produces is not something the shell accepts here.
    let argument = format!("/select,{}", strip_extended_prefix(path));
    Command::new("explorer.exe")
        .arg(argument)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法在资源管理器中定位该文件：{error}"))
}

#[cfg(windows)]
fn open_with_default_program(path: &Path) -> Result<(), String> {
    use std::process::Command;
    // Explorer hands the file to whatever is registered for it, without a shell parsing the path.
    Command::new("explorer.exe")
        .arg(strip_extended_prefix(path))
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开该文件：{error}"))
}

/// Drops the `\\?\` that `canonicalize` adds, which the shell APIs below do not accept.
#[cfg(windows)]
fn strip_extended_prefix(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
}

#[cfg(not(windows))]
fn reveal(_path: &Path) -> Result<(), String> {
    Err("当前平台不支持在文件管理器中定位。".into())
}

#[cfg(not(windows))]
fn open_with_default_program(_path: &Path) -> Result<(), String> {
    Err("当前平台不支持打开文件。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_a_scheme_a_browser_should_not_be_handed() {
        for url in [
            "javascript:alert(1)",
            "file:///D:/secret.txt",
            "ms-settings:",
            "http://",
            "",
        ] {
            assert!(open_terminal_url(url.into()).is_err(), "{url} was allowed");
        }
    }

    #[test]
    fn treats_the_things_windows_would_run_as_executables() {
        for name in ["setup.exe", "run.BAT", "task.ps1", "installer.msi", "shortcut.lnk"] {
            assert!(is_executable_extension(Path::new(name)), "{name}");
        }
        for name in ["main.rs", "readme.md", "notes.txt", "chart.png", "data.json"] {
            assert!(!is_executable_extension(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn resolves_a_relative_path_against_the_terminal_directory() {
        let directory = std::env::temp_dir();
        let name = format!("termexo-open-{}.txt", std::process::id());
        let file = directory.join(&name);
        std::fs::write(&file, "x").unwrap();

        let resolved = resolve(&name, directory.to_str()).unwrap();

        assert_eq!(
            resolved.canonicalize().unwrap(),
            file.canonicalize().unwrap()
        );
        std::fs::remove_file(&file).ok();
    }

    #[test]
    fn reports_a_path_that_is_not_there_rather_than_opening_something_else() {
        let missing = resolve("termexo-does-not-exist.txt", std::env::temp_dir().to_str());

        assert!(missing.is_err());
    }

    #[test]
    fn refuses_a_relative_path_with_no_directory_to_resolve_it_against() {
        assert!(resolve("src/main.rs", None).is_err());
    }
}
