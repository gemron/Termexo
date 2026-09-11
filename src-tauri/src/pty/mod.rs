pub mod backend;

use std::collections::HashMap;
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

/// How much of what has scrolled off a terminal is kept for a client that attaches or reloads.
///
/// Counted in lines rather than bytes, because what is kept is the screen itself: a line costs
/// what its characters cost, where the stream that drew it also cost every redraw of it.
///
/// A kept line is a row of cells, not the text of one, so the budget is real memory: at a wide
/// desktop grid this is roughly 4.5 MB per terminal, and every open terminal pays it. Six hundred
/// lines is around twenty screens on a phone and a handful on a desktop, which is as far back as
/// anyone scrolls after a reload.
const MAX_SCROLLBACK_ROWS: usize = 600;

/// Ends a replayed line, clearing the attributes so they cannot bleed into the line after it.
const END_OF_LINE: &str = "\x1b[m\r\n";
const RESET_ATTRIBUTES: &str = "\x1b[m";
const ENTER_ALTERNATE_SCREEN: &str = "\x1b[?1049h";
const HIDE_CURSOR: &str = "\x1b[?25l";
const SHOW_CURSOR: &str = "\x1b[?25h";

/// Grid a terminal falls back to when no viewer has claimed a size, matching the VT default.
const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;

/// A terminal whose process is still running, as a loading client needs to see it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTerminal {
    pub terminal_id: String,
    pub runtime_revision: u64,
}

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
    /// A redraw of the terminal's screen, not the output that produced it — see [`OutputHistory`].
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

/// The screen a terminal is showing, kept so a client can be handed the picture rather than the
/// instructions that painted it.
///
/// Replaying the raw output stream cannot be made to work. The buffer has to be bounded, and a cut
/// anywhere leaves the replay starting mid-frame: the cursor position, character attributes,
/// scroll region and screen mode that everything after the cut was written against all sit in the
/// part that was dropped. The client's emulator runs those instructions against whatever it
/// happens to have instead, which is what put duplicated frames, misplaced cursors and rewrapped
/// lines on a reloaded page.
///
/// Parsing the stream here keeps one screen that is always whole, and [`OutputHistory::snapshot`] describes
/// it as a redraw that stands on its own. A resize costs nothing either: the screen is re-laid out
/// at the new grid the way the terminal in front of the user is, rather than being thrown away for
/// having been drawn at the old one.
struct OutputHistory {
    screen: vt100::Parser,
    last_sequence: u64,
}

impl OutputHistory {
    fn new(cols: u16, rows: u16) -> Self {
        Self {
            screen: vt100::Parser::new(rows.max(1), cols.max(1), MAX_SCROLLBACK_ROWS),
            last_sequence: 0,
        }
    }

    /// Draws a chunk onto the screen and returns the sequence assigned to it.
    fn push(&mut self, chunk: &[u8]) -> u64 {
        self.screen.process(chunk);
        self.last_sequence += 1;
        self.last_sequence
    }

    /// Follows the PTY's grid, so a replay is always drawn for the size the client will show it at.
    fn resize(&mut self, cols: u16, rows: u16) {
        self.screen.screen_mut().set_size(rows.max(1), cols.max(1));
    }

