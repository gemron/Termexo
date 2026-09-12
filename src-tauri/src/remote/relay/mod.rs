//! The desktop end of a relay tunnel.
//!
//! [`RelayLink`] owns one outbound connection to a relay: it starts and stops with the settings,
//! reconnects on its own, and publishes what the panel shows. It deliberately knows nothing about
//! the credential store or the settings document — when the relay revokes this device, it reports
//! that through a callback and leaves the durable consequences to the manager that owns them.

mod client;
mod endpoint;
mod enroll;
mod mux;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Router;
use serde::Serialize;
use termexo_relay_protocol::frames::RelayAddress;
use tokio::sync::{watch, Mutex as AsyncMutex};
use tokio_util::sync::CancellationToken;

use crate::remote::server::ConnectionCommand;

use client::{SessionConfig, SessionEnd, SessionOutcome};

pub use endpoint::RelayEndpoint;
pub use enroll::{enroll, RelayEnrollRequest};

/// Reconnect delays: 1 s doubling to 30 s, so a relay that restarts is picked up almost at once
/// while one that is simply unreachable is not hammered.
const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);
/// Upper bound on waiting for the link to wind down, so a stuck session cannot hang a settings
/// save the way the LAN listener's own shutdown must not.
const LINK_SHUTDOWN_WAIT: Duration = Duration::from_secs(5);

/// What the relay section of the panel shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RelayLinkState {
    /// No relay is configured, or the relay is switched off.
    Disabled,
    Connecting,
    Connected,
    /// The relay withdrew this device's access; the credential has been forgotten.
    Revoked,
    /// The last attempt failed. The link may still be retrying — `error` says why it failed.
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatus {
    pub state: RelayLinkState,
    /// Why the last attempt failed, in Chinese, for the panel.
    pub error: Option<String>,
    /// The public half of the device credential; the secret never leaves the credential store.
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    /// Every address this device can be opened at, across the whole relay chain.
    pub addresses: Vec<RelayAddress>,
    /// Milliseconds since the epoch, so the panel can count the uptime itself.
    pub connected_since: Option<i64>,
}

impl Default for RelayStatus {
    fn default() -> Self {
        Self {
            state: RelayLinkState::Disabled,
            error: None,
            device_id: None,
            device_name: None,
            addresses: Vec::new(),
            connected_since: None,
        }
    }
}

/// The status snapshot, behind a lock the running session updates as it goes.
struct LinkStatus(Mutex<RelayStatus>);

impl LinkStatus {
    fn new() -> Self {
        Self(Mutex::new(RelayStatus::default()))
    }

    fn snapshot(&self) -> RelayStatus {
        self.guard().clone()
    }

    fn set_disabled(&self) {
        *self.guard() = RelayStatus::default();
    }

    /// Keeps the device's identity, which is still true, and drops everything that is not: no
    /// address works while the tunnel is down.
    fn set_connecting(&self) {
        let mut status = self.guard();
        status.state = RelayLinkState::Connecting;
        status.addresses.clear();
        status.connected_since = None;
    }

    fn set_connected(&self, device_id: String, device_name: String, addresses: Vec<RelayAddress>) {
        let mut status = self.guard();
        status.state = RelayLinkState::Connected;
        status.error = None;
        status.device_id = Some(device_id);
        status.device_name = Some(device_name);
        status.addresses = addresses;
        status.connected_since = Some(now_ms());
    }

    fn set_addresses(&self, addresses: Vec<RelayAddress>) {
        self.guard().addresses = addresses;
    }

    fn set_error(&self, message: String) {
        self.set_failure(RelayLinkState::Error, message);
    }

    fn set_revoked(&self, reason: String) {
        self.set_failure(RelayLinkState::Revoked, reason);
    }

    fn set_failure(&self, state: RelayLinkState, message: String) {
        let mut status = self.guard();
        status.state = state;
        status.error = Some(message);
        status.addresses.clear();
        status.connected_since = None;
    }

