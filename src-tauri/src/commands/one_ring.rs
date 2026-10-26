use crate::{
    database::WorkspaceDatabase,
    one_ring::{self, Connection},
};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command(async)]
pub fn find_one_ring_coordinator(
    root: String,
    workflow_id: String,
    original_terminal_id: Option<String>,
    terminal_ids: Vec<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Option<String>, String> {
    one_ring::find_coordinator(
        &database,
        &root,
        &workflow_id,
        original_terminal_id.as_deref(),
        &terminal_ids,
    )
}

#[tauri::command(async)]
pub fn get_one_ring_connection(
    database: State<'_, WorkspaceDatabase>,
) -> Result<Option<Connection>, String> {
    one_ring::bundled_connection(&database)
}

#[tauri::command(async)]
pub fn inspect_one_ring(
    operation: String,
    workflow_id: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Value, String> {
    let connection = one_ring::bundled_connection(&database)?
        .ok_or("内置 One Ring 引擎尚未就绪，请检查 Termexo 安装。")?;
    let args = match operation.as_str() {
        "one_ring_doctor" | "one_ring_list" => json!({}),
        "one_ring_status" => json!({ "workflowId": workflow_id.ok_or("缺少工作流 ID")? }),
        _ => return Err("不支持的 One Ring 查询。".into()),
    };
    one_ring::inspect(&connection, &operation, args)
}
