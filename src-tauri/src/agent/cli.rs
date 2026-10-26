use crate::platform::shell_quote;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::process::hidden_command;

pub(super) fn command_paths(command: &str) -> Vec<PathBuf> {
    let mut paths = env::current_dir()
        .ok()
        .map(|directory| vec![directory.join(command)])
        .unwrap_or_default();
    if let Some(search_path) = env::var_os("PATH") {
        paths.extend(env::split_paths(&search_path).map(|directory| directory.join(command)));
    }
    paths
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
