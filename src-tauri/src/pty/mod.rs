use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use thiserror::Error;

use crate::commands::terminal::TerminalStartRequest;
use crate::remote::{
    RemoteEventHub, EVENT_TERMINAL_EXIT, EVENT_TERMINAL_OUTPUT, EVENT_TERMINAL_RESIZED,
};

/// Upper bound on what one terminal keeps for replay.
///
/// A remote client that attaches to a running terminal, or reloads its page, has no other way to
/// see what already scrolled by. 256 KiB covers a full screen of a TUI agent many times over while
/// staying small enough to hold for every open terminal at once.
const MAX_SCROLLBACK_BYTES: usize = 256 * 1024;

/// Grid a terminal falls back to when no viewer has claimed a size, matching the VT default.
const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;

#[derive(Debug, Error)]
pub enum PtyError {
    #[error("terminal {0} was not found")]
    NotFound(String),
    #[error("terminal manager lock is poisoned")]
    LockPoisoned,
    #[error("failed to create PTY: {0}")]
    Open(String),
    #[error("failed to start shell: {0}")]
    Spawn(String),
    #[error("PTY operation failed: {0}")]
    Backend(String),
    #[error("terminal I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    terminal_id: String,
    runtime_revision: u64,
    /// Position of this chunk in the terminal's output stream. A client that just replayed the
    /// scrollback uses it to drop the live events the replay already contained.
    sequence: u64,
    data: String,
}

/// Reports that a terminal's process ended, so the UI stops presenting it as running.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    terminal_id: String,
    runtime_revision: u64,
    exit_code: i32,
    success: bool,
}

/// What a client needs to catch up with a terminal it was not connected to.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScrollback {
    pub data: String,
    /// Sequence of the last chunk contained in `data`.
    pub sequence: u64,
    pub runtime_revision: u64,
}

impl TerminalScrollback {
    /// A terminal the backend does not know about replays as nothing at all.
    pub fn empty() -> Self {
        Self {
            data: String::new(),
            sequence: 0,
            runtime_revision: 0,
        }
    }
}

/// Replay buffer for one terminal, evicted whole chunk by whole chunk.
///
/// Trimming inside a chunk would cut an escape sequence — or a multi-byte character — in half and
/// leave the replaying terminal in a broken state.
#[derive(Default)]
struct OutputHistory {
    chunks: VecDeque<(u64, Vec<u8>)>,
    buffered_bytes: usize,
    last_sequence: u64,
}

impl OutputHistory {
    /// Appends a chunk and returns the sequence assigned to it.
    fn push(&mut self, chunk: &[u8]) -> u64 {
        self.last_sequence += 1;
        self.buffered_bytes += chunk.len();
        self.chunks.push_back((self.last_sequence, chunk.to_vec()));
        // The newest chunk always survives, even when it alone exceeds the budget.
        while self.buffered_bytes > MAX_SCROLLBACK_BYTES && self.chunks.len() > 1 {
            if let Some((_, evicted)) = self.chunks.pop_front() {
                self.buffered_bytes -= evicted.len();
            }
        }
        self.last_sequence
    }

    fn snapshot(&self, runtime_revision: u64) -> TerminalScrollback {
        let mut buffered = Vec::with_capacity(self.buffered_bytes);
        for (_, chunk) in &self.chunks {
            buffered.extend_from_slice(chunk);
        }
        TerminalScrollback {
            // Decoding the concatenation rather than each chunk keeps a character that a PTY read
            // split across two chunks intact.
            data: String::from_utf8_lossy(&buffered).into_owned(),
            sequence: self.last_sequence,
            runtime_revision,
        }
    }
}

struct PtyProcess {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    /// The child itself is owned by the exit watcher, which blocks on it; closing a terminal only
    /// ever needs to kill it.
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// Which launch of this terminal is running. A reconnect with a newer revision must replace
    /// the process rather than attach to the previous one.
    runtime_revision: u64,
    history: Arc<Mutex<OutputHistory>>,
    /// The viewer currently driving this terminal's size, and the grid it asked for.
    ///
    /// A PTY has one size and the agent draws for it, so the size has to belong to somebody. It
    /// belongs to whoever last worked in the terminal: focusing it from a phone hands the grid to
    /// the phone, focusing it back on the desktop hands it back. Every other viewer renders that
    /// grid, scrolling if their window cannot hold it.
    active_viewport: Option<(String, TerminalViewport)>,
}

