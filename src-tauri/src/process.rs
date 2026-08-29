//! Shared helpers for the short-lived child processes Termexo shells out to.
//!
//! Every agent adapter probes its CLI for a version, and OpenCode is additionally queried for its
//! session list. All of those run while the user waits, so they must stay invisible on Windows and
//! must not be able to hang the caller.

use std::ffi::OsStr;
use std::io::{self, Read};
use std::process::{Child, Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// How often a timed wait re-checks a child that has not exited yet.
const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Builds a command that spawns no console window on Windows.
pub fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    hide_window(&mut command);
    command
}

/// Suppresses the console window of a command that has already been built.
pub fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// Stops a child and every process it launched.
///
/// Killing only the `cmd.exe` of a Windows `.cmd` shim leaves the real program alive holding the
/// inherited pipes, so a reader waiting on those pipes never returns even though the child is gone.
pub fn terminate_process_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let pid = child.id().to_string();
        let mut taskkill = hidden_command("taskkill.exe");
        taskkill
            .args(["/PID", &pid, "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = taskkill.status();
    }

    // This is also the non-Windows implementation and a fallback if taskkill could not run.
    let _ = child.kill();
    let _ = child.wait();
}

/// Runs a command to completion, terminating its whole process tree once `timeout` elapses.
///
/// Output is drained on separate threads: a child that fills a pipe blocks until someone reads it,
/// which would otherwise deadlock the wait loop against the very process it is timing.
pub fn run_with_timeout(command: &mut Command, timeout: Duration) -> io::Result<Output> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(command);

    let mut child = command.spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader = thread::spawn(move || read_stream(stdout));
    let stderr_reader = thread::spawn(move || read_stream(stderr));

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= timeout {
            terminate_process_tree(&mut child);
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("命令在 {} 秒内没有结束。", timeout.as_secs()),
            ));
        }
        thread::sleep(POLL_INTERVAL);
    };

    Ok(Output {
        status,
        stdout: stdout_reader.join().unwrap_or_default(),
        stderr: stderr_reader.join().unwrap_or_default(),
    })
}

fn read_stream(reader: Option<impl Read>) -> Vec<u8> {
    let mut buffer = Vec::new();
    if let Some(mut reader) = reader {
        let _ = reader.read_to_end(&mut buffer);
    }
    buffer
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    use std::{
        env, fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    /// Writes a `.cmd` shim that sleeps, mirroring how npm and the agent CLIs are actually invoked.
    ///
    /// The sleep lives in a script rather than in an argument because Rust escapes arguments for
    /// the C runtime, not for `cmd.exe`: an inline quoted command reaches cmd mangled and exits at
    /// once, which would leave this test passing or failing on timing alone.
    #[cfg(windows)]
    fn sleeping_script() -> PathBuf {
        // Only digits and dashes: cmd.exe treats parentheses as command grouping, so a name like
        // `ThreadId(5).cmd` is cut short and the script is never found.
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "termexo-process-timeout-{}-{unique}.cmd",
            std::process::id()
        ));
        fs::write(
            &path,
            "@echo off\r\n%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -Command \"Start-Sleep -Seconds 30\"\r\n",
        )
        .unwrap();
        path
    }

    #[test]
    fn captures_output_of_a_command_that_finishes() {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd.exe");
            command.args(["/d", "/c", "echo termexo"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("echo");
            command.arg("termexo");
            command
        };

        let output = run_with_timeout(&mut command, Duration::from_secs(30)).unwrap();
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("termexo"));
    }

    #[cfg(windows)]
    #[test]
    fn stops_a_command_tree_that_outlives_its_timeout() {
        let script = sleeping_script();
        let mut command = Command::new("cmd.exe");
        command.args(["/d", "/c", "call"]).arg(&script);

        let started = Instant::now();
        let error = run_with_timeout(&mut command, Duration::from_millis(500))
            .expect_err("a script sleeping for 30s cannot finish inside its timeout");
        let elapsed = started.elapsed();
        let _ = fs::remove_file(&script);

        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(
            elapsed < Duration::from_secs(10),
            "terminating the process tree took {elapsed:?}"
        );
    }
}
