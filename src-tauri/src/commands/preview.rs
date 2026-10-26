use std::io::Read;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::State;

use crate::database::WorkspaceDatabase;

const MAX_DIRECTORY_ENTRIES: usize = 500;
const MAX_TEXT_LINES: usize = 30_000;
const MAX_TEXT_BYTES: u64 = 1024 * 1024;
const MAX_MEDIA_BYTES: u64 = 24 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    name: String,
    path: String,
    directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDirectory {
    path: String,
    entries: Vec<ProjectEntry>,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPreview {
    path: String,
    kind: &'static str,
    mime: &'static str,
    content: String,
    message: Option<String>,
}

fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
}

fn project_root(database: &WorkspaceDatabase, workspace_id: &str) -> Result<PathBuf, String> {
    let workspace = database
        .list()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|item| item.id == workspace_id)
        .ok_or("项目不存在。")?;
    let root = Path::new(&workspace.project_path)
        .canonicalize()
        .map_err(|_| "项目目录不存在或无法读取。")?;
    if !root.is_dir() {
        return Err("项目路径不是文件夹。".into());
    }
    Ok(root)
}

/// Canonical paths reject traversal and links leading outside this project. This module never writes.
fn project_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    let resolved = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    }
    .canonicalize()
    .map_err(|_| "文件或目录不存在，或无法读取。")?;
    if !resolved.starts_with(root) {
        return Err("只读预览仅支持当前项目目录内的文件。".into());
    }
    Ok(resolved)
}

#[tauri::command(async)]
pub fn list_project_directory(
    workspace_id: String,
    path: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<ProjectDirectory, String> {
    let root = project_root(&database, &workspace_id)?;
    list_directory(&root, path.as_deref().unwrap_or(""))
}

fn list_directory(root: &Path, path: &str) -> Result<ProjectDirectory, String> {
    let directory = project_path(root, path)?;
    let iterator = std::fs::read_dir(&directory).map_err(|_| "无法读取此文件夹。")?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in iterator {
        let entry = entry.map_err(|_| "读取目录项失败，请刷新后重试。")?;
        let metadata = entry.file_type().map_err(|_| "无法读取目录项类型。")?;
        // Do not offer junctions/symlinks as navigation shortcuts outside the project.
        if metadata.is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
            continue;
        }
        if entries.len() == MAX_DIRECTORY_ENTRIES {
            truncated = true;
            break;
        }
        entries.push(ProjectEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: display_path(&entry.path()),
            directory: metadata.is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(ProjectDirectory {
        path: display_path(&directory),
        entries,
        truncated,
    })
}

#[tauri::command(async)]
pub fn read_project_preview(
    workspace_id: String,
    path: String,
    database: State<'_, WorkspaceDatabase>,
) -> Result<ProjectPreview, String> {
    let root = project_root(&database, &workspace_id)?;
    read_preview(&root, &path)
}

fn read_preview(root: &Path, path: &str) -> Result<ProjectPreview, String> {
    let resolved = project_path(root, path)?;
    if resolved.is_dir() {
        return Ok(ProjectPreview {
            path: display_path(&resolved),
            kind: "directory",
            mime: "",
            content: String::new(),
            message: None,
        });
    }
    if !resolved.is_file() {
        return Err("请选择一个文件。".into());
    }
    let extension = resolved
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let (kind, mime) = match extension.as_str() {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "gif" => ("image", "image/gif"),
        "webp" => ("image", "image/webp"),
        "svg" => ("image", "image/svg+xml"),
        "bmp" => ("image", "image/bmp"),
        "ico" => ("image", "image/x-icon"),
        "avif" => ("image", "image/avif"),
        "pdf" => ("pdf", "application/pdf"),
        "md" | "markdown" | "mdx" => ("markdown", "text/markdown"),
        "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "odt" | "ods" | "odp" | "rtf"
        | "exe" | "dll" | "zip" | "gz" | "7z" | "mp4" | "mp3" | "woff" | "ttf" => {
            ("unsupported", "application/octet-stream")
        }
        _ => ("text", "text/plain"),
    };
    let mut preview = ProjectPreview {
        path: display_path(&resolved),
        kind,
        mime,
        content: String::new(),
        message: None,
    };
    if kind == "unsupported" {
        preview.message = Some("此格式暂不支持内置预览，请使用外部应用打开。".into());
        return Ok(preview);
    }
    let limit = if kind == "image" || kind == "pdf" {
        MAX_MEDIA_BYTES
    } else {
        MAX_TEXT_BYTES
    };
    let file = std::fs::File::open(&resolved).map_err(|_| "无法读取文件。")?;
    let mut bytes = Vec::new();
    // Bound the read itself: the file may grow after metadata was checked.
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取文件失败。")?;
    if bytes.len() as u64 > limit {
        return Err(format!(
            "文件超过内置预览大小限制（{} MB），请使用外部应用打开。",
            limit / 1024 / 1024
        ));
    }
    if kind == "image" || kind == "pdf" {
        preview.content = STANDARD.encode(bytes);
    } else {
        let text =
            String::from_utf8(bytes).map_err(|_| "此文件不是 UTF-8 文本，请使用外部应用打开。")?;
        if text.contains('\0') {
            return Err("此文件包含二进制内容，请使用外部应用打开。".into());
        }
        if text.lines().count() > MAX_TEXT_LINES {
            return Err("文件超过 30000 行，请使用外部应用打开。".into());
        }
        preview.content = text
            .strip_prefix('\u{feff}')
            .unwrap_or(&text)
            .replace("\r\n", "\n")
            .replace('\r', "\n");
    }
    Ok(preview)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_are_bounded_and_cannot_escape_the_project() {
        let root = std::env::temp_dir().join(format!("termexo-preview-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        std::fs::write(root.join("代码 空格.ts"), "first\r\nsecond 中文\r\n").unwrap();
        let preview = read_preview(&root, "代码 空格.ts").unwrap();
        assert_eq!(preview.kind, "text");
        assert_eq!(preview.content, "first\nsecond 中文\n");
        assert!(preview.path.ends_with("代码 空格.ts"));
        assert!(project_path(&root, "..").is_err());
        assert!(read_preview(&root, "missing").is_err());
        std::fs::write(root.join("binary"), [0, 1, 2]).unwrap();
        assert!(read_preview(&root, "binary").is_err());
        std::fs::write(
            root.join("large.txt"),
            vec![b'a'; MAX_TEXT_BYTES as usize + 1],
        )
        .unwrap();
        assert!(read_preview(&root, "large.txt").is_err());
        std::fs::write(root.join("example.docx"), b"not a document").unwrap();
        assert_eq!(
            read_preview(&root, "example.docx").unwrap().kind,
            "unsupported"
        );
        std::fs::write(root.join("example.png"), [137, 80, 78, 71]).unwrap();
        assert_eq!(
            read_preview(&root, "example.png").unwrap().content,
            "iVBORw=="
        );
        assert_eq!(list_directory(&root, "").unwrap().entries.len(), 5);
        std::fs::remove_dir_all(root).unwrap();
    }
}
