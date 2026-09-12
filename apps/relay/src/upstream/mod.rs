//! This relay as a device of another relay: the outbound tunnel, the announcements it makes, and
//! the addresses the chain above it contributes.
//!
//! Cascading needs no second protocol. A relay joins an upstream through the very same `/tunnel`
//! a desktop app uses, declares `kind = relay` in its `hello`, and from then on announces the
//! devices it can reach. The upstream opens streams on that link exactly as it would on a desktop's
//! — this end simply carries each one to the device it names instead of serving it.

mod addresses;
mod enroll;
mod forward;
mod pinning;
mod session;
mod settings;

use std::str::FromStr;
use std::sync::{Mutex, MutexGuard, RwLock, RwLockReadGuard};
use std::time::Duration;

use serde::Serialize;
use termexo_relay_protocol::frames::{ControlFrame, RelayAddress};
use termexo_relay_protocol::tunnel::Backoff;
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use addresses::UpstreamReach;
use session::{SessionEnd, SessionOutcome};

pub use pinning::normalize_fingerprint;
pub use settings::UpstreamSettings;

use crate::audit::{self, action, target, AuditEntry};
use crate::config::{LinkArgs, PublicUrl};
use crate::db::{Database, SETTING_PUBLIC_URL};
use crate::registry::Route;
use crate::state::{RelayState, SharedState};

/// Upper bound on waiting for a link to wind down, so a stuck session cannot hang a console
/// request that is only trying to drop the upstream.
const SHUTDOWN_WAIT: Duration = Duration::from_secs(5);

/// What this relay calls itself upstream when it has no public address of its own yet.
const DEFAULT_LINK_NAME: &str = "termexo-relay";

const NO_UPSTREAM: &str = "本中继没有配置上游。";
const REVOKED_MESSAGE: &str = "上游中继已撤销本中继的接入，配置已清除。";

/// What the console's relay page shows about the upstream link.
///
/// There is no state for "not configured": the API answers `null` for that, and the console shows
/// its join form. Every state here belongs to a link that exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UpstreamState {
    Connecting,
    Connected,
    /// The last attempt failed; `error` says why. The link may still be retrying.
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamView {
    pub url: String,
    pub state: UpstreamState,
    /// The upstream's own id, once a handshake got far enough to learn it.
    pub relay_id: Option<String>,
    /// The upstream's id followed by everything above it, for the console's chain column.
    pub chain: Vec<String>,
    /// Why the last attempt failed, in Chinese.
    pub error: Option<String>,
}

/// The part of the view that does not come from the chain itself.
#[derive(Debug, Clone)]
struct LinkStatus {
    url: String,
    state: UpstreamState,
    relay_id: Option<String>,
    error: Option<String>,
}

struct RunningLink {
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

/// One outbound link to an upstream relay, plus everything that link contributes to this relay.
///
/// The link is owned by [`RelayState`] while its running session holds a handle to that same
/// state. The cycle is deliberate and bounded: [`UpstreamLink::stop`] ends the session, which is
/// what a console request, a revocation and the test harness all go through.
pub struct UpstreamLink {
    reach: RwLock<UpstreamReach>,
    /// `None` means no upstream is configured, which is what makes the API answer `null`.
    status: Mutex<Option<LinkStatus>>,
    running: AsyncMutex<Option<RunningLink>>,
}

impl UpstreamLink {
    pub fn new() -> Self {
        Self {
            reach: RwLock::new(UpstreamReach::default()),
            status: Mutex::new(None),
            running: AsyncMutex::new(None),
        }
    }

    /// The addresses one of this relay's devices gains from the chain above.
    pub fn addresses_for(&self, device_id: &str) -> Vec<RelayAddress> {
        self.reach().addresses_for(device_id)
    }

    /// The upstream relay ids, for a device's `welcome.chain`.
    pub fn chain(&self) -> Vec<String> {
        self.reach().chain().to_vec()
    }

    /// What `GET /api/admin/relays` reports, or `None` when no upstream is configured.
    pub fn view(&self) -> Option<UpstreamView> {
        let status = self.status().clone()?;
        Some(UpstreamView {
            url: status.url,
            state: status.state,
            relay_id: status.relay_id,
            chain: self.chain(),
            error: status.error,
        })
    }

