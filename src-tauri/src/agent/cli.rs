use crate::platform::shell_quote;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::process::hidden_command;

pub(super) fn command_paths(command: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    let mut paths = env::current_dir()
        .ok()
        .map(|directory| vec![directory.join(command)])
        .unwrap_or_default();
    #[cfg(not(windows))]
    let mut paths = Vec::new();
    if let Some(search_path) = env::var_os("PATH") {
        paths.extend(paths_from_search(
            command,
            &search_path,
            env::current_dir().ok().as_deref(),
        ));
    }
    paths
}

fn paths_from_search(command: &str, search: &std::ffi::OsStr, cwd: Option<&Path>) -> Vec<PathBuf> {
    env::split_paths(search)
        .filter_map(|directory| {
            let directory = if directory.is_absolute() {
                directory
            } else {
                cwd?.join(directory)
            };
            Some(directory.join(command))
        })
        .collect()
}

/// Windows npm shims need cmd.exe even for read-only version queries.
pub(super) fn query_command(executable: &Path) -> Command {
    #[cfg(windows)]
    if executable
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd"))
    {
        let mut command = hidden_command("cmd.exe");
        command.args(["/d", "/c", "call"]).arg(executable);
        return command;
    }
    hidden_command(executable)
}

pub(super) fn append_option(command: &mut String, flag: &str, value: Option<&str>) {
    if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
        command.push(' ');
        command.push_str(flag);
        command.push(' ');
        command.push_str(&shell_quote(value));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn path_search_follows_bash_order_and_skips_non_executable_files() {
        let root = env::temp_dir().join(format!("termexo-path-search-{}", std::process::id()));
        let first = root.join("first");
        let second = root.join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        for directory in [&first, &second] {
            std::fs::write(directory.join("agent"), "#!/bin/sh\n").unwrap();
        }
        std::fs::set_permissions(second.join("agent"), std::fs::Permissions::from_mode(0o755))
            .unwrap();
        let search = env::join_paths([&first, &second]).unwrap();
        let found = paths_from_search("agent", &search, Some(&root))
            .into_iter()
            .find(|path| crate::platform::is_executable_file(path));
        assert_eq!(found, Some(second.join("agent")));
        let relative = paths_from_search("agent", std::ffi::OsStr::new("tools:/bin"), Some(&root));
        assert_eq!(
            relative,
            vec![root.join("tools/agent"), PathBuf::from("/bin/agent")]
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
