use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
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
    data: String,
}

struct PtyProcess {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtyProcess>>,
}

impl PtyManager {
    pub fn start(&self, request: TerminalStartRequest, app: AppHandle) -> Result<(), PtyError> {
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
        configure_shell(&mut command, &request.shell);

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| PtyError::Spawn(error.to_string()))?;
        drop(pair.slave);
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| PtyError::Backend(error.to_string()))?;
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|error| PtyError::Backend(error.to_string()))?;

        if let Some(initial_command) = request.command.as_deref().filter(|value| !value.is_empty())
        {
            writer.write_all(initial_command.as_bytes())?;
            writer.write_all(line_ending().as_bytes())?;
            writer.flush()?;
        }

        spawn_reader(request.terminal_id.clone(), app, reader);

        sessions.insert(
            request.terminal_id,
            PtyProcess {
                writer,
                master: pair.master,
                child,
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
        session
            .child
            .kill()
            .map_err(|error| PtyError::Backend(error.to_string()))?;
        Ok(())
    }
}

fn spawn_reader(terminal_id: String, app: AppHandle, mut reader: Box<dyn Read + Send>) {
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

fn configure_shell(command: &mut CommandBuilder, shell: &str) {
    if shell.to_ascii_lowercase().contains("powershell") {
        command.args(["-NoLogo", "-NoProfile"]);
    }
}

fn line_ending() -> &'static str {
    if cfg!(windows) {
        "\r\n"
    } else {
        "\n"
    }
}