    /// Brings the link up, replacing whatever was running before.
    pub async fn start(&self, state: SharedState, settings: UpstreamSettings) {
        let mut running = self.running.lock().await;
        Self::stop_running(&mut running).await;
        // Marked before the task is spawned, so a console request that reads the view as soon as
        // this returns sees a link that is on its way up rather than one that looks switched off.
        self.set_connecting(&settings.url);
        let cancel = CancellationToken::new();
        let task = tokio::spawn(supervise(state, settings, cancel.clone()));
        *running = Some(RunningLink { cancel, task });
    }

    /// Ends the link and forgets everything it contributed.
    pub async fn stop(&self) {
        let mut running = self.running.lock().await;
        Self::stop_running(&mut running).await;
        self.clear_reach();
        *self.status() = None;
    }

    /// Asks the link to end without waiting for it, for callers that cannot await — the test
    /// harness tearing a relay down, and anything else running inside `Drop`.
    pub fn request_stop(&self) {
        if let Ok(running) = self.running.try_lock() {
            if let Some(link) = running.as_ref() {
                link.cancel.cancel();
            }
        }
    }

    fn set_connecting(&self, url: &str) {
        let mut status = self.status();
        match status.as_mut() {
            Some(existing) if existing.url == url => existing.state = UpstreamState::Connecting,
            _ => {
                *status = Some(LinkStatus {
                    url: url.to_string(),
                    state: UpstreamState::Connecting,
                    relay_id: None,
                    error: None,
                })
            }
        }
    }

    fn set_connected(&self, relay_id: &str) {
        if let Some(status) = self.status().as_mut() {
            status.state = UpstreamState::Connected;
            status.relay_id = Some(relay_id.to_string());
            status.error = None;
        }
    }

    fn set_error(&self, message: String) {
        if let Some(status) = self.status().as_mut() {
            status.state = UpstreamState::Error;
            status.error = Some(message);
        }
    }

    fn set_reach(&self, reach: UpstreamReach) {
        *self
            .reach
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = reach;
    }

    fn clear_reach(&self) {
        self.set_reach(UpstreamReach::default());
    }

    async fn stop_running(running: &mut Option<RunningLink>) {
        let Some(link) = running.take() else {
            return;
        };
        link.cancel.cancel();
        if tokio::time::timeout(SHUTDOWN_WAIT, link.task)
            .await
            .is_err()
        {
            tracing::warn!("上游隧道未在超时前停止");
        }
    }

