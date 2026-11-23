use serde_json::{json, Value};

use super::McpSettings;

pub fn catalog() -> Vec<Value> {
    serde_json::from_str(include_str!("tools.json")).expect("the bundled MCP catalog must be valid")
}

pub fn allowed(tool: &Value, settings: &McpSettings) -> bool {
    match tool["group"].as_str() {
        Some("workspace") => settings.terminal_access || settings.task_access,
        Some("terminal") => settings.terminal_access,
        Some("task") => settings.task_access,
        Some("settings") => settings.settings_access,
        _ => false,
    }
}

pub fn list(settings: &McpSettings) -> Value {
    let tools: Vec<Value> = catalog()
        .into_iter()
        .filter(|tool| allowed(tool, settings))
        .map(|mut tool| {
            tool.as_object_mut().unwrap().remove("group");
            tool
        })
        .collect();
    json!({ "tools": tools })
}

/// The catalog uses flat objects with primitive values and string arrays. Reject unknown fields
/// before a request reaches the desktop, so extra fields cannot become privileged service arguments.
pub fn validate_arguments(schema: &Value, arguments: &Value) -> Result<(), String> {
    let object = arguments
        .as_object()
        .ok_or("Tool arguments must be an object")?;
    let properties = schema["properties"].as_object().unwrap();
    for required in schema["required"].as_array().unwrap() {
        let name = required.as_str().unwrap();
        if !object.contains_key(name) {
            return Err(format!("Missing argument: {name}"));
        }
    }
    for (name, value) in object {
        let field = properties
            .get(name)
            .ok_or_else(|| format!("Unknown argument: {name}"))?;
        validate_field(name, field, value)?;
    }
    Ok(())
}

fn validate_field(name: &str, field: &Value, value: &Value) -> Result<(), String> {
    if field["type"].as_str() == Some("array") {
        let items = value
            .as_array()
            .ok_or_else(|| format!("Invalid argument: {name}"))?;
        if field["maxItems"]
            .as_u64()
            .is_some_and(|max| items.len() as u64 > max)
        {
            return Err(format!("Invalid argument: {name}"));
        }
        let item_schema = &field["items"];
        if item_schema["type"].as_str() != Some("string") {
            return Err(format!("Invalid argument: {name}"));
        }
        for item in items {
            validate_field(name, item_schema, item)?;
        }
        return Ok(());
    }
    let correct_type = match field["type"].as_str() {
        Some("string") => value.is_string(),
        Some("boolean") => value.is_boolean(),
        Some("integer") => value.as_i64().is_some(),
        _ => false,
    };
    let length = value.as_str().map(|s| s.chars().count() as u64);
    let number = value.as_i64();
    if !correct_type
        || field["enum"]
            .as_array()
            .is_some_and(|items| !items.contains(value))
        || field["minLength"]
            .as_u64()
            .zip(length)
            .is_some_and(|(min, len)| len < min)
        || field["maxLength"]
            .as_u64()
            .zip(length)
            .is_some_and(|(max, len)| len > max)
        || field["minimum"]
            .as_i64()
            .zip(number)
            .is_some_and(|(min, n)| n < min)
        || field["maximum"]
            .as_i64()
            .zip(number)
            .is_some_and(|(max, n)| n > max)
    {
        return Err(format!("Invalid argument: {name}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permissions_filter_the_catalog() {
        let settings = McpSettings {
            task_access: false,
            settings_access: false,
            ..Default::default()
        };
        let list = list(&settings);
        assert_eq!(list["tools"].as_array().unwrap().len(), 13);
        for tool in list["tools"].as_array().unwrap() {
            assert!(tool.get("group").is_none());
        }
    }

    #[test]
    fn project_tools_respect_terminal_permissions_and_cannot_confirm_proposals() {
        let catalog = catalog();
        assert!(!catalog
            .iter()
            .any(|tool| tool["name"] == "common_action_confirm"
                || tool["name"] == "common_action_save"));
        let settings = McpSettings {
            terminal_access: false,
            ..Default::default()
        };
        for tool in catalog.iter().filter(|tool| {
            tool["name"].as_str().is_some_and(|name| {
                name.starts_with("common_action_") || name.ends_with("preview_open")
            })
        }) {
            assert!(!allowed(tool, &settings));
        }
        let proposal = catalog
            .iter()
            .find(|tool| tool["name"] == "common_action_propose")
            .unwrap();
        assert!(validate_arguments(
            &proposal["inputSchema"],
            &json!({ "workspaceId": "w", "actionsJson": "[]" })
        )
        .is_err());
    }

    #[test]
    fn invalid_arguments_cannot_reach_the_desktop() {
        let tool = catalog()
            .into_iter()
            .find(|tool| tool["name"] == "terminal_write")
            .unwrap();
        let schema = &tool["inputSchema"];
        assert!(
            validate_arguments(schema, &json!({"terminalId":"t","data":"hi","submit":true}))
                .is_ok()
        );
        for args in [
            json!({}),
            json!({"terminalId":"t","data":1}),
            json!({"terminalId":"t","data":"hi","apiKey":"secret"}),
            json!({"terminalId":"","data":"hi"}),
        ] {
            assert!(validate_arguments(schema, &args).is_err());
        }
    }

    #[test]
    fn task_create_validates_account_and_mcp_profile_arrays() {
        let tool = catalog()
            .into_iter()
            .find(|tool| tool["name"] == "task_create")
            .unwrap();
        let schema = &tool["inputSchema"];
        assert!(validate_arguments(
            schema,
            &json!({
                "workspaceId": "w1",
                "projectId": "p1",
                "title": "Plan",
                "agentType": "antigravity",
                "accountProfileId": "acc-1",
                "mcpProfileIds": ["mcp-fleet", "mcp-db"]
            })
        )
        .is_ok());
        for bad in [
            json!({"workspaceId":"w1","projectId":"p1","title":"t","agentType":"claude","mcpProfileIds":"not-array"}),
            json!({"workspaceId":"w1","projectId":"p1","title":"t","agentType":"claude","mcpProfileIds":[""]}),
            json!({"workspaceId":"w1","projectId":"p1","title":"t","agentType":"claude","mcpProfileIds":[123]}),
            json!({"workspaceId":"w1","projectId":"p1","title":"t","agentType":"claude","accountProfileId":""}),
        ] {
            assert!(validate_arguments(schema, &bad).is_err());
        }
    }
}