    fn guard(&self) -> MutexGuard<'_, RelayStatus> {
        // Recovering from poisoning keeps a panic in one session from freezing the panel's status
        // for good; the value is a snapshot, so a torn update is harmless.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

/// Told that the relay revoked this device, so the owner can forget the credential and switch the
/// setting off. It is called once, from the supervisor task, just before the link stops.
pub type RevocationCallback = Arc<dyn Fn(String) + Send + Sync>;

/// Everything needed to bring a link up, assembled by the manager from the settings, the
/// credential store and the tunnel router.
pub struct LinkRequest {
    pub endpoint: RelayEndpoint,
    pub credential: String,
    pub device_name: String,
    pub version: String,
    pub router: Router,
}

struct RunningLink {
    endpoint: RelayEndpoint,
    cancel: CancellationToken,
    task: tauri::async_runtime::JoinHandle<()>,
    /// Cleared by the supervisor when it stops for good, so a link that gave up — or that was
    /// revoked — can be started again against the very same relay after a fresh enrollment.
    alive: Arc<AtomicBool>,
}

impl RunningLink {
    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }
}

/// Clears the running flag however the supervisor leaves its loop.
struct AliveGuard(Arc<AtomicBool>);

impl Drop for AliveGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Relaxed);
    }
}

/// One outbound tunnel to a relay.
pub struct RelayLink {
    status: Arc<LinkStatus>,
    /// Commands for the viewers that came in through the tunnel. It is separate from the LAN
    /// listener's channel so that stopping one route never closes the other's sessions.
    commands: watch::Sender<ConnectionCommand>,
    running: AsyncMutex<Option<RunningLink>>,
    on_revoked: Mutex<Option<RevocationCallback>>,
}

impl RelayLink {
    pub fn new() -> Self {
        let (commands, _) = watch::channel(ConnectionCommand::Run);
        Self {
            status: Arc::new(LinkStatus::new()),
            commands,
            running: AsyncMutex::new(None),
            on_revoked: Mutex::new(None),
        }
    }

    pub fn status(&self) -> RelayStatus {
        self.status.snapshot()
    }

    /// The receiver the tunnel router's `ServerContext` watches.
    pub fn commands(&self) -> watch::Receiver<ConnectionCommand> {
        self.commands.subscribe()
    }

    /// Sends every viewer that came in through the tunnel back through authentication.
    pub fn reauthenticate(&self) {
        let _ = self.commands.send(ConnectionCommand::Reauthenticate);
    }

    /// Installs what to do when the relay revokes this device.
    pub fn on_revoked(&self, callback: RevocationCallback) {
        *self.revocation_guard() = Some(callback);
    }

    /// Brings the link up, or leaves it alone when it is already attached to this very relay.
    pub async fn start(&self, request: LinkRequest) {
        let mut running = self.running.lock().await;
        if running
            .as_ref()
            .is_some_and(|link| link.endpoint == request.endpoint && link.is_alive())
        {
            return;
        }

        Self::stop_running(&mut running).await;
        // Marked before the task is spawned: the caller snapshots the status as soon as `start`
        // returns, and a snapshot that still says "disabled" sends the panel back to the join form.
        self.status.set_connecting();
        let cancel = CancellationToken::new();
        let endpoint = request.endpoint.clone();
        let alive = Arc::new(AtomicBool::new(true));
        let task = tauri::async_runtime::spawn(supervise(
            request,
            self.status.clone(),
            cancel.clone(),
            self.revocation_guard().clone(),
            AliveGuard(alive.clone()),
        ));
        *running = Some(RunningLink {
            endpoint,
            cancel,
            task,
            alive,
        });
    }

    pub async fn stop(&self) {
        let mut running = self.running.lock().await;
        Self::stop_running(&mut running).await;
        self.status.set_disabled();
    }

    /// Records why the link cannot even be attempted — no stored credential, for instance — so the
    /// panel explains the gap instead of showing a relay that looks merely switched off.
    pub async fn report_unavailable(&self, reason: String) {
        let mut running = self.running.lock().await;
        Self::stop_running(&mut running).await;
        self.status.set_error(reason);
    }

    async fn stop_running(running: &mut Option<RunningLink>) {
        let Some(link) = running.take() else {
            return;
        };
        link.cancel.cancel();
        if tokio::time::timeout(LINK_SHUTDOWN_WAIT, link.task)
            .await
            .is_err()
        {
            tracing::warn!("中继隧道未在超时前停止");
        }
    }