    fn reach(&self) -> RwLockReadGuard<'_, UpstreamReach> {
        // A poisoned lock still holds a usable snapshot: the value is rebuilt by the next
        // handshake, so recovering beats taking the relay's address list down with it.
        self.reach
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn status(&self) -> MutexGuard<'_, Option<LinkStatus>> {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for UpstreamLink {
    fn default() -> Self {
        Self::new()
    }
}

/// The `termexo-relay link` subcommand: exchange the code, store the upstream, and stop there.
///
/// It deliberately does not start a session — the operator runs it on a relay that is not serving
/// yet, and `serve` picks the stored upstream up on its next start.
pub async fn link(args: &LinkArgs) -> Result<(), String> {
    std::fs::create_dir_all(&args.data_dir)
        .map_err(|error| format!("无法创建数据目录 {}：{error}", args.data_dir.display()))?;
    let database =
        Database::open(&args.data_dir).map_err(|error| format!("无法打开中继数据库：{error}"))?;
    let name = link_name(&database, args.name.as_deref());
    let fingerprint = args
        .certificate_fingerprint
        .as_deref()
        .map(pinning::normalize_fingerprint)
        .transpose()?;

    let settings = establish(
        &database,
        &args.upstream,
        &args.code,
        &name,
        fingerprint,
        None,
    )
    .await?;
    println!("已接入上游中继：{}", settings.url);
    println!("本中继在上游显示的名称：{name}");
    println!("下次执行 termexo-relay serve 时会自动建立这条链接。");
    Ok(())
}

/// The name this relay registers under upstream: the operator's own, or the public host it already
/// answers on, so the upstream's device list is readable without extra configuration.
fn link_name(database: &Database, requested: Option<&str>) -> String {
    if let Some(name) = requested.map(str::trim).filter(|name| !name.is_empty()) {
        return name.to_string();
    }
    database
        .read_setting(SETTING_PUBLIC_URL)
        .ok()
        .flatten()
        .and_then(|url| PublicUrl::from_str(&url).ok())
        .map(|url| url.host().to_string())
        .unwrap_or_else(|| DEFAULT_LINK_NAME.to_string())
}

/// Starts the stored upstream, if there is one. Called once per start-up.
pub async fn resume(state: &SharedState) {
    match settings::load(&state.database) {
        Ok(Some(settings)) => {
            tracing::info!(upstream = %settings.authority(), "正在接入已保存的上游中继");
            state.upstream.start(state.clone(), settings).await;
        }
        Ok(None) => {}
        // A stored value that no longer parses is left in place: rewriting it would destroy the
        // credential an operator may still be able to repair by hand.
        Err(error) => tracing::error!(%error, "无法读取已保存的上游中继配置"),
    }
}

/// Trades an enrollment code for a credential, stores it, and brings the link up.
///
/// `certificate_fingerprint` is what makes a self-signed upstream reachable: with it the link
/// trusts exactly that certificate, without it the platform's root store decides.
pub async fn connect(
    state: &SharedState,
    url: &str,
    code: &str,
    certificate_fingerprint: Option<String>,
    actor_user_id: &str,
) -> Result<UpstreamView, String> {
    let name = state.public_url().host().to_string();
    let settings = establish(
        &state.database,
        url,
        code,
        &name,
        certificate_fingerprint,
        Some(actor_user_id),
    )
    .await?;
    state.upstream.start(state.clone(), settings).await;
    state.upstream.view().ok_or_else(|| NO_UPSTREAM.to_string())
}

/// The half the console and the CLI share: exchange the code, store the upstream, record it.
///
/// The audit actor is what tells the two apart — a console request has a signed-in administrator
/// behind it, while `termexo-relay link` is run on the host itself.
async fn establish(
    database: &Database,
    url: &str,
    code: &str,
    name: &str,
    certificate_fingerprint: Option<String>,
    actor_user_id: Option<&str>,
) -> Result<UpstreamSettings, String> {
    let settings = enroll::join(database, url, code, name, certificate_fingerprint).await?;
    let entry = match actor_user_id {
        Some(user_id) => AuditEntry::by_user(user_id, action::UPSTREAM_LINKED),
        None => AuditEntry::by_system(action::UPSTREAM_LINKED),
    };
    // Whether the upstream is pinned matters when reading the trail back; the digest itself is
    // public information but adds nothing here, so only the fact is recorded.
    audit::record(
        database,
        entry
            .detail("url", &*settings.url)
            .detail("pinned", settings.certificate_fingerprint.is_some()),
    );
    Ok(settings)
}

/// Drops the link and forgets the credential.
pub async fn disconnect(state: &SharedState, actor_user_id: &str) -> Result<(), String> {
    let previous = state.upstream.view();
    state.upstream.stop().await;
    // Stopping cancels the session before it can clean up after itself, so the addresses it
    // contributed are withdrawn here instead.
    publish_addresses(state);
    settings::clear(&state.database).map_err(|error| error.to_string())?;
    audit::record(
        &state.database,
        AuditEntry::by_user(actor_user_id, action::UPSTREAM_UNLINKED)
            .detail("url", previous.map(|view| view.url).unwrap_or_default()),
    );
    Ok(())
}

/// Tells everything attached to this relay that its address list changed.
///
/// Only directly attached tunnels are pushed to: a device behind a downstream relay is that
/// relay's to inform, and it does so when this very frame reaches it.
pub fn publish_addresses(state: &RelayState) {
    for device in state.registry.snapshot() {
        if let Route::Direct(handle) = &device.route {
            handle.send_frame(ControlFrame::Addresses {
                addresses: state.device_addresses(&device.device_id),
            });
        }
    }
}

/// Runs one session after another until the link is cancelled or gives up.
async fn supervise(state: SharedState, settings: UpstreamSettings, cancel: CancellationToken) {
    let upstream = settings.authority().to_string();
    let mut backoff = Backoff::new();

    loop {
        state.upstream.set_connecting(&settings.url);
        let outcome = tokio::select! {
            // Cancellation wins a tie so that stopping the link never starts one more session.
            biased;
            _ = cancel.cancelled() => return,
            outcome = session::run(&state, &settings) => outcome,
        };

        let reason = outcome.end.message().to_string();
        match next_step(&outcome, &mut backoff) {
            SupervisorStep::Revoked => {
                tracing::warn!(%upstream, "上游中继已撤销本中继的接入，不再重连");
                forget(&state, &settings, &reason);
                return;
            }
            SupervisorStep::Looped => {
                tracing::error!(%upstream, %reason, "上游中继链成环，已拒绝接入");
                audit::record(
                    &state.database,
                    AuditEntry::by_system(action::UPSTREAM_LOOP_REFUSED)
                        .detail("url", &*settings.url),
                );
                state.upstream.set_error(reason);
                return;
            }
            SupervisorStep::Stop => {
                tracing::warn!(%upstream, %reason, "上游中继拒绝了本中继，已停止重连");
                state.upstream.set_error(reason);
                return;
            }
            SupervisorStep::RetryAfter(delay) => {
                state.upstream.set_error(reason);
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => return,
                    _ = tokio::time::sleep(delay) => {}
                }
            }
        }
    }
}

