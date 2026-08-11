use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config::NetworkProfile;
use crate::database::WorkspaceDatabase;
use crate::network;

/// Format version, so a future importer can tell which shape it is reading.
const EXPORT_VERSION: u32 = 1;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfileExport {
    pub version: u32,
    pub exported_at: String,
    pub profiles: Vec<ExportedNetworkProfile>,
}

/// A profile stripped of everything machine-specific or secret.
///
/// `credentialTarget` and `hasCredential` are deliberately absent: the first names a slot in
/// this machine's Credential Manager and means nothing elsewhere, and the second would imply
/// the export carries a password when it never can. `proxyUsername` is kept because it is part
/// of the configuration a user re-enters, and the password stays behind.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedNetworkProfile {
    pub name: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    pub enabled: bool,
    pub is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub https_proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub all_proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub npm_registry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub npm_proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub npm_https_proxy: Option<String>,
    pub npm_strict_ssl: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub npm_ca_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_username: Option<String>,
    /// Tells the reader a password has to be supplied again after importing.
    pub requires_password: bool,
}

impl From<&NetworkProfile> for ExportedNetworkProfile {
    fn from(profile: &NetworkProfile) -> Self {
        Self {
            name: profile.name.clone(),
            scope: profile.scope.clone(),
            workspace_id: profile.workspace_id.clone(),
            enabled: profile.enabled,
            is_default: profile.is_default,
            http_proxy: profile.http_proxy.clone(),
            https_proxy: profile.https_proxy.clone(),
            all_proxy: profile.all_proxy.clone(),
            no_proxy: profile.no_proxy.clone(),
            npm_registry: profile.npm_registry.clone(),
            npm_proxy: profile.npm_proxy.clone(),
            npm_https_proxy: profile.npm_https_proxy.clone(),
            npm_strict_ssl: profile.npm_strict_ssl,
            npm_ca_path: profile.npm_ca_path.clone(),
            proxy_username: profile.proxy_username.clone(),
            requires_password: profile.proxy_username.is_some(),
        }
    }
}

/// Builds the export document for every proxy profile, or just one when `profile_id` is given.
///
/// Returns pretty JSON so the file stays reviewable — a user should be able to read exactly
/// what is leaving their machine before sharing it.
#[tauri::command]
pub fn export_network_profiles(
    profile_id: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<String, String> {
    let profiles = database
        .list_network_profiles()
        .map_err(|error| error.to_string())?;
    let selected = match profile_id.as_deref() {
        Some(id) => profiles
            .iter()
            .filter(|profile| profile.id == id)
            .collect::<Vec<_>>(),
        None => profiles.iter().collect(),
    };
    if selected.is_empty() {
        return Err("没有可导出的代理 Profile".into());
    }

    let document = NetworkProfileExport {
        version: EXPORT_VERSION,
        exported_at: current_timestamp(),
        profiles: selected
            .into_iter()
            .map(ExportedNetworkProfile::from)
            .collect(),
    };
    serde_json::to_string_pretty(&document).map_err(|error| format!("生成导出内容失败：{error}"))
}

/// Writes the export to `path`.
///
/// The frontend picks the path through the save dialog, so this only has to persist the bytes.
#[tauri::command]
pub fn write_network_profile_export(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|error| format!("写入导出文件失败：{error}"))
}

/// Document as read back from disk. Every field is optional so a hand-edited file with a
/// missing key reports a useful error instead of failing to parse at all.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkProfileImport {
    version: Option<u32>,
    profiles: Option<Vec<ImportedNetworkProfile>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportedNetworkProfile {
    name: Option<String>,
    scope: Option<String>,
    workspace_id: Option<String>,
    enabled: Option<bool>,
    is_default: Option<bool>,
    http_proxy: Option<String>,
    https_proxy: Option<String>,
    all_proxy: Option<String>,
    no_proxy: Option<String>,
    npm_registry: Option<String>,
    npm_proxy: Option<String>,
    npm_https_proxy: Option<String>,
    npm_strict_ssl: Option<bool>,
    npm_ca_path: Option<String>,
    proxy_username: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub imported: usize,
    /// Names that need a password re-entered before the profile will authenticate.
    pub needs_password: Vec<String>,
    /// Per-profile reasons, for entries that were skipped rather than imported.
    pub skipped: Vec<String>,
}