#[derive(Clone, Copy)]
struct TerminalViewport {
    cols: u16,
    rows: u16,
}

/// Reports the size a terminal settled on, so every viewer can match its emulator to the PTY.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalResizedEvent {
    terminal_id: String,
    cols: u16,
    rows: u16,
}

/// Whether a viewer's report should become the terminal's size.
///
/// A claim is the user working in that view — focusing the terminal there — and always wins. A
/// plain report is a window that merely changed shape; it only counts when that window already
/// owns the terminal, so a background client resizing itself never disturbs the one in use.
fn should_apply_viewport(active_viewer: Option<&str>, viewer_id: &str, claim: bool) -> bool {
    claim || active_viewer == Some(viewer_id)
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtyProcess>>,
    hub: Arc<RemoteEventHub>,
}

impl PtyManager {
    pub fn new(hub: Arc<RemoteEventHub>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            hub,
        }
    }

    /// Which launch of a terminal is currently running, or `None` when it is not.
    pub fn runtime_revision(&self, terminal_id: &str) -> Result<Option<u64>, PtyError> {
        let sessions = self.sessions.lock().map_err(|_| PtyError::LockPoisoned)?;
        Ok(sessions
            .get(terminal_id)
            .map(|session| session.runtime_revision))
    }

    /// The grid a terminal is currently running at, or `None` when it is not running.
    ///
    /// A client joining a terminal has to draw what the agent is already drawing for, which its own
    /// window may not match.
    pub fn size(&self, terminal_id: &str) -> Result<Option<(u16, u16)>, PtyError> {
        let sessions = self.sessions.lock().map_err(|_| PtyError::LockPoisoned)?;
        Ok(sessions.get(terminal_id).map(|session| {
            session
                .active_viewport
                .as_ref()
                .map(|(_, viewport)| (viewport.cols, viewport.rows))
                .unwrap_or((DEFAULT_COLS, DEFAULT_ROWS))
        }))
    }

    pub fn read_scrollback(&self, terminal_id: &str) -> Result<TerminalScrollback, PtyError> {
        let sessions = self.sessions.lock().map_err(|_| PtyError::LockPoisoned)?;
        let Some(session) = sessions.get(terminal_id) else {
            return Ok(TerminalScrollback::empty());
        };
        let history = session.history.lock().map_err(|_| PtyError::LockPoisoned)?;
        Ok(history.snapshot(session.runtime_revision))
    }

    /// Starts the terminal's process, or reports `false` when one is already running under this id.
    pub fn start(
        &self,
        request: TerminalStartRequest,
        app: AppHandle,
        environment: HashMap<String, String>,
    ) -> Result<bool, PtyError> {
        let mut sessions = self.sessions.lock().map_err(|_| PtyError::LockPoisoned)?;
        if sessions.contains_key(&request.terminal_id) {
            return Ok(false);
        }

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: request.rows.max(1),
                cols: request.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError::Open(error.to_string()))?;

        let mut command = CommandBuilder::new(&request.shell);
        command.cwd(&request.working_directory);
        for (key, value) in environment {
            command.env(key, value);
        }
        let initial_command = request.command.as_deref().filter(|value| !value.is_empty());
        let command_started_without_echo = configure_shell(
            &mut command,
            &request.shell,
            request
                .hide_initial_command
                .then_some(initial_command)
                .flatten(),
        );

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| PtyError::Spawn(error.to_string()))?;
        drop(pair.slave);
        let killer = child.clone_killer();
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| PtyError::Backend(error.to_string()))?;
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|error| PtyError::Backend(error.to_string()))?;

        if let Some(initial_command) = initial_command.filter(|_| !command_started_without_echo) {
            writer.write_all(initial_command.as_bytes())?;
            writer.write_all(line_ending().as_bytes())?;
            writer.flush()?;
        }

        let history = Arc::new(Mutex::new(OutputHistory::default()));
        spawn_reader(
            request.terminal_id.clone(),
            request.runtime_revision,
            app.clone(),
            self.hub.clone(),
            history.clone(),
            reader,
        );
        spawn_exit_watcher(
            request.terminal_id.clone(),
            request.runtime_revision,
            app,
            self.hub.clone(),
            child,
        );

        sessions.insert(
            request.terminal_id,
            PtyProcess {
                writer,
                master: pair.master,
                killer,
                runtime_revision: request.runtime_revision,
                history,
                // Whoever launched the terminal is working in it, so it starts out theirs.
                active_viewport: Some((
                    request.viewer_id.clone(),
                    TerminalViewport {
                        cols: request.cols.max(1),
                        rows: request.rows.max(1),
                    },
                )),
            },
        );
        Ok(true)
    }

    pub fn write(&self, terminal_id: &str, data: &[u8]) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().map_err(|_| PtyError::LockPoisoned)?;
        let session = sessions
            .get_mut(terminal_id)
            .ok_or_else(|| PtyError::NotFound(terminal_id.into()))?;
        session.writer.write_all(data)?;
        session.writer.flush()?;
        Ok(())
    }

    /// Sizes a terminal to a viewer's window, when that viewer is the one driving it.
    ///
    /// `claim` marks the user actually working in this view, which takes the terminal over; a
    /// report without it is a window that merely changed shape and is ignored unless it already
    /// owns the terminal.
    pub fn resize(
        &self,
        terminal_id: &str,
        viewer_id: &str,
        cols: u16,
        rows: u16,
        claim: bool,
        app: &AppHandle,
    ) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().map_err(|_| PtyError::LockPoisoned)?;
        let session = sessions
            .get_mut(terminal_id)
            .ok_or_else(|| PtyError::NotFound(terminal_id.into()))?;
        let active = session.active_viewport.as_ref().map(|(id, _)| id.as_str());
        if !should_apply_viewport(active, viewer_id, claim) {
            return Ok(());
        }
        session.active_viewport = Some((
            viewer_id.to_owned(),
            TerminalViewport {
                cols: cols.max(1),
                rows: rows.max(1),
            },
        ));
        self.apply_viewport(terminal_id, session, app)
    }

    /// Releases every terminal a departing viewer was driving.
    ///
    /// The PTY keeps the grid it is on — resizing it with nobody to size it for would reshape what
    /// the remaining viewers are reading. The next view the user works in takes it over.
    pub fn remove_viewer(&self, viewer_id: &str, _app: &AppHandle) {
        let Ok(mut sessions) = self.sessions.lock() else {
            return;
        };
        for session in sessions.values_mut() {
            if session
                .active_viewport
                .as_ref()
                .is_some_and(|(id, _)| id == viewer_id)
            {
                session.active_viewport = None;
            }
        }
    }

    /// Sizes the PTY to the driving viewer's window, then tells every viewer what it settled on.
    ///
    /// Announcing the result is what keeps the other viewers honest: their emulators must match the
    /// PTY, because the agent only ever redraws the columns it believes exist and would leave stale
    /// output standing in any beyond them.
    fn apply_viewport(
        &self,
        terminal_id: &str,
        session: &PtyProcess,
        app: &AppHandle,
    ) -> Result<(), PtyError> {
        let Some((_, viewport)) = session.active_viewport.as_ref() else {
            return Ok(());
        };
        session
            .master
            .resize(PtySize {
                rows: viewport.rows,
                cols: viewport.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError::Backend(error.to_string()))?;

        let event = TerminalResizedEvent {
            terminal_id: terminal_id.to_owned(),
            cols: viewport.cols,
            rows: viewport.rows,
        };
        self.hub.publish(EVENT_TERMINAL_RESIZED, &event);
        let _ = app.emit(EVENT_TERMINAL_RESIZED, &event);
        Ok(())
    }

    pub fn close(&self, terminal_id: &str) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().map_err(|_| PtyError::LockPoisoned)?;
        let mut session = sessions
            .remove(terminal_id)
            .ok_or_else(|| PtyError::NotFound(terminal_id.into()))?;
        normalize_kill_result(session.killer.kill())
    }
}

