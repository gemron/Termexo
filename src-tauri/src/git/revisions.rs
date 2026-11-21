use serde::{Deserialize, Serialize};

use super::{
    clean_output, collect_commit_page, current_head, parse_name_status, read_git_blob, run_git,
    sanitize_text, truncate_preview_lines, validate_relative_path, RepositoryBranch,
    RepositoryChange, RepositoryDiff, RepositoryHistory, RepositoryManager, RepositoryTarget,
    MAX_FILE_BYTES,
};
use crate::database::WorkspaceDatabase;
use std::collections::HashSet;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCursor {
    offset: usize,
    snapshot: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionRange {
    pub base_oid: Option<String>,
    pub head_oid: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub range: RevisionRange,
    pub summary: String,
    pub body: String,
    pub author: String,
    pub email: String,
    pub authored_at: i64,
    pub parents: Vec<String>,
    pub files: Vec<RepositoryChange>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchComparison {
    pub range: RevisionRange,
    pub base_only: u64,
    pub head_only: u64,
    pub files: Vec<RepositoryChange>,
}

fn branch_refs(root: &Path) -> Result<Vec<u8>, String> {
    run_git(
        root,
        &[
            "for-each-ref",
            "--sort=refname",
            "--format=%(refname)%00%(symref)%00%(objectname)",
            "refs/heads/",
            "refs/remotes/",
        ],
    )
}

fn branches(output: &[u8]) -> Vec<(RepositoryBranch, String)> {
    String::from_utf8_lossy(output)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\0');
            let reference = fields.next()?;
            if !fields.next()?.is_empty() {
                return None;
            }
            let oid = fields.next()?;
            let name = reference
                .strip_prefix("refs/heads/")
                .or_else(|| reference.strip_prefix("refs/remotes/"))?;
            Some((
                RepositoryBranch {
                    reference: reference.into(),
                    name: name.into(),
                },
                oid.into(),
            ))
        })
        .collect()
}

pub(super) fn collect_history(
    root: &Path,
    head: Option<&str>,
    branch: Option<&str>,
    cursor: Option<&HistoryCursor>,
    limit: usize,
    session_oids: &HashSet<String>,
) -> Result<RepositoryHistory, String> {
    let refs = branch_refs(root)?;
    let branches = branches(&refs);
    let mut hasher = DefaultHasher::new();
    (root, head, branch, &refs).hash(&mut hasher);
    let snapshot = format!("{:016x}", hasher.finish());
    let changed = "分支或提交历史已更新，请刷新后继续。";
    let offset = match cursor {
        Some(cursor) if cursor.snapshot == snapshot && cursor.offset <= i32::MAX as usize => {
            cursor.offset
        }
        Some(_) => return Err(changed.into()),
        None => 0,
    };
    let page_size = limit + 1;
    let mut commits = if let Some(reference) = branch {
        let oid = branch_oid(&branches, reference)?;
        collect_commit_page(root, page_size, offset, session_oids, &[oid])?
    } else if branches.is_empty() && head.is_none() {
        Vec::new()
    } else {
        // Keep HEAD in a detached checkout and all local and tracked remote branches in the graph.
        // The second read rejects a page built while its roots were moving.
        let mut revisions = vec!["--branches", "--remotes"];
        revisions.extend(head);
        let commits = collect_commit_page(root, page_size, offset, session_oids, &revisions)?;
        if branch_refs(root)? != refs || current_head(root)?.as_deref() != head {
            return Err(changed.into());
        }
        commits
    };
    let next = (commits.len() > limit).then(|| HistoryCursor {
        offset: offset + limit,
        snapshot,
    });
    commits.truncate(limit);
    Ok(RepositoryHistory {
        branches: branches.into_iter().map(|(branch, _)| branch).collect(),
        commits,
        next,
    })
}

fn branch_oid<'a>(
    branches: &'a [(RepositoryBranch, String)],
    reference: &str,
) -> Result<&'a str, String> {
    branches
        .iter()
        .find(|(branch, _)| branch.reference == reference)
        .map(|(_, oid)| oid.as_str())
        .ok_or_else(|| "该分支已不存在，请刷新或选择其他分支。".into())
}

