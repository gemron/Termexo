//! Where Termexo keeps its data, and how that location is moved.
//!
//! Everything the application owns — the database, the hook spool, the per-account directories —
//! lives in one directory. By default that is the one Windows hands out for this application, but
//! it sits on the system drive, and the database is the largest thing Termexo writes. Being able
//! to put it on another drive is the point of this module.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use thiserror::Error;

/// Names the directory the data was moved to, and always lives in the default directory.
///
/// Something has to be findable without configuration, or there would be no way to discover where
/// the configuration went. Keeping it as one line of plain text also means a user who moved the
/// data somewhere now unreachable can point it back — or delete the file to return to the default
/// — without the application running.
const LOCATION_POINTER_FILE: &str = "data-location.txt";

/// The files worth naming in the interface, in the order they are shown.
///
/// The database first because it is the one that grows: one reached 208 MB of agent events before
/// anybody had a way to see it. The rest are what a diagnosis asks for.
const DESCRIBED_FILES: &[&str] = &[
    "agentdock.db",
    "claude-hook-events.jsonl",
    "claude-hook-events.cursor",
    "proxy-diagnostics.log",
];

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("数据目录路径无效：{0}")]
    InvalidTarget(String),
    #[error("目标目录不是空的，请选择一个空目录或新建一个：{0}")]
    TargetNotEmpty(String),
    #[error("无法写入目标目录：{0}")]
    TargetNotWritable(String),
    #[error("数据目录操作失败：{0}")]
    Io(#[from] io::Error),
}

/// The directory in use and the default one, resolved once at startup and shared from there.
///
/// The default is kept alongside the active one because it is where the pointer lives, so moving
/// the data — or moving it back — always needs both.
pub struct DataDirectories {
    pub active: PathBuf,
    pub default: PathBuf,
}

/// One file or directory inside the data directory, as the interface lists it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEntry {
    pub name: String,
    pub path: String,
    /// Absent when the entry does not exist yet, which is normal for a fresh installation.
    pub bytes: Option<u64>,
}

/// Everything the storage panel shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageOverview {
    /// The directory in use, which is the default one unless it was moved.
    pub data_directory: String,
    pub default_directory: String,
    pub relocated: bool,
    /// Total size of everything in the data directory, not only the named entries.
    pub total_bytes: u64,
    pub entries: Vec<StorageEntry>,
    pub executable: String,
    pub version: String,
}

/// The directory to use, which is the pointer's target when one is set and valid.
///
/// A pointer to somewhere that cannot be used is ignored rather than fatal: a data directory on a
/// drive that is not currently attached would otherwise leave the application unable to start at
/// all, with no way in to correct it. Falling back to the default loses sight of the moved data
/// but keeps Termexo usable, and the panel reports which directory is actually in use.
pub fn resolve_data_directory(default: &Path) -> PathBuf {
    let Some(target) = read_location_pointer(default) else {
        return default.to_path_buf();
    };
    if fs::create_dir_all(&target).is_ok() && is_writable(&target) {
        return target;
    }
    tracing::warn!(
        target = %target.display(),
        "配置的数据目录不可用，已回退到默认目录"
    );
    default.to_path_buf()
}

fn read_location_pointer(default: &Path) -> Option<PathBuf> {
    let recorded = fs::read_to_string(default.join(LOCATION_POINTER_FILE)).ok()?;
    let trimmed = recorded.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

/// Describes what is stored and where, for the panel that shows it.
pub fn describe(
    data_directory: &Path,
    default_directory: &Path,
    executable: &Path,
    version: &str,
) -> StorageOverview {
    let entries = DESCRIBED_FILES
        .iter()
        .map(|name| {
            let path = data_directory.join(name);
            StorageEntry {
                name: (*name).to_owned(),
                bytes: fs::metadata(&path).ok().map(|meta| meta.len()),
                path: path.to_string_lossy().into_owned(),
            }
        })
        .collect();

    StorageOverview {
        data_directory: data_directory.to_string_lossy().into_owned(),
        default_directory: default_directory.to_string_lossy().into_owned(),
        relocated: data_directory != default_directory,
        total_bytes: directory_size(data_directory),
        entries,
        executable: executable.to_string_lossy().into_owned(),
        version: version.to_owned(),
    }
}

/// Everything under a directory, following its subdirectories.
fn directory_size(directory: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(directory) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => directory_size(&entry.path()),
            _ => entry.metadata().map(|meta| meta.len()).unwrap_or(0),
        })
        .sum()
}

/// Checks a directory can be used before anything is copied into it.
///
/// The target must be empty. Merging into a directory that already holds files would make the
/// result impossible to undo cleanly — there would be no way to tell afterwards which files were
/// moved and which were already there.
pub fn prepare_target(target: &Path, current: &Path) -> Result<(), StorageError> {
    if target.as_os_str().is_empty() || target.is_relative() {
        return Err(StorageError::InvalidTarget(target.display().to_string()));
    }
    if target == current {
        return Err(StorageError::InvalidTarget(target.display().to_string()));
    }
    // Copying a directory into itself would recurse until the disk filled.
    if target.starts_with(current) {
        return Err(StorageError::InvalidTarget(target.display().to_string()));
    }

    fs::create_dir_all(target)?;
    if fs::read_dir(target)?.next().is_some() {
        return Err(StorageError::TargetNotEmpty(target.display().to_string()));
    }
    if !is_writable(target) {
        return Err(StorageError::TargetNotWritable(
            target.display().to_string(),
        ));
    }
    Ok(())
}

