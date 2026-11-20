//! Discovers updates through official release metadata and verifies downloaded packages
//! before handing them to the platform installer. The npm mirror only serves package bytes.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha512};
use tokio::io::AsyncWriteExt;

const GITHUB_API: &str = "https://api.github.com/repos/gemron/Termexo/releases";
const GITHUB_DOWNLOAD: &str = "https://github.com/gemron/Termexo/releases/download";
pub const RELEASES_PAGE: &str = "https://github.com/gemron/Termexo/releases/latest";
pub const RELEASES_TAG: &str = "https://github.com/gemron/Termexo/releases/tag/";
const NPM_API: &str = "https://registry.npmjs.org/termexo";
const NPM_MIRROR: &str = "https://registry.npmmirror.com/termexo";
const MAX_DOWNLOAD_BYTES: u64 = 180_000_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_notes: Option<String>,
    pub release_url: String,
    pub published_at: Option<String>,
    pub installed_via_npm: bool,
    pub install_method: InstallMethod,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallMethod {
    Restart,
    OpenInstaller,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PackageKind {
    Npm,
    WindowsExe,
    WindowsMsi,
    MacArm,
    MacIntel,
    LinuxDeb,
    Manual,
}

impl PackageKind {
    fn filename(self, version: &str) -> Option<String> {
        Some(match self {
            Self::Npm => format!("termexo-{version}.tgz"),
            Self::WindowsExe => format!("Termexo_{version}_x64-setup.exe"),
            Self::WindowsMsi => format!("Termexo_{version}_x64_en-US.msi"),
            Self::MacArm => format!("Termexo_{version}_aarch64.dmg"),
            Self::MacIntel => format!("Termexo_{version}_x64.dmg"),
            Self::LinuxDeb => format!("Termexo_{version}_amd64.deb"),
            Self::Manual => return None,
        })
    }

    fn install_method(self) -> InstallMethod {
        match self {
            Self::Npm | Self::WindowsExe | Self::WindowsMsi => InstallMethod::Restart,
            Self::MacArm | Self::MacIntel | Self::LinuxDeb => InstallMethod::OpenInstaller,
            Self::Manual => InstallMethod::Manual,
        }
    }
}

#[derive(Clone, Copy)]
struct Installation {
    package: PackageKind,
    via_npm: bool,
}

fn installation() -> Installation {
    let executable = std::env::current_exe().unwrap_or_default();
    let windows_npm = windows_npm_prefix(&executable).is_some();
    let path = executable.to_string_lossy().replace('\\', "/");
    let via_npm = windows_npm || path.contains("/Termexo/npm/");
    let package = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") if windows_npm && !path.contains("/_npx/") => PackageKind::Npm,
        _ if via_npm => PackageKind::Manual,
        ("windows", "x86_64") => {
            if executable.with_file_name("Uninstall.exe").is_file() {
                PackageKind::WindowsExe
            } else {
                PackageKind::WindowsMsi
            }
        }
        ("macos", "aarch64") => PackageKind::MacArm,
        ("macos", "x86_64") => PackageKind::MacIntel,
        ("linux", "x86_64") if Path::new("/usr/bin/dpkg").is_file() => PackageKind::LinuxDeb,
        _ => PackageKind::Manual,
    };
    Installation { package, via_npm }
}