/// Reconciles portable-pty 0.9's inverted Windows kill result.
///
/// `WinChildKiller::kill` reads as:
///
/// ```ignore
/// let res = unsafe { TerminateProcess(handle, 1) };
/// let err = IoError::last_os_error();
/// if res != 0 { Err(err) } else { Ok(()) }
/// ```
///
/// `TerminateProcess` returns non-zero on success, so the branches are the wrong way round: a
/// terminated process is reported as `Err` carrying whatever `GetLastError` happened to hold —
/// 0 when nothing had failed, but just as often a stale code left by an unrelated earlier call,
/// which is how closing a terminal surfaced "句柄无效 (os error 6)" and "已到文件结尾 (os error 38)".
/// Every error on this path therefore means the process is gone, which is all closing asked for.
/// A genuine failure is unfortunately indistinguishable, since it arrives as `Ok`.
fn normalize_kill_result(result: std::io::Result<()>) -> Result<(), PtyError> {
    #[cfg(windows)]
    {
        if let Err(error) = result {
            tracing::debug!(%error, "终端进程已终止（portable-pty 以错误形式报告成功）");
        }
        Ok(())
    }
    #[cfg(not(windows))]
    result.map_err(|error| PtyError::Backend(error.to_string()))
}

/// Waits for the terminal's process and reports how it ended.
///
/// This is how a failed agent launch becomes visible: a missing executable, a rejected key, or a
/// CLI that exits immediately all leave the PTY open with nothing running behind it. Without this
/// the terminal keeps its running state forever and the user is never told.
fn spawn_exit_watcher(
    terminal_id: String,
    runtime_revision: u64,
    app: AppHandle,
    hub: Arc<RemoteEventHub>,
    mut child: Box<dyn Child + Send>,
) {
    thread::spawn(move || {
        let (exit_code, success) = match child.wait() {
            Ok(status) => (status.exit_code() as i32, status.success()),
            Err(error) => {
                tracing::warn!(%terminal_id, %error, "failed to wait for terminal process");
                (-1, false)
            }
        };
        let event = TerminalExitEvent {
            terminal_id,
            runtime_revision,
            exit_code,
            success,
        };
        hub.publish(EVENT_TERMINAL_EXIT, &event);
        let _ = app.emit(EVENT_TERMINAL_EXIT, &event);
    });
}

