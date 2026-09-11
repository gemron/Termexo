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

/// The private modes a reloading client has to be put back into.
///
/// The screen model tracks what was drawn, not how the terminal reports input, so these are read
/// off the stream instead. They are the ones that change what a keypress or a click becomes:
/// mouse reporting in each encoding an agent might ask for, focus reporting, and bracketed paste.
/// Losing the mouse ones is what stops a phone scrolling an agent's viewer after a reload.
const TRACKED_PRIVATE_MODES: &[u16] = &[1000, 1002, 1003, 1004, 1005, 1006, 1015, 1016, 2004];

/// Longest unfinished escape sequence held back for the read that completes it.
///
/// A mode sequence is a dozen bytes at most; anything longer is not one being split across reads,
/// so holding it would only grow without bound on output that never completes a sequence.
const MAX_PENDING_SEQUENCE: usize = 64;

/// Puts the keypad back into application mode, which the screen model does not restore either.
const APPLICATION_KEYPAD: &str = "\x1b=";

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

/// The input modes a reloading client has to be put back into.
///
/// The screen model describes what was drawn; it does not describe how the terminal reports a
/// click, a paste or a keypad key. Those are read off the output stream here, because a client
/// that comes back without them looks fine and behaves wrongly — a phone silently loses the
/// ability to scroll an agent's viewer.
#[derive(Default)]
struct InputModes {
    enabled: std::collections::BTreeSet<u16>,
    keypad_application: bool,
    /// Whether a program has taken the alternate screen, which decides whether history is shown
    /// behind it. The screen model does not report this either.
    alternate_screen: bool,
    /// A sequence cut in half by the end of a read, kept for the read that finishes it.
    carry: Vec<u8>,
}

impl InputModes {
    /// Reads the mode changes out of one chunk of terminal output.
    fn observe(&mut self, chunk: &[u8]) {
        let mut data = std::mem::take(&mut self.carry);
        data.extend_from_slice(chunk);
        let mut index = 0;
        while let Some(offset) = data[index..].iter().position(|byte| *byte == 0x1b) {
            let start = index + offset;
            match self.read_sequence(&data[start..]) {
                Some(used) => index = start + used,
                None => {
                    if data.len() - start <= MAX_PENDING_SEQUENCE {
                        self.carry = data[start..].to_vec();
                    }
                    return;
                }
            }
        }
    }

    /// Applies one sequence and reports its length, or `None` when the read ended inside it.
    fn read_sequence(&mut self, data: &[u8]) -> Option<usize> {
        match data.get(1)? {
            b'=' => {
                self.keypad_application = true;
                Some(2)
            }
            b'>' => {
                self.keypad_application = false;
                Some(2)
            }
            b'[' => self.read_csi(data),
            // Every other sequence is one this does not track. Stepping over the escape byte is
            // enough, because the scan only ever looks for the next one.
            _ => Some(1),
        }
    }

    fn read_csi(&mut self, data: &[u8]) -> Option<usize> {
        let private = data.get(2)? == &b'?';
        let params_start = if private { 3 } else { 2 };
        let mut index = params_start;
        loop {
            let byte = *data.get(index)?;
            if byte.is_ascii_digit() || byte == b';' {
                index += 1;
                continue;
            }
            if private && (byte == b'h' || byte == b'l') {
                let enable = byte == b'h';
                for part in data[params_start..index].split(|byte| *byte == b';') {
                    if let Some(mode) = std::str::from_utf8(part).ok().and_then(|t| t.parse().ok())
                    {
                        self.set(mode, enable);
                    }
                }
            }
            return Some(index + 1);
        }
    }

    fn set(&mut self, mode: u16, enable: bool) {
        // Both spellings of the alternate screen are tracked on their own, because entering it is
        // written once, ahead of the grid, rather than restored alongside the input modes.
        if matches!(mode, 1047 | 1049) {
            self.alternate_screen = enable;
            return;
        }
        if !TRACKED_PRIVATE_MODES.contains(&mode) {
            return;
        }
        if enable {
            self.enabled.insert(mode);
        } else {
            self.enabled.remove(&mode);
        }
    }

    /// The sequences that put a terminal that has seen nothing into these modes.
    fn formatted(&self) -> String {
        let mut out = String::new();
        if self.keypad_application {
            out.push_str(APPLICATION_KEYPAD);
        }
        for mode in &self.enabled {
            out.push_str(&format!("\x1b[?{mode}h"));
        }
        out
    }
}

