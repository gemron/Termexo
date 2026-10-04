use std::sync::Arc;

use serde_json::Value;
use tauri::{State, WebviewWindow};

use crate::mcp::{McpManager, McpSettings, McpStatus};

fn require_desktop(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("MCP administration is only available in the desktop window".into())
    }
}

#[tauri::command]
pub async fn get_mcp_server_status(
    window: WebviewWindow,
    manager: State<'_, Arc<McpManager>>,
) -> Result<McpStatus, String> {
    require_desktop(&window)?;
    Ok(manager.status().await)
}

#[tauri::command]
pub async fn update_mcp_server_settings(
    window: WebviewWindow,
    settings: McpSettings,
    manager: State<'_, Arc<McpManager>>,
) -> Result<McpStatus, String> {
    require_desktop(&window)?;
    manager.update(settings).await
}

#[tauri::command]
pub async fn regenerate_mcp_server_token(
    window: WebviewWindow,
    manager: State<'_, Arc<McpManager>>,
) -> Result<McpStatus, String> {
    require_desktop(&window)?;
    manager.regenerate_token().await
}

#[tauri::command]
pub fn complete_mcp_tool(
    window: WebviewWindow,
    id: String,
    value: Option<Value>,
    error: Option<String>,
    manager: State<'_, Arc<McpManager>>,
) -> Result<(), String> {
    require_desktop(&window)?;
    manager.complete(
        &id,
        match error {
            Some(error) => Err(error),
            None => Ok(value.unwrap_or(Value::Null)),
        },
    )
}