    /// Describes the screen as output that reproduces it on a terminal that has seen nothing.
    ///
    /// The lines are written in the order the terminal produced them — what has scrolled off
    /// first, then the visible grid — so the client's own scrollback ends up holding the history
    /// exactly as this one does. The last visible line deliberately ends without a newline: that
    /// leaves the client's viewport sitting on the visible grid rather than scrolled a line past
    /// it. Cursor position and input modes are restored last, because writing the lines moves the
    /// cursor and the modes decide how the client's keyboard and mouse report from here on.
    fn snapshot(&mut self, runtime_revision: u64) -> TerminalScrollback {
        let (_, cols) = self.screen.screen().size();
        // A program drawing on the alternate screen — an editor, or an agent's own viewer — owns
        // the whole grid, and a real terminal shows no scrollback behind it either.
        let alternate = self.screen.screen().alternate_screen();
        let scrolled_off = if alternate {
            Vec::new()
        } else {
            self.scrolled_off_lines(cols)
        };

        // A terminal that has drawn nothing replays as nothing. A view that is starting a terminal
        // rather than joining one would otherwise be sent a screenful of blank lines, pushing the
        // notice it had already written for itself out of sight.
        if scrolled_off.is_empty() && self.screen.screen().contents().is_empty() {
            return TerminalScrollback {
                data: String::new(),
                sequence: self.last_sequence,
                runtime_revision,
            };
        }

        let mut data = String::new();
        if alternate {
            data.push_str(ENTER_ALTERNATE_SCREEN);
        }
        for line in scrolled_off {
            data.push_str(&line);
            data.push_str(END_OF_LINE);
        }

        let screen = self.screen.screen();
        for (index, row) in screen.rows_formatted(0, cols).enumerate() {
            if index > 0 {
                data.push_str(END_OF_LINE);
            }
            data.push_str(&String::from_utf8_lossy(&row));
        }

        let (cursor_row, cursor_col) = screen.cursor_position();
        data.push_str(RESET_ATTRIBUTES);
        data.push_str(&format!("\x1b[{};{}H", cursor_row + 1, cursor_col + 1));
        data.push_str(if screen.hide_cursor() {
            HIDE_CURSOR
        } else {
            SHOW_CURSOR
        });
        data.push_str(&String::from_utf8_lossy(&screen.input_mode_formatted()));

        TerminalScrollback {
            data,
            sequence: self.last_sequence,
            runtime_revision,
        }
    }

