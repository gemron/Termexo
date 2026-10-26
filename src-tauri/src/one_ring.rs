//! Bundled One Ring engine, runtime and application-owned state.
use std::{fs, path::PathBuf, time::Duration};

use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;

use crate::{database::WorkspaceDatabase, hooks::toml_literal, process};

const SETTING: &str = "one_ring.connection.v1";
const CONTEXT_PREFIX: &str = "one_ring.coordinator.v1.";
const BUNDLED_SETTING: &str = "one_ring.bundled.v1";

// Rust/Tauri canonical Windows paths use extended prefixes that Node's entry-point resolver
// does not handle consistently across supported runtimes. Keep OS paths internally, normalize IPC.
fn node_path(path: &std::path::Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub plugin_directory: String,
    pub node_command: String,
    pub state_directory: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorRequest {
    pub root: String,
    pub goal: String,
    pub workflow_id: Option<String>,
    #[serde(default)]
    pub implementer: Option<WorkerPreference>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WorkerPreference {
    pub cli: String,
    pub model: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct Context {
    connection: Connection,
    request: CoordinatorRequest,
}

impl Connection {
    fn paths(&self) -> Result<(PathBuf, PathBuf), String> {
        if self.node_command.trim().is_empty() || self.state_directory.trim().is_empty() {
            return Err("请填写 Node 可执行文件和 One Ring 状态目录。".into());
        }
        let directory = PathBuf::from(&self.plugin_directory)
            .canonicalize()
            .map_err(|e| format!("One Ring 插件目录不可用：{e}"))?;
        let manifest: Value = serde_json::from_str(
            &fs::read_to_string(directory.join("plugin.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if manifest["name"] != "one-ring" {
            return Err("所选目录不是 One Ring 插件（plugin.json name 应为 one-ring）。".into());
        }
        let server = directory.join("server/index.mjs");
        if !server.is_file() || !directory.join("skills/one-ring/SKILL.md").is_file() {
            return Err(
                "插件缺少 server/index.mjs 或 One Ring Skill；请先构建或解压完整插件。".into(),
            );
        }
        if !PathBuf::from(&self.state_directory).is_absolute() {
            return Err("One Ring 状态目录必须是桌面主机上的绝对路径。".into());
        }
        Ok((directory, server))
    }
}

pub fn load(database: &WorkspaceDatabase) -> Result<Option<Connection>, String> {
    database
        .read_app_setting(SETTING)
        .map_err(|e| e.to_string())?
        .map(|value| serde_json::from_str(&value).map_err(|e| e.to_string()))
        .transpose()
}

pub fn bundled_connection(database: &WorkspaceDatabase) -> Result<Option<Connection>, String> {
    if database
        .read_app_setting(BUNDLED_SETTING)
        .map_err(|e| e.to_string())?
        .as_deref()
        != Some("true")
    {
        return Ok(None);
    }
    load(database)
}

pub fn initialize_bundled(
    database: &WorkspaceDatabase,
    resources: &std::path::Path,
    app_data: &std::path::Path,
) -> Result<Connection, String> {
    let plugin = resources.join("one-ring");
    let node = plugin
        .join("runtime")
        .join(if cfg!(windows) { "node.exe" } else { "node" });
    if !node.is_file() {
        return Err("安装包缺少内置 One Ring 运行时，请重新安装 Termexo。".into());
    }
    // Preserve previously recorded workflows while removing external executable/plugin paths.
    let state = load(database)?
        .map(|previous| PathBuf::from(previous.state_directory))
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| app_data.join("one-ring"));
    let connection = Connection {
        plugin_directory: node_path(&plugin),
        node_command: node_path(&node),
        state_directory: node_path(&state),
    };
    connection.paths()?;
    fs::create_dir_all(&state).map_err(|e| format!("无法创建 One Ring 应用数据目录：{e}"))?;
    database
        .write_app_setting(
            SETTING,
            &serde_json::to_string(&connection).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    database
        .write_app_setting(BUNDLED_SETTING, "true")
        .map_err(|e| e.to_string())?;
    Ok(connection)
}

pub fn inspect(connection: &Connection, operation: &str, args: Value) -> Result<Value, String> {
    if !matches!(
        operation,
        "one_ring_doctor" | "one_ring_list" | "one_ring_status"
    ) {
        return Err("Termexo 面板只允许查询 One Ring 状态。".into());
    }
    let (directory, server) = connection.paths()?;
    let mut command = process::hidden_command(&connection.node_command);
    command.current_dir(directory).args([
        "--input-type=module",
        "-e",
        include_str!("one_ring_bridge.mjs"),
        &node_path(&server),
        &connection.state_directory,
        operation,
        &args.to_string(),
    ]);
    let output = process::run_with_timeout(&mut command, Duration::from_secs(50))
        .map_err(|e| format!("One Ring 连接失败：{e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("One Ring 返回格式错误：{e}"))
}

#[cfg(test)]
pub fn save(database: &WorkspaceDatabase, connection: &Connection) -> Result<Value, String> {
    let doctor = inspect(connection, "one_ring_doctor", json!({}))?;
    database
        .write_app_setting(
            SETTING,
            &serde_json::to_string(connection).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    Ok(doctor)
}

/// Keep the connection with the terminal, so restore/model/account changes retain the MCP.
pub fn coordinator_config(
    database: &WorkspaceDatabase,
    terminal_id: &str,
    request: Option<CoordinatorRequest>,
) -> Result<Option<(String, String)>, String> {
    if terminal_id.is_empty()
        || terminal_id.len() > 128
        || !terminal_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("无效的协调终端 ID。".into());
    }
    let key = format!("{CONTEXT_PREFIX}{terminal_id}");
    let mut context: Context = match request {
        Some(request) => {
            if request.goal.trim().is_empty() && request.workflow_id.is_none() {
                return Err("请先填写 One Ring 任务目标。".into());
            }
            if !PathBuf::from(&request.root).is_absolute() {
                return Err("One Ring 项目根目录必须是绝对路径。".into());
            }
            Context {
                connection: load(database)?
                    .ok_or("内置 One Ring 引擎尚未就绪，请检查 Termexo 安装。")?,
                request,
            }
        }
        None => match database.read_app_setting(&key).map_err(|e| e.to_string())? {
            Some(value) => serde_json::from_str(&value).map_err(|e| e.to_string())?,
            None => return Ok(None),
        },
    };
    if database
        .read_app_setting(BUNDLED_SETTING)
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("true")
    {
        if let Some(current) = load(database)? {
            context.connection.plugin_directory = current.plugin_directory;
            context.connection.node_command = current.node_command;
        }
    }
    let (directory, server) = context.connection.paths()?;
    if let Some(preference) = &context.request.implementer {
        if !matches!(preference.cli.as_str(), "codex" | "opencode") {
            return Err("实施者仅支持 Codex 或 OpenCode。".into());
        }
    }
    let literal = |value: &str| toml_literal(value).map_err(|e| e.to_string());
    let config = format!(
        "mcp_servers.one_ring={{command={},args=[{}],cwd={},env={{ONE_RING_STATE_DIR={},TERMEXO_COORDINATOR_TERMINAL_ID={}}},env_vars=['CODEX_HOME','TERMEXO_EXECUTABLE','TERMEXO_DATABASE','TERMEXO_ACCOUNT_PROFILE_ID','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'],enabled=true,required=true}}",
        literal(&context.connection.node_command)?, literal(&node_path(&server))?,
        literal(&node_path(&directory))?, literal(&context.connection.state_directory)?, literal(terminal_id)?,
    );
    let skill = fs::read_to_string(directory.join("skills/one-ring/SKILL.md"))
        .map_err(|e| e.to_string())?;
    let prompt = format!(
        "Use One Ring as Coordinator for this Termexo session. Follow the installed One Ring Skill below. \
         Use one_ring MCP tools for all workflow execution and approval. Do not edit source as Coordinator. \
         Never treat a terminal completion, this launch, or tool permission as workflow approval. \
         First call one_ring_doctor; if platform or host confirmation is unsupported, explain the blocker and stop execution.\n\n\
         Project root: {}\nTask goal: {}\nExisting workflow: {}\n\n{}",
        context.request.root, context.request.goal,
        context.request.workflow_id.as_deref().unwrap_or("none; create a plan and request approval before execution"), skill,
    );
    database
        .write_app_setting(
            &key,
            &serde_json::to_string(&context).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    // A short initial prompt avoids Windows .cmd argument limits and multiline PTY input.
    let task_directory =
        PathBuf::from(&context.connection.state_directory).join("termexo-coordinators");
    fs::create_dir_all(&task_directory).map_err(|e| e.to_string())?;
    let task_path = task_directory.join(format!("{terminal_id}.md"));
    let prompt = format!("{}\n\nUser implementer preference: {}. Preserve the requested CLI and any explicit model. If the model is omitted, inspect the available models with one_ring_worker_models and propose a concrete choice in the plan before requesting confirmation. OpenCode requires an explicit provider/model in the approved plan. Use Codex as the independent verifier. Do not silently substitute a CLI or model.", prompt,
        serde_json::to_string(&context.request.implementer).map_err(|e| e.to_string())?);
    fs::write(&task_path, prompt).map_err(|e| e.to_string())?;
    let initial_prompt = format!(
        "Use One Ring. Read and follow the coordinator instructions and user task in {}. Start with one_ring_doctor; request real human confirmation before execution.",
        serde_json::to_string(&task_path.to_string_lossy()).map_err(|e| e.to_string())?,
    );
    Ok(Some((config, initial_prompt)))
}

/// Only choose from terminals still present in the requesting workspace. Saved coordinator
/// contexts bind resumed sessions to a workflow; the engine binds the original session at create.
pub fn find_coordinator(
    database: &WorkspaceDatabase,
    root: &str,
    workflow_id: &str,
    original_terminal_id: Option<&str>,
    terminal_ids: &[String],
) -> Result<Option<String>, String> {
    let normalize = |value: &str| {
        let path = value.replace('\\', "/").trim_end_matches('/').to_string();
        if cfg!(windows) {
            path.to_lowercase()
        } else {
            path
        }
    };
    let mut original = None;
    for id in terminal_ids {
        if !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            continue;
        }
        let Some(value) = database
            .read_app_setting(&format!("{CONTEXT_PREFIX}{id}"))
            .map_err(|e| e.to_string())?
        else {
            continue;
        };
        let Ok(context) = serde_json::from_str::<Context>(&value) else {
            continue;
        };
        if normalize(&context.request.root) != normalize(root) {
            continue;
        }
        if context.request.workflow_id.as_deref() == Some(workflow_id) {
            return Ok(Some(id.clone()));
        }
        if original_terminal_id == Some(id.as_str()) && context.request.workflow_id.is_none() {
            original = Some(id.clone());
        }
    }
    Ok(original)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        root: PathBuf,
        database: WorkspaceDatabase,
        connection: Connection,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "termexo-one-ring-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let plugin = root.join("plugin with ' quote");
            fs::create_dir_all(plugin.join("server")).unwrap();
            fs::create_dir_all(plugin.join("skills/one-ring")).unwrap();
            fs::write(plugin.join("plugin.json"), r#"{"name":"one-ring"}"#).unwrap();
            fs::write(plugin.join("server/index.mjs"), "").unwrap();
            fs::write(
                plugin.join("skills/one-ring/SKILL.md"),
                "Use the real One Ring approval form.",
            )
            .unwrap();
            let database = WorkspaceDatabase::open(root.join("workspace.db")).unwrap();
            let connection = Connection {
                plugin_directory: plugin.to_string_lossy().into(),
                node_command: "node".into(),
                state_directory: root.join("state with spaces").to_string_lossy().into(),
            };
            database
                .write_app_setting(SETTING, &serde_json::to_string(&connection).unwrap())
                .unwrap();
            Self {
                root,
                database,
                connection,
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn bundled_resources(fixture: &Fixture) -> PathBuf {
        let resources = fixture.root.join("resources");
        let plugin = resources.join("one-ring");
        fs::create_dir_all(plugin.join("runtime")).unwrap();
        fs::create_dir_all(plugin.join("server")).unwrap();
        fs::create_dir_all(plugin.join("skills/one-ring")).unwrap();
        fs::write(plugin.join("plugin.json"), r#"{"name":"one-ring"}"#).unwrap();
        fs::write(plugin.join("server/index.mjs"), "").unwrap();
        fs::write(
            plugin.join("skills/one-ring/SKILL.md"),
            "Use the real One Ring approval form.",
        )
        .unwrap();
        fs::write(
            plugin
                .join("runtime")
                .join(if cfg!(windows) { "node.exe" } else { "node" }),
            "fixture runtime",
        )
        .unwrap();
        resources
    }

    #[test]
    fn node_entry_paths_support_canonical_windows_and_unc_locations() {
        assert_eq!(
            node_path(std::path::Path::new(
                r"\\?\C:\Program Files\Termexo\one-ring\server\index.mjs"
            )),
            r"C:\Program Files\Termexo\one-ring\server\index.mjs"
        );
        assert_eq!(
            node_path(std::path::Path::new(r"\\?\UNC\host\share\engine.mjs")),
            r"\\host\share\engine.mjs"
        );
    }

    #[test]
    fn builtin_defaults_need_no_external_installation_or_user_paths() {
        let fixture = Fixture::new();
        let database = WorkspaceDatabase::open(fixture.root.join("fresh.db")).unwrap();
        let resources = bundled_resources(&fixture);
        let app_data = fixture.root.join("application-data");
        let connection = initialize_bundled(&database, &resources, &app_data).unwrap();
        assert_eq!(
            PathBuf::from(connection.plugin_directory),
            resources.join("one-ring")
        );
        assert_eq!(
            PathBuf::from(connection.state_directory),
            app_data.join("one-ring")
        );
        assert!(PathBuf::from(connection.node_command).is_file());
        assert!(load(&database).unwrap().is_some());
    }

    #[test]
    fn builtin_migration_preserves_workflow_state_and_updates_restored_coordinators() {
        let fixture = Fixture::new();
        coordinator_config(
            &fixture.database,
            "existing-terminal",
            Some(CoordinatorRequest {
                root: fixture.root.to_string_lossy().into_owned(),
                goal: "Preserve state".into(),
                workflow_id: None,
                implementer: None,
            }),
        )
        .unwrap();
        let state = PathBuf::from(&fixture.connection.state_directory);
        fs::write(state.join("preserved-workflow.txt"), "existing data").unwrap();
        let resources = bundled_resources(&fixture);
        let connection =
            initialize_bundled(&fixture.database, &resources, &fixture.root.join("app")).unwrap();
        assert_eq!(
            connection.state_directory,
            fixture.connection.state_directory
        );
        assert_eq!(
            fs::read_to_string(state.join("preserved-workflow.txt")).unwrap(),
            "existing data"
        );
        let restored = coordinator_config(&fixture.database, "existing-terminal", None)
            .unwrap()
            .unwrap()
            .0;
        let config: toml::Table = toml::from_str(&restored).unwrap();
        assert_eq!(
            config["mcp_servers"]["one_ring"]["command"].as_str(),
            Some(connection.node_command.as_str())
        );
    }

    #[test]
    fn incomplete_builtin_bundle_does_not_overwrite_existing_configuration() {
        let fixture = Fixture::new();
        assert!(initialize_bundled(
            &fixture.database,
            &fixture.root.join("missing"),
            &fixture.root
        )
        .is_err());
        assert_eq!(
            load(&fixture.database).unwrap().unwrap().plugin_directory,
            fixture.connection.plugin_directory
        );
    }

    #[test]
    fn coordinator_restores_its_original_connection_and_writes_task_outside_workspace() {
        let fixture = Fixture::new();
        let request = CoordinatorRequest {
            root: fixture.root.to_string_lossy().into(),
            goal: "Keep zero; quote ' and $() literally".into(),
            workflow_id: Some("workflow-1".into()),
            implementer: None,
        };
        let (config, prompt) = coordinator_config(&fixture.database, "terminal-1", Some(request))
            .unwrap()
            .unwrap();
        let parsed: toml::Table = toml::from_str(&config).unwrap();
        let server = &parsed["mcp_servers"]["one_ring"];
        assert_eq!(server["required"].as_bool(), Some(true));
        assert_eq!(
            server["env"]["ONE_RING_STATE_DIR"].as_str(),
            Some(fixture.connection.state_directory.as_str())
        );
        assert!(server["env_vars"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str() == Some("CODEX_HOME")));
        assert!(!config.contains("OPENAI_API_KEY"));
        assert!(!prompt.contains('\n'));
        let task = fs::read_to_string(
            PathBuf::from(&fixture.connection.state_directory)
                .join("termexo-coordinators/terminal-1.md"),
        )
        .unwrap();
        assert!(task.contains("Existing workflow: workflow-1"));
        assert!(task.contains("Use the real One Ring approval form."));
        let mut changed = fixture.connection.clone();
        changed.plugin_directory = "missing-plugin".into();
        fixture
            .database
            .write_app_setting(SETTING, &serde_json::to_string(&changed).unwrap())
            .unwrap();
        assert_eq!(
            coordinator_config(&fixture.database, "terminal-1", None)
                .unwrap()
                .unwrap()
                .0,
            config
        );
        assert!(
            coordinator_config(&fixture.database, "ordinary-terminal", None)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn rejects_invalid_plugins_relative_state_and_terminal_path_traversal() {
        let fixture = Fixture::new();
        let mut invalid = fixture.connection.clone();
        invalid.state_directory = "relative/state".into();
        assert!(invalid.paths().is_err());
        fs::write(
            PathBuf::from(&fixture.connection.plugin_directory).join("plugin.json"),
            r#"{"name":"another-plugin"}"#,
        )
        .unwrap();
        assert!(fixture.connection.paths().is_err());
        assert!(coordinator_config(&fixture.database, "../escape", None).is_err());
        assert!(inspect(&fixture.connection, "one_ring_request_decision", json!({})).is_err());
    }

    #[test]
    fn coordinator_lookup_preserves_workflow_binding_and_excludes_closed_or_other_project_sessions()
    {
        let fixture = Fixture::new();
        let project = fixture.root.join("project").to_string_lossy().to_string();
        for (id, workflow, root) in [
            ("original", None, project.clone()),
            ("resumed", Some("workflow"), project.clone()),
            (
                "other",
                Some("workflow"),
                fixture.root.join("other").to_string_lossy().to_string(),
            ),
        ] {
            let context = Context {
                connection: fixture.connection.clone(),
                request: CoordinatorRequest {
                    root,
                    goal: "same goal".into(),
                    workflow_id: workflow.map(String::from),
                    implementer: None,
                },
            };
            fixture
                .database
                .write_app_setting(
                    &format!("{CONTEXT_PREFIX}{id}"),
                    &serde_json::to_string(&context).unwrap(),
                )
                .unwrap();
        }
        let ids = vec!["original".into(), "other".into(), "resumed".into()];
        assert_eq!(
            find_coordinator(
                &fixture.database,
                &project,
                "workflow",
                Some("original"),
                &ids
            )
            .unwrap()
            .as_deref(),
            Some("resumed")
        );
        assert_eq!(
            find_coordinator(
                &fixture.database,
                &project,
                "workflow",
                Some("original"),
                &["original".into()]
            )
            .unwrap()
            .as_deref(),
            Some("original")
        );
        assert!(find_coordinator(
            &fixture.database,
            &project,
            "workflow",
            Some("original"),
            &["other".into()]
        )
        .unwrap()
        .is_none());
        assert!(
            find_coordinator(&fixture.database, &project, "different", None, &ids)
                .unwrap()
                .is_none()
        );
        assert!(find_coordinator(
            &fixture.database,
            &project,
            "workflow",
            Some("original"),
            &[]
        )
        .unwrap()
        .is_none());
    }

    #[test]
    #[ignore = "requires TERMEXO_ONE_RING_PLUGIN_DIR pointing to a built local One Ring plugin"]
    fn connects_to_real_plugin() {
        let mut fixture = Fixture::new();
        fixture.connection.plugin_directory =
            std::env::var("TERMEXO_ONE_RING_PLUGIN_DIR").expect("set TERMEXO_ONE_RING_PLUGIN_DIR");
        let doctor = save(&fixture.database, &fixture.connection).unwrap();
        assert_eq!(doctor["stateDirectory"], fixture.connection.state_directory);
        assert!(doctor["version"].as_str().is_some());
        assert_eq!(
            inspect(&fixture.connection, "one_ring_list", json!({})).unwrap(),
            json!([])
        );
    }
}