/// The SGR parameters that select one colour, as a foreground or a background.
fn colour_parameters(colour: avt::Color, background: bool) -> String {
    let base: u16 = if background { 40 } else { 30 };
    match colour {
        avt::Color::Indexed(index) if index < 8 => format!("{}", base + u16::from(index)),
        avt::Color::Indexed(index) if index < 16 => format!("{}", base + 60 + u16::from(index - 8)),
        avt::Color::Indexed(index) => format!("{};5;{index}", base + 8),
        avt::Color::RGB(rgb) => format!("{};2;{};{};{}", base + 8, rgb.r, rgb.g, rgb.b),
    }
}

/// The sequence that selects a pen, written from a known-reset state so it never inherits.
fn pen_sequence(pen: &avt::Pen) -> String {
    if pen.is_default() {
        return RESET_ATTRIBUTES.to_owned();
    }
    let mut parts = vec![String::from("0")];
    for (active, code) in [
        (pen.is_bold(), "1"),
        (pen.is_faint(), "2"),
        (pen.is_italic(), "3"),
        (pen.is_underline(), "4"),
        (pen.is_blink(), "5"),
        (pen.is_inverse(), "7"),
        (pen.is_strikethrough(), "9"),
    ] {
        if active {
            parts.push(code.to_owned());
        }
    }
    if let Some(colour) = pen.foreground() {
        parts.push(colour_parameters(colour, false));
    }
    if let Some(colour) = pen.background() {
        parts.push(colour_parameters(colour, true));
    }
    format!("\x1b[{}m", parts.join(";"))
}

