//! Session overrides for clients that support them; reversible user entries for the others.
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::commands::terminal::TerminalStartRequest;
use crate::hooks::toml_literal;

const SERVER: &str = "termexo-desktop";
const GROK_BEGIN: &str = "# BEGIN TERMEXO AGENT MCP\n";
const GROK_END: &str = "# END TERMEXO AGENT MCP\n";

#[derive(Clone, Deserialize, Serialize)]
struct Registration {
    agent: String,
    path: PathBuf,
}

fn proxy_args(database: &Path) -> Vec<String> {
    vec![
        "mcp-proxy".into(),
        "--database".into(),
        database.to_string_lossy().into_owned(),
    ]
}

fn stdio_entry(executable: &Path, database: &Path) -> Value {
    json!({"command": executable, "args": proxy_args(database)})
}

fn owned(entry: &Value, database: &Path) -> bool {
    entry.get("command").is_some_and(Value::is_string)
        && entry.get("args") == Some(&json!(proxy_args(database)))
}

pub(super) fn inject(
    request: &mut TerminalStartRequest,
    environment: &mut HashMap<String, String>,
    executable: &Path,
    database: &Path,
) -> Result<(), String> {
    let Some(command) = request.command.as_mut() else {
        return Ok(());
    };
    let runtime = database
        .parent()
        .ok_or("MCP database has no parent")?
        .join("runtime");
    match request.agent_type.as_deref() {
        Some("claude") => {
            // `attach` joins an existing Claude process, whose MCP catalog is already loaded.
            if command.contains(" attach ") {
                return Ok(());
            }
            fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
            // One stable file per app, without credentials; it composes with the selected profile.
            let path = runtime.join("termexo-agent-mcp.json");
            write_atomic(
                &path,
                &serde_json::to_vec_pretty(
                    &json!({"mcpServers": {SERVER: stdio_entry(executable, database)}}),
                )
                .map_err(|e| e.to_string())?,
            )?;
            let argument = quote(&path.to_string_lossy());
            if let Some(index) = command.find(" --mcp-config ") {
                let start = index + " --mcp-config ".len();
                let end = single_quoted_argument_end(command, start)?;
                command.insert_str(end, &format!(" {argument}"));
            } else {
                command.push_str(&format!(" --mcp-config {argument}"));
            }
        }
        Some("codex") => {
            // Replace only this server's table; other MCP servers and provider overrides survive.
            let args = proxy_args(database)
                .iter()
                .map(|value| toml_literal(value).map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            let config = format!(
                "mcp_servers.{SERVER}={{command={},args=[{args}],enabled=true}}",
                toml_literal(&executable.to_string_lossy()).map_err(|e| e.to_string())?
            );
            command.push_str(&format!(" -c {}", quote(&config)));
        }
        Some("opencode") => {
            let mut config: Value = match environment.get("OPENCODE_CONFIG_CONTENT") {
                Some(value) => serde_json::from_str(value)
                    .map_err(|e| format!("Invalid OpenCode config: {e}"))?,
                None => json!({}),
            };
            let config = config
                .as_object_mut()
                .ok_or("OpenCode config must be an object")?;
            // Hook preparation already selects `plugins` for V2 and `plugin` for V1.
            // Reuse that version decision: V2 moved entries under mcp.servers.
            let v2 = config.contains_key("plugins")
                || config
                    .get("mcp")
                    .and_then(|mcp| mcp.get("servers"))
                    .is_some();
            let mcp = config
                .entry("mcp")
                .or_insert_with(|| json!({}))
                .as_object_mut()
                .ok_or("OpenCode mcp must be an object")?;
            let servers = if v2 {
                mcp.entry("servers")
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
                    .ok_or("OpenCode mcp.servers must be an object")?
            } else {
                mcp
            };
            let mut args = vec![executable.to_string_lossy().into_owned()];
            args.extend(proxy_args(database));
            let entry = if v2 {
                json!({"type":"local", "command":args, "disabled":false})
            } else {
                json!({"type":"local", "command":args, "enabled":true})
            };
            servers.insert(SERVER.into(), entry);
            environment.insert(
                "OPENCODE_CONFIG_CONTENT".into(),
                serde_json::to_string(config).map_err(|e| e.to_string())?,
            );
        }
        Some(agent @ ("grok" | "antigravity")) => {
            let home = || {
                environment
                    .get("USERPROFILE")
                    .or_else(|| environment.get("HOME"))
                    .cloned()
                    .or_else(|| std::env::var("USERPROFILE").ok())
                    .or_else(|| std::env::var("HOME").ok())
                    .map(PathBuf::from)
                    .ok_or("Cannot find agent home directory")
            };
            let path = if agent == "grok" {
                environment
                    .get("GROK_HOME")
                    .cloned()
                    .or_else(|| std::env::var("GROK_HOME").ok())
                    .map(PathBuf::from)
                    .unwrap_or(home()?.join(".grok"))
                    .join("config.toml")
            } else {
                home()?.join(".gemini/config/mcp_config.json")
            };
            register(database, agent, &path)?;
            update_global(agent, &path, database, Some(executable))?;
        }
        _ => {}
    }
    Ok(())
}

fn single_quoted_argument_end(command: &str, start: usize) -> Result<usize, String> {
    let bytes = command.as_bytes();
    if bytes.get(start) != Some(&b'\'') {
        return Err("Cannot merge Claude --mcp-config: expected a quoted file path".into());
    }
    let mut index = start + 1;
    while index < bytes.len() {
        if bytes[index] == b'\'' {
            if bytes.get(index + 1) != Some(&b'\'') {
                return Ok(index + 1);
            }
            index += 1;
        }
        index += 1;
    }
    Err("Cannot merge Claude --mcp-config: unterminated file path".into())
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn registry_path(database: &Path) -> Result<PathBuf, String> {
    Ok(database
        .parent()
        .ok_or("MCP database has no parent")?
        .join("runtime/agent-mcp-configs.json"))
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot read {}: {error}", path.display())),
    }
}

fn registrations(database: &Path) -> Result<Vec<Registration>, String> {
    read_optional(&registry_path(database)?)?
        .map(|text| serde_json::from_str(&text).map_err(|e| e.to_string()))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

fn register(database: &Path, agent: &str, path: &Path) -> Result<(), String> {
    let mut records = registrations(database)?;
    if !records
        .iter()
        .any(|record| record.agent == agent && record.path == path)
    {
        records.push(Registration {
            agent: agent.into(),
            path: path.into(),
        });
        write_atomic(
            &registry_path(database)?,
            &serde_json::to_vec(&records).map_err(|e| e.to_string())?,
        )?;
    }
    Ok(())
}

pub(super) fn remove_global_configs(database: &Path) -> Result<(), String> {
    let records = registrations(database)?;
    if records.is_empty() {
        return Ok(());
    }
    for record in &records {
        update_global(&record.agent, &record.path, database, None)?;
    }
    write_atomic(&registry_path(database)?, b"[]")
}

fn update_global(
    agent: &str,
    path: &Path,
    database: &Path,
    executable: Option<&Path>,
) -> Result<(), String> {
    let previous = read_optional(path)?;
    if executable.is_none() && previous.is_none() {
        return Ok(());
    }
    let updated = if agent == "grok" {
        merge_grok(previous.as_deref().unwrap_or(""), database, executable)?
    } else if agent == "antigravity" {
        merge_antigravity(previous.as_deref().unwrap_or("{}"), database, executable)?
    } else {
        return Err("Unknown managed MCP config type".into());
    };
    if previous.as_deref() != Some(&updated) {
        write_atomic(path, updated.as_bytes())?;
    }
    Ok(())
}

fn merge_antigravity(
    text: &str,
    database: &Path,
    executable: Option<&Path>,
) -> Result<String, String> {
    let mut config: Value = serde_json::from_str(text)
        .map_err(|e| format!("Invalid Antigravity MCP config; left unchanged: {e}"))?;
    let root = config
        .as_object_mut()
        .ok_or("Antigravity MCP config must be an object; left unchanged")?;
    if executable.is_none() && !root.contains_key("mcpServers") {
        return Ok(text.into());
    }
    let servers = root
        .entry("mcpServers")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("Antigravity mcpServers must be an object; left unchanged")?;
    if let Some(entry) = servers.get(SERVER) {
        if !owned(entry, database) {
            return if executable.is_none() {
                Ok(text.into())
            } else {
                Err(format!(
                    "MCP server {SERVER} already exists; left unchanged"
                ))
            };
        }
    }
    match executable {
        Some(executable) => {
            servers.insert(SERVER.into(), stdio_entry(executable, database));
        }
        None => {
            if servers.remove(SERVER).is_none() {
                return Ok(text.into());
            }
        }
    }
    serde_json::to_string_pretty(&config).map_err(|e| e.to_string())
}

fn merge_grok(text: &str, database: &Path, executable: Option<&Path>) -> Result<String, String> {
    // Preserve the user's TOML comments and layout exactly outside our marked block.
    let parsed: toml::Value =
        toml::from_str(text).map_err(|e| format!("Invalid Grok config; left unchanged: {e}"))?;
    let entry = parsed
        .get("mcp_servers")
        .and_then(|servers| servers.get(SERVER));
    let entry_owned = entry
        .map(|entry| serde_json::to_value(entry).map(|value| owned(&value, database)))
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if entry.is_some() && !entry_owned {
        return if executable.is_none() {
            Ok(text.into())
        } else {
            Err(format!(
                "MCP server {SERVER} already exists; left unchanged"
            ))
        };
    }
    let mut updated = text.to_owned();
    if let Some(start) = text.find(GROK_BEGIN) {
        if !entry_owned {
            return Err("Managed Grok MCP block was edited; left unchanged".into());
        }
        let end = text[start..]
            .find(GROK_END)
            .ok_or("Incomplete managed Grok MCP block; left unchanged")?
            + start
            + GROK_END.len();
        let block: toml::Value = toml::from_str(&text[start..end]).map_err(|e| e.to_string())?;
        let expected_keys = ["command", "args", "enabled"];
        if block.as_table().is_none_or(|root| root.len() != 1)
            || block
                .get("mcp_servers")
                .and_then(toml::Value::as_table)
                .is_none_or(|servers| servers.len() != 1)
            || block
                .get("mcp_servers")
                .and_then(|servers| servers.get(SERVER))
                .and_then(toml::Value::as_table)
                .is_none_or(|server| {
                    server
                        .keys()
                        .any(|key| !expected_keys.contains(&key.as_str()))
                })
        {
            return Err("Managed Grok MCP block contains user additions; left unchanged".into());
        }
        updated.replace_range(start..end, "");
    } else if entry_owned {
        return Err("Managed Grok MCP markers are missing; left unchanged".into());
    }
    if let Some(executable) = executable {
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        let args = proxy_args(database)
            .iter()
            .map(|value| toml_literal(value).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?
            .join(", ");
        updated.push_str(&format!("{GROK_BEGIN}[mcp_servers.{SERVER}]\ncommand = {}\nargs = [{args}]\nenabled = true\n{GROK_END}", toml_literal(&executable.to_string_lossy()).map_err(|e| e.to_string())?));
    }
    // Reject any invalid composition before replacing an existing file.
    toml::from_str::<toml::Value>(&updated).map_err(|e| e.to_string())?;
    Ok(updated)
}

fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("MCP configuration has no parent")?)
        .map_err(|e| e.to_string())?;
    let temporary = path.with_extension(format!(
        "termexo-{}.tmp",
        crate::remote::token::generate_token().map_err(|e| e.to_string())?
    ));
    fs::write(&temporary, contents).map_err(|e| e.to_string())?;
    fs::rename(&temporary, path).map_err(|error| {
        fs::remove_file(&temporary).ok();
        format!("Cannot replace {}: {error}", path.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> PathBuf {
        PathBuf::from("C:/Termexo data/agentdock.db")
    }
    fn executable() -> PathBuf {
        PathBuf::from("C:/Termexo's app/termexo.exe")
    }

    #[test]
    fn grok_merge_is_idempotent_and_removal_preserves_other_servers_and_comments() {
        let original = "# keep my comments\n[models]\ndefault = 'grok-4.5'\n[mcp_servers.other]\ncommand = 'other.exe'\n";
        let installed = merge_grok(original, &database(), Some(&executable())).unwrap();
        assert_eq!(
            merge_grok(&installed, &database(), Some(&executable())).unwrap(),
            installed
        );
        assert_eq!(merge_grok(&installed, &database(), None).unwrap(), original);
        let parsed: toml::Value = toml::from_str(&installed).unwrap();
        assert_eq!(
            parsed["mcp_servers"][SERVER]["command"].as_str(),
            executable().to_str()
        );
        assert!(!installed.contains("Bearer"));
    }

    #[test]
    fn antigravity_merge_keeps_settings_and_other_servers_and_updates_executable() {
        let original = json!({"otherSetting": true, "mcpServers": {"other": {"serverUrl": "https://example.com/mcp"}}});
        let installed =
            merge_antigravity(&original.to_string(), &database(), Some(&executable())).unwrap();
        let new_executable = Path::new("D:/Termexo/termexo.exe");
        let updated = merge_antigravity(&installed, &database(), Some(new_executable)).unwrap();
        let config: Value = serde_json::from_str(&updated).unwrap();
        assert_eq!(
            config["mcpServers"][SERVER]["command"],
            new_executable.to_str().unwrap()
        );
        assert_eq!(
            serde_json::from_str::<Value>(&merge_antigravity(&updated, &database(), None).unwrap())
                .unwrap(),
            original
        );
    }

    #[test]
    fn foreign_or_invalid_config_is_never_overwritten_or_removed() {
        let json = json!({"mcpServers": {SERVER: {"command": "user.exe"}}}).to_string();
        let toml = format!("[mcp_servers.{SERVER}]\ncommand = 'user.exe'\n");
        assert!(merge_antigravity(&json, &database(), Some(&executable())).is_err());
        assert!(merge_grok(&toml, &database(), Some(&executable())).is_err());
        assert_eq!(merge_antigravity(&json, &database(), None).unwrap(), json);
        assert_eq!(merge_grok(&toml, &database(), None).unwrap(), toml);
        assert!(merge_antigravity("broken", &database(), Some(&executable())).is_err());
        assert!(merge_grok("broken", &database(), Some(&executable())).is_err());
    }

    #[test]
    fn claude_profile_paths_with_quotes_can_be_extended_without_replacing_them() {
        let command = "& 'claude.exe' --mcp-config 'C:/my ''MCP'' config.json' --resume 'session'";
        let start = command.find(" --mcp-config ").unwrap() + " --mcp-config ".len();
        let end = single_quoted_argument_end(command, start).unwrap();
        let mut merged = command.to_owned();
        merged.insert_str(end, " 'C:/Termexo/runtime/self.json'");
        assert!(merged.contains(
            "--mcp-config 'C:/my ''MCP'' config.json' 'C:/Termexo/runtime/self.json' --resume"
        ));
    }

    #[test]
    fn opencode_overlay_retains_plugins_and_existing_servers_without_secrets() {
        let mut request: TerminalStartRequest = serde_json::from_value(json!({"terminalId":"test", "shell":"powershell", "workingDirectory":"C:/", "command":"& 'opencode.exe'", "cols":120,"rows":40,"agentType":"opencode"})).unwrap();
        let mut environment = HashMap::from([("OPENCODE_CONFIG_CONTENT".into(), json!({"plugin":["my-plugin"],"mcp":{"other":{"type":"remote","url":"https://example.com"}}}).to_string())]);
        inject(&mut request, &mut environment, &executable(), &database()).unwrap();
        let config: Value = serde_json::from_str(&environment["OPENCODE_CONFIG_CONTENT"]).unwrap();
        assert_eq!(config["plugin"], json!(["my-plugin"]));
        assert_eq!(config["mcp"]["other"]["url"], "https://example.com");
        assert_eq!(config["mcp"][SERVER]["command"][1], "mcp-proxy");
        assert!(!environment["OPENCODE_CONFIG_CONTENT"].contains("Bearer"));
    }

    #[test]
    fn opencode_v2_keeps_server_timeouts_and_uses_its_nested_schema() {
        let mut request: TerminalStartRequest = serde_json::from_value(json!({"terminalId":"test", "shell":"powershell", "workingDirectory":"C:/", "command":"& 'opencode.exe' --standalone", "cols":120,"rows":40,"agentType":"opencode"})).unwrap();
        let mut environment = HashMap::from([("OPENCODE_CONFIG_CONTENT".into(), json!({"plugins":["my-plugin"],"mcp":{"timeout":{"execution":45000},"servers":{"other":{"type":"remote","url":"https://example.com"}}}}).to_string())]);
        inject(&mut request, &mut environment, &executable(), &database()).unwrap();
        let config: Value = serde_json::from_str(&environment["OPENCODE_CONFIG_CONTENT"]).unwrap();
        assert_eq!(config["plugins"], json!(["my-plugin"]));
        assert_eq!(config["mcp"]["timeout"]["execution"], 45000);
        assert_eq!(
            config["mcp"]["servers"]["other"]["url"],
            "https://example.com"
        );
        assert_eq!(config["mcp"]["servers"][SERVER]["command"][1], "mcp-proxy");
        assert_eq!(config["mcp"]["servers"][SERVER]["disabled"], false);
        assert!(config["mcp"]["servers"][SERVER].get("enabled").is_none());
        assert!(config["mcp"].get(SERVER).is_none());
    }

    #[test]
    fn real_launch_overrides_and_registered_user_configs_can_be_removed() {
        let root = std::env::temp_dir().join(format!(
            "termexo-agent-mcp-{}",
            crate::remote::token::generate_token().unwrap()
        ));
        let database = root.join("data/agentdock.db");
        let grok = root.join("profile/.grok/config.toml");
        let antigravity = root.join("profile/.gemini/config/mcp_config.json");
        write_atomic(&grok, b"# Keep\n[models]\ndefault='grok-4.5'\n").unwrap();
        write_atomic(
            &antigravity,
            b"{\"mcpServers\":{\"other\":{\"command\":\"user.exe\"}}}",
        )
        .unwrap();
        let make_request = |agent: &str| {
            serde_json::from_value::<TerminalStartRequest>(json!({"terminalId":"test", "shell":"powershell", "workingDirectory":root,"command":"& 'agent.exe' --resume 'session'", "cols":120,"rows":40,"agentType":agent})).unwrap()
        };
        let mut environment = HashMap::from([
            (
                "USERPROFILE".into(),
                root.join("profile").to_string_lossy().into_owned(),
            ),
            (
                "GROK_HOME".into(),
                grok.parent().unwrap().to_string_lossy().into_owned(),
            ),
        ]);
        let mut claude = make_request("claude");
        claude.command =
            Some("& 'claude.exe' --mcp-config 'existing.json' --resume 'session'".into());
        inject(&mut claude, &mut environment, &executable(), &database).unwrap();
        assert!(claude
            .command
            .unwrap()
            .contains("--mcp-config 'existing.json' '"));
        let config: Value = serde_json::from_slice(
            &fs::read(root.join("data/runtime/termexo-agent-mcp.json")).unwrap(),
        )
        .unwrap();
        assert!(owned(&config["mcpServers"][SERVER], &database));
        let mut codex = make_request("codex");
        inject(&mut codex, &mut environment, &executable(), &database).unwrap();
        assert!(codex
            .command
            .unwrap()
            .contains("mcp_servers.termexo-desktop={command="));
        for agent in ["grok", "antigravity"] {
            inject(
                &mut make_request(agent),
                &mut environment,
                &executable(),
                &database,
            )
            .unwrap();
        }
        assert!(fs::read_to_string(&grok).unwrap().contains(SERVER));
        assert!(fs::read_to_string(&antigravity).unwrap().contains(SERVER));
        remove_global_configs(&database).unwrap();
        assert_eq!(
            fs::read_to_string(&grok).unwrap(),
            "# Keep\n[models]\ndefault='grok-4.5'\n"
        );
        let config: Value = serde_json::from_slice(&fs::read(&antigravity).unwrap()).unwrap();
        assert_eq!(
            config,
            json!({"mcpServers":{"other":{"command":"user.exe"}}})
        );
        assert!(registrations(&database).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn grok_block_with_user_additions_cannot_be_removed() {
        let installed = merge_grok("", &database(), Some(&executable())).unwrap();
        let edited = installed.replace(
            GROK_END,
            &format!("[mcp_servers.other]\ncommand='user.exe'\n{GROK_END}"),
        );
        assert!(merge_grok(&edited, &database(), None).is_err());
    }
}