/// Writes and removes an empty file, which is the only reliable way to know a directory is usable.
///
/// Windows reports a directory as writable through its metadata while still refusing the write —
/// a folder under Program Files behaves exactly that way — so the check performs one.
fn is_writable(directory: &Path) -> bool {
    let probe = directory.join(".termexo-write-test");
    match fs::write(&probe, b"") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Copies everything except the database, which is copied by the database itself.
///
/// The database is skipped here because a file copy of it would be taken while it is open, and
/// SQLite makes no promise about what that produces. Its own copy is consistent, and it leaves the
/// write-ahead log behind rather than carrying a stale one across.
pub fn copy_supporting_files(from: &Path, to: &Path) -> Result<(), StorageError> {
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_text = name.to_string_lossy();
        // The pointer stays in the default directory: it is what says where to look.
        if name_text == LOCATION_POINTER_FILE {
            continue;
        }
        // The database and its sidecars come from the database's own copy.
        if name_text.starts_with("agentdock.db") {
            continue;
        }
        let source = entry.path();
        let destination = to.join(&name);
        if entry.file_type()?.is_dir() {
            copy_directory(&source, &destination)?;
        } else {
            fs::copy(&source, &destination)?;
        }
    }
    Ok(())
}

fn copy_directory(from: &Path, to: &Path) -> Result<(), StorageError> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let source = entry.path();
        let destination = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&source, &destination)?;
        } else {
            fs::copy(&source, &destination)?;
        }
    }
    Ok(())
}

/// Records where the data now lives, so the next start finds it.
pub fn write_location_pointer(default: &Path, target: &Path) -> Result<(), StorageError> {
    fs::create_dir_all(default)?;
    fs::write(
        default.join(LOCATION_POINTER_FILE),
        target.to_string_lossy().as_bytes(),
    )?;
    Ok(())
}

/// Forgets a recorded location, returning the next start to the default directory.
pub fn clear_location_pointer(default: &Path) -> Result<(), StorageError> {
    let pointer = default.join(LOCATION_POINTER_FILE);
    if pointer.exists() {
        fs::remove_file(pointer)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_directory(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("termexo-storage-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn the_default_directory_is_used_when_nothing_was_recorded() {
        let default = temporary_directory("default");

        assert_eq!(resolve_data_directory(&default), default);
    }

    #[test]
    fn a_recorded_location_is_used_instead_of_the_default() {
        let default = temporary_directory("pointer-default");
        let moved = temporary_directory("pointer-moved");
        write_location_pointer(&default, &moved).unwrap();

        assert_eq!(resolve_data_directory(&default), moved);

        clear_location_pointer(&default).unwrap();
        assert_eq!(resolve_data_directory(&default), default);
    }

    /// A drive that is not attached must not be able to stop the application starting, because the
    /// only way to correct the setting is from inside the application.
    #[test]
    fn an_unusable_recorded_location_falls_back_to_the_default() {
        let default = temporary_directory("unusable-default");
        write_location_pointer(&default, Path::new("\\\\?\\Z:\\termexo-does-not-exist")).unwrap();

        assert_eq!(resolve_data_directory(&default), default);
    }

    #[test]
    fn a_target_that_already_holds_files_is_refused() {
        let current = temporary_directory("busy-current");
        let target = temporary_directory("busy-target");
        fs::write(target.join("something.txt"), b"already here").unwrap();

        let result = prepare_target(&target, &current);

        assert!(matches!(result, Err(StorageError::TargetNotEmpty(_))));
    }

    /// Copying a directory into itself would recurse until the disk filled.
    #[test]
    fn a_target_inside_the_current_directory_is_refused() {
        let current = temporary_directory("nested-current");
        let target = current.join("inside");

        let result = prepare_target(&target, &current);

        assert!(matches!(result, Err(StorageError::InvalidTarget(_))));
    }

    #[test]
    fn supporting_files_are_copied_but_the_database_and_pointer_are_not() {
        let from = temporary_directory("copy-from");
        let to = temporary_directory("copy-to");
        fs::write(from.join("agentdock.db"), b"database").unwrap();
        fs::write(from.join("agentdock.db-wal"), b"log").unwrap();
        fs::write(from.join(LOCATION_POINTER_FILE), b"somewhere").unwrap();
        fs::write(from.join("claude-hook-events.jsonl"), b"events").unwrap();
        fs::create_dir_all(from.join("accounts/one")).unwrap();
        fs::write(from.join("accounts/one/profile.json"), b"account").unwrap();

        copy_supporting_files(&from, &to).unwrap();

        assert!(to.join("claude-hook-events.jsonl").exists());
        assert!(to.join("accounts/one/profile.json").exists());
        // The database is copied by the database, which is the only consistent way to do it.
        assert!(!to.join("agentdock.db").exists());
        assert!(!to.join("agentdock.db-wal").exists());
        // The pointer belongs to the default directory; carrying it would point the copy at itself.
        assert!(!to.join(LOCATION_POINTER_FILE).exists());
    }

    #[test]
    fn the_overview_reports_sizes_and_whether_the_data_was_moved() {
        let default = temporary_directory("overview-default");
        let moved = temporary_directory("overview-moved");
        fs::write(moved.join("agentdock.db"), vec![0_u8; 2048]).unwrap();

        let overview = describe(&moved, &default, Path::new("C:\\termexo.exe"), "9.9.9");

        assert!(overview.relocated);
        assert_eq!(overview.total_bytes, 2048);
        assert_eq!(overview.version, "9.9.9");
        let database = overview
            .entries
            .iter()
            .find(|entry| entry.name == "agentdock.db")
            .unwrap();
        assert_eq!(database.bytes, Some(2048));
        // A file that was never written reports no size rather than zero, so the panel can say so.
        let log = overview
            .entries
            .iter()
            .find(|entry| entry.name == "proxy-diagnostics.log")
            .unwrap();
        assert_eq!(log.bytes, None);
    }
}
