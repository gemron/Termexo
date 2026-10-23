use crate::{
    database::WorkspaceDatabase,
    one_ring::{self, Connection},
};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command(async)]
pub fn get_one_ring_connection(
    database: State<'_, WorkspaceDatabase>,
) -> Result<Option<Connection>, String> {
    one_ring::load(&database)
}

#[tauri::command(async)]
pub fn connect_one_ring(
    connection: Connection,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Value, String> {
    one_ring::save(&database, &connection)
}

#[tauri::command(async)]
pub fn inspect_one_ring(
    operation: String,
    workflow_id: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Value, String> {
    let connection = one_ring::load(&database)?.ok_or("请先连接 One Ring 插件。")?;
    let args = match operation.as_str() {
        "one_ring_doctor" | "one_ring_list" => json!({}),
        "one_ring_status" => json!({ "workflowId": workflow_id.ok_or("缺少工作流 ID")? }),
        _ => return Err("不支持的 One Ring 查询。".into()),
    };
    one_ring::inspect(&connection, &operation, args)
}
