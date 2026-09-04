use serde::Deserialize;
use tauri::State;

use crate::database::WorkspaceDatabase;
use crate::git::{RepositoryDiff, RepositoryManager, RepositoryOverview, RepositoryTarget};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryTargetRequest {
    workspace_id: String,
    terminal_id: String,
    #[serde(default)]
    runtime_revision: u64,
}

impl From<RepositoryTargetRequest> for RepositoryTarget {
    fn from(value: RepositoryTargetRequest) -> Self {
        Self {
            workspace_id: value.workspace_id,
            terminal_id: value.terminal_id,
            runtime_revision: value.runtime_revision,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryOverviewRequest {
    target: RepositoryTargetRequest,
    commit_limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDiffRequest {
    target: RepositoryTargetRequest,
    path: String,
}

#[tauri::command]
pub fn get_repository_overview(
    request: RepositoryOverviewRequest,
    repositories: State<'_, RepositoryManager>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<RepositoryOverview, String> {
    repositories.overview(&request.target.into(), &database, request.commit_limit)
}

#[tauri::command]
pub fn get_repository_diff(
    request: RepositoryDiffRequest,
    repositories: State<'_, RepositoryManager>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<RepositoryDiff, String> {
    repositories.diff(&request.target.into(), &database, request.path.trim())
}