    /// The lines that have scrolled off the top of the screen, oldest first.
    ///
    /// A line above the screen is only reachable by moving the viewport over it, so the viewport
    /// walks down the history one line at a time and its top line is read off at each step. Asking
    /// to scroll back further than there is history settles on however much there is, which is
    /// also how the depth is found.
    fn scrolled_off_lines(&mut self, cols: u16) -> Vec<String> {
        self.screen.screen_mut().set_scrollback(usize::MAX);
        let depth = self.screen.screen().scrollback();
        let mut lines = Vec::with_capacity(depth);
        for offset in (1..=depth).rev() {
            self.screen.screen_mut().set_scrollback(offset);
            if let Some(row) = self.screen.screen().rows_formatted(0, cols).next() {
                lines.push(String::from_utf8_lossy(&row).into_owned());
            }
        }
        self.screen.screen_mut().set_scrollback(0);
        lines
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
    /// The grid the PTY was last actually resized to. A viewer reporting the size it already has
    /// must not be read as a change, or every report would re-lay out the screen kept for replay.
    applied_viewport: Option<TerminalViewport>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
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

    /// Every terminal with a process still running, and which launch of it that is.
    ///
    /// A client that loads has no other way to tell an app that just started — where nothing is
    /// running and every terminal has to be launched — from a window that merely reloaded, or a
    /// second client joining, where relaunching would kill the agents mid-task.
    pub fn live_terminals(&self) -> Result<Vec<LiveTerminal>, PtyError> {
        let sessions = self.sessions.lock().map_err(|_| PtyError::LockPoisoned)?;
        Ok(sessions
            .iter()
            .map(|(terminal_id, session)| LiveTerminal {
                terminal_id: terminal_id.clone(),
                runtime_revision: session.runtime_revision,
            })
            .collect())
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
        let mut history = session.history.lock().map_err(|_| PtyError::LockPoisoned)?;
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

        let history = Arc::new(Mutex::new(OutputHistory::new(
            request.cols.max(1),
            request.rows.max(1),
        )));
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
                // The PTY was opened at this grid, so nothing has moved yet.
                applied_viewport: Some(TerminalViewport {
                    cols: request.cols.max(1),
                    rows: request.rows.max(1),
                }),
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
        session: &mut PtyProcess,
        app: &AppHandle,
    ) -> Result<(), PtyError> {
        let Some(viewport) = session
            .active_viewport
            .as_ref()
            .map(|(_, viewport)| *viewport)
        else {
            return Ok(());
        };
        // A viewer reporting the grid the PTY already has changes nothing; only a grid that really
        // moves is worth re-laying the replay screen out for.
        let changed = session.applied_viewport != Some(viewport);
        session
            .master
            .resize(PtySize {
                rows: viewport.rows,
                cols: viewport.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError::Backend(error.to_string()))?;
        session.applied_viewport = Some(viewport);
        if changed {
            if let Ok(mut history) = session.history.lock() {
                history.resize(viewport.cols, viewport.rows);
            }
        }

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

/// Reassembles the characters a PTY read split in half.
///
/// A read returns whatever bytes happened to be ready, so a multi-byte character — and every CJK
/// one is three bytes — can straddle two of them. Decoding each read on its own turns both halves
/// into replacement characters and destroys the character for every client at once. The damage
/// does not stop at the glyph: a full-width character occupies two columns where its replacement
/// occupies one, so the rest of that line shifts a column left and the agent's next redraw, which
/// positions itself by the columns it believes it wrote, lands on top of the shifted remains.
///
/// Holding an incomplete tail back until the read that finishes it keeps the stream whole. The
/// held bytes move into the next chunk for the replay buffer as well, so history and live events
/// stay describing exactly the same stream.
#[derive(Default)]
struct Utf8Reassembler {
    carry: Vec<u8>,
}

impl Utf8Reassembler {
    /// The bytes that are now safe to decode, with any half-finished character kept back.
    fn accept(&mut self, chunk: &[u8]) -> Vec<u8> {
        let mut data = std::mem::take(&mut self.carry);
        data.extend_from_slice(chunk);
        let complete = match std::str::from_utf8(&data) {
            Ok(_) => data.len(),
            // `error_len` is None only where the bytes ran out mid-character, which the next read
            // completes. A genuinely invalid sequence is passed on to be decoded lossily instead,
            // because no later byte will ever make it valid and carrying it would stall the
            // stream.
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            Err(_) => data.len(),
        };
        self.carry = data.split_off(complete);
        data
    }
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
        let mut reassembler = Utf8Reassembler::default();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    let chunk = reassembler.accept(&buffer[..bytes_read]);
                    if chunk.is_empty() {
                        // The whole read was the first bytes of a character; nothing to publish
                        // until the read that completes it.
                        continue;
                    }
                    let chunk = chunk.as_slice();
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

    #[test]
    fn a_character_split_across_two_reads_survives_whole() {
        // Three bytes for one ideograph, cut where an 8 KiB read would happen to end.
        let text = "\u{6587}\u{4ef6}";
        let bytes = text.as_bytes();
        let (head, tail) = bytes.split_at(4);
        let mut reassembler = Utf8Reassembler::default();

        let first = reassembler.accept(head);
        let second = reassembler.accept(tail);

        // The half character is held back rather than published as a replacement.
        assert_eq!(String::from_utf8_lossy(&first), "\u{6587}");
        assert_eq!(String::from_utf8_lossy(&second), "\u{4ef6}");
        // And nothing is invented or lost: the two together are the original stream.
        assert_eq!([first, second].concat(), bytes);
    }

    #[test]
    fn a_read_holding_only_half_a_character_publishes_nothing_yet() {
        let bytes = "\u{6587}".as_bytes();
        let mut reassembler = Utf8Reassembler::default();

        assert!(reassembler.accept(&bytes[..2]).is_empty());
        assert_eq!(reassembler.accept(&bytes[2..]), bytes);
    }

    #[test]
    fn bytes_that_can_never_become_a_character_are_passed_on_rather_than_held() {
        let mut reassembler = Utf8Reassembler::default();

        // A stray 0xFF is invalid wherever it lands, so carrying it would stall the stream.
        let published = reassembler.accept(&[b'a', 0xFF, b'b']);

        assert_eq!(published, vec![b'a', 0xFF, b'b']);
        assert!(reassembler.carry.is_empty());
    }

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

    /// Feeds a snapshot to a terminal that has seen nothing, the way a reloading client does.
    fn replay_into(snapshot: &str, cols: u16, rows: u16) -> vt100::Parser {
        let mut client = vt100::Parser::new(rows, cols, MAX_SCROLLBACK_ROWS);
        client.process(snapshot.as_bytes());
        client
    }

    #[test]
    fn sequences_increase_by_one_per_chunk() {
        let mut history = OutputHistory::new(20, 4);

        assert_eq!(history.push(b"a"), 1);
        assert_eq!(history.push(b"b"), 2);
        assert_eq!(history.snapshot(3).sequence, 2);
        assert_eq!(history.snapshot(3).runtime_revision, 3);
    }

    #[test]
    fn a_terminal_that_has_drawn_nothing_replays_as_nothing() {
        let mut history = OutputHistory::new(20, 4);

        assert!(history.snapshot(1).data.is_empty());

        history.push(b"first output");

        assert!(history.snapshot(1).data.contains("first output"));
    }

    /// The whole point of replaying a screen rather than a stream: what the client ends up showing
    /// is what the terminal is showing, cell for cell.
    #[test]
    fn a_replayed_snapshot_reproduces_the_screen() {
        let mut history = OutputHistory::new(20, 4);
        history.push(b"\x1b[31mred\x1b[0m\r\nplain\r\n\x1b[1;32mbold green\x1b[0m");

        let snapshot = history.snapshot(1);

        let client = replay_into(&snapshot.data, 20, 4);
        assert_eq!(
            client.screen().contents(),
            history.screen.screen().contents()
        );
        assert_eq!(
            client.screen().cursor_position(),
            history.screen.screen().cursor_position()
        );
    }

    /// A cut in the middle of a frame is exactly what replaying a raw stream could not survive.
    #[test]
    fn a_snapshot_taken_mid_frame_still_replays_whole() {
        let mut history = OutputHistory::new(20, 4);
        // A redraw split across reads, the second half of which has not arrived yet.
        history.push(b"\x1b[H\x1b[2Jfirst line\r\nsecond li");

        let client = replay_into(&history.snapshot(1).data, 20, 4);

        assert_eq!(
            client.screen().contents(),
            history.screen.screen().contents()
        );
        assert!(client.screen().contents().contains("second li"));
    }

    #[test]
    fn lines_that_scrolled_off_are_replayed_above_the_screen() {
        let mut history = OutputHistory::new(20, 3);
        history.push(b"one\r\ntwo\r\nthree\r\nfour\r\nfive");

        let snapshot = history.snapshot(1);

        // The visible grid holds the last three lines; the first two are only in the scrollback.
        let mut client = replay_into(&snapshot.data, 20, 3);
        assert_eq!(client.screen().contents(), "three\nfour\nfive");
        client.screen_mut().set_scrollback(2);
        assert!(client.screen().contents().contains("one"));
    }

    /// Input modes decide how the client's keyboard and mouse report, so a reload has to restore
    /// them — losing mouse tracking is what stops a phone scrolling an agent's viewer.
    #[test]
    fn input_modes_survive_the_replay() {
        let mut history = OutputHistory::new(20, 4);
        history.push(b"\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?25lprompt");

        let client = replay_into(&history.snapshot(1).data, 20, 4);

        assert!(client.screen().bracketed_paste());
        assert!(client.screen().hide_cursor());
        assert_eq!(
            client.screen().mouse_protocol_mode(),
            history.screen.screen().mouse_protocol_mode()
        );
        assert_eq!(
            client.screen().mouse_protocol_encoding(),
            history.screen.screen().mouse_protocol_encoding()
        );
    }

    /// A program on the alternate screen owns the whole grid, and nothing sits behind it.
    #[test]
    fn the_alternate_screen_replays_without_the_scrollback_behind_it() {
        let mut history = OutputHistory::new(20, 3);
        history.push(b"shell one\r\nshell two\r\nshell three\r\nshell four\r\n");
        history.push(b"\x1b[?1049heditor");

        let client = replay_into(&history.snapshot(1).data, 20, 3);

        assert!(client.screen().alternate_screen());
        assert!(client.screen().contents().contains("editor"));
        assert!(!client.screen().contents().contains("shell"));
    }

    #[test]
    fn a_resize_re_lays_out_the_screen_instead_of_discarding_it() {
        let mut history = OutputHistory::new(40, 4);
        history.push(b"kept across the resize");
        let sequence = history.last_sequence;

        history.resize(20, 4);

        assert!(history.snapshot(1).data.contains("kept across"));
        // The stream keeps counting, so a client can still tell what it has already seen.
        assert_eq!(history.last_sequence, sequence);
        assert_eq!(history.push(b" and after it"), sequence + 1);
    }

    #[test]
    fn multi_byte_characters_split_across_chunks_survive_the_replay() {
        let mut history = OutputHistory::new(20, 4);
        let encoded = "中".as_bytes();

        history.push(&encoded[..1]);
        history.push(&encoded[1..]);

        assert!(history.snapshot(1).data.contains('中'));
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
