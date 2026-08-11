use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use thiserror::Error;

use crate::commands::terminal::TerminalStartRequest;

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

struct PtyProcess {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    /// The child itself is owned by the exit watcher, which blocks on it; closing a terminal only
    /// ever needs to kill it.
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtyProcess>>,
}

impl PtyManager {
    pub fn start(
        &self,
        request: TerminalStartRequest,
        app: AppHandle,
        environment: HashMap<String, String>,
    ) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().map_err(|_| PtyError::LockPoisoned)?;
        if sessions.contains_key(&request.terminal_id) {
            return Ok(());
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

        spawn_reader(
            request.terminal_id.clone(),
            request.runtime_revision,
            app.clone(),
            reader,
        );
        spawn_exit_watcher(
            request.terminal_id.clone(),
            request.runtime_revision,
            app,
            child,
        );

        sessions.insert(
            request.terminal_id,
            PtyProcess {
                writer,
                master: pair.master,
                killer,
            },
        );
        Ok(())
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

    pub fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        let sessions = self.sessions.lock().map_err(|_| PtyError::LockPoisoned)?;
        let session = sessions
            .get(terminal_id)
            .ok_or_else(|| PtyError::NotFound(terminal_id.into()))?;
        session
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError::Backend(error.to_string()))
    }

    pub fn close(&self, terminal_id: &str) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().map_err(|_| PtyError::LockPoisoned)?;
        let mut session = sessions
            .remove(terminal_id)
            .ok_or_else(|| PtyError::NotFound(terminal_id.into()))?;
        normalize_kill_result(session.killer.kill())
    }
}

/// portable-pty 0.9 reports a successful Windows `TerminateProcess` call as an I/O error built
/// from `GetLastError`. When Windows has no pending error that becomes the contradictory message
/// "The operation completed successfully. (os error 0)". The process was terminated, so treating
/// that one value as a failure makes model switching roll back a successful close.
fn normalize_kill_result(result: std::io::Result<()>) -> Result<(), PtyError> {
    match result {
        Ok(()) => Ok(()),
        #[cfg(windows)]
        Err(error) if error.raw_os_error() == Some(0) => Ok(()),
        Err(error) => Err(PtyError::Backend(error.to_string())),
    }
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
        let _ = app.emit(
            "terminal-exit",
            TerminalExitEvent {
                terminal_id,
                runtime_revision,
                exit_code,
                success,
            },
        );
    });
}

fn spawn_reader(
    terminal_id: String,
    runtime_revision: u64,
    app: AppHandle,
    mut reader: Box<dyn Read + Send>,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    let data = String::from_utf8_lossy(&buffer[..bytes_read]).into_owned();
                    let _ = app.emit(
                        "terminal-output",
                        TerminalOutputEvent {
                            terminal_id: terminal_id.clone(),
                            runtime_revision,
                            data,
                        },
                    );
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

    #[cfg(windows)]
    #[test]
    fn accepts_portable_pty_windows_success_reported_as_os_error_zero() {
        let result = normalize_kill_result(Err(std::io::Error::from_raw_os_error(0)));

        assert!(result.is_ok());
    }

    #[test]
    fn preserves_real_terminal_kill_errors() {
        let result = normalize_kill_result(Err(std::io::Error::from_raw_os_error(5)));

        assert!(matches!(result, Err(PtyError::Backend(_))));
    }
}

fn line_ending() -> &'static str {
    if cfg!(windows) {
        "\r\n"
    } else {
        "\n"
    }
}
