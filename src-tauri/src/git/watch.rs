//! Tells the UI when a repository it shows may have changed, so nothing has to poll for it.
//!
//! Polling every few seconds meant a git process per poll — around 150 ms on a machine whose
//! antivirus scans git.exe on every start — for a working tree that had not changed since the
//! last one. Watching the tree instead costs nothing while it is quiet, and reports an agent's
//! edits within half a second rather than at the next tick.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::AppHandle;

use crate::remote::{broadcast_event, RemoteEventHub};

pub const EVENT_REPOSITORY_CHANGED: &str = "repository-changed";

/// A burst of writes — an agent editing several files — becomes one notification.
const SETTLE_DELAY: Duration = Duration::from_millis(500);

/// Path segments under which nothing the overview shows ever lives. Events there are noise, and
/// a package install produces tens of thousands of them.
const NOISE_SEGMENTS: [&str; 5] = ["node_modules", "target", "dist", ".angular", ".tooling"];

/// Inside `.git`, the repository's visible state lives in these and under `refs`. Everything
/// else — objects, logs, lock files — churns on every git command without changing what is shown.
const GIT_STATE_NAMES: [&str; 7] = [
    "HEAD",
    "index",
    "ORIG_HEAD",
    "MERGE_HEAD",
    "REBASE_HEAD",
    "CHERRY_PICK_HEAD",
    "packed-refs",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryChangedEvent {
    pub root: String,
}

struct WatchedRoot {
    /// Dropping it stops the watch.
    _watcher: RecommendedWatcher,
    /// The terminals showing this root; the watch ends with the last of them.
    terminals: HashSet<String>,
}

/// Debounce state for one root: every event bumps the version, and the timer that is waiting
/// announces the change only if the version is still the one it last saw.
#[derive(Default)]
struct Settling {
    version: u64,
    timer_running: bool,
}

type SettlingMap = Arc<Mutex<HashMap<PathBuf, Settling>>>;

pub struct RepositoryWatcher {
    app: AppHandle,
    hub: Arc<RemoteEventHub>,
    roots: Mutex<HashMap<PathBuf, WatchedRoot>>,
    settling: SettlingMap,
}

impl RepositoryWatcher {
    pub fn new(app: AppHandle, hub: Arc<RemoteEventHub>) -> Self {
        Self {
            app,
            hub,
            roots: Mutex::new(HashMap::new()),
            settling: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Watches `root` on behalf of a terminal and reports whether the watch is in place.
    ///
    /// `false` means the UI has to keep polling: the watch could not be started, which happens
    /// on network shares and a few other file systems the platform cannot notify for.
    pub fn watch(&self, root: &Path, terminal_id: &str) -> bool {
        let Ok(mut roots) = self.roots.lock() else {
            return false;
        };
        if let Some(watched) = roots.get_mut(root) {
            watched.terminals.insert(terminal_id.to_owned());
            return true;
        }
        // A terminal shows one repository at a time; it stops counting towards any other.
        release_terminal(&mut roots, terminal_id);
        let watcher = match self.start_watcher(root) {
            Ok(watcher) => watcher,
            Err(error) => {
                tracing::warn!(root = %root.display(), %error, "无法监听仓库目录，改为定时刷新");
                return false;
            }
        };
        roots.insert(
            root.to_path_buf(),
            WatchedRoot {
                _watcher: watcher,
                terminals: HashSet::from([terminal_id.to_owned()]),
            },
        );
        true
    }

    /// Stops counting a closed terminal; a root nobody shows any more stops being watched.
    pub fn release(&self, terminal_id: &str) {
        if let Ok(mut roots) = self.roots.lock() {
            release_terminal(&mut roots, terminal_id);
        }
    }

    fn start_watcher(&self, root: &Path) -> notify::Result<RecommendedWatcher> {
        let root = root.to_path_buf();
        let settling = Arc::clone(&self.settling);
        let app = self.app.clone();
        let hub = Arc::clone(&self.hub);
        let watched_root = root.clone();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            let Ok(event) = result else {
                return;
            };
            if event
                .paths
                .iter()
                .any(|path| is_relevant(&watched_root, path))
            {
                schedule_announcement(&settling, &app, &hub, &watched_root);
            }
        })?;
        watcher.watch(&root, RecursiveMode::Recursive)?;
        Ok(watcher)
    }
}

fn release_terminal(roots: &mut HashMap<PathBuf, WatchedRoot>, terminal_id: &str) {
    roots.retain(|_, watched| {
        watched.terminals.remove(terminal_id);
        !watched.terminals.is_empty()
    });
}

/// Announces the root once it has been quiet for [`SETTLE_DELAY`].
///
/// Only one timer runs per root: later events bump the version and the running timer, on waking,
/// sees the change and waits again, so a long burst still produces exactly one announcement.
fn schedule_announcement(
    settling: &SettlingMap,
    app: &AppHandle,
    hub: &Arc<RemoteEventHub>,
    root: &Path,
) {
    let Ok(mut guard) = settling.lock() else {
        return;
    };
    let state = guard.entry(root.to_path_buf()).or_default();
    state.version += 1;
    if state.timer_running {
        return;
    }
    state.timer_running = true;
    let mut seen = state.version;
    drop(guard);

    let settling = Arc::clone(settling);
    let app = app.clone();
    let hub = Arc::clone(hub);
    let root = root.to_path_buf();
    thread::spawn(move || loop {
        thread::sleep(SETTLE_DELAY);
        let Ok(mut guard) = settling.lock() else {
            return;
        };
        let Some(state) = guard.get_mut(&root) else {
            return;
        };
        if state.version != seen {
            seen = state.version;
            continue;
        }
        state.timer_running = false;
        drop(guard);
        broadcast_event(
            &app,
            &hub,
            EVENT_REPOSITORY_CHANGED,
            &RepositoryChangedEvent {
                root: root.to_string_lossy().into_owned(),
            },
        );
        return;
    });
}

/// Whether a change at `path` can alter what the overview shows for `root`.
fn is_relevant(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let mut segments = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned());
    let Some(first) = segments.next() else {
        return false;
    };
    if first == ".git" {
        return segments
            .next()
            .is_some_and(|second| second == "refs" || GIT_STATE_NAMES.contains(&second.as_str()));
    }
    !std::iter::once(first)
        .chain(segments)
        .any(|segment| NOISE_SEGMENTS.contains(&segment.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn relevant(relative: &str) -> bool {
        let root = Path::new("D:/repo");
        is_relevant(root, &root.join(relative))
    }

    #[test]
    fn working_tree_edits_count_and_build_output_does_not() {
        assert!(relevant("src/app.ts"));
        assert!(relevant("docs/notes with space.md"));
        assert!(!relevant("node_modules/left-pad/index.js"));
        assert!(!relevant("apps/web/node_modules/x/y.js"));
        assert!(!relevant("target/release/termexo.exe"));
        assert!(!relevant("apps/web/dist/main.js"));
    }

    #[test]
    fn only_git_state_files_count_inside_the_git_directory() {
        assert!(relevant(".git/HEAD"));
        assert!(relevant(".git/index"));
        assert!(relevant(".git/refs/heads/main"));
        assert!(relevant(".git/packed-refs"));
        // These change on every command without changing anything the overview shows.
        assert!(!relevant(".git/objects/ab/cdef"));
        assert!(!relevant(".git/logs/HEAD"));
        assert!(!relevant(".git/index.lock"));
        assert!(!relevant(".git/FETCH_HEAD"));
    }

    #[test]
    fn paths_outside_the_root_are_ignored() {
        assert!(!is_relevant(
            Path::new("D:/repo"),
            Path::new("D:/other/file.txt")
        ));
    }
}
