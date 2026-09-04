use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{Read, Take};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

use crate::database::WorkspaceDatabase;
use crate::process::{hidden_command, run_with_timeout};

const GIT_TIMEOUT: Duration = Duration::from_secs(8);
const DEFAULT_COMMIT_LIMIT: usize = 40;
const MAX_COMMIT_LIMIT: usize = 100;
const MAX_FILE_BYTES: usize = 1024 * 1024;
const MAX_PREVIEW_LINES: usize = 5_000;
const MAX_BASELINE_FILES: usize = 256;
const MAX_BASELINE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SessionKey {
    terminal_id: String,
    runtime_revision: u64,
}

#[derive(Debug, Clone)]
struct SessionBaseline {
    workspace_id: String,
    root: PathBuf,
    head: Option<String>,
    dirty_files: HashMap<String, BaselineFile>,
    repository_missing_at_start: bool,
    snapshot_truncated: bool,
}

#[derive(Debug, Clone)]
struct BaselineFile {
    change: RepositoryChange,
    content: Vec<u8>,
    content_fingerprint: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct RepositoryTarget {
    pub workspace_id: String,
    pub terminal_id: String,
    pub runtime_revision: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryOverview {
    pub available: bool,
    pub diagnostic: String,
    pub root: String,
    pub branch: String,
    pub detached: bool,
    pub head: Option<String>,
    pub baseline_head: Option<String>,
    pub baseline_captured: bool,
    pub history_rewritten: bool,
    pub changes: Vec<RepositoryChange>,
    pub commits: Vec<RepositoryCommit>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryChange {
    pub path: String,
    pub old_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub untracked: bool,
    pub committed: bool,
    pub pre_existing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryCommit {
    pub oid: String,
    pub short_oid: String,
    pub parent_oids: Vec<String>,
    pub decorations: Vec<String>,
    pub author: String,
    pub committed_at: i64,
    pub summary: String,
    pub in_session: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDiff {
    pub path: String,
    pub old_text: String,
    pub new_text: String,
    pub binary: bool,
    pub truncated: bool,
}

#[derive(Default)]
pub struct RepositoryManager {
    baselines: Mutex<HashMap<SessionKey, Arc<SessionBaseline>>>,
}

impl RepositoryManager {
    /// Captures repository identity before the PTY can modify the working tree. Git failures must
    /// never prevent a terminal from starting, so the caller deliberately ignores the result.
    pub fn capture_baseline(
        &self,
        workspace_id: Option<&str>,
        terminal_id: &str,
        runtime_revision: u64,
        working_directory: &str,
    ) -> Result<(), String> {
        let Some(workspace_id) = workspace_id.filter(|value| !value.trim().is_empty()) else {
            return Ok(());
        };
        let key = SessionKey {
            terminal_id: terminal_id.to_owned(),
            runtime_revision,
        };
        {
            let mut baselines = self
                .baselines
                .lock()
                .map_err(|_| "Git 会话基线锁已损坏。".to_owned())?;
            if baselines.contains_key(&key) {
                return Ok(());
            }
            if let Some(existing) = baselines
                .iter()
                .find(|(candidate, baseline)| {
                    candidate.terminal_id == terminal_id && baseline.workspace_id == workspace_id
                })
                .map(|(_, baseline)| Arc::clone(baseline))
            {
                baselines.retain(|candidate, _| candidate.terminal_id != terminal_id);
                baselines.insert(key, existing);
                return Ok(());
            }
        }
        let directory = PathBuf::from(working_directory);
        let discovered_root = repository_root(&directory)?;
        let repository_missing_at_start = discovered_root.is_none();
        let root = discovered_root.unwrap_or_else(|| directory.clone());
        let head = if repository_missing_at_start {
            None
        } else {
            current_head(&root)?
        };
        let mut dirty_files = HashMap::new();
        let mut snapshot_bytes = 0usize;
        let mut snapshot_truncated = false;
        if !repository_missing_at_start {
            for change in collect_worktree_changes(&root, &HashSet::new())? {
                if dirty_files.len() >= MAX_BASELINE_FILES {
                    snapshot_truncated = true;
                    break;
                }
                let path = change.path.clone();
                let content = read_worktree_file(&root, &path)?;
                if snapshot_bytes.saturating_add(content.len()) > MAX_BASELINE_BYTES {
                    snapshot_truncated = true;
                    break;
                }
                snapshot_bytes += content.len();
                let content_fingerprint = worktree_fingerprint_from_content(&root, &path, &content);
                dirty_files.insert(
                    path,
                    BaselineFile {
                        change,
                        content,
                        content_fingerprint,
                    },
                );
            }
        }
        let baseline = SessionBaseline {
            workspace_id: workspace_id.to_owned(),
            root,
            head,
            dirty_files,
            repository_missing_at_start,
            snapshot_truncated,
        };
        let mut baselines = self
            .baselines
            .lock()
            .map_err(|_| "Git 会话基线锁已损坏。".to_owned())?;
        baselines.retain(|candidate, _| candidate.terminal_id != terminal_id);
        baselines.insert(key, Arc::new(baseline));
        Ok(())
    }

    pub fn remove_terminal(&self, terminal_id: &str) {
        if let Ok(mut baselines) = self.baselines.lock() {
            baselines.retain(|key, _| key.terminal_id != terminal_id);
        }
    }

    pub fn overview(
        &self,
        target: &RepositoryTarget,
        database: &WorkspaceDatabase,
        commit_limit: Option<usize>,
    ) -> Result<RepositoryOverview, String> {
        let (directory, baseline) = self.resolve_target(target, database)?;
        let Some(root) = repository_root(&directory)? else {
            return Ok(unavailable_overview("当前终端目录不是 Git 工作树。"));
        };
        let head = current_head(&root)?;
        let baseline = baseline.filter(|item| {
            item.root == root || (item.repository_missing_at_start && root.starts_with(&item.root))
        });
        let baseline_head = baseline.as_ref().and_then(|item| item.head.clone());
        let current_head_value = head.as_deref();
        let history_rewritten = match (baseline_head.as_deref(), current_head_value) {
            (Some(base), Some(current)) if base != current => !is_ancestor(&root, base, current),
            _ => false,
        };
        let session_oids = if history_rewritten || baseline.is_none() {
            HashSet::new()
        } else {
            commits_since(&root, baseline_head.as_deref(), current_head_value)?
        };
        let pre_existing = baseline
            .as_ref()
            .map(|item| item.dirty_files.keys().cloned().collect())
            .unwrap_or_default();
        let mut changes = collect_worktree_changes(&root, &pre_existing)?;
        if let Some(baseline) = baseline.as_ref() {
            if baseline.snapshot_truncated {
                changes.clear();
            } else {
                retain_session_worktree_changes(&root, baseline, &mut changes);
            }
        }
        match (baseline_head.as_deref(), current_head_value) {
            (Some(base), Some(current)) => {
                merge_committed_changes(&root, base, current, &pre_existing, &mut changes)?;
            }
            (None, Some(current)) if baseline.is_some() => {
                merge_initial_commit_changes(&root, current, &pre_existing, &mut changes)?;
            }
            _ => {}
        }
        changes.sort_by(|left, right| left.path.cmp(&right.path));

        let (branch, detached) = current_branch(&root, current_head_value)?;
        let limit = commit_limit
            .unwrap_or(DEFAULT_COMMIT_LIMIT)
            .clamp(1, MAX_COMMIT_LIMIT);
        let commits = collect_commits(&root, limit, &session_oids)?;
        let mut diagnostic: String = if history_rewritten {
            "当前 HEAD 已不再包含会话启动时的提交，变更列表仍按两个版本比较。".into()
        } else if baseline.is_some() {
            "显示当前终端会话启动以来的仓库差异。".into()
        } else {
            "未找到当前终端的启动基线，显示工作树相对 HEAD 的差异。".into()
        };
        if baseline
            .as_ref()
            .is_some_and(|item| item.snapshot_truncated)
        {
            diagnostic.push_str(" 启动时变更过多，无法准确区分后续工作树修改，仅显示提交变更。");
        }
        Ok(RepositoryOverview {
            available: true,
            diagnostic,
            root: root.to_string_lossy().into_owned(),
            branch,
            detached,
            head,
            baseline_head,
            baseline_captured: baseline.is_some(),
            history_rewritten,
            changes,
            commits,
        })
    }

    pub fn diff(
        &self,
        target: &RepositoryTarget,
        database: &WorkspaceDatabase,
        requested_path: &str,
    ) -> Result<RepositoryDiff, String> {
        let overview = self.overview(target, database, Some(1))?;
        if !overview.available {
            return Err(overview.diagnostic);
        }
        let change = overview
            .changes
            .iter()
            .find(|change| change.path == requested_path)
            .ok_or_else(|| "只能查看当前变更列表中的文件。".to_owned())?;
        validate_relative_path(&change.path)?;
        let root = PathBuf::from(&overview.root);
        let old_path = change.old_path.as_deref().unwrap_or(&change.path);
        let (_, baseline) = self.resolve_target(target, database)?;
        let baseline_file = baseline.as_ref().and_then(|item| {
            item.dirty_files
                .get(old_path)
                .or_else(|| item.dirty_files.get(&change.path))
        });
        let (old_bytes, old_truncated) = if let Some(file) = baseline_file {
            (file.content.clone(), file.content.len() > MAX_FILE_BYTES)
        } else {
            let old_revision = if overview.baseline_captured {
                overview.baseline_head.as_deref()
            } else {
                overview.head.as_deref()
            };
            match old_revision {
                Some(revision) => read_git_blob(&root, revision, old_path)?,
                None => (Vec::new(), false),
            }
        };
        let new_bytes = read_worktree_file(&root, &change.path)?;
        let binary = (old_truncated && old_bytes.is_empty())
            || old_bytes.contains(&0)
            || new_bytes.contains(&0);
        let new_truncated = new_bytes.len() > MAX_FILE_BYTES;
        let (old_bytes, old_lines_truncated) = truncate_preview_lines(old_bytes);
        let (new_bytes, new_lines_truncated) = truncate_preview_lines(new_bytes);
        Ok(RepositoryDiff {
            path: change.path.clone(),
            old_text: if binary {
                String::new()
            } else {
                String::from_utf8_lossy(&old_bytes[..old_bytes.len().min(MAX_FILE_BYTES)]).into()
            },
            new_text: if binary {
                String::new()
            } else {
                String::from_utf8_lossy(&new_bytes[..new_bytes.len().min(MAX_FILE_BYTES)]).into()
            },
            binary,
            truncated: old_truncated || new_truncated || old_lines_truncated || new_lines_truncated,
        })
    }

    fn resolve_target(
        &self,
        target: &RepositoryTarget,
        database: &WorkspaceDatabase,
    ) -> Result<(PathBuf, Option<Arc<SessionBaseline>>), String> {
        if target.workspace_id.trim().is_empty() {
            return Err("缺少 Git 查询所需的工作区标识。".into());
        }
        let key = SessionKey {
            terminal_id: target.terminal_id.clone(),
            runtime_revision: target.runtime_revision,
        };
        if let Some(baseline) = self
            .baselines
            .lock()
            .map_err(|_| "Git 会话基线锁已损坏。".to_owned())?
            .get(&key)
            .filter(|item| item.workspace_id == target.workspace_id)
            .cloned()
        {
            return Ok((baseline.root.clone(), Some(baseline)));
        }

        let workspaces = database.list().map_err(|error| error.to_string())?;
        let workspace = workspaces
            .iter()
            .find(|workspace| workspace.id == target.workspace_id)
            .ok_or_else(|| "Git 查询对应的工作区不存在。".to_owned())?;
        let terminal = workspace
            .terminals
            .iter()
            .find(|terminal| terminal.id == target.terminal_id)
            .ok_or_else(|| "Git 查询对应的终端不存在。".to_owned())?;
        Ok((PathBuf::from(&terminal.working_directory), None))
    }
}

fn unavailable_overview(diagnostic: &str) -> RepositoryOverview {
    RepositoryOverview {
        available: false,
        diagnostic: diagnostic.into(),
        root: String::new(),
        branch: String::new(),
        detached: false,
        head: None,
        baseline_head: None,
        baseline_captured: false,
        history_rewritten: false,
        changes: Vec::new(),
        commits: Vec::new(),
    }
}

fn repository_root(directory: &Path) -> Result<Option<PathBuf>, String> {
    if !directory.is_dir() {
        return Ok(None);
    }
    if let Some(root) = direct_repository_root(directory) {
        return Ok(Some(root));
    }

    let mut candidates = fs::read_dir(directory)
        .map_err(|error| format!("无法扫描终端目录中的 Git 仓库：{error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path.join(".git").exists())
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    for candidate in candidates.into_iter().rev() {
        if let Some(root) = direct_repository_root(&candidate) {
            return Ok(Some(root));
        }
    }
    Ok(None)
}

fn direct_repository_root(directory: &Path) -> Option<PathBuf> {
    match run_git(directory, &["rev-parse", "--show-toplevel"]) {
        Ok(output) => {
            let value = clean_output(&output);
            (!value.is_empty()).then(|| PathBuf::from(value))
        }
        Err(_) => None,
    }
}

fn current_head(root: &Path) -> Result<Option<String>, String> {
    match run_git(root, &["rev-parse", "--verify", "HEAD"]) {
        Ok(output) => Ok(Some(clean_output(&output))),
        Err(_) => Ok(None),
    }
}

fn current_branch(root: &Path, head: Option<&str>) -> Result<(String, bool), String> {
    match run_git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]) {
        Ok(output) => Ok((clean_output(&output), false)),
        Err(_) => Ok((
            head.map(|value| format!("detached@{}", &value[..value.len().min(8)]))
                .unwrap_or_else(|| "未提交分支".into()),
            head.is_some(),
        )),
    }
}

fn collect_worktree_changes(
    root: &Path,
    pre_existing: &HashSet<String>,
) -> Result<Vec<RepositoryChange>, String> {
    let output = run_git(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    parse_porcelain_status(&output, pre_existing)
}

fn parse_porcelain_status(
    output: &[u8],
    pre_existing: &HashSet<String>,
) -> Result<Vec<RepositoryChange>, String> {
    let records: Vec<&[u8]> = output.split(|byte| *byte == 0).collect();
    let mut changes = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let record = records[index];
        index += 1;
        if record.is_empty() {
            continue;
        }
        if record.len() < 4 || record[2] != b' ' {
            return Err("Git 状态输出格式无效。".into());
        }
        let index_status = record[0] as char;
        let worktree_status = record[1] as char;
        let path = String::from_utf8_lossy(&record[3..]).into_owned();
        let old_path = if matches!(index_status, 'R' | 'C') {
            let value = records
                .get(index)
                .ok_or_else(|| "Git 重命名状态不完整。".to_owned())?;
            index += 1;
            Some(String::from_utf8_lossy(value).into_owned())
        } else {
            None
        };
        let is_pre_existing = pre_existing.contains(&path)
            || old_path
                .as_ref()
                .is_some_and(|old_path| pre_existing.contains(old_path));
        changes.push(RepositoryChange {
            path,
            old_path,
            index_status: normalized_status(index_status),
            worktree_status: normalized_status(worktree_status),
            untracked: index_status == '?' && worktree_status == '?',
            committed: false,
            pre_existing: is_pre_existing,
        });
    }
    Ok(changes)
}

fn normalized_status(value: char) -> String {
    if value == ' ' || value == '?' {
        String::new()
    } else {
        value.to_string()
    }
}

fn merge_committed_changes(
    root: &Path,
    base: &str,
    current: &str,
    pre_existing: &HashSet<String>,
    changes: &mut Vec<RepositoryChange>,
) -> Result<(), String> {
    if base == current {
        return Ok(());
    }
    let output = run_git(
        root,
        &[
            "diff",
            "--no-ext-diff",
            "--name-status",
            "-z",
            "--find-renames",
            base,
            current,
        ],
    )?;
    merge_change_sets(parse_name_status(&output, pre_existing)?, changes);
    Ok(())
}

fn merge_initial_commit_changes(
    root: &Path,
    current: &str,
    pre_existing: &HashSet<String>,
    changes: &mut Vec<RepositoryChange>,
) -> Result<(), String> {
    let empty_tree = clean_output(&run_git(root, &["mktree"])?);
    merge_committed_changes(root, &empty_tree, current, pre_existing, changes)
}

fn merge_change_sets(committed: Vec<RepositoryChange>, changes: &mut Vec<RepositoryChange>) {
    for item in committed {
        if let Some(existing) = changes.iter_mut().find(|change| change.path == item.path) {
            existing.committed = true;
            existing.pre_existing |= item.pre_existing;
            if existing.old_path.is_none() {
                existing.old_path = item.old_path;
            }
        } else {
            changes.push(item);
        }
    }
}

fn retain_session_worktree_changes(
    root: &Path,
    baseline: &SessionBaseline,
    changes: &mut Vec<RepositoryChange>,
) {
    changes.retain(|change| {
        let Some(file) = baseline.dirty_files.get(&change.path) else {
            return true;
        };
        file.change.index_status != change.index_status
            || file.change.worktree_status != change.worktree_status
            || file.change.old_path != change.old_path
            || file.content_fingerprint != worktree_fingerprint(root, &change.path)
    });

    for (path, file) in &baseline.dirty_files {
        if changes.iter().any(|change| change.path == *path) {
            continue;
        }
        let current_fingerprint = worktree_fingerprint(root, path);
        if current_fingerprint != file.content_fingerprint {
            changes.push(RepositoryChange {
                path: path.clone(),
                old_path: file.change.old_path.clone(),
                index_status: String::new(),
                worktree_status: if current_fingerprint.is_some() {
                    "M"
                } else {
                    "D"
                }
                .into(),
                untracked: false,
                committed: false,
                pre_existing: true,
            });
        }
    }
}

fn parse_name_status(
    output: &[u8],
    pre_existing: &HashSet<String>,
) -> Result<Vec<RepositoryChange>, String> {
    let fields: Vec<&[u8]> = output
        .split(|byte| *byte == 0)
        .filter(|item| !item.is_empty())
        .collect();
    let mut changes = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let status = String::from_utf8_lossy(fields[index]).into_owned();
        index += 1;
        let status_code = status.chars().next().unwrap_or('M');
        let first_path = fields
            .get(index)
            .ok_or_else(|| "Git 文件变更输出不完整。".to_owned())?;
        index += 1;
        let (old_path, path) = if matches!(status_code, 'R' | 'C') {
            let new_path = fields
                .get(index)
                .ok_or_else(|| "Git 重命名输出不完整。".to_owned())?;
            index += 1;
            (
                Some(String::from_utf8_lossy(first_path).into_owned()),
                String::from_utf8_lossy(new_path).into_owned(),
            )
        } else {
            (None, String::from_utf8_lossy(first_path).into_owned())
        };
        let is_pre_existing = pre_existing.contains(&path)
            || old_path
                .as_ref()
                .is_some_and(|old_path| pre_existing.contains(old_path));
        changes.push(RepositoryChange {
            path,
            old_path,
            index_status: status_code.to_string(),
            worktree_status: String::new(),
            untracked: false,
            committed: true,
            pre_existing: is_pre_existing,
        });
    }
    Ok(changes)
}

fn is_ancestor(root: &Path, base: &str, current: &str) -> bool {
    run_git(root, &["merge-base", "--is-ancestor", base, current]).is_ok()
}

fn commits_since(
    root: &Path,
    base: Option<&str>,
    current: Option<&str>,
) -> Result<HashSet<String>, String> {
    let Some(current) = current else {
        return Ok(HashSet::new());
    };
    let Some(base) = base else {
        return Ok(clean_output(&run_git(root, &["rev-list", current])?)
            .lines()
            .map(str::to_owned)
            .collect());
    };
    if base == current {
        return Ok(HashSet::new());
    }
    let range = format!("{base}..{current}");
    Ok(clean_output(&run_git(root, &["rev-list", &range])?)
        .lines()
        .map(str::to_owned)
        .collect())
}

fn collect_commits(
    root: &Path,
    limit: usize,
    session_oids: &HashSet<String>,
) -> Result<Vec<RepositoryCommit>, String> {
    let max_count = format!("--max-count={limit}");
    let output = match run_git(
        root,
        &[
            "log",
            "--topo-order",
            &max_count,
            "--pretty=format:%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%at%x1f%s%x1e",
        ],
    ) {
        Ok(output) => output,
        Err(_) => return Ok(Vec::new()),
    };
    let text = String::from_utf8_lossy(&output);
    Ok(text
        .split('\u{1e}')
        .filter_map(|record| {
            let record = record.trim_matches(['\r', '\n']);
            if record.is_empty() {
                return None;
            }
            let fields: Vec<&str> = record.split('\u{1f}').collect();
            if fields.len() != 7 {
                return None;
            }
            Some(RepositoryCommit {
                oid: fields[0].to_owned(),
                short_oid: fields[1].to_owned(),
                parent_oids: fields[2].split_whitespace().map(str::to_owned).collect(),
                decorations: fields[3]
                    .split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(sanitize_text)
                    .collect(),
                author: sanitize_text(fields[4]),
                committed_at: fields[5].parse().unwrap_or_default(),
                summary: sanitize_text(fields[6]),
                in_session: session_oids.contains(fields[0]),
            })
        })
        .collect())
}

fn sanitize_text(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .collect()
}

fn read_git_blob(root: &Path, revision: &str, path: &str) -> Result<(Vec<u8>, bool), String> {
    validate_relative_path(path)?;
    let object = format!("{revision}:{path}");
    let size = match run_git(root, &["cat-file", "-s", &object]) {
        Ok(output) => clean_output(&output).parse::<usize>().unwrap_or_default(),
        Err(_) => return Ok((Vec::new(), false)),
    };
    if size > MAX_FILE_BYTES {
        return Ok((Vec::new(), true));
    }
    match run_git(root, &["cat-file", "blob", &object]) {
        Ok(output) => Ok((output, false)),
        Err(_) => Ok((Vec::new(), false)),
    }
}

fn worktree_fingerprint(root: &Path, path: &str) -> Option<u64> {
    let content = read_worktree_file(root, path).ok()?;
    worktree_fingerprint_from_content(root, path, &content)
}

fn worktree_fingerprint_from_content(root: &Path, path: &str, content: &[u8]) -> Option<u64> {
    validate_relative_path(path).ok()?;
    let file_path = root.join(path);
    let metadata = fs::symlink_metadata(&file_path).ok()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return None;
    }
    let mut hasher = DefaultHasher::new();
    metadata.len().hash(&mut hasher);
    content.hash(&mut hasher);
    Some(hasher.finish())
}

fn truncate_preview_lines(mut content: Vec<u8>) -> (Vec<u8>, bool) {
    let cutoff = content
        .iter()
        .enumerate()
        .filter(|(_, byte)| **byte == b'\n')
        .nth(MAX_PREVIEW_LINES - 1)
        .map(|(index, _)| index + 1);
    if let Some(cutoff) = cutoff.filter(|cutoff| *cutoff < content.len()) {
        content.truncate(cutoff);
        return (content, true);
    }
    (content, false)
}

fn read_worktree_file(root: &Path, path: &str) -> Result<Vec<u8>, String> {
    validate_relative_path(path)?;
    let file_path = root.join(path);
    if !file_path.exists() {
        return Ok(Vec::new());
    }
    let metadata = fs::symlink_metadata(&file_path)
        .map_err(|error| format!("无法读取变更文件元数据：{error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Ok(Vec::new());
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("无法解析 Git 工作树路径：{error}"))?;
    let canonical_file = file_path
        .canonicalize()
        .map_err(|error| format!("无法解析变更文件路径：{error}"))?;
    if !canonical_file.starts_with(canonical_root) {
        return Err("变更文件位于 Git 工作树之外。".into());
    }
    let file = File::open(canonical_file).map_err(|error| format!("无法读取变更文件：{error}"))?;
    read_limited(file.take((MAX_FILE_BYTES + 1) as u64))
}

fn read_limited(mut reader: Take<File>) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    reader
        .read_to_end(&mut output)
        .map_err(|error| format!("无法读取变更文件：{error}"))?;
    Ok(output)
}

fn validate_relative_path(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    if value.trim().is_empty()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Git 文件路径无效。".into());
    }
    Ok(())
}

fn clean_output(output: &[u8]) -> String {
    String::from_utf8_lossy(output).trim().to_owned()
}

fn run_git(directory: &Path, arguments: &[&str]) -> Result<Vec<u8>, String> {
    let mut command = hidden_command("git");
    command
        .args([
            "-c",
            "core.quotepath=false",
            "-c",
            "color.ui=false",
            "-c",
            "core.fsmonitor=false",
            "--no-pager",
        ])
        .args(arguments)
        .current_dir(directory)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null());
    let output = run_with_timeout(&mut command, GIT_TIMEOUT)
        .map_err(|error| format!("无法运行 Git：{error}"))?;
    if !output.status.success() {
        let diagnostic = clean_output(&output.stderr);
        return Err(if diagnostic.is_empty() {
            "Git 命令执行失败。".into()
        } else {
            diagnostic
        });
    }
    Ok(output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_repository() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "termexo-git-session-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn parses_status_with_rename_and_untracked_file() {
        let output = b" M src/main.rs\0R  src/new.rs\0src/old.rs\0?? notes a.txt\0";
        let changes =
            parse_porcelain_status(output, &HashSet::from(["src/main.rs".into()])).unwrap();

        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].path, "src/main.rs");
        assert!(changes[0].pre_existing);
        assert_eq!(changes[1].old_path.as_deref(), Some("src/old.rs"));
        assert_eq!(changes[1].path, "src/new.rs");
        assert!(changes[2].untracked);
    }

    #[test]
    fn parses_committed_name_status() {
        let output = b"M\0src/main.rs\0R100\0old name.rs\0new name.rs\0";
        let changes = parse_name_status(output, &HashSet::new()).unwrap();

        assert_eq!(changes.len(), 2);
        assert!(changes[0].committed);
        assert_eq!(changes[1].old_path.as_deref(), Some("old name.rs"));
        assert_eq!(changes[1].path, "new name.rs");
    }

    #[test]
    fn rejects_paths_outside_the_worktree() {
        assert!(validate_relative_path("src/main.rs").is_ok());
        assert!(validate_relative_path("../secret.txt").is_err());
        assert!(validate_relative_path("C:\\secret.txt").is_err());
    }

    #[test]
    fn excludes_unchanged_preexisting_edits_from_session_changes() {
        let root = temporary_repository();
        fs::create_dir_all(&root).unwrap();
        if run_git(&root, &["init"]).is_err() {
            fs::remove_dir_all(&root).ok();
            return;
        }
        run_git(&root, &["config", "user.name", "Termexo Test"]).unwrap();
        run_git(&root, &["config", "user.email", "termexo@example.invalid"]).unwrap();
        fs::write(root.join("sample.txt"), "committed\n").unwrap();
        run_git(&root, &["add", "sample.txt"]).unwrap();
        run_git(&root, &["commit", "-m", "initial"]).unwrap();

        fs::write(root.join("sample.txt"), "before session\n").unwrap();
        let change = collect_worktree_changes(&root, &HashSet::new())
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        let baseline = SessionBaseline {
            workspace_id: "workspace".into(),
            root: root.clone(),
            head: current_head(&root).unwrap(),
            repository_missing_at_start: false,
            snapshot_truncated: false,
            dirty_files: HashMap::from([(
                change.path.clone(),
                BaselineFile {
                    content: read_worktree_file(&root, &change.path).unwrap(),
                    content_fingerprint: worktree_fingerprint(&root, &change.path),
                    change,
                },
            )]),
        };
        let pre_existing = HashSet::from(["sample.txt".into()]);
        let mut unchanged = collect_worktree_changes(&root, &pre_existing).unwrap();
        retain_session_worktree_changes(&root, &baseline, &mut unchanged);
        assert!(unchanged.is_empty());

        fs::write(root.join("sample.txt"), "changed in session\n").unwrap();
        let mut changed = collect_worktree_changes(&root, &pre_existing).unwrap();
        retain_session_worktree_changes(&root, &baseline, &mut changed);
        assert_eq!(changed.len(), 1);
        assert!(changed[0].pre_existing);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn discovers_a_repository_created_below_the_terminal_directory() {
        let terminal_directory = temporary_repository();
        let project = terminal_directory.join("new-project");
        fs::create_dir_all(&project).unwrap();
        if run_git(&project, &["init"]).is_err() {
            fs::remove_dir_all(&terminal_directory).ok();
            return;
        }

        assert_eq!(repository_root(&terminal_directory).unwrap(), Some(project));
        fs::remove_dir_all(&terminal_directory).ok();
    }

    #[test]
    fn preserves_the_original_baseline_across_runtime_restarts() {
        let root = temporary_repository();
        fs::create_dir_all(&root).unwrap();
        if run_git(&root, &["init"]).is_err() {
            fs::remove_dir_all(&root).ok();
            return;
        }
        run_git(&root, &["config", "user.name", "Termexo Test"]).unwrap();
        run_git(&root, &["config", "user.email", "termexo@example.invalid"]).unwrap();
        fs::write(root.join("sample.txt"), "initial\n").unwrap();
        run_git(&root, &["add", "sample.txt"]).unwrap();
        run_git(&root, &["commit", "-m", "initial"]).unwrap();

        let manager = RepositoryManager::default();
        manager
            .capture_baseline(Some("workspace"), "terminal", 0, &root.to_string_lossy())
            .unwrap();
        let initial_head = current_head(&root).unwrap();
        fs::write(root.join("sample.txt"), "second\n").unwrap();
        run_git(&root, &["add", "sample.txt"]).unwrap();
        run_git(&root, &["commit", "-m", "second"]).unwrap();
        manager
            .capture_baseline(Some("workspace"), "terminal", 1, &root.to_string_lossy())
            .unwrap();

        let baselines = manager.baselines.lock().unwrap();
        assert_eq!(baselines.len(), 1);
        assert_eq!(baselines.values().next().unwrap().head, initial_head);
        drop(baselines);
        manager.remove_terminal("terminal");
        assert!(manager.baselines.lock().unwrap().is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn limits_diff_previews_by_line_count() {
        let content = "line\n".repeat(MAX_PREVIEW_LINES + 1).into_bytes();
        let (content, truncated) = truncate_preview_lines(content);

        assert!(truncated);
        assert_eq!(
            content.iter().filter(|byte| **byte == b'\n').count(),
            MAX_PREVIEW_LINES
        );
    }
}