    fn revocation_guard(&self) -> MutexGuard<'_, Option<RevocationCallback>> {
        self.on_revoked
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for RelayLink {
    fn default() -> Self {
        Self::new()
    }
}

/// Runs one session after another until the link is cancelled or gives up.
async fn supervise(
    request: LinkRequest,
    status: Arc<LinkStatus>,
    cancel: CancellationToken,
    on_revoked: Option<RevocationCallback>,
    _alive: AliveGuard,
) {
    let relay = request.endpoint.authority().to_string();
    let config = SessionConfig {
        endpoint: request.endpoint,
        credential: request.credential,
        device_name: request.device_name,
        version: request.version,
        router: request.router,
    };
    let mut backoff = Backoff::new();

    loop {
        status.set_connecting();
        let started = std::time::Instant::now();
        let outcome = tokio::select! {
            // Cancellation wins a tie so that stopping the link never starts one more session.
            biased;
            _ = cancel.cancelled() => return,
            outcome = client::run_session(&config, &status) => outcome,
        };
        tracing::info!(
            %relay,
            connected = outcome.connected,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "中继隧道会话已结束"
        );

        let reason = outcome.end.message().to_string();
        match next_step(&outcome, &mut backoff) {
            SupervisorStep::Revoked => {
                tracing::warn!(%relay, "中继已撤销本设备的接入，不再重连");
                status.set_revoked(reason.clone());
                if let Some(callback) = &on_revoked {
                    callback(reason);
                }
                return;
            }
            SupervisorStep::Stop => {
                tracing::warn!(%relay, %reason, "中继拒绝了本设备，已停止重连");
                status.set_error(reason);
                return;
            }
            SupervisorStep::RetryAfter(delay) => {
                status.set_error(reason);
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => return,
                    _ = tokio::time::sleep(delay) => {}
                }
            }
        }
    }
}

/// What the supervisor does once a session has ended.
#[derive(Debug, PartialEq, Eq)]
enum SupervisorStep {
    /// Stop, but keep the credential.
    Stop,
    /// Stop, forget the credential and tell the owner.
    Revoked,
    RetryAfter(Duration),
}

/// The supervisor's whole decision, kept free of I/O so the reconnect behaviour can be tested
/// without a relay on the other end.
fn next_step(outcome: &SessionOutcome, backoff: &mut Backoff) -> SupervisorStep {
    if outcome.connected {
        backoff.reset();
    }
    match outcome.end {
        // Revocation is permanent: the relay will never accept this credential again.
        SessionEnd::Revoked(_) => SupervisorStep::Revoked,
        // A refusal keeps the credential but stops the link: the relay may simply be running a
        // build that cannot speak this protocol version, and reconnecting on a timer would only
        // walk into the relay's own failure lockout and shut every browser on this address out.
        SessionEnd::Refused(_) => SupervisorStep::Stop,
        SessionEnd::Interrupted(_) => SupervisorStep::RetryAfter(backoff.take()),
    }
}

/// How long to wait before the next attempt, doubling up to a ceiling.
struct Backoff {
    next: Duration,
}

impl Backoff {
    fn new() -> Self {
        Self {
            next: INITIAL_RECONNECT_DELAY,
        }
    }

    fn take(&mut self) -> Duration {
        let delay = self.next;
        self.next = (self.next * 2).min(MAX_RECONNECT_DELAY);
        delay
    }

