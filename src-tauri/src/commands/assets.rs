use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::database::{HandoffRecord, PromptAsset, WorkspaceDatabase};

const MAX_HANDOFF_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
const DEFAULT_MAX_GIT_DIFF_BYTES: usize = 96 * 1024;
const MAX_GIT_DIFF_BYTES: usize = 512 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitContextRequest {
    pub project_path: String,
    pub max_diff_bytes: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitContext {
    pub available: bool,
    pub branch: String,
    pub status: String,
    pub changed_files: Vec<String>,
    pub diff: String,
    pub recent_commits: Vec<String>,
    pub truncated: bool,
    pub diagnostic: String,
}

#[tauri::command]
pub fn list_prompt_assets(
    workspace_id: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<PromptAsset>, String> {
    database
        .list_prompt_assets(workspace_id.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_prompt_asset(
    input: PromptAsset,
    database: State<'_, WorkspaceDatabase>,
) -> Result<PromptAsset, String> {
    input.validate()?;
    database
        .save_prompt_asset(&input)
        .map_err(|error| error.to_string())?;
    Ok(input)
}

#[tauri::command]
pub fn delete_prompt_asset(
    asset_id: String,
    database: State<'_, WorkspaceDatabase>,
) -> Result<(), String> {
    database
        .delete_prompt_asset(&asset_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_handoff_packages(
    workspace_id: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<HandoffRecord>, String> {
    database
        .list_handoff_packages(workspace_id.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_handoff_package(
    input: HandoffRecord,
    database: State<'_, WorkspaceDatabase>,
) -> Result<HandoffRecord, String> {
    input.validate()?;
    database
        .save_handoff_package(&input)
        .map_err(|error| error.to_string())?;
    Ok(input)
}

#[tauri::command]
pub fn delete_handoff_package(
    package_id: String,
    database: State<'_, WorkspaceDatabase>,
) -> Result<(), String> {
    database
        .delete_handoff_package(&package_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn collect_git_context(request: GitContextRequest) -> Result<GitContext, String> {
    let project_path = PathBuf::from(request.project_path.trim());
    if !project_path.is_dir() {
        return Err("Workspace project directory does not exist or is not a directory.".into());
    }

    let inside = run_git(&project_path, &["rev-parse", "--is-inside-work-tree"]);
    if inside.as_deref().map(str::trim) != Ok("true") {
        return Ok(GitContext {
            available: false,
            branch: String::new(),
            status: String::new(),
            changed_files: Vec::new(),
            diff: String::new(),
            recent_commits: Vec::new(),
            truncated: false,
            diagnostic: "The current workspace is not a Git worktree; Git context was omitted."
                .into(),
        });
    }

    let branch = run_git(&project_path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_default()
        .trim()
        .to_owned();
    let status = run_git(
        &project_path,
        &[
            "-c",
            "core.quotepath=false",
            "status",
            "--short",
            "--branch",
        ],
    )
    .unwrap_or_default();
    let changed_files = status
        .lines()
        .filter(|line| !line.starts_with("##"))
        .filter_map(|line| line.get(3..))
        .map(|path| path.split(" -> ").last().unwrap_or(path).trim().to_owned())
        .filter(|path| !path.is_empty())
        .collect();

    let unstaged = run_git(
        &project_path,
        &[
            "-c",
            "core.quotepath=false",
            "diff",
            "--no-ext-diff",
            "--unified=3",
        ],
    )
    .unwrap_or_default();
    let staged = run_git(
        &project_path,
        &[
            "-c",
            "core.quotepath=false",
            "diff",
            "--cached",
            "--no-ext-diff",
            "--unified=3",
        ],
    )
    .unwrap_or_default();
    let mut diff = match (staged.trim().is_empty(), unstaged.trim().is_empty()) {
        (false, false) => format!("# Staged changes\n{staged}\n# Unstaged changes\n{unstaged}"),
        (false, true) => staged,
        (true, false) => unstaged,
        (true, true) => String::new(),
    };
    let budget = request
        .max_diff_bytes
        .unwrap_or(DEFAULT_MAX_GIT_DIFF_BYTES)
        .clamp(1_024, MAX_GIT_DIFF_BYTES);
    let truncated = truncate_utf8(&mut diff, budget);

    let recent_commits = run_git(&project_path, &["log", "-5", "--pretty=format:%h %s"])
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect();

    Ok(GitContext {
        available: true,
        branch,
        status,
        changed_files,
        diff,
        recent_commits,
        truncated,
        diagnostic: if truncated {
            format!(
                "Git diff was truncated to the {} KiB handoff budget.",
                budget / 1024
            )
        } else {
            "Git context collected successfully.".into()
        },
    })
}

#[tauri::command]
pub fn write_handoff_document(path: String, contents: String) -> Result<(), String> {
    if contents.len() > MAX_HANDOFF_DOCUMENT_BYTES {
        return Err("The handoff document exceeds the 2 MB safety limit.".into());
    }
    let path = validate_handoff_path(&path)?;
    fs::write(path, contents).map_err(|error| format!("Failed to write handoff document: {error}"))
}

#[tauri::command]
pub fn read_handoff_document(path: String) -> Result<String, String> {
    let path = validate_handoff_path(&path)?;
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Failed to read handoff document: {error}"))?;
    if metadata.len() > MAX_HANDOFF_DOCUMENT_BYTES as u64 {
        return Err("The handoff document exceeds the 2 MB safety limit.".into());
    }
    fs::read_to_string(path).map_err(|error| format!("Failed to read handoff document: {error}"))
}

fn run_git(directory: &Path, arguments: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(directory)
        .output()
        .map_err(|error| format!("Failed to start Git: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn truncate_utf8(value: &mut String, max_bytes: usize) -> bool {
    if value.len() <= max_bytes {
        return false;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value.truncate(end);
    value.push_str("\n\n[Termexo: diff truncated to token budget]\n");
    true
}

fn validate_handoff_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value.trim());
    if value.trim().is_empty() || path.file_name().is_none() {
        return Err("Select a valid handoff document path.".into());
    }
    let supported = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "json"));
    if !supported {
        return Err("Handoff documents must use the .md or .json extension.".into());
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_utf8_without_splitting_a_character() {
        let mut value = "abc中文def".to_owned();
        assert!(truncate_utf8(&mut value, 5));
        assert!(value.starts_with("abc"));
        assert!(value.contains("diff truncated"));
    }

    #[test]
    fn accepts_only_markdown_and_json_handoff_paths() {
        assert!(validate_handoff_path("handoff.md").is_ok());
        assert!(validate_handoff_path("handoff.JSON").is_ok());
        assert!(validate_handoff_path("handoff.txt").is_err());
        assert!(validate_handoff_path("").is_err());
    }
}