/// Drops a revoked upstream for good: the credential is worthless, so it is not kept around.
fn forget(state: &SharedState, settings: &UpstreamSettings, reason: &str) {
    audit::record(
        &state.database,
        AuditEntry::by_system(action::UPSTREAM_REVOKED)
            .detail("url", &*settings.url)
            .detail("reason", reason),
    );
    if let Err(error) = settings::clear(&state.database) {
        tracing::error!(%error, "无法清除已被撤销的上游中继配置");
    }
    state.upstream.clear_reach();
    *state.upstream.status() = None;
    publish_addresses(state);
    tracing::warn!("{REVOKED_MESSAGE}");
}

/// What the supervisor does once a session has ended.
#[derive(Debug, PartialEq, Eq)]
enum SupervisorStep {
    /// Stop, but keep the credential.
    Stop,
    /// Stop and forget the credential.
    Revoked,
    /// Stop: the chain is circular, and every retry would be refused for the same reason.
    Looped,
    RetryAfter(Duration),
}

/// The supervisor's whole decision, kept free of I/O so the reconnect behaviour can be tested
/// without an upstream on the other end.
fn next_step(outcome: &SessionOutcome, backoff: &mut Backoff) -> SupervisorStep {
    if outcome.connected {
        backoff.reset();
    }
    match outcome.end {
        SessionEnd::Revoked(_) => SupervisorStep::Revoked,
        SessionEnd::Refused(_) => SupervisorStep::Stop,
        SessionEnd::Looped(_) => SupervisorStep::Looped,
        SessionEnd::Interrupted(_) => SupervisorStep::RetryAfter(backoff.take()),
    }
}

/// Audits a link that just came up. Written here so both halves of the lifecycle sit together.
pub(super) fn record_connected(state: &RelayState, settings: &UpstreamSettings, relay_id: &str) {
    audit::record(
        &state.database,
        AuditEntry::by_system(action::UPSTREAM_CONNECTED)
            .target(target::RELAY, relay_id)
            .detail("url", &*settings.url),
    );
}

