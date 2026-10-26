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

/// Extensions macOS runs, installs or mounts rather than displays when handed to `open`.
///
/// `.command` and `.terminal` start Terminal.app and execute their contents, the installer and
/// automation types run code on open, and the script extensions are what an editor would not
/// necessarily be registered for. `.app` bundles are directories and are revealed already.
#[cfg(target_os = "macos")]
const MACOS_EXECUTABLE_EXTENSIONS: &[&str] = &[
    "command", "terminal", "tool", "sh", "zsh", "bash", "pkg", "mpkg", "dmg", "workflow",
    "action", "scpt", "scptd", "applescript", "app", "jar", "py", "pl", "rb",
];

#[cfg(not(target_os = "macos"))]
const MACOS_EXECUTABLE_EXTENSIONS: &[&str] = &[];

/// Whether the path names something the platform would run if it were opened.
fn is_executable_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            EXECUTABLE_EXTENSIONS
                .iter()
                .chain(MACOS_EXECUTABLE_EXTENSIONS)
                .any(|known| extension.eq_ignore_ascii_case(known))
        })
}

/// Whether the file carries an execute permission, which makes `open` run it in a terminal
/// whatever its name. Windows has no such bit; it is judged by extension alone.
#[cfg(unix)]
fn has_execute_permission(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn has_execute_permission(_path: &Path) -> bool {
    false
}

/// Schemes a browser may be handed. Terminal output is written by an agent, not by the user, so
/// anything else — a custom protocol registered on this machine above all — is refused rather
/// than trusted to be harmless.
const ALLOWED_URL_SCHEMES: &[&str] = &["http://", "https://"];

/// Opens a draft to the fixed support address; no arbitrary protocol or recipient is accepted.
#[tauri::command(async)]
pub fn open_support_email() -> Result<(), String> {
    super::update::open_url("mailto:gemron@foxmail.com")
}

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
    if resolved.is_dir() || is_executable_extension(&resolved) || has_execute_permission(&resolved)
    {
        return reveal(&resolved);
    }
    open_with_default_program(&resolved)
}

/// Opens a project directory's contents, rather than selecting it in its parent folder.
#[tauri::command(async)]
pub fn open_directory(path: String) -> Result<(), String> {
    let resolved = resolve_directory(&path)?;
    open_with_default_program(&resolved)
}

fn resolve_directory(path: &str) -> Result<PathBuf, String> {
    let resolved = resolve(path, None)?;
    if !resolved.is_dir() {
        return Err(format!("不是文件夹：{}。", resolved.to_string_lossy()));
    }
    Ok(resolved)
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
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
}

#[cfg(target_os = "macos")]
fn reveal(path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法在 Finder 中定位该文件：{error}"))
}

#[cfg(target_os = "macos")]
fn open_with_default_program(path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开该文件：{error}"))
}

#[cfg(not(any(windows, target_os = "macos")))]
fn reveal(_path: &Path) -> Result<(), String> {
    Err("当前平台不支持在文件管理器中定位。".into())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn open_with_default_program(_path: &Path) -> Result<(), String> {
    Err("当前平台不支持打开文件。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_files_that_run_when_opened_are_recognised() {
        for name in ["fix.command", "x.TERMINAL", "setup.pkg", "a.dmg", "run.scpt", "job.workflow"] {
            assert!(is_executable_extension(Path::new(name)), "{name}");
        }
        for name in ["notes.md", "image.png", "main.rs", "README"] {
            assert!(!is_executable_extension(Path::new(name)), "{name}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_file_with_an_execute_bit_counts_as_executable() {
        use std::os::unix::fs::PermissionsExt;

        let directory = std::env::temp_dir().join(format!("termexo-open-exec-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let plain = directory.join("notes");
        let program = directory.join("tool-without-extension");
        std::fs::write(&plain, "text").unwrap();
        std::fs::write(&program, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&plain, std::fs::Permissions::from_mode(0o644)).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert!(!has_execute_permission(&plain));
        assert!(has_execute_permission(&program));
        std::fs::remove_dir_all(directory).unwrap();
    }

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
        for name in [
            "setup.exe",
            "run.BAT",
            "task.ps1",
            "installer.msi",
            "shortcut.lnk",
        ] {
            assert!(is_executable_extension(Path::new(name)), "{name}");
        }
        for name in [
            "main.rs",
            "readme.md",
            "notes.txt",
            "chart.png",
            "data.json",
        ] {
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

    #[test]
    fn resolves_project_directories_with_spaces_and_unicode() {
        let directory =
            std::env::temp_dir().join(format!("termexo-project-{} 空格目录", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        assert_eq!(
            resolve_directory(directory.to_str().unwrap()).unwrap(),
            directory.canonicalize().unwrap()
        );
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn refuses_files_and_invalid_project_directories() {
        let file =
            std::env::temp_dir().join(format!("termexo-project-file-{}.txt", std::process::id()));
        std::fs::write(&file, "x").unwrap();
        assert!(resolve_directory(file.to_str().unwrap()).is_err());
        std::fs::remove_file(file).unwrap();
        assert!(resolve_directory("").is_err());
        assert!(resolve_directory("relative/project").is_err());
        assert!(resolve_directory(
            &std::env::temp_dir()
                .join("termexo-nonexistent-project-directory")
                .to_string_lossy()
        )
        .is_err());
    }

    #[cfg(windows)]
    #[test]
    fn converts_extended_local_and_unc_paths_for_explorer() {
        assert_eq!(
            strip_extended_prefix(Path::new(r"\\?\C:\my project")),
            r"C:\my project"
        );
        assert_eq!(
            strip_extended_prefix(Path::new(r"\\?\UNC\server\share\项目")),
            r"\\server\share\项目"
        );
    }
}