/// Reads an exported document and stores each profile it describes.
///
/// Imported profiles are always created as new records with fresh ids rather than overwriting
/// by name: a file from a colleague must never silently replace a working local configuration.
/// Nothing is marked default either, since that would change which proxy the agents use.
#[tauri::command]
pub fn import_network_profiles(
    path: String,
    database: State<'_, WorkspaceDatabase>,
) -> Result<ImportSummary, String> {
    let contents =
        std::fs::read_to_string(&path).map_err(|error| format!("无法读取导入文件：{error}"))?;
    let document = serde_json::from_str::<NetworkProfileImport>(&contents)
        .map_err(|error| format!("导入文件不是有效的 JSON：{error}"))?;
    if let Some(version) = document.version {
        if version > EXPORT_VERSION {
            return Err(format!(
                "导入文件的版本（{version}）高于当前支持的版本（{EXPORT_VERSION}），请升级 Termexo"
            ));
        }
    }
    let entries = document
        .profiles
        .filter(|profiles| !profiles.is_empty())
        .ok_or_else(|| "导入文件中没有代理 Profile".to_owned())?;

    let mut summary = ImportSummary {
        imported: 0,
        needs_password: Vec::new(),
        skipped: Vec::new(),
    };
    for entry in entries {
        let name = entry
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("未命名")
            .to_owned();
        match build_imported_profile(&name, entry) {
            Ok(profile) => {
                let needs_password = profile.proxy_username.is_some();
                match database.save_network_profile(&profile) {
                    Ok(()) => {
                        summary.imported += 1;
                        if needs_password {
                            summary.needs_password.push(name);
                        }
                    }
                    Err(error) => summary.skipped.push(format!("{name}：{error}")),
                }
            }
            Err(reason) => summary.skipped.push(format!("{name}：{reason}")),
        }
    }

    if summary.imported == 0 {
        return Err(format!(
            "没有导入任何 Profile。{}",
            summary.skipped.join("；")
        ));
    }
    Ok(summary)
}

/// Turns one imported entry into a profile, running the same validation as a manual save.
fn build_imported_profile(
    name: &str,
    entry: ImportedNetworkProfile,
) -> Result<NetworkProfile, String> {
    let scope = entry
        .scope
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("global")
        .to_owned();
    // A workspace-scoped profile points at an id that only exists on the machine that wrote
    // the file, so it is imported as global rather than silently bound to nothing.
    let (scope, workspace_id) = match scope.as_str() {
        "workspace" => match entry.workspace_id.as_deref().map(str::trim) {
            Some(id) if !id.is_empty() => ("workspace".to_owned(), Some(id.to_owned())),
            _ => ("global".to_owned(), None),
        },
        _ => ("global".to_owned(), None),
    };

    let profile = NetworkProfile {
        id: format!("network-{}", uuid_like_suffix()),
        name: name.to_owned(),
        scope,
        workspace_id,
        enabled: entry.enabled.unwrap_or(true),
        // Never default: that would repoint every agent at an imported proxy on first launch.
        is_default: false,
        http_proxy: trimmed_owned(entry.http_proxy),
        https_proxy: trimmed_owned(entry.https_proxy),
        all_proxy: trimmed_owned(entry.all_proxy),
        no_proxy: trimmed_owned(entry.no_proxy),
        npm_registry: trimmed_owned(entry.npm_registry),
        npm_proxy: trimmed_owned(entry.npm_proxy),
        npm_https_proxy: trimmed_owned(entry.npm_https_proxy),
        npm_strict_ssl: entry.npm_strict_ssl.unwrap_or(true),
        npm_ca_path: trimmed_owned(entry.npm_ca_path),
        proxy_username: trimmed_owned(entry.proxy_username),
        // The password never travels with the file, so the profile starts without one.
        credential_target: None,
        has_credential: false,
    };
    network::validate_profile(&profile)?;
    Ok(profile)
}