pub(super) fn record_disconnected(state: &RelayState, settings: &UpstreamSettings, reason: &str) {
    audit::record(
        &state.database,
        AuditEntry::by_system(action::UPSTREAM_DISCONNECTED)
            .detail("url", &*settings.url)
            .detail("reason", reason),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use termexo_relay_protocol::tunnel::INITIAL_RECONNECT_DELAY;

    fn ended(connected: bool, end: SessionEnd) -> SessionOutcome {
        SessionOutcome { connected, end }
    }

    /// Only a revocation forgets the credential; a refusal and a loop stop the link but leave the
    /// configuration for the operator to look at, and everything else is retried.
    #[test]
    fn each_way_a_session_can_end_has_its_own_consequence() {
        let mut backoff = Backoff::new();

        assert_eq!(
            next_step(
                &ended(true, SessionEnd::Revoked("接入已被撤销。".into())),
                &mut backoff
            ),
            SupervisorStep::Revoked
        );
        assert_eq!(
            next_step(
                &ended(true, SessionEnd::Refused("凭据无效。".into())),
                &mut backoff
            ),
            SupervisorStep::Stop
        );
        assert_eq!(
            next_step(
                &ended(false, SessionEnd::Looped("中继链成环。".into())),
                &mut backoff
            ),
            SupervisorStep::Looped
        );
        assert_eq!(
            next_step(
                &ended(true, SessionEnd::Interrupted("连接已断开。".into())),
                &mut backoff
            ),
            SupervisorStep::RetryAfter(INITIAL_RECONNECT_DELAY)
        );
    }

    /// An upstream that is simply unreachable must be backed off, not retried every second.
    #[test]
    fn repeated_failures_walk_the_delay_ladder() {
        let mut backoff = Backoff::new();

        let delays: Vec<u64> = (0..4)
            .map(|_| {
                match next_step(
                    &ended(false, SessionEnd::Interrupted("连接被拒绝。".into())),
                    &mut backoff,
                ) {
                    SupervisorStep::RetryAfter(delay) => delay.as_secs(),
                    step => panic!("a transient failure should be retried, got {step:?}"),
                }
            })
            .collect();

        assert_eq!(delays, vec![1, 2, 4, 8]);
    }

    /// The upstream's device list is only readable if this relay registers under a name somebody
    /// recognises, and the one thing it always knows about itself is the address it answers on.
    #[test]
    fn the_link_name_falls_back_to_this_relays_own_public_host() {
        let database = Database::open_in_memory().expect("the database should open");

        assert_eq!(link_name(&database, None), DEFAULT_LINK_NAME);
        database
            .write_setting(SETTING_PUBLIC_URL, "https://relay-b.example.com")
            .expect("the setting should store");
        assert_eq!(link_name(&database, None), "relay-b.example.com");
        assert_eq!(link_name(&database, Some("  办公室中继 ")), "办公室中继");
        assert_eq!(link_name(&database, Some("   ")), "relay-b.example.com");
    }

    #[test]
    fn a_link_without_an_upstream_reports_nothing_at_all() {
        let link = UpstreamLink::new();

        assert_eq!(link.view(), None);
        assert!(link.chain().is_empty());
        assert!(link.addresses_for("device-a").is_empty());
    }

    #[test]
    fn the_view_follows_the_link_through_its_states() {
        let link = UpstreamLink::new();

        link.set_connecting("https://relay-a.example.com");
        assert_eq!(
            link.view().expect("a view").state,
            UpstreamState::Connecting
        );

        link.set_connected("relay-a");
        let connected = link.view().expect("a view");
        assert_eq!(connected.state, UpstreamState::Connected);
        assert_eq!(connected.relay_id.as_deref(), Some("relay-a"));
        assert_eq!(connected.error, None);
        assert_eq!(connected.url, "https://relay-a.example.com");

        link.set_error("无法连接上游中继。".into());
        let failed = link.view().expect("a view");
        assert_eq!(failed.state, UpstreamState::Error);
        assert_eq!(failed.error.as_deref(), Some("无法连接上游中继。"));
        // The identity stays: it is still true, and it is what the operator recognises the row by.
        assert_eq!(failed.relay_id.as_deref(), Some("relay-a"));
    }

    #[test]
    fn the_view_travels_to_the_console_in_camel_case() {
        let link = UpstreamLink::new();
        link.set_connecting("https://relay-a.example.com");
        link.set_connected("relay-a");

        let encoded = serde_json::to_string(&link.view()).expect("the view should serialize");

        assert!(encoded.contains("\"state\":\"connected\""));
        assert!(encoded.contains("\"relayId\":\"relay-a\""));
        assert!(encoded.contains("\"chain\":[]"));
        assert!(encoded.contains("\"error\":null"));
    }

    #[test]
    fn every_state_has_a_lowercase_name_the_console_can_switch_on() {
        for (state, expected) in [
            (UpstreamState::Connecting, "\"connecting\""),
            (UpstreamState::Connected, "\"connected\""),
            (UpstreamState::Error, "\"error\""),
        ] {
            assert_eq!(
                serde_json::to_string(&state).expect("a state should serialize"),
                expected
            );
        }
    }
}