impl RepositoryManager {
    fn revision_root(
        &self,
        target: &RepositoryTarget,
        database: &WorkspaceDatabase,
    ) -> Result<PathBuf, String> {
        let (directory, _) = self.resolve_target(target, database)?;
        self.cached_repository_root(&directory)?
            .ok_or_else(|| "当前终端目录不是 Git 工作树。".into())
    }

    pub fn commit_details(
        &self,
        target: &RepositoryTarget,
        database: &WorkspaceDatabase,
        oid: &str,
    ) -> Result<CommitDetails, String> {
        read_commit(&self.revision_root(target, database)?, oid)
    }

    pub fn compare_branches(
        &self,
        target: &RepositoryTarget,
        database: &WorkspaceDatabase,
        base: &str,
        head: &str,
    ) -> Result<BranchComparison, String> {
        compare(&self.revision_root(target, database)?, base, head)
    }

    pub fn revision_diff(
        &self,
        target: &RepositoryTarget,
        database: &WorkspaceDatabase,
        range: &RevisionRange,
        path: &str,
        old_path: Option<&str>,
    ) -> Result<RepositoryDiff, String> {
        read_diff(
            &self.revision_root(target, database)?,
            range,
            path,
            old_path,
        )
    }
}

fn valid_oid(oid: &str) -> bool {
    matches!(oid.len(), 40 | 64) && oid.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_commit(root: &Path, oid: &str) -> Result<(), String> {
    if !valid_oid(oid) || clean_output(&run_git(root, &["cat-file", "-t", oid])?) != "commit" {
        return Err("Git 提交标识无效。".into());
    }
    Ok(())
}

fn read_commit(root: &Path, oid: &str) -> Result<CommitDetails, String> {
    validate_commit(root, oid)?;
    let output = run_git(
        root,
        &[
            "show",
            "-s",
            "--no-decorate",
            "--no-notes",
            "--no-show-signature",
            "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%b",
            oid,
            "--",
        ],
    )?;
    let text = String::from_utf8_lossy(&output);
    let fields: Vec<_> = text.splitn(7, '\0').collect();
    let [oid, parents, author, email, time, summary, body] = fields.as_slice() else {
        return Err("Git 提交详情格式无效。".into());
    };
    let parents: Vec<String> = parents.split_whitespace().map(str::to_owned).collect();
    let range = RevisionRange {
        base_oid: parents.first().cloned(),
        head_oid: (*oid).into(),
    };
    Ok(CommitDetails {
        files: revision_changes(root, &range)?,
        range,
        summary: sanitize_text(summary),
        body: body
            .trim_end()
            .chars()
            .filter(|ch| !ch.is_control() || matches!(ch, '\n' | '\t'))
            .take(65_536)
            .collect(),
        author: sanitize_text(author),
        email: sanitize_text(email),
        authored_at: time.parse().unwrap_or_default(),
        parents,
    })
}

fn compare(root: &Path, base: &str, head: &str) -> Result<BranchComparison, String> {
    let entries = branches(&branch_refs(root)?);
    let base_oid = branch_oid(&entries, base)?;
    let head_oid = branch_oid(&entries, head)?;
    let revisions = format!("{base_oid}...{head_oid}");
    let counts = run_git(
        root,
        &["rev-list", "--left-right", "--count", &revisions, "--"],
    )?;
    let counts = clean_output(&counts);
    let (base_only, head_only) = counts
        .split_once('\t')
        .and_then(|(left, right)| Some((left.parse().ok()?, right.parse().ok()?)))
        .ok_or_else(|| "Git 分支提交计数无效。".to_owned())?;
    let range = RevisionRange {
        base_oid: Some(base_oid.into()),
        head_oid: head_oid.into(),
    };
    Ok(BranchComparison {
        files: revision_changes(root, &range)?,
        range,
        base_only,
        head_only,
    })
}

fn revision_changes(root: &Path, range: &RevisionRange) -> Result<Vec<RepositoryChange>, String> {
    let output = match range.base_oid.as_deref() {
        Some(base) => run_git(
            root,
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--name-status",
                "-z",
                "-M",
                base,
                &range.head_oid,
                "--",
            ],
        )?,
        None => run_git(
            root,
            &[
                "diff-tree",
                "--root",
                "--no-commit-id",
                "-r",
                "--name-status",
                "-z",
                "-M",
                &range.head_oid,
                "--",
            ],
        )?,
    };
    parse_name_status(&output, &HashSet::new())
}

