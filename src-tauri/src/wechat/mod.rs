//! Desktop WeChat notifications, disabled until configured by the user.
//! A single native UIA adapter handles both a no-send probe and guarded submission.
use std::sync::Mutex;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::database::WorkspaceDatabase;
use crate::third_party_notifications::content::{
    format_notification, NotificationContent, NotificationKind,
};

const SETTINGS_KEY: &str = "wechat-notifications.v1";
const HISTORY_KEY: &str = "wechat-notification-history.v1";
const HISTORY_LIMIT: usize = 50;
const SEEN_LIMIT: usize = 10_000;
const DESKTOP_TIMEOUT: Duration = Duration::from_secs(30);
static DESKTOP_ACTION: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct WechatSettings {
    pub enabled: bool,
    pub target: String,
    pub workspace_ids: Vec<String>,
    pub all_workspaces: bool,
    pub completed: bool,
    pub errors: bool,
    pub approval: bool,
    pub input: bool,
}
impl Default for WechatSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            target: "文件传输助手".into(),
            workspace_ids: vec![],
            all_workspaces: true,
            completed: true,
            errors: true,
            approval: true,
            input: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub id: String,
    pub target: String,
    pub kind: String,
    pub workspace_id: String,
    pub created_at: u64,
    pub status: String,
    pub detail: String,
}
#[derive(Default, Serialize, Deserialize)]
struct Journal {
    seen: Vec<String>,
    entries: Vec<Delivery>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationRequest {
    pub workspace_id: String,
    pub event_key: String,
    pub kind: String,
    pub terminal_id: Option<String>,
    pub task_title: Option<String>,
}
#[derive(Serialize, Deserialize)]
pub struct DesktopResult {
    pub status: String,
    pub detail: String,
}

fn settings(database: &WorkspaceDatabase) -> Result<WechatSettings, String> {
    database
        .read_app_setting(SETTINGS_KEY)
        .map_err(|e| e.to_string())?
        .map(|value| serde_json::from_str(&value).map_err(|_| "微信通知配置无法读取。".into()))
        .unwrap_or_else(|| Ok(WechatSettings::default()))
}
fn journal(database: &WorkspaceDatabase) -> Result<Journal, String> {
    database
        .read_app_setting(HISTORY_KEY)
        .map_err(|e| e.to_string())?
        .map(|value| {
            serde_json::from_str(&value)
                .map_err(|_| "微信通知投递记录无法读取，已停止发送以防重复。".into())
        })
        .unwrap_or_else(|| Ok(Journal::default()))
}
fn save_journal(database: &WorkspaceDatabase, journal: &Journal) -> Result<(), String> {
    database
        .write_app_setting(
            HISTORY_KEY,
            &serde_json::to_string(journal).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn validate_target(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 100 || value.chars().any(char::is_control) {
        return Err("微信目标必须是 1–100 字的完整联系人或群名称。".into());
    }
    Ok(value.to_owned())
}
fn enabled_kind(settings: &WechatSettings, kind: &str) -> bool {
    match kind {
        "completed" => settings.completed,
        "error" => settings.errors,
        "approval" => settings.approval,
        "input" => settings.input,
        _ => false,
    }
}

#[tauri::command(async)]
pub fn read_wechat_notifications(
    database: State<'_, WorkspaceDatabase>,
) -> Result<serde_json::Value, String> {
    Ok(
        json!({"settings": settings(&database)?, "history": journal(&database)?.entries, "platformSupported": cfg!(windows)}),
    )
}
#[tauri::command(async)]
pub fn update_wechat_notifications(
    mut input: WechatSettings,
    database: State<'_, WorkspaceDatabase>,
) -> Result<WechatSettings, String> {
    input.target = validate_target(&input.target)?;
    if input.workspace_ids.len() > 100 {
        return Err("项目范围过大。".into());
    }
    let ids: Vec<String> = database
        .list()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|w| w.id)
        .collect();
    if input.workspace_ids.iter().any(|id| !ids.contains(id)) {
        return Err("请选择存在的项目。".into());
    }
    database
        .write_app_setting(
            SETTINGS_KEY,
            &serde_json::to_string(&input).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    Ok(input)
}
#[tauri::command(async)]
pub fn probe_wechat_notification_target(target: String) -> Result<DesktopResult, String> {
    let target = validate_target(&target)?;
    let _guard = DESKTOP_ACTION
        .try_lock()
        .map_err(|_| "微信通知正在处理，请稍后检查。")?;
    desktop(&target, None)
}

#[tauri::command(async)]
pub fn send_wechat_notification(
    request: NotificationRequest,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Delivery, String> {
    let _guard = DESKTOP_ACTION
        .try_lock()
        .map_err(|_| "微信通知正在处理，请稍后重试；本次未发送。")?;
    notify_with(request, &database, desktop)
}

fn notify_with(
    request: NotificationRequest,
    database: &WorkspaceDatabase,
    transport: impl FnOnce(&str, Option<&str>) -> Result<DesktopResult, String>,
) -> Result<Delivery, String> {
    crate::third_party_notifications::ensure_enabled(database)?;
    let settings = settings(&database)?;
    if !settings.enabled {
        return Err("微信通知未启用；请由用户在设置中启用。".into());
    }
    let kind = NotificationKind::parse(&request.kind)?;
    if !enabled_kind(&settings, &request.kind) {
        return Err("此类微信通知未启用。".into());
    }
    if request.event_key.is_empty() || request.event_key.len() > 500 {
        return Err("通知事件标识无效。".into());
    }
    if !settings.all_workspaces && !settings.workspace_ids.contains(&request.workspace_id) {
        return Err("此项目不在微信通知范围内。".into());
    }
    let workspace = database
        .list()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|w| w.id == request.workspace_id)
        .ok_or("项目不存在。")?;
    let terminal = if let Some(id) = &request.terminal_id {
        let terminal = workspace
            .terminals
            .iter()
            .find(|t| &t.id == id)
            .ok_or("通知终端不存在。")?;
        if terminal.agent_type == "shell"
            || terminal.account_login
            || terminal.common_action_id.is_some()
        {
            return Err("普通 Shell、常用进程及账号登录终端不发送任务微信通知。".into());
        }
        Some(terminal)
    } else {
        None
    };
    let task = request.task_title.unwrap_or_else(|| {
        terminal
            .map(|value| value.name.clone())
            .unwrap_or_else(|| "Agent 会话".into())
    });
    if task.chars().count() > 150 || task.chars().any(char::is_control) {
        return Err("任务标题无效。".into());
    }
    let id = format!("{}:{}", request.workspace_id, request.event_key);
    let mut journal = journal(&database)?;
    if journal.seen.contains(&id) {
        return journal
            .entries
            .iter()
            .find(|item| item.id == id)
            .cloned()
            .ok_or("此事件已经尝试通知，记录已归档；不会重复发送。".into());
    }
    let created_at = now();
    let body = format_notification(
        &NotificationContent {
            kind,
            project: &workspace.name,
            task: &task,
            session: terminal.map(|value| value.name.as_str()),
            agent: terminal.map(|value| value.agent_type.as_str()),
            model: terminal.map(|value| value.model.as_str()),
            branch: Some(
                terminal
                    .map(|value| value.branch.as_str())
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or(&workspace.active_branch),
            ),
        },
        created_at,
    )?;
    let mut entry = Delivery {
        id: id.clone(),
        target: settings.target.clone(),
        kind: request.kind,
        workspace_id: workspace.id,
        created_at,
        status: "pending".into(),
        detail: "已登记本次尝试；中断后不会自动重发。".into(),
    };
    let claim_key = format!(
        "wechat-notification-claim:{:x}",
        Sha256::digest(id.as_bytes())
    );
    let pending_json = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    if !database
        .claim_app_setting(&claim_key, &pending_json)
        .map_err(|e| e.to_string())?
    {
        return database
            .read_app_setting(&claim_key)
            .map_err(|e| e.to_string())?
            .and_then(|value| serde_json::from_str(&value).ok())
            .ok_or("此事件已由其他窗口尝试通知，不会重复发送。".into());
    }
    journal.seen.push(id);
    if journal.seen.len() > SEEN_LIMIT {
        journal.seen.remove(0);
    }
    journal.entries.insert(0, entry.clone());
    journal.entries.truncate(HISTORY_LIMIT);
    save_journal(&database, &journal)?;
    match transport(&settings.target, Some(&body)) {
        Ok(result) => {
            entry.status = result.status;
            entry.detail = result.detail;
        }
        Err(error) => {
            entry.status = "uncertain".into();
            entry.detail = format!("自动化进程未正常返回，结果不确定且不会自动重发：{error}");
        }
    }
    database
        .write_app_setting(
            &claim_key,
            &serde_json::to_string(&entry).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    journal.entries[0] = entry.clone();
    save_journal(&database, &journal)?;
    Ok(entry)
}

#[cfg(windows)]
fn desktop(target: &str, message: Option<&str>) -> Result<DesktopResult, String> {
    let payload = STANDARD.encode(serde_json::to_vec(&json!({"target":target,"message":message,"mode":if message.is_some(){"send"}else{"probe"}})).map_err(|e| e.to_string())?);
    let script = include_str!("desktop.ps1")
        .replace(
            "__TERMEXO_TARGET_RESOLUTION__",
            include_str!("target-resolution.ps1"),
        )
        .replace("__TERMEXO_WINDOW_ACTIVATION__", include_str!("window.ps1"))
        .replace("__TERMEXO_PAYLOAD__", &payload);
    let mut command = crate::process::hidden_command("powershell.exe");
    command.args([
        "-NoLogo",
        "-NoProfile",
        "-STA",
        "-NonInteractive",
        "-Command",
        &script,
    ]);
    let output = crate::process::run_with_timeout(&mut command, DESKTOP_TIMEOUT)
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(
            "微信桌面自动化无法运行；请检查 Windows PowerShell 和 UIAutomation 组件。".into(),
        );
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|_| "微信自动化未返回可验证的结果；不会自动重发。".into())
}
#[cfg(not(windows))]
fn desktop(_: &str, _: Option<&str>) -> Result<DesktopResult, String> {
    Err("微信桌面通知仅支持 Windows。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn selects_the_owned_search_popup_and_verifies_the_destination_before_returning() {
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/wechat/target-activation.tests.ps1");
        let output = crate::process::hidden_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(fixture)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout)
            .contains("19 target activation fixtures passed"));
    }
    #[cfg(windows)]
    #[test]
    fn restores_minimized_or_hidden_main_windows_and_rejects_ambiguous_or_blocked_windows() {
        let script = format!(
            "{}\n{}",
            include_str!("window.ps1"),
            include_str!("window.tests.ps1")
        );
        let output = crate::process::hidden_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("15 window fixtures passed"));
    }
    #[cfg(windows)]
    #[test]
    fn native_send_waits_for_readiness_and_verifies_a_new_message_without_retrying() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/wechat/delivery.tests.ps1");
        let output = crate::process::hidden_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(fixture)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("24 delivery fixtures passed"));
    }
    #[cfg(windows)]
    #[test]
    fn real_search_row_shapes_distinguish_types_duplicates_and_incomplete_results() {
        let script = format!(
            "{}\n{}",
            include_str!("target-resolution.ps1"),
            include_str!("target-resolution.tests.ps1")
        );
        let output = crate::process::hidden_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout)
            .contains("14 target classification fixtures passed"));
    }
    #[test]
    fn defaults_are_off_with_a_specific_target_and_approval_is_notification_only() {
        let settings = WechatSettings::default();
        assert!(!settings.enabled);
        assert_eq!(settings.target, "文件传输助手");
        assert!(enabled_kind(&settings, "completed"));
        assert!(enabled_kind(&settings, "error"));
        assert!(enabled_kind(&settings, "approval"));
        assert!(!enabled_kind(&settings, "input"));
        assert!(NotificationKind::parse("execute").is_err());
        assert!(validate_target("\n").is_err());
        assert!(validate_target("a\rb").is_err());
    }
    #[test]
    fn delivery_includes_record_time_and_the_associated_session_context() {
        let file = std::env::temp_dir().join(format!(
            "termexo-wechat-content-{}-{}.db",
            std::process::id(),
            now()
        ));
        let database = WorkspaceDatabase::open(file.clone()).unwrap();
        let mut workspace: crate::database::Workspace = serde_json::from_value(json!({
            "id":"w", "name":"Project", "projectPath":"D:/test", "projectType":"",
            "activeBranch":"feature/workspace", "favorite":false, "lastOpenedAt":0, "layout":"single",
            "terminals":[{"id":"t", "name":"Codex CLI 3", "workingDirectory":"D:/test",
                "shell":"pwsh", "agentType":"codex", "status":"COMPLETED", "model":"example-model", "branch":""}]
        })).unwrap();
        database.save(&workspace).unwrap();
        database
            .write_app_setting(
                SETTINGS_KEY,
                &serde_json::to_string(&WechatSettings {
                    enabled: true,
                    ..Default::default()
                })
                .unwrap(),
            )
            .unwrap();
        let request = NotificationRequest {
            workspace_id: "w".into(),
            event_key: "context-1".into(),
            kind: "completed".into(),
            terminal_id: Some("t".into()),
            task_title: Some("Build project".into()),
        };
        let result = notify_with(request.clone(), &database, |_, message| {
            let pending = &journal(&database).unwrap().entries[0];
            let expected = format_notification(
                &NotificationContent {
                    kind: NotificationKind::Completed,
                    project: "Project",
                    task: "Build project",
                    session: Some("Codex CLI 3"),
                    agent: Some("codex"),
                    model: Some("example-model"),
                    branch: Some("feature/workspace"),
                },
                pending.created_at,
            )
            .unwrap();
            assert_eq!(message.unwrap(), expected);
            Ok(DesktopResult {
                status: "submitted".into(),
                detail: "mock delivery".into(),
            })
        })
        .unwrap();
        assert_eq!(result.status, "submitted");
        workspace.terminals[0].branch = "feature/session".into();
        database.save(&workspace).unwrap();
        notify_with(
            NotificationRequest {
                event_key: "context-2".into(),
                task_title: None,
                ..request
            },
            &database,
            |_, message| {
                let message = message.unwrap();
                assert!(message.contains("任务：Codex CLI 3\n"));
                assert!(message.contains("分支：feature/session\n"));
                assert!(!message.contains("feature/workspace"));
                Ok(DesktopResult {
                    status: "submitted".into(),
                    detail: "mock delivery".into(),
                })
            },
        )
        .unwrap();
        drop(database);
        std::fs::remove_file(file).unwrap();
    }
    #[test]
    fn persists_attempts_before_delivery_and_never_retries_unknown_or_duplicate_results() {
        use std::cell::Cell;
        let file = std::env::temp_dir().join(format!(
            "termexo-wechat-test-{}-{}.db",
            std::process::id(),
            now()
        ));
        let database = WorkspaceDatabase::open(file.clone()).unwrap();
        let workspace = serde_json::from_value(json!({"id":"w", "name":"Test", "projectPath":"D:/test", "projectType":"", "activeBranch":"", "favorite":false, "lastOpenedAt":0, "layout":"single", "terminals":[]})).unwrap();
        database.save(&workspace).unwrap();
        let request = NotificationRequest {
            workspace_id: "w".into(),
            event_key: "event1".into(),
            kind: "approval".into(),
            terminal_id: None,
            task_title: Some("Build".into()),
        };
        assert!(notify_with(request.clone(), &database, |_, _| panic!(
            "disabled notifications must not interact with WeChat"
        ))
        .is_err());
        let config = WechatSettings {
            enabled: true,
            ..Default::default()
        };
        database
            .write_app_setting(SETTINGS_KEY, &serde_json::to_string(&config).unwrap())
            .unwrap();
        database
            .write_app_setting("third-party-notifications.v1", r#"{"enabled":false}"#)
            .unwrap();
        assert!(notify_with(request.clone(), &database, |_, _| panic!(
            "master pause must block delivery even with WeChat enabled"
        ))
        .is_err());
        assert!(journal(&database).unwrap().entries.is_empty());
        assert!(settings(&database).unwrap().enabled);
        database
            .write_app_setting("third-party-notifications.v1", r#"{"enabled":true}"#)
            .unwrap();
        let calls = Cell::new(0);
        let first = notify_with(request.clone(), &database, |target, message| {
            calls.set(calls.get() + 1);
            assert_eq!(target, "文件传输助手");
            assert!(message.unwrap().contains("不会批准任何操作"));
            assert_eq!(journal(&database).unwrap().entries[0].status, "pending");
            Err("timeout".into())
        })
        .unwrap();
        assert_eq!(first.status, "uncertain");
        let second = notify_with(request.clone(), &database, |_, _| {
            panic!("uncertain results must never be resent")
        })
        .unwrap();
        assert_eq!(second.id, first.id);
        assert_eq!(calls.get(), 1);
        // A second process may have an older history snapshot. The durable claim still wins.
        database
            .write_app_setting(HISTORY_KEY, r#"{"seen":[],"entries":[]}"#)
            .unwrap();
        let other = WorkspaceDatabase::open(file.clone()).unwrap();
        assert_eq!(
            notify_with(request.clone(), &other, |_, _| panic!(
                "claimed event was resent"
            ))
            .unwrap()
            .status,
            "uncertain"
        );
        drop(other);
        let scoped = WechatSettings {
            enabled: true,
            all_workspaces: false,
            workspace_ids: vec![],
            ..Default::default()
        };
        database
            .write_app_setting(SETTINGS_KEY, &serde_json::to_string(&scoped).unwrap())
            .unwrap();
        assert!(notify_with(
            NotificationRequest {
                event_key: "event2".into(),
                ..request
            },
            &database,
            |_, _| panic!("empty explicit project scope must send nothing")
        )
        .is_err());
        drop(database);
        std::fs::remove_file(file).unwrap();
    }
}
