//! Release update checks against the public GitHub Releases API.
//!
//! Termexo ships through three channels (GitHub Releases, npm, and the MSI/NSIS installers),
//! and none of them can replace a running executable in place. So this module only *reports*
//! what the latest published release is; downloading and installing stays the user's decision,
//! which also keeps the check free of any signing-key infrastructure.

use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Latest-release endpoint. Unauthenticated requests are rate limited per IP, which is ample
/// for one check per launch.
const LATEST_RELEASE_API: &str = "https://api.github.com/repos/gemron/Termexo/releases/latest";
pub const RELEASES_PAGE: &str = "https://github.com/gemron/Termexo/releases/latest";

/// GitHub requires a User-Agent on every API request and rejects the ones it does not like.
const USER_AGENT: &str = "Termexo-Updater";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// npm package that ships the desktop executable.
pub const NPM_PACKAGE: &str = "termexo";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_notes: Option<String>,
    pub release_url: String,
    pub published_at: Option<String>,
    /// True when this build runs out of a global npm install, where `npm install -g` updates it.
    pub installed_via_npm: bool,
}

/// Reports whether the running executable came from a global npm install.
///
/// The npm wrapper stores the binary under `node_modules/termexo/vendor/<platform>/`, a layout
/// no installer produces, so the path is what distinguishes the two distribution channels.
pub fn is_npm_installation() -> bool {
    let Ok(executable) = std::env::current_exe() else {
        return false;
    };
    let path = executable.to_string_lossy().replace('\\', "/");
    path.contains("/node_modules/termexo/vendor/")
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    html_url: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// A release version, compared numerically so `0.3.10` sorts above `0.3.9`.
///
/// A plain string comparison would call `0.3.9` the newer release and never offer the upgrade.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Version(Vec<u32>);

impl Version {
    /// Parses `v0.3.12` or `0.3.12`, ignoring any suffix such as `-beta.1`.
    fn parse(value: &str) -> Option<Self> {
        let trimmed = value.trim().trim_start_matches(['v', 'V']);
        let core = trimmed
            .split(['-', '+'])
            .next()
            .filter(|part| !part.is_empty())?;
        let parts = core
            .split('.')
            .map(|part| part.parse::<u32>().ok())
            .collect::<Option<Vec<_>>>()?;
        (!parts.is_empty()).then_some(Self(parts))
    }

    /// Compares against `other` with missing trailing components treated as zero, so `0.4`
    /// and `0.4.0` are the same release.
    fn is_newer_than(&self, other: &Self) -> bool {
        let length = self.0.len().max(other.0.len());
        for index in 0..length {
            let left = self.0.get(index).copied().unwrap_or(0);
            let right = other.0.get(index).copied().unwrap_or(0);
            if left != right {
                return left > right;
            }
        }
        false
    }
}

/// Reports whether `latest` supersedes `current`.
///
/// An unparseable version means no update is offered: a bad tag must never push the user
/// toward a download they do not need.
fn is_update_available(current: &str, latest: &str) -> bool {
    match (Version::parse(current), Version::parse(latest)) {
        (Some(current), Some(latest)) => latest.is_newer_than(&current),
        _ => false,
    }
}

/// Fetches the latest published release from GitHub.
pub async fn check_for_update(current_version: &str) -> Result<UpdateCheck, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("无法创建更新检查请求：{error}"))?;

    let response = client
        .get(LATEST_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("检查更新失败，请确认网络连接：{error}"))?;

    if !response.status().is_success() {
        return Err(format!("检查更新失败：GitHub 返回 {}", response.status()));
    }

    let release = response
        .json::<GitHubRelease>()
        .await
        .map_err(|error| format!("解析更新信息失败：{error}"))?;

    // The "latest" endpoint already excludes drafts and prereleases, but a repository that
    // publishes one later must not push it to everyone.
    if release.draft || release.prerelease {
        return Ok(UpdateCheck {
            current_version: current_version.to_owned(),
            latest_version: current_version.to_owned(),
            update_available: false,
            release_notes: None,
            release_url: RELEASES_PAGE.to_owned(),
            published_at: None,
            installed_via_npm: is_npm_installation(),
        });
    }

    let latest_version = release.tag_name.trim_start_matches(['v', 'V']).to_owned();
    Ok(UpdateCheck {
        update_available: is_update_available(current_version, &latest_version),
        current_version: current_version.to_owned(),
        latest_version,
        release_notes: release.body.filter(|notes| !notes.trim().is_empty()),
        release_url: release.html_url.unwrap_or_else(|| RELEASES_PAGE.to_owned()),
        published_at: release.published_at,
        installed_via_npm: is_npm_installation(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions_with_and_without_prefixes() {
        assert_eq!(Version::parse("v0.3.12"), Some(Version(vec![0, 3, 12])));
        assert_eq!(Version::parse("0.3.12"), Some(Version(vec![0, 3, 12])));
        assert_eq!(Version::parse("0.4.0-beta.1"), Some(Version(vec![0, 4, 0])));
        assert_eq!(Version::parse("not-a-version"), None);
        assert_eq!(Version::parse(""), None);
    }

    #[test]
    fn compares_release_versions_numerically() {
        // A string comparison would rank 0.3.9 above 0.3.10 and hide the update.
        assert!(is_update_available("0.3.9", "0.3.10"));
        assert!(is_update_available("0.3.12", "0.4.0"));
        assert!(is_update_available("0.3.12", "1.0.0"));
        assert!(!is_update_available("0.3.12", "0.3.12"));
        assert!(!is_update_available("0.3.12", "0.3.11"));
        assert!(!is_update_available("1.0.0", "0.9.9"));
    }

    #[test]
    fn treats_missing_components_as_zero() {
        assert!(!is_update_available("0.4.0", "0.4"));
        assert!(is_update_available("0.4", "0.4.1"));
    }

    #[test]
    fn recognizes_only_the_npm_wrapper_layout() {
        // The check runs on the real current_exe, so this pins the path shape it looks for.
        let npm_path = "C:/Users/x/AppData/Roaming/npm/node_modules/termexo/vendor/win32-x64/termexo.exe";
        let installed_path = "C:/Program Files/Termexo/termexo.exe";
        assert!(npm_path.replace('\\', "/").contains("/node_modules/termexo/vendor/"));
        assert!(!installed_path
            .replace('\\', "/")
            .contains("/node_modules/termexo/vendor/"));
    }

    #[test]
    fn never_offers_an_update_for_an_unparseable_version() {
        assert!(!is_update_available("0.3.12", "nightly"));
        assert!(!is_update_available("unknown", "0.4.0"));
    }
}