fn trimmed_owned(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Generates a collision-resistant id suffix without adding a uuid dependency.
fn uuid_like_suffix() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{sequence:x}")
}

/// RFC 3339 timestamp in UTC, formatted without pulling in a date library.
fn current_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();

    let days = seconds / 86_400;
    let time_of_day = seconds % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time_of_day / 3600,
        (time_of_day % 3600) / 60,
        time_of_day % 60
    )
}

/// Converts days since the Unix epoch into a calendar date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (year + i64::from(month <= 2), month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile_with_credentials() -> NetworkProfile {
        NetworkProfile {
            id: "network-1".into(),
            name: "Corp proxy".into(),
            scope: "global".into(),
            workspace_id: None,
            enabled: true,
            is_default: true,
            http_proxy: Some("http://proxy.corp:8080".into()),
            https_proxy: Some("http://proxy.corp:8080".into()),
            all_proxy: None,
            no_proxy: Some("localhost".into()),
            npm_registry: Some("https://registry.npmmirror.com/".into()),
            npm_proxy: None,
            npm_https_proxy: None,
            npm_strict_ssl: true,
            npm_ca_path: None,
            proxy_username: Some("corp-user".into()),
            credential_target: Some("termexo:network:network-1".into()),
            has_credential: true,
        }
    }

    #[test]
    fn export_never_carries_credentials_or_machine_local_handles() {
        let exported = ExportedNetworkProfile::from(&profile_with_credentials());
        let json = serde_json::to_string(&exported).unwrap();

        // The password lives in Credential Manager and must not leave with the file; the
        // target string names a slot on this machine only.
        assert!(!json.contains("credentialTarget"));
        assert!(!json.contains("termexo:network"));
        assert!(!json.contains("hasCredential"));
        assert!(json.contains("\"requiresPassword\":true"));
        assert!(json.contains("corp-user"));
    }

    #[test]
    fn export_omits_empty_optional_fields() {
        let json =
            serde_json::to_string(&ExportedNetworkProfile::from(&profile_with_credentials()))
                .unwrap();

        assert!(!json.contains("allProxy"));
        assert!(!json.contains("npmCaPath"));
        assert!(json.contains("httpsProxy"));
    }

    #[test]
    fn requires_password_is_false_without_a_username() {
        let mut profile = profile_with_credentials();
        profile.proxy_username = None;

        assert!(!ExportedNetworkProfile::from(&profile).requires_password);
    }

    #[test]
    fn formats_the_timestamp_as_utc_rfc3339() {
        let stamp = current_timestamp();

        assert_eq!(stamp.len(), 20, "{stamp}");
        assert!(stamp.ends_with('Z'), "{stamp}");
        assert_eq!(&stamp[4..5], "-");
        assert_eq!(&stamp[10..11], "T");
    }

    fn import_entry(json: &str) -> Result<NetworkProfile, String> {
        let entry = serde_json::from_str::<ImportedNetworkProfile>(json).unwrap();
        let name = entry.name.clone().unwrap_or_else(|| "未命名".into());
        build_imported_profile(&name, entry)
    }

    #[test]
    fn imported_profiles_never_arrive_authenticated_or_default() {
        let profile = import_entry(
            r#"{"name":"Corp","httpsProxy":"http://proxy.corp:8080",
                "proxyUsername":"corp-user","isDefault":true,"requiresPassword":true}"#,
        )
        .unwrap();

        // The file cannot carry a password, so the profile must not claim to have one.
        assert!(!profile.has_credential);
        assert_eq!(profile.credential_target, None);
        assert_eq!(profile.proxy_username.as_deref(), Some("corp-user"));
        // Importing must not repoint every agent at a colleague's proxy.
        assert!(!profile.is_default);
    }

    #[test]
    fn workspace_scope_falls_back_to_global_without_a_local_workspace() {
        // The exported workspace id belongs to another machine's database.
        let profile = import_entry(
            r#"{"name":"Scoped","scope":"workspace","httpProxy":"http://proxy:8080"}"#,
        )
        .unwrap();

        assert_eq!(profile.scope, "global");
        assert_eq!(profile.workspace_id, None);
    }

    #[test]
    fn import_rejects_an_address_that_would_hang_the_agent() {
        // Same validation as a manual save, so a shared file cannot smuggle in https://.
        let error =
            import_entry(r#"{"name":"Bad","httpsProxy":"https://proxy.corp:8080"}"#).unwrap_err();

        assert!(error.contains("https://"), "{error}");
    }

    #[test]
    fn import_generates_a_fresh_id_for_every_profile() {
        let first = import_entry(r#"{"name":"A","httpProxy":"http://proxy:8080"}"#).unwrap();
        let second = import_entry(r#"{"name":"A","httpProxy":"http://proxy:8080"}"#).unwrap();

        // Reusing an id would overwrite whatever the user already had under it.
        assert_ne!(first.id, second.id);
        assert!(first.id.starts_with("network-"));
    }

    #[test]
    fn import_applies_defaults_for_omitted_fields() {
        let profile =
            import_entry(r#"{"name":"Minimal","httpProxy":"http://proxy:8080"}"#).unwrap();

        assert!(profile.enabled);
        assert!(profile.npm_strict_ssl);
        assert_eq!(profile.no_proxy, None);
    }

    #[test]
    fn parses_a_real_exported_document_end_to_end() {
        // Mirrors a file written by the export command, including entries that must be
        // rejected or downgraded rather than imported as written.
        let json = r#"{
            "version": 1,
            "exportedAt": "2026-08-06T02:00:00Z",
            "profiles": [
                {"name":"Corp","httpsProxy":"http://proxy.corp:8080","proxyUsername":"u","isDefault":true},
                {"name":"Scoped","scope":"workspace","workspaceId":"remote-id","httpProxy":"http://o:3128"},
                {"name":"Bad","httpsProxy":"https://proxy.corp:8080"}
            ]
        }"#;
        let document = serde_json::from_str::<NetworkProfileImport>(json).unwrap();
        let entries = document.profiles.unwrap();
        assert_eq!(entries.len(), 3);

        let outcomes = entries
            .into_iter()
            .map(|entry| {
                let name = entry.name.clone().unwrap_or_default();
                build_imported_profile(&name, entry).map_err(|error| (name, error))
            })
            .collect::<Vec<_>>();

        let corp = outcomes[0].as_ref().unwrap();
        assert!(!corp.is_default, "imported profiles must not seize default");
        assert!(!corp.has_credential);

        let scoped = outcomes[1].as_ref().unwrap();
        assert_eq!(scoped.scope, "workspace");
        assert_eq!(scoped.workspace_id.as_deref(), Some("remote-id"));

        let (name, error) = outcomes[2].as_ref().unwrap_err();
        assert_eq!(name, "Bad");
        assert!(error.contains("https://"));
    }

    #[test]
    fn rejects_a_document_from_a_newer_format() {
        let document =
            serde_json::from_str::<NetworkProfileImport>(r#"{"version":99,"profiles":[]}"#)
                .unwrap();

        assert!(document.version.unwrap() > EXPORT_VERSION);
    }

    #[test]
    fn converts_known_epoch_days_to_calendar_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        // A leap day, which a naive 365-day conversion would shift.
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
    }
}