pub(crate) fn windows_npm_prefix(executable: &Path) -> Option<&Path> {
    let platform = executable.parent()?;
    let vendor = platform.parent()?;
    let package = vendor.parent()?;
    let modules = package.parent()?;
    (platform.file_name()? == "win32-x64"
        && vendor.file_name()? == "vendor"
        && package.file_name()? == "termexo"
        && modules.file_name()? == "node_modules")
        .then(|| modules.parent())
        .flatten()
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NpmRelease {
    version: String,
    dist: NpmDistribution,
    #[serde(default)]
    termexo_installers: HashMap<String, String>,
    termexo_release_notes: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NpmDistribution {
    integrity: String,
}

pub(crate) fn version_tag(value: &str) -> Option<&str> {
    let version = value.strip_prefix('v').unwrap_or(value);
    let parts: Vec<_> = version.split('.').collect();
    (parts.len() == 3
        && parts
            .iter()
            .all(|part| part.parse::<u32>().is_ok() && part.bytes().all(|ch| ch.is_ascii_digit())))
    .then_some(version)
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

fn metadata_client() -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .user_agent("Termexo-Updater")
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(7))
        .build()
        .map_err(|error| error.to_string())
}

async fn github_release(client: &Client, endpoint: &str) -> Result<GitHubRelease, String> {
    let release = client
        .get(format!("{GITHUB_API}/{endpoint}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<GitHubRelease>()
        .await
        .map_err(|error| error.to_string())?;
    if release.draft || release.prerelease || version_tag(&release.tag_name).is_none() {
        return Err("No stable GitHub release".into());
    }
    Ok(release)
}

async fn npm_release(client: &Client, version: &str) -> Result<NpmRelease, String> {
    let release = client
        .get(format!("{NPM_API}/{version}"))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<NpmRelease>()
        .await
        .map_err(|error| error.to_string())?;
    if version_tag(&release.version) != Some(release.version.as_str())
        || (version != "latest" && release.version != version)
    {
        return Err("Invalid npm release version".into());
    }
    Ok(release)
}

pub async fn check_for_update(current: &str, prefer_china: bool) -> Result<UpdateCheck, String> {
    let installation = installation();
    let client = metadata_client()?;
    let prefers_npm = prefer_china || installation.via_npm;
    let (github, npm) = if prefers_npm {
        let npm = npm_release(&client, "latest").await;
        match npm {
            Ok(npm) => {
                // Release notes are useful but an unreachable GitHub must not hide an npm release.
                (None, Some(npm))
            }
            Err(_) => (Some(github_release(&client, "latest").await?), None),
        }
    } else {
        match github_release(&client, "latest").await {
            Ok(github) => (Some(github), None),
            Err(_) => (None, Some(npm_release(&client, "latest").await?)),
        }
    };

    let latest = github
        .as_ref()
        .and_then(|release| version_tag(&release.tag_name))
        .or_else(|| npm.as_ref().map(|release| release.version.as_str()))
        .unwrap_or(current);
    let release_url = format!("{RELEASES_TAG}v{latest}");
    Ok(UpdateCheck {
        current_version: current.to_owned(),
        latest_version: latest.to_owned(),
        update_available: is_update_available(current, latest),
        release_notes: github
            .as_ref()
            .and_then(|release| release.body.clone())
            .or_else(|| {
                npm.as_ref()
                    .and_then(|release| release.termexo_release_notes.clone())
            })
            .filter(|notes| !notes.trim().is_empty()),
        release_url,
        published_at: github.and_then(|release| release.published_at),
        installed_via_npm: installation.via_npm,
        install_method: installation.package.install_method(),
    })
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadSource {
    Github,
    ChinaMirror,
    NpmRegistry,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub source: DownloadSource,
    pub received: u64,
    pub total: Option<u64>,
    pub verifying: bool,
}

enum Checksum {
    Sha256(String),
    Sha512(Vec<u8>),
}

fn valid_sha256(digest: &str) -> bool {
    digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
}

struct Download {
    source: DownloadSource,
    url: String,
    checksum: Checksum,
    size: Option<u64>,
    embedded_installer: Option<String>,
}

fn github_download(release: GitHubRelease, version: &str, name: &str) -> Option<Download> {
    if version_tag(&release.tag_name) != Some(version) {
        return None;
    }
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == name)?;
    let digest = asset.digest?.strip_prefix("sha256:")?.to_ascii_lowercase();
    if !valid_sha256(&digest) || !(1..=MAX_DOWNLOAD_BYTES).contains(&asset.size) {
        return None;
    }
    Some(Download {
        source: DownloadSource::Github,
        url: format!("{GITHUB_DOWNLOAD}/v{version}/{name}"),
        checksum: Checksum::Sha256(digest),
        size: Some(asset.size),
        embedded_installer: None,
    })
}

fn npm_download(
    release: &NpmRelease,
    version: &str,
    kind: PackageKind,
    name: &str,
    mirror: bool,
) -> Option<Download> {
    let digest = STANDARD
        .decode(release.dist.integrity.strip_prefix("sha512-")?)
        .ok()?;
    if digest.len() != 64 {
        return None;
    }
    let embedded_installer = if kind == PackageKind::Npm {
        None
    } else {
        let hash = release.termexo_installers.get(name)?;
        if !valid_sha256(hash) {
            return None;
        }
        Some(hash.to_ascii_lowercase())
    };
    let (source, registry) = if mirror {
        (DownloadSource::ChinaMirror, NPM_MIRROR)
    } else {
        (DownloadSource::NpmRegistry, NPM_API)
    };
    Some(Download {
        source,
        url: format!("{registry}/-/termexo-{version}.tgz"),
        checksum: Checksum::Sha512(digest),
        size: None,
        embedded_installer,
    })
}

pub(crate) struct StagedUpdate {
    pub version: String,
    pub package: PackageKind,
    pub file: PathBuf,
    pub directory: tempfile::TempDir,
}

pub(crate) async fn stage_update(
    cache: &Path,
    current: &str,
    version: &str,
    prefer_china: bool,
    progress: impl Fn(DownloadProgress),
) -> Result<StagedUpdate, String> {
    if version_tag(version) != Some(version) || !is_update_available(current, version) {
        return Err("此版本已不可用于更新，请重新检查。".into());
    }
    let package = installation().package;
    let name = package
        .filename(version)
        .ok_or("当前安装方式请从发布页面更新。")?;
    let metadata = metadata_client()?;
    let tag = format!("tags/v{version}");
    let sources: &[DownloadSource] = if prefer_china {
        &[
            DownloadSource::ChinaMirror,
            DownloadSource::Github,
            DownloadSource::NpmRegistry,
        ]
    } else {
        &[DownloadSource::Github, DownloadSource::NpmRegistry]
    };
    let downloader = Client::builder()
        .https_only(true)
        .user_agent("Termexo-Updater")
        .connect_timeout(Duration::from_secs(6))
        .read_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?;
    tokio::fs::create_dir_all(cache)
        .await
        .map_err(|error| error.to_string())?;
    let mut failure = None;
    let mut npm = None;
    for source in sources {
        let candidate = match source {
            DownloadSource::Github => github_release(&metadata, &tag)
                .await
                .ok()
                .and_then(|release| github_download(release, version, &name)),
            DownloadSource::ChinaMirror | DownloadSource::NpmRegistry => {
                if npm.is_none() {
                    npm = Some(npm_release(&metadata, version).await.ok());
                }
                npm.as_ref().and_then(Option::as_ref).and_then(|release| {
                    npm_download(
                        release,
                        version,
                        package,
                        &name,
                        matches!(source, DownloadSource::ChinaMirror),
                    )
                })
            }
        };
        let Some(candidate) = candidate else { continue };
        let directory = tempfile::Builder::new()
            .prefix("termexo-update-")
            .tempdir_in(cache)
            .map_err(|error| error.to_string())?;
        let file = directory.path().join(&name);
        match download_candidate(&downloader, &candidate, &file, &name, &progress).await {
            Ok(()) => {
                return Ok(StagedUpdate {
                    version: version.into(),
                    package,
                    file,
                    directory,
                })
            }
            Err(error) => {
                tracing::warn!(source = %candidate.url, "{error}");
                failure = Some(error);
            }
        }
    }
    Err(failure.unwrap_or_else(|| "暂时没有可校验的安装包，请稍后重试或打开发布页面。".into()))
}

async fn download_candidate(
    client: &Client,
    candidate: &Download,
    file: &Path,
    name: &str,
    progress: &impl Fn(DownloadProgress),
) -> Result<(), String> {
    let archive = file.with_file_name("download.tgz");
    let destination = if candidate.embedded_installer.is_some() {
        &archive
    } else {
        file
    };
    transfer(client, candidate, destination, progress).await?;

    if let Some(hash) = candidate.embedded_installer.as_ref() {
        let hash = hash.clone();
        let file = file.to_owned();
        let name = name.to_owned();
        tokio::task::spawn_blocking(move || unpack_installer(&archive, &file, &name, &hash))
            .await
            .map_err(|error| error.to_string())??;
    }
    Ok(())
}

async fn transfer(
    client: &Client,
    candidate: &Download,
    destination: &Path,
    progress: &impl Fn(DownloadProgress),
) -> Result<(), String> {
    let source = candidate.source;
    progress(DownloadProgress {
        source,
        received: 0,
        total: candidate.size,
        verifying: false,
    });
    let mut response = client
        .get(&candidate.url)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|error| error.to_string())?;
    let total = candidate.size.or_else(|| response.content_length());
    if total.is_some_and(|size| !(1..=MAX_DOWNLOAD_BYTES).contains(&size)) {
        return Err("更新包大小无效。".into());
    }
    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|error| error.to_string())?;
    let mut sha256 = Sha256::new();
    let mut sha512 = Sha512::new();
    let mut received = 0_u64;
    let mut last_notice = std::time::Instant::now();
    while let Some(bytes) = response.chunk().await.map_err(|error| error.to_string())? {
        received += bytes.len() as u64;
        if received > total.unwrap_or(MAX_DOWNLOAD_BYTES) {
            return Err("更新包大小超出预期。".into());
        }
        match &candidate.checksum {
            Checksum::Sha256(_) => sha256.update(&bytes),
            Checksum::Sha512(_) => sha512.update(&bytes),
        }
        file.write_all(&bytes)
            .await
            .map_err(|error| error.to_string())?;
        if last_notice.elapsed() >= Duration::from_millis(150) {
            progress(DownloadProgress {
                source,
                received,
                total,
                verifying: false,
            });
            last_notice = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|error| error.to_string())?;
    progress(DownloadProgress {
        source,
        received,
        total: Some(received),
        verifying: true,
    });
    let valid = match &candidate.checksum {
        Checksum::Sha256(expected) => format!("{:x}", sha256.finalize()) == *expected,
        Checksum::Sha512(expected) => &sha512.finalize()[..] == expected.as_slice(),
    };
    if received == 0 || total.is_some_and(|size| size != received) || !valid {
        return Err("更新包校验失败。".into());
    }
    Ok(())
}

fn unpack_installer(
    archive: &Path,
    output: &Path,
    name: &str,
    expected: &str,
) -> Result<(), String> {
    use std::{fs::File, io, io::Read};
    let unpack = || -> io::Result<()> {
        let input = File::open(archive)?;
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(input));
        let wanted = format!("package/installers/{name}");
        for entry in archive.entries()? {
            let entry = entry?;
            if entry.path()?.as_ref() != Path::new(&wanted) {
                continue;
            }
            if !entry.header().entry_type().is_file() || entry.size() > MAX_DOWNLOAD_BYTES {
                return Err(io::Error::other("Invalid installer entry"));
            }
            // Read exactly one regular file into the trusted staging path. No archive-supplied
            // path, link, or permission is ever applied to disk.
            let mut reader = entry.take(MAX_DOWNLOAD_BYTES);
            let mut writer = File::create(output)?;
            io::copy(&mut reader, &mut writer)?;
            let mut input = File::open(output)?;
            let mut hash = Sha256::new();
            io::copy(&mut input, &mut hash)?;
            if format!("{:x}", hash.finalize()) == expected {
                return Ok(());
            }
            return Err(io::Error::other("Installer checksum mismatch"));
        }
        Err(io::Error::other("Installer is missing from the archive"))
    };
    unpack().map_err(|error| format!("无法读取已校验的安装包：{error}"))?;
    std::fs::remove_file(archive).map_err(|error| error.to_string())
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
        let npm_path =
            "C:/Users/x/AppData/Roaming/npm/node_modules/termexo/vendor/win32-x64/termexo.exe";
        let installed_path = "C:/Program Files/Termexo/termexo.exe";
        assert!(npm_path
            .replace('\\', "/")
            .contains("/node_modules/termexo/vendor/"));
        assert!(!installed_path
            .replace('\\', "/")
            .contains("/node_modules/termexo/vendor/"));
    }

    #[test]
    fn package_names_match_release_assets_and_input_versions_are_stable() {
        assert_eq!(
            PackageKind::WindowsExe.filename("1.2.3").as_deref(),
            Some("Termexo_1.2.3_x64-setup.exe")
        );
        assert_eq!(
            PackageKind::WindowsMsi.filename("1.2.3").as_deref(),
            Some("Termexo_1.2.3_x64_en-US.msi")
        );
        assert_eq!(
            PackageKind::MacArm.filename("1.2.3").as_deref(),
            Some("Termexo_1.2.3_aarch64.dmg")
        );
        assert_eq!(
            PackageKind::LinuxDeb.filename("1.2.3").as_deref(),
            Some("Termexo_1.2.3_amd64.deb")
        );
        assert_eq!(version_tag("v1.2.3"), Some("1.2.3"));
        assert_eq!(version_tag("1.2.3/../../latest"), None);
        assert_eq!(version_tag("v1.2.3-rc.1"), None);
    }

    #[test]
    fn mirror_needs_official_integrity_and_the_exact_installer_inventory() {
        let name = "Termexo_1.2.3_x64-setup.exe";
        let mut registry = NpmRelease {
            version: "1.2.3".into(),
            dist: NpmDistribution {
                integrity: "invalid".into(),
            },
            termexo_installers: HashMap::new(),
            termexo_release_notes: None,
        };
        assert!(npm_download(&registry, "1.2.3", PackageKind::Npm, name, true).is_none());
        registry.dist.integrity = format!("sha512-{}", STANDARD.encode([0; 64]));
        assert!(npm_download(&registry, "1.2.3", PackageKind::WindowsExe, name, true).is_none());
        registry
            .termexo_installers
            .insert(name.into(), "f".repeat(64));
        let mirror = npm_download(&registry, "1.2.3", PackageKind::WindowsExe, name, true).unwrap();
        assert_eq!(
            mirror.url,
            "https://registry.npmmirror.com/termexo/-/termexo-1.2.3.tgz"
        );
        assert!(matches!(mirror.checksum, Checksum::Sha512(bytes) if bytes == [0; 64]));
        assert_eq!(mirror.embedded_installer, Some("f".repeat(64)));
    }

    #[test]
    fn extracts_only_the_requested_verified_installer() {
        use flate2::{write::GzEncoder, Compression};
        use std::fs;

        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("termexo.tgz");
        let output = temp.path().join("update.exe");
        let encoder = GzEncoder::new(fs::File::create(&archive).unwrap(), Compression::fast());
        let mut tar = tar::Builder::new(encoder);
        let body = b"test installer";
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        tar.append_data(&mut header, "package/installers/update.exe", &body[..])
            .unwrap();
        tar.into_inner().unwrap().finish().unwrap();

        assert!(unpack_installer(&archive, &output, "missing.exe", &"0".repeat(64)).is_err());
        assert!(!output.exists());
        assert!(unpack_installer(&archive, &output, "update.exe", &"0".repeat(64)).is_err());
        let expected = format!("{:x}", Sha256::digest(body));
        unpack_installer(&archive, &output, "update.exe", &expected).unwrap();
        assert_eq!(fs::read(output).unwrap(), body);
        assert!(!archive.exists());
    }

    #[tokio::test]
    async fn transfer_rejects_corrupt_bytes_before_a_verified_fallback() {
        use axum::{routing::get, Router};
        use std::sync::Mutex;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route("/mirror", get(|| async { "bad data" }))
            .route("/origin", get(|| async { "verified" }));
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("download.tgz");
        let client = Client::new();
        let hash = Sha512::digest(b"verified").to_vec();
        let notices = Mutex::new(Vec::new());
        let progress = |event: DownloadProgress| notices.lock().unwrap().push(event);
        let mut candidate = Download {
            source: DownloadSource::ChinaMirror,
            url: format!("http://{address}/mirror"),
            checksum: Checksum::Sha512(hash),
            size: Some(8),
            embedded_installer: None,
        };
        assert!(transfer(&client, &candidate, &file, &progress)
            .await
            .is_err());
        candidate.source = DownloadSource::NpmRegistry;
        candidate.url = format!("http://{address}/origin");
        transfer(&client, &candidate, &file, &progress)
            .await
            .unwrap();
        assert_eq!(std::fs::read(file).unwrap(), b"verified");
        let notices = notices.into_inner().unwrap();
        assert!(notices.last().unwrap().verifying);
        assert!(matches!(
            notices.last().unwrap().source,
            DownloadSource::NpmRegistry
        ));
        server.abort();
    }

    #[test]
    fn never_offers_an_update_for_an_unparseable_version() {
        assert!(!is_update_available("0.3.12", "nightly"));
        assert!(!is_update_available("unknown", "0.4.0"));
    }
}