    /// A session that actually reached the relay starts the ladder again, so a link that drops
    /// once an hour reconnects in a second every time rather than inheriting an old ceiling.
    fn reset(&mut self) {
        self.next = INITIAL_RECONNECT_DELAY;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addresses() -> Vec<RelayAddress> {
        vec![RelayAddress {
            relay_id: "relay-a".into(),
            relay_name: "公网中继".into(),
            url: "https://relay.example.com/d/abcdefghijklmnopqrstuvwxyz/".into(),
            hops: 0,
        }]
    }

    #[test]
    fn the_reconnect_delay_doubles_up_to_half_a_minute() {
        let mut backoff = Backoff::new();

        let delays: Vec<u64> = (0..8).map(|_| backoff.take().as_secs()).collect();

        assert_eq!(delays, vec![1, 2, 4, 8, 16, 30, 30, 30]);
    }

    #[test]
    fn a_session_that_reached_the_relay_starts_the_ladder_again() {
        let mut backoff = Backoff::new();
        for _ in 0..5 {
            backoff.take();
        }

        backoff.reset();

        assert_eq!(backoff.take(), INITIAL_RECONNECT_DELAY);
    }

    fn ended(connected: bool, end: SessionEnd) -> SessionOutcome {
        SessionOutcome { connected, end }
    }

    /// Only a revocation is permanent. A refusal stops the link but keeps the credential, and
    /// everything else is a connection to make again.
    #[test]
    fn only_a_revocation_forgets_the_credential() {
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
                &ended(true, SessionEnd::Interrupted("连接已断开。".into())),
                &mut backoff
            ),
            SupervisorStep::RetryAfter(INITIAL_RECONNECT_DELAY)
        );
    }

    /// A tunnel closed with 4403 must not come back, however many times it had reconnected before.
    #[test]
    fn a_revoked_link_stops_even_after_a_run_of_retries() {
        let mut backoff = Backoff::new();
        for _ in 0..3 {
            assert!(matches!(
                next_step(
                    &ended(false, SessionEnd::Interrupted("连接被拒绝。".into())),
                    &mut backoff
                ),
                SupervisorStep::RetryAfter(_)
            ));
        }

        assert_eq!(
            next_step(
                &ended(true, SessionEnd::Revoked("接入已被中继撤销。".into())),
                &mut backoff
            ),
            SupervisorStep::Revoked
        );
    }

    /// A relay that is simply unreachable must be backed off, not retried every second.
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

    #[test]
    fn a_fresh_link_reports_itself_as_switched_off() {
        let status = LinkStatus::new();

        let snapshot = status.snapshot();

        assert_eq!(snapshot.state, RelayLinkState::Disabled);
        assert!(snapshot.addresses.is_empty());
        assert_eq!(snapshot.connected_since, None);
    }

    #[test]
    fn a_connected_link_publishes_its_identity_and_addresses() {
        let status = LinkStatus::new();
        status.set_error("上一次失败。".into());

        status.set_connected(
            "abcdefghijklmnopqrstuvwxyz".into(),
            "工作室台式机".into(),
            addresses(),
        );

        let snapshot = status.snapshot();
        assert_eq!(snapshot.state, RelayLinkState::Connected);
        assert_eq!(snapshot.error, None);
        assert_eq!(
            snapshot.device_id.as_deref(),
            Some("abcdefghijklmnopqrstuvwxyz")
        );
        assert_eq!(snapshot.addresses.len(), 1);
        assert!(snapshot.connected_since.is_some());
    }

    /// No address works while the tunnel is down, so a failure must not leave stale ones on the
    /// panel for the user to copy.
    #[test]
    fn a_failure_clears_the_addresses_but_keeps_the_device_identity() {
        let status = LinkStatus::new();
        status.set_connected(
            "abcdefghijklmnopqrstuvwxyz".into(),
            "台式机".into(),
            addresses(),
        );

        status.set_revoked("接入已被中继撤销。".into());

        let snapshot = status.snapshot();
        assert_eq!(snapshot.state, RelayLinkState::Revoked);
        assert_eq!(snapshot.error.as_deref(), Some("接入已被中继撤销。"));
        assert!(snapshot.addresses.is_empty());
        assert_eq!(snapshot.connected_since, None);
        assert_eq!(
            snapshot.device_id.as_deref(),
            Some("abcdefghijklmnopqrstuvwxyz")
        );
    }

    #[test]
    fn the_status_travels_to_the_panel_in_camel_case() {
        let status = LinkStatus::new();
        status.set_connected(
            "abcdefghijklmnopqrstuvwxyz".into(),
            "台式机".into(),
            addresses(),
        );

        let encoded =
            serde_json::to_string(&status.snapshot()).expect("the status should serialize");

        assert!(encoded.contains("\"state\":\"connected\""));
        assert!(encoded.contains("\"deviceId\""));
        assert!(encoded.contains("\"deviceName\""));
        assert!(encoded.contains("\"connectedSince\""));
        assert!(encoded.contains("\"relayName\""));
    }

    #[test]
    fn every_link_state_has_a_lowercase_name_the_panel_can_switch_on() {
        for (state, expected) in [
            (RelayLinkState::Disabled, "\"disabled\""),
            (RelayLinkState::Connecting, "\"connecting\""),
            (RelayLinkState::Connected, "\"connected\""),
            (RelayLinkState::Revoked, "\"revoked\""),
            (RelayLinkState::Error, "\"error\""),
        ] {
            assert_eq!(
                serde_json::to_string(&state).expect("a state should serialize"),
                expected
            );
        }
    }
}
