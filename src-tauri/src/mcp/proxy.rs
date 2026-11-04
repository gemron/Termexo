//! Credential-free stdio launch configuration, forwarding to the live desktop HTTP server.
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};

use super::{McpSettings, CREDENTIAL_TARGET, SETTINGS_KEY};
use crate::config::CredentialStore;

const MAX_MESSAGE_BYTES: u64 = 1024 * 1024;

pub(crate) fn run_proxy_from_cli() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(2).collect();
    if args.len() != 2 || args[0] != "--database" {
        return Err("Usage: termexo mcp-proxy --database <Termexo database>".into());
    }
    let database = PathBuf::from(&args[1]);
    if !database.is_absolute() {
        return Err("MCP database path must be absolute".into());
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    runtime.block_on(forward_stdio(&database))
}

fn endpoint(database: &Path) -> Result<String, String> {
    // Do not open WorkspaceDatabase here: a helper must never migrate or create desktop data.
    let connection = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Cannot read Termexo MCP settings: {e}"))?;
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    let text: String = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [SETTINGS_KEY],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let settings: McpSettings = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if !settings.enabled || !settings.auto_connect_agents {
        return Err("Termexo automatic agent MCP connection is disabled".into());
    }
    if settings.port == 0 {
        return Err("Invalid Termexo MCP port".into());
    }
    Ok(format!("http://127.0.0.1:{}/mcp", settings.port))
}

async fn forward(
    client: &reqwest::Client,
    database: &Path,
    message: &Value,
    protocol: &str,
) -> Result<Option<Value>, String> {
    let url = endpoint(database)?;
    // Re-read on each request: token rotation and port edits need no config rewrite or restart.
    let token = CredentialStore
        .get(CREDENTIAL_TARGET)
        .map_err(|_| "Cannot read Termexo MCP credential")?;
    let response = client
        .post(url)
        .bearer_auth(token)
        .header("Accept", "application/json, text/event-stream")
        .header("MCP-Protocol-Version", protocol)
        .json(message)
        .send()
        .await
        .map_err(|_| "Cannot connect to Termexo MCP; keep the desktop open")?;
    if !response.status().is_success() {
        return Err(format!(
            "Termexo MCP returned HTTP {}",
            response.status().as_u16()
        ));
    }
    if response.status() == reqwest::StatusCode::ACCEPTED {
        return Ok(None);
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| "Invalid response from Termexo MCP")?;
    Ok(Some(value))
}

async fn forward_stdio(database: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(65))
        .build()
        .map_err(|e| e.to_string())?;
    // Stdin is a blocking OS pipe. Keeping it on the runtime thread can stall reqwest's
    // connection tasks between messages, especially after the initialized notification.
    let (sender, mut input) = tokio::sync::mpsc::channel::<Result<Vec<u8>, String>>(16);
    std::thread::spawn(move || {
        let mut reader = std::io::stdin().lock();
        loop {
            let mut line = Vec::new();
            let result = (&mut reader)
                .take(MAX_MESSAGE_BYTES + 1)
                .read_until(b'\n', &mut line);
            let result = match result {
                Ok(0) => return,
                Ok(size) if size as u64 <= MAX_MESSAGE_BYTES => Ok(line),
                Ok(_) => Err("MCP request exceeds 1 MB".into()),
                Err(error) => Err(error.to_string()),
            };
            let failed = result.is_err();
            if sender.blocking_send(result).is_err() || failed {
                return;
            }
        }
    });
    let mut output = std::io::stdout().lock();
    let mut protocol = "2025-11-25".to_owned();
    while let Some(line) = input.recv().await {
        let line = line?;
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let message: Value =
            serde_json::from_slice(&line).map_err(|_| "Invalid MCP JSON message")?;
        let reply = match forward(&client, database, &message, &protocol).await {
            Ok(reply) => reply,
            Err(error) => message.get("id").map(
                |id| json!({"jsonrpc":"2.0", "id":id, "error":{"code":-32000,"message":error}}),
            ),
        };
        if let Some(reply) = reply {
            if message["method"] == "initialize" {
                if let Some(version) = reply
                    .pointer("/result/protocolVersion")
                    .and_then(Value::as_str)
                {
                    protocol = version.to_owned();
                }
            }
            serde_json::to_writer(&mut output, &reply).map_err(|e| e.to_string())?;
            output
                .write_all(b"\n")
                .and_then(|_| output.flush())
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_settings_enable_agent_autoconnection_by_default() {
        let settings: McpSettings = serde_json::from_value(json!({"enabled":true,"port":7421,"terminalAccess":true,"taskAccess":true,"settingsAccess":false})).unwrap();
        assert!(settings.auto_connect_agents);
    }

    #[test]
    fn endpoint_reads_current_settings_and_honors_both_switches() {
        let path = std::env::temp_dir().join(format!(
            "termexo-mcp-proxy-{}.db",
            crate::remote::token::generate_token().unwrap()
        ));
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)",
                [],
            )
            .unwrap();
        let mut settings = McpSettings {
            enabled: true,
            ..Default::default()
        };
        let save = |settings: &McpSettings| {
            connection
                .execute(
                    "INSERT OR REPLACE INTO app_settings VALUES (?1, ?2)",
                    [SETTINGS_KEY, &serde_json::to_string(settings).unwrap()],
                )
                .unwrap();
        };
        save(&settings);
        assert_eq!(endpoint(&path).unwrap(), "http://127.0.0.1:7421/mcp");
        settings.port = 17421;
        save(&settings);
        assert_eq!(endpoint(&path).unwrap(), "http://127.0.0.1:17421/mcp");
        settings.auto_connect_agents = false;
        save(&settings);
        assert!(endpoint(&path).is_err());
        settings.auto_connect_agents = true;
        settings.enabled = false;
        save(&settings);
        assert!(endpoint(&path).is_err());
        drop(connection);
        std::fs::remove_file(path).unwrap();
    }
}
