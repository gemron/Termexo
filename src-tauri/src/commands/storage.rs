use std::path::PathBuf;

use tauri::State;

use crate::database::WorkspaceDatabase;
use crate::storage::{self, DataDirectories, StorageOverview};

/// Reports where Termexo keeps its data and what is in there.
#[tauri::command(async)]
pub fn read_storage_overview(
    app: tauri::AppHandle,
    directories: State<'_, DataDirectories>,
) -> Result<StorageOverview, String> {
    let executable = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("termexo.exe"));
    Ok(storage::describe(
        &directories.active,
        &directories.default,
        &executable,
        app.package_info().version.to_string().as_str(),
    ))
}

/// Copies the data to another directory and records it as the one to use from the next start.
///
/// Nothing is deleted. The copy is verified before the pointer is written, and the directory it
/// came from is left exactly as it was, so a move that turns out to be wrong is undone by pointing
/// the setting back — the old data is still there. That also means the user reclaims the space
/// themselves, which is the right way round: this command must never be the reason data is gone.
#[tauri::command(async)]
pub fn relocate_application_data(
    target: String,
    database: State<'_, WorkspaceDatabase>,
    directories: State<'_, DataDirectories>,
) -> Result<String, String> {
    let target = PathBuf::from(target.trim());
    storage::prepare_target(&target, &directories.active).map_err(|error| error.to_string())?;

    // The database goes first: it is the one that can fail for reasons the others cannot — no
    // space for a compacted copy, most likely — and failing before anything else has been written
    // leaves the target empty rather than half filled.
    database
        .copy_to(&target.join("agentdock.db"))
        .map_err(|error| format!("复制数据库失败：{error}"))?;
    storage::copy_supporting_files(&directories.active, &target)
        .map_err(|error| error.to_string())?;
    storage::write_location_pointer(&directories.default, &target)
        .map_err(|error| error.to_string())?;

    Ok(directories.active.to_string_lossy().into_owned())
}

/// Returns the next start to the default directory, leaving the moved copy where it is.
#[tauri::command(async)]
pub fn reset_application_data_location(
    directories: State<'_, DataDirectories>,
) -> Result<(), String> {
    storage::clear_location_pointer(&directories.default).map_err(|error| error.to_string())
}