fn read_diff(
    root: &Path,
    range: &RevisionRange,
    path: &str,
    old_path: Option<&str>,
) -> Result<RepositoryDiff, String> {
    validate_relative_path(path)?;
    validate_commit(root, &range.head_oid)?;
    let (old, old_truncated) = match range.base_oid.as_deref() {
        Some(base) => {
            validate_commit(root, base)?;
            read_git_blob(root, base, old_path.unwrap_or(path))?
        }
        None => (Vec::new(), false),
    };
    let (new, new_truncated) = read_git_blob(root, &range.head_oid, path)?;
    let binary = old.contains(&0) || new.contains(&0);
    let (old, old_lines_truncated) = truncate_preview_lines(old);
    let (new, new_lines_truncated) = truncate_preview_lines(new);
    let unavailable = (old_truncated && old.is_empty()) || (new_truncated && new.is_empty());
    let text = |bytes: &[u8]| {
        if binary || unavailable {
            String::new()
        } else {
            String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_FILE_BYTES)]).into_owned()
        }
    };
    Ok(RepositoryDiff {
        path: path.into(),
        old_text: text(&old),
        new_text: text(&new),
        binary,
        truncated: old_truncated || new_truncated || old_lines_truncated || new_lines_truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reads_commit_files_and_compares_branch_tips_with_renames() {
        let repository = tempfile::tempdir().unwrap();
        let root = repository.path();
        if run_git(root, &["init", "-b", "main"]).is_err() {
            return;
        }
        run_git(root, &["config", "user.name", "Termexo Test"]).unwrap();
        run_git(root, &["config", "user.email", "termexo@example.invalid"]).unwrap();
        let save = |summary, body| {
            run_git(root, &["add", "-A"]).unwrap();
            run_git(
                root,
                &[
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "-m",
                    summary,
                    "-m",
                    body,
                ],
            )
            .unwrap();
            current_head(root).unwrap().unwrap()
        };
        fs::write(root.join("old.txt"), "original\n").unwrap();
        fs::write(root.join("one.txt"), "shared line\n").unwrap();
        let first = save("Initial commit", "Full explanation\nSecond line");
        run_git(root, &["checkout", "-b", "feature"]).unwrap();
        fs::rename(root.join("old.txt"), root.join("new.txt")).unwrap();
        fs::write(root.join("one.txt"), "feature line\n").unwrap();
        let feature = save("Feature commit", "Review this feature");
        run_git(
            root,
            &["update-ref", "refs/remotes/origin/feature", &feature],
        )
        .unwrap();
        run_git(root, &["checkout", "main"]).unwrap();
        fs::write(root.join("one.txt"), "main line\n").unwrap();
        let main = save("Main commit", "A change on main");

        let initial = read_commit(root, &first).unwrap();
        assert_eq!(initial.summary, "Initial commit");
        assert_eq!(initial.body, "Full explanation\nSecond line");
        assert!(initial.range.base_oid.is_none());
        assert_eq!(initial.files.len(), 2);
        let initial_diff = read_diff(root, &initial.range, "old.txt", None).unwrap();
        assert!(initial_diff.old_text.is_empty());
        assert_eq!(initial_diff.new_text, "original\n");

        let result = compare(root, "refs/heads/main", "refs/remotes/origin/feature").unwrap();
        assert_eq!((result.base_only, result.head_only), (1, 1));
        assert_eq!(result.range.base_oid.as_deref(), Some(main.as_str()));
        assert_eq!(result.range.head_oid, feature);
        let rename = result
            .files
            .iter()
            .find(|file| file.path == "new.txt")
            .unwrap();
        assert_eq!(rename.old_path.as_deref(), Some("old.txt"));
        let renamed = read_diff(
            root,
            &result.range,
            &rename.path,
            rename.old_path.as_deref(),
        )
        .unwrap();
        assert_eq!(renamed.old_text, renamed.new_text);
        let changed = read_diff(root, &result.range, "one.txt", None).unwrap();
        assert_eq!(changed.old_text, "main line\n");
        assert_eq!(changed.new_text, "feature line\n");
        assert!(compare(root, "--all", "refs/heads/feature").is_err());
        assert!(read_commit(root, "HEAD~1").is_err());
        assert_eq!(current_head(root).unwrap(), Some(main));
    }
}