/// One line of history, with the attributes it was drawn in, clipped to the grid's width.
///
/// A line kept from before a resize stays as wide as the grid it was written for, so writing it
/// out in full would wrap onto a second line in a narrower terminal — and every wrapped line
/// pushes what follows down, including the visible grid the redraw has to land exactly on.
fn line_sequence(line: &avt::Line, cols: u16) -> String {
    let mut out = String::new();
    let mut current: Option<avt::Pen> = None;
    let mut width = 0usize;
    for cell in line.cells() {
        // A wide character owns two cells and the second holds no character of its own; writing
        // it would put a stray space after every wide glyph.
        if cell.width() == 0 {
            continue;
        }
        width += usize::from(cell.width());
        if width > usize::from(cols) {
            break;
        }
        if current.as_ref() != Some(cell.pen()) {
            out.push_str(&pen_sequence(cell.pen()));
            current = Some(cell.pen().clone());
        }
        out.push(cell.char());
    }
    out
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
/// Parsing the stream here keeps one screen that is always whole, and [`OutputHistory::snapshot`]
/// describes it as a redraw that stands on its own. A resize costs nothing either: the screen is
/// re-laid out at the new grid the way the terminal in front of the user is, rather than being
/// thrown away for having been drawn at the old one.
struct OutputHistory {
    screen: avt::Vt,
    /// Tracked separately because the screen model does not describe how input is reported.
    modes: InputModes,
    /// Rejoins a character split across two reads, because the screen is fed text, not bytes.
    text: Utf8Reassembler,
    last_sequence: u64,
    /// The grid the screen is kept at, so it can be rebuilt without asking a parser that panicked.
    rows: u16,
    cols: u16,
}

impl OutputHistory {
    fn new(cols: u16, rows: u16) -> Self {
        let (rows, cols) = (rows.max(1), cols.max(1));
        Self {
            screen: Self::build_screen(rows, cols),
            modes: InputModes::default(),
            text: Utf8Reassembler::default(),
            last_sequence: 0,
            rows,
            cols,
        }
    }

    fn build_screen(rows: u16, cols: u16) -> avt::Vt {
        avt::Vt::builder()
            .size(usize::from(cols), usize::from(rows))
            .scrollback_limit(MAX_SCROLLBACK_ROWS)
            .build()
    }

    /// Runs an operation against the parsed screen, rebuilding the screen if the parser panics.
    ///
    /// A terminal model is a large state machine with invariants a resize can break, and one that
    /// asserts them rather than repairing them takes the whole terminal down with it: an unwind
    /// poisons the mutex the screen lives behind, and a poisoned mutex is permanent — every later
    /// read fails, so the terminal never redraws again while its PTY keeps running with nothing
    /// able to reach it. That is how a terminal ended up showing an empty screen marked "stopped"
    /// with its agent still alive.
    ///
    /// Discarding one terminal's scrollback is the cheaper failure by a wide margin, so the screen
    /// is started again at the same grid and the terminal carries on.
    fn guard<T>(&mut self, during: &str, operation: impl FnOnce(&mut avt::Vt) -> T) -> Option<T> {
        let screen = &mut self.screen;
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| operation(screen))) {
            Ok(value) => Some(value),
            Err(_) => {
                tracing::warn!(
                    during,
                    rows = self.rows,
                    cols = self.cols,
                    "terminal screen parser panicked; its scrollback was discarded"
                );
                self.screen = Self::build_screen(self.rows, self.cols);
                None
            }
        }
    }

    /// Draws a chunk onto the screen and returns the sequence assigned to it.
    ///
    /// The sequence advances even when the draw failed, because the chunk was still published to
    /// every client; a client that reads the screen afterwards must not be told it is older.
    fn push(&mut self, chunk: &[u8]) -> u64 {
        self.modes.observe(chunk);
        // The screen is fed text rather than bytes, so the half of a character that arrived in
        // this read waits for the read that finishes it. Decoding each half on its own would turn
        // both into replacement characters and lose the character from the screen entirely — and a
        // full-width one occupies two columns where its replacement occupies one, so everything
        // after it on the line would shift as well.
        let complete = self.text.accept(chunk);
        let text = String::from_utf8_lossy(&complete).into_owned();
        if self
            .guard("drawing output", |screen| {
                screen.feed_str(&text);
            })
            .is_none()
        {
            // The rebuilt screen has never seen this chunk, and it is the newest thing the
            // terminal drew, so it is worth starting the fresh screen from.
            self.guard("redrawing output after a reset", |screen| {
                screen.feed_str(&text);
            });
        }
        self.last_sequence += 1;
        self.last_sequence
    }

    /// Follows the PTY's grid, so a replay is always drawn for the size the client will show it at.
    fn resize(&mut self, cols: u16, rows: u16) {
        self.rows = rows.max(1);
        self.cols = cols.max(1);
        let (rows, cols) = (self.rows, self.cols);
        self.guard("resizing the screen", |screen| {
            screen.resize(usize::from(cols), usize::from(rows));
        });
    }

    /// Describes the screen as output that reproduces it on a terminal that has seen nothing.
    ///
    /// The lines are written in the order the terminal produced them — what has scrolled off
    /// first, then the visible grid — so the client's own scrollback ends up holding the history
    /// exactly as this one does. The visible grid, the cursor and the alternate screen come from
    /// the parser's own dump; the input modes are appended because it does not track them.
    fn snapshot(&mut self, runtime_revision: u64) -> TerminalScrollback {
        let modes = self.modes.formatted();
        let alternate = self.modes.alternate_screen;
        // Reading the screen walks it the same way drawing does, so it is guarded the same way:
        // a redraw that cannot be produced costs this client its history, not the terminal.
        let data = self
            .guard("reading the screen", |screen| {
                Self::encode(screen, &modes, alternate)
            })
            .flatten();
        TerminalScrollback {
            data: data.unwrap_or_default(),
            sequence: self.last_sequence,
            runtime_revision,
        }
    }

    /// Encodes the screen, or `None` when the terminal has drawn nothing worth replaying.
    ///
    /// Every row of the grid is written, including the blank ones, so the cursor lands on the row
    /// it belongs to. The parser's own dump is not used: it writes from wherever the cursor is and
    /// leaves trailing blank rows out, which only reproduces a screen when nothing precedes it —
    /// and replayed history always does.
    fn encode(screen: &avt::Vt, modes: &str, alternate: bool) -> Option<String> {
        let (cols, _) = screen.size();
        let cols = cols as u16;
        let total = screen.lines().count();
        let visible = screen.view().count();
        let scrolled_off = total.saturating_sub(visible);

        // A terminal that has drawn nothing replays as nothing. A view that is starting a terminal
        // rather than joining one would otherwise be sent a screenful of blank lines, pushing the
        // notice it had already written for itself out of sight.
        if scrolled_off == 0 && screen.lines().all(|line| line.text().trim().is_empty()) {
            return None;
        }

        let mut data = String::new();
        // A program drawing on the alternate screen owns the whole grid, and a real terminal shows
        // no scrollback behind it either.
        if alternate {
            data.push_str(ENTER_ALTERNATE_SCREEN);
        } else {
            for line in screen.lines().take(scrolled_off) {
                data.push_str(&line_sequence(line, cols));
                data.push_str(END_OF_LINE);
            }
        }

        // The last visible row deliberately ends without a newline: that leaves the client's
        // viewport sitting on the grid rather than scrolled one row past it.
        for (index, line) in screen.view().enumerate() {
            if index > 0 {
                data.push_str(END_OF_LINE);
            }
            data.push_str(&line_sequence(line, cols));
        }

        let cursor = screen.cursor();
        data.push_str(RESET_ATTRIBUTES);
        data.push_str(&format!("\x1b[{};{}H", cursor.row + 1, cursor.col + 1));
        if !cursor.visible {
            data.push_str(HIDE_CURSOR);
        }
        data.push_str(modes);
        Some(data)
    }
}

