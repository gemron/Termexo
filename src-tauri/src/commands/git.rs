use serde::Deserialize;
use tauri::State;

use crate::database::WorkspaceDatabase;
use std::path::Path;

use crate::git::watch::RepositoryWatcher;
use crate::git::{
    BranchComparison, CommitDetails, HistoryCursor, RepositoryDiff, RepositoryHistory,
    RepositoryManager, RepositoryOverview, RepositoryTarget, RevisionRange,
};

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

#[tauri::command(async)]
pub fn get_repository_overview(
    request: RepositoryOverviewRequest,
    repositories: State<'_, RepositoryManager>,
    database: State<'_, WorkspaceDatabase>,
    watcher: State<'_, RepositoryWatcher>,
) -> Result<RepositoryOverview, String> {
    let terminal_id = request.target.terminal_id.clone();
    let mut overview =
        repositories.overview(&request.target.into(), &database, request.commit_limit)?;
    // From here on the UI is told about changes instead of asking; `watched` says whether that
    // worked, so it knows whether to keep polling.
    if overview.available {
        overview.watched = watcher.watch(Path::new(&overview.root), &terminal_id);
    }
    Ok(overview)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryHistoryRequest {
    target: RepositoryTargetRequest,
    branch: Option<String>,
    cursor: Option<HistoryCursor>,
    commit_limit: Option<usize>,
}

#[tauri::command(async)]
pub fn get_repository_history(
    request: RepositoryHistoryRequest,
    repositories: State<'_, RepositoryManager>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<RepositoryHistory, String> {
    repositories.history(
        &request.target.into(),
        &database,
        request.branch.as_deref(),
        request.cursor.as_ref(),
        request.commit_limit,
    )
}

#[tauri::command(async)]
pub fn get_repository_diff(
    request: RepositoryDiffRequest,
    repositories: State<'_, RepositoryManager>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<RepositoryDiff, String> {
    repositories.diff(&request.target.into(), &database, request.path.trim())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetailsRequest {
    target: RepositoryTargetRequest,
    oid: String,
}

#[tauri::command(async)]
pub fn get_repository_commit(
    request: CommitDetailsRequest,
    repositories: State<'_, RepositoryManager>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<CommitDetails, String> {
    repositories.commit_details(&request.target.into(), &database, &request.oid)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchComparisonRequest {
    target: RepositoryTargetRequest,
    base: String,
    head: String,
}

#[tauri::command(async)]
pub fn compare_repository_branches(
    request: BranchComparisonRequest,
    repositories: State<'_, RepositoryManager>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<BranchComparison, String> {
    repositories.compare_branches(
        &request.target.into(),
        &database,
        &request.base,
        &request.head,
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionDiffRequest {
    target: RepositoryTargetRequest,
    range: RevisionRange,
    path: String,
    old_path: Option<String>,
}

#[tauri::command(async)]
pub fn get_repository_revision_diff(
    request: RevisionDiffRequest,
    repositories: State<'_, RepositoryManager>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<RepositoryDiff, String> {
    repositories.revision_diff(
        &request.target.into(),
        &database,
        &request.range,
        &request.path,
        request.old_path.as_deref(),
    )
}