fn spawn_reader(
    terminal_id: String,
    runtime_revision: u64,
    app: AppHandle,
    hub: Arc<RemoteEventHub>,
    history: Arc<Mutex<OutputHistory>>,
    mut reader: Box<dyn Read + Send>,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    let chunk = &buffer[..bytes_read];
                    // Sequencing, buffering and publishing share one critical section so a replay
                    // and the live stream can never interleave out of order.
                    let event = {
                        let mut history = match history.lock() {
                            Ok(history) => history,
                            Err(poisoned) => poisoned.into_inner(),
                        };
                        let event = TerminalOutputEvent {
                            terminal_id: terminal_id.clone(),
                            runtime_revision,
                            sequence: history.push(chunk),
                            data: String::from_utf8_lossy(chunk).into_owned(),
                        };
                        hub.publish(EVENT_TERMINAL_OUTPUT, &event);
                        event
                    };
                    let _ = app.emit(EVENT_TERMINAL_OUTPUT, &event);
                }
                Err(error) => {
                    tracing::warn!(%terminal_id, %error, "terminal reader stopped");
                    break;
                }
            }
        }
    });
}

fn configure_shell(
    command: &mut CommandBuilder,
    shell: &str,
    hidden_initial_command: Option<&str>,
) -> bool {
    let normalized_shell = shell.to_ascii_lowercase();
    if normalized_shell.contains("powershell")
        || normalized_shell.ends_with("pwsh")
        || normalized_shell.ends_with("pwsh.exe")
    {
        command.args(["-NoLogo", "-NoProfile"]);
        if let Some(initial_command) = hidden_initial_command {
            command.args(["-NoExit", "-Command"]);
            command.arg(initial_command);
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The user working in a view hands it the terminal, whoever held it before.
    #[test]
    fn working_in_a_view_hands_it_the_terminal() {
        assert!(should_apply_viewport(Some("desktop"), "phone", true));
        assert!(should_apply_viewport(None, "phone", true));
    }

    /// A window that merely changed shape keeps sizing the terminal only while it owns it, so a
    /// background client relaying out itself never reshapes what the user is reading elsewhere.
    #[test]
    fn a_reshaped_background_window_does_not_take_the_terminal() {
        assert!(!should_apply_viewport(Some("desktop"), "phone", false));
        assert!(!should_apply_viewport(None, "phone", false));
    }

    /// The view that owns the terminal keeps it through its own resizes — dragging the desktop
    /// window wider has to widen the agent with it.
    #[test]
    fn the_owning_view_keeps_the_terminal_when_it_resizes() {
        assert!(should_apply_viewport(Some("desktop"), "desktop", false));
    }

    #[test]
    fn powershell_consumes_hidden_initial_commands() {
        let mut powershell = CommandBuilder::new("powershell.exe");
        assert!(configure_shell(
            &mut powershell,
            "powershell.exe",
            Some("codex")
        ));

        let mut pwsh = CommandBuilder::new("pwsh");
        assert!(configure_shell(&mut pwsh, "pwsh", Some("codex")));
    }

    #[test]
    fn other_shells_keep_using_pty_input() {
        let mut bash = CommandBuilder::new("bash");
        assert!(!configure_shell(&mut bash, "bash", Some("codex")));
    }

    #[test]
    fn powershell_without_hidden_command_keeps_using_pty_input() {
        let mut powershell = CommandBuilder::new("powershell.exe");
        assert!(!configure_shell(&mut powershell, "powershell.exe", None));
    }

    /// portable-pty inverts `TerminateProcess`'s result on Windows, so every error it produces
    /// there is a success carrying whatever `GetLastError` held at the time. Treating any of them
    /// as a failure aborts the relaunch meant to replace the process.
    #[cfg(windows)]
    #[test]
    fn every_windows_kill_error_means_the_process_was_terminated() {
        // 0 "success", 6 invalid handle, 38 end of file — all observed in practice.
        for code in [0, 5, 6, 38] {
            let result = normalize_kill_result(Err(std::io::Error::from_raw_os_error(code)));

            assert!(result.is_ok(), "os error {code} should not fail the close");
        }
    }

    /// Only platforms whose kill result is trustworthy can report one.
    #[cfg(not(windows))]
    #[test]
    fn preserves_real_terminal_kill_errors() {
        let result = normalize_kill_result(Err(std::io::Error::from_raw_os_error(5)));

        assert!(matches!(result, Err(PtyError::Backend(_))));
    }

    #[test]
    fn sequences_increase_by_one_per_chunk() {
        let mut history = OutputHistory::default();

        assert_eq!(history.push(b"a"), 1);
        assert_eq!(history.push(b"b"), 2);
        assert_eq!(history.snapshot(3).sequence, 2);
        assert_eq!(history.snapshot(3).data, "ab");
        assert_eq!(history.snapshot(3).runtime_revision, 3);
    }

    #[test]
    fn evicts_whole_chunks_once_the_budget_is_exceeded() {
        let mut history = OutputHistory::default();
        let chunk = vec![b'x'; MAX_SCROLLBACK_BYTES / 2];

        history.push(&chunk);
        history.push(&chunk);
        history.push(b"tail");

        let snapshot = history.snapshot(1);
        assert_eq!(snapshot.sequence, 3);
        // The first half-budget chunk is gone entirely rather than truncated.
        assert_eq!(snapshot.data.len(), chunk.len() + "tail".len());
        assert!(snapshot.data.ends_with("tail"));
    }

    #[test]
    fn a_single_oversized_chunk_is_still_replayable() {
        let mut history = OutputHistory::default();
        let chunk = vec![b'x'; MAX_SCROLLBACK_BYTES * 2];

        history.push(&chunk);

        assert_eq!(history.snapshot(1).data.len(), chunk.len());
    }

    #[test]
    fn multi_byte_characters_split_across_chunks_survive_the_replay() {
        let mut history = OutputHistory::default();
        let encoded = "中".as_bytes();

        history.push(&encoded[..1]);
        history.push(&encoded[1..]);

        assert_eq!(history.snapshot(1).data, "中");
    }

    #[test]
    fn an_unknown_terminal_replays_as_nothing() {
        let scrollback = TerminalScrollback::empty();

        assert!(scrollback.data.is_empty());
        assert_eq!(scrollback.sequence, 0);
        assert_eq!(scrollback.runtime_revision, 0);
    }
}

fn line_ending() -> &'static str {
    if cfg!(windows) {
        "\r\n"
    } else {
        "\n"
    }
}