fn lock_recovering<T>(lock: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match lock.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::warn!(
                "terminal manager lock had been poisoned by an earlier panic; recovered"
            );
            poisoned.into_inner()
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
        let sessions = lock_recovering(&self.sessions);
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
        let sessions = lock_recovering(&self.sessions);
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
        let sessions = lock_recovering(&self.sessions);
        Ok(sessions.get(terminal_id).map(|session| {
            session
                .active_viewport
                .as_ref()
                .map(|(_, viewport)| (viewport.cols, viewport.rows))
                .unwrap_or((DEFAULT_COLS, DEFAULT_ROWS))
        }))
    }

    /// Describes one terminal's screen, without holding the session map while doing it.
    ///
    /// Taking the snapshot is the only real work here — walking the scrolled-off lines and
    /// encoding a redraw — and the session map is what every terminal's input, output, resize and
    /// launch has to pass through. Holding it for the duration put all of them behind one
    /// terminal's redraw, so two clients each redrawing what the other's resize announced was
    /// enough to keep the map busy continuously and stall both ends. The history is reached
    /// through its own handle, so the map is released before any of that begins.
    pub fn read_scrollback(&self, terminal_id: &str) -> Result<TerminalScrollback, PtyError> {
        let (history, runtime_revision) = {
            let sessions = lock_recovering(&self.sessions);
            let Some(session) = sessions.get(terminal_id) else {
                return Ok(TerminalScrollback::empty());
            };
            (session.history.clone(), session.runtime_revision)
        };
        let mut history = lock_recovering(&history);
        Ok(history.snapshot(runtime_revision))
    }

    /// Starts the terminal's process, or reports `false` when one is already running under this id.
    pub fn start(
        &self,
        request: TerminalStartRequest,
        app: AppHandle,
        environment: HashMap<String, String>,
    ) -> Result<bool, PtyError> {
        let mut sessions = lock_recovering(&self.sessions);
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
        let mut sessions = lock_recovering(&self.sessions);
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
        let mut sessions = lock_recovering(&self.sessions);
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
        let mut sessions = lock_recovering(&self.sessions);
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
                    // Only drawing the chunk onto the screen needs the lock. Encoding and
                    // publishing used to sit inside it as well, to keep a replay and the live
                    // stream from interleaving, but the sequence number already settles that: a
                    // client drops anything the snapshot it just applied already covered, however
                    // the two arrive. Holding the lock for the rest starved the reads that take it
                    // — a screen is read out under the same lock — and a terminal producing output
                    // steadily could keep a redraw waiting indefinitely, which left that terminal
                    // buffering everything it produced and showing none of it.
                    let sequence = {
                        let mut history = match history.lock() {
                            Ok(history) => history,
                            Err(poisoned) => poisoned.into_inner(),
                        };
                        history.push(chunk)
                    };
                    let event = TerminalOutputEvent {
                        terminal_id: terminal_id.clone(),
                        runtime_revision,
                        sequence,
                        data: String::from_utf8_lossy(chunk).into_owned(),
                    };
                    hub.publish(EVENT_TERMINAL_OUTPUT, &event);
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
    fn replay_into(snapshot: &str, cols: u16, rows: u16) -> avt::Vt {
        let mut client = OutputHistory::build_screen(rows, cols);
        client.feed_str(snapshot);
        client
    }

    /// The grid a terminal is showing right now, which is what a redraw has to reproduce exactly.
    fn visible_grid(screen: &avt::Vt) -> Vec<String> {
        screen
            .view()
            .map(|line| line.text().trim_end().to_owned())
            .collect()
    }

    /// What a terminal is showing, with the trailing blank lines a comparison does not care about.
    fn shown(screen: &avt::Vt) -> Vec<String> {
        let mut lines: Vec<String> = screen
            .text()
            .into_iter()
            .map(|line| line.trim_end().to_owned())
            .collect();
        while lines.last().is_some_and(|line| line.is_empty()) {
            lines.pop();
        }
        lines
    }

    #[test]
    fn sequences_increase_by_one_per_chunk() {
        let mut history = OutputHistory::new(20, 4);

        assert_eq!(history.push(b"a"), 1);
        assert_eq!(history.push(b"b"), 2);
        assert_eq!(history.snapshot(3).sequence, 2);
        assert_eq!(history.snapshot(3).runtime_revision, 3);
    }

    /// Replaying a screen has to survive whatever an agent draws, not just the cases someone
    /// thought to write down — a terminal that redraws, resizes and writes wide characters is
    /// exactly where the previous parser asserted its way out of a usable terminal.
    #[test]
    fn a_snapshot_reproduces_the_screen_across_many_random_sessions() {
        // xorshift, so a failure is reproducible from the round number alone.
        let mut state = 0x2026_09_11_u64;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };

        for round in 0..300 {
            let mut history = OutputHistory::new(80, 24);
            for _ in 0..30 {
                match next() % 7 {
                    0 => history.push(
                        format!("\x1b[3{}m混合 output 中文\x1b[0m\r\n", next() % 8).as_bytes(),
                    ),
                    1 => history.push(format!("\x1b[{}A\x1b[K", 1 + next() % 20).as_bytes()),
                    2 => history
                        .push(format!("\x1b[{};{}H", 1 + next() % 24, 1 + next() % 80).as_bytes()),
                    3 => history.push(b"\x1b[?1049h"),
                    4 => history.push(b"\x1b[?1049l"),
                    5 => {
                        history.resize(40 + (next() % 200) as u16, 10 + (next() % 40) as u16);
                        0
                    }
                    _ => history
                        .push(format!("{}\r\n", "x".repeat((next() % 100) as usize)).as_bytes()),
                };
            }

            let snapshot = history.snapshot(1);
            let (rows, cols) = (history.rows, history.cols);
            let client = replay_into(&snapshot.data, cols, rows);
            // The visible grid is compared, not the scrollback: a line kept from before a resize
            // stays at the width it was written at, so replaying it wraps where the stored line
            // does not. Every client wraps it the same way, so what they show still agrees — it is
            // only the backend's own copy that holds the longer line.
            assert_eq!(
                visible_grid(&client),
                visible_grid(&history.screen),
                "round {round} did not reproduce the screen"
            );
        }
    }

    /// A mode sequence can be cut in half by a read boundary the same way a character can, and
    /// losing one is silent: the terminal looks right and stops reporting the mouse.
    #[test]
    fn a_mode_sequence_split_across_reads_is_still_seen() {
        let mut history = OutputHistory::new(20, 4);

        history.push(b"\x1b[?1000h\x1b[?10");
        history.push(b"06h\x1b[?2004hprompt");

        let restored = history.modes.formatted();
        assert!(restored.contains("\x1b[?1000h"));
        assert!(restored.contains("\x1b[?1006h"));
        assert!(restored.contains("\x1b[?2004h"));
    }

    #[test]
    fn a_mode_the_program_turned_off_is_not_restored() {
        let mut history = OutputHistory::new(20, 4);

        history.push(b"\x1b[?1000h\x1b[?1006h");
        history.push(b"\x1b[?1000l");

        let restored = history.modes.formatted();
        assert!(!restored.contains("\x1b[?1000h"));
        assert!(restored.contains("\x1b[?1006h"));
    }

    /// Runs something that panics without the default hook printing a backtrace for it.
    fn quietly<T>(body: impl FnOnce() -> T) -> std::thread::Result<T> {
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(body));
        std::panic::set_hook(hook);
        result
    }

    /// The parser asserts invariants a resize can break, and an unwind out of one would poison the
    /// mutex the screen lives behind — permanently, for the life of the process. That is what left
    /// a terminal showing an empty screen marked "stopped" while its agent kept running.
    #[test]
    fn a_panicking_screen_operation_costs_the_scrollback_not_the_terminal() {
        let mut history = OutputHistory::new(20, 4);
        history.push(b"drawn before the parser gave up");

        let result = quietly(|| {
            let mut history = OutputHistory::new(20, 4);
            history.push(b"first");
            let outcome = history.guard("a parser that panics", |_| panic!("parser gave up"));
            assert!(outcome.is_none());
            // The screen was rebuilt at the same grid, so the terminal keeps working.
            assert_eq!(history.push(b"drawn after"), 2);
            history.snapshot(1).data
        });

        let replayed = result.expect("the panic must not escape the guard");
        assert!(replayed.contains("drawn after"));
        // The sequence keeps counting, so a client can still tell what it has already seen.
        assert_eq!(history.push(b"and the original history is unaffected"), 2);
    }

    /// A poisoned lock stays poisoned, so refusing it would disable every terminal for good.
    #[test]
    fn a_poisoned_lock_is_recovered_rather_than_refused() {
        let lock = Mutex::new(String::from("still here"));

        let _ = quietly(|| {
            let _guard = lock.lock().expect("first lock succeeds");
            panic!("a holder panicked");
        });

        assert!(lock.lock().is_err(), "the lock should now be poisoned");
        assert_eq!(*lock_recovering(&lock), "still here");
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
        assert_eq!(shown(&client), shown(&history.screen));
        assert_eq!(client.cursor(), history.screen.cursor());
    }

    /// A cut in the middle of a frame is exactly what replaying a raw stream could not survive.
    #[test]
    fn a_snapshot_taken_mid_frame_still_replays_whole() {
        let mut history = OutputHistory::new(20, 4);
        // A redraw split across reads, the second half of which has not arrived yet.
        history.push(b"\x1b[H\x1b[2Jfirst line\r\nsecond li");

        let client = replay_into(&history.snapshot(1).data, 20, 4);

        assert_eq!(shown(&client), shown(&history.screen));
        assert!(shown(&client).iter().any(|line| line.contains("second li")));
    }

    #[test]
    fn lines_that_scrolled_off_are_replayed_above_the_screen() {
        let mut history = OutputHistory::new(20, 3);
        history.push(b"one\r\ntwo\r\nthree\r\nfour\r\nfive");

        let snapshot = history.snapshot(1);

        // The visible grid holds the last three lines; the first two are only in the scrollback.
        let client = replay_into(&snapshot.data, 20, 3);
        let history_and_screen: Vec<String> = client
            .lines()
            .map(|line| line.text().trim_end().to_owned())
            .collect();
        assert_eq!(history_and_screen, ["one", "two", "three", "four", "five"]);
        assert_eq!(client.view().count(), 3);
    }

    /// Input modes decide how the client's keyboard and mouse report, so a reload has to restore
    /// them — losing mouse tracking is what stops a phone scrolling an agent's viewer.
    #[test]
    fn input_modes_survive_the_replay() {
        let mut history = OutputHistory::new(20, 4);
        history.push(b"\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?25lprompt");

        // avt models the screen, not how input is reported, so the modes are read back from the
        // snapshot the way a client's own tracker would see them.
        let mut restored = InputModes::default();
        restored.observe(history.snapshot(1).data.as_bytes());

        assert_eq!(restored.formatted(), history.modes.formatted());
        for mode in ["\u{1b}[?1000h", "\u{1b}[?1006h", "\u{1b}[?2004h"] {
            assert!(restored.formatted().contains(mode), "missing {mode:?}");
        }
        let client = replay_into(&history.snapshot(1).data, 20, 4);
        assert!(!client.cursor().visible);
    }

    /// A program on the alternate screen owns the whole grid, and nothing sits behind it.
    #[test]
    fn the_alternate_screen_replays_without_the_scrollback_behind_it() {
        let mut history = OutputHistory::new(20, 3);
        history.push(b"shell one\r\nshell two\r\nshell three\r\nshell four\r\n");
        history.push(b"\x1b[?1049heditor");

        let client = replay_into(&history.snapshot(1).data, 20, 3);

        // The alternate screen owns the whole grid. avt keeps the normal screen underneath it, so
        // the alternate grid is what `lines()` describes while `text()` still describes the one
        // beneath — which is also why no scrollback is replayed behind it.
        let alternate: Vec<String> = client
            .lines()
            .map(|line| line.text().trim_end().to_owned())
            .collect();
        assert!(alternate.iter().any(|line| line.contains("editor")));
        assert!(!alternate.iter().any(|line| line.contains("shell")));
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
