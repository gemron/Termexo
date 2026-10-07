use std::fs::File;
use std::io::{self, BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;

use serde_json::{json, Value};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use super::AgentEvent;

/// A resumed main session has a known rollout. Follow only new records, never its history or
/// sibling/subagent files. Healthy lifecycle hooks remain the primary status source.
pub(super) struct CodexRolloutWatch {
    path: PathBuf,
    session_id: String,
    cursor: u64,
    pub hook_seen: bool,
    pub last_hook_completion: Option<i64>,
    turn_started_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn record(kind: &str, turn: &str) -> String {
        format!(
            "{}\n",
            json!({
                "timestamp": "2026-10-07T10:23:11.208Z", "type": "event_msg",
                "payload": {"type": kind, "turn_id": turn, "last_agent_message": "private reply"}
            })
        )
    }

    #[test]
    fn follows_only_new_complete_main_session_records_without_spooling_content() {
        let path = std::env::temp_dir().join(format!(
            "termexo-rollout-{}-{}.jsonl",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&path, record("task_complete", "old-turn")).unwrap();
        let mut watch = CodexRolloutWatch::new(path.clone(), "main-session".into()).unwrap();
        assert!(watch.read("terminal").unwrap().is_empty());
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(record("task_started", "new-turn").as_bytes())
            .unwrap();
        file.write_all(record("agent_message", "new-turn").as_bytes())
            .unwrap();
        let completed = record("task_complete", "new-turn");
        let split = completed.len() / 2;
        file.write_all(completed[..split].as_bytes()).unwrap();
        let started = watch.read("terminal").unwrap();
        assert_eq!(started.len(), 1);
        assert_eq!(started[0].event_type, "agent.thinking");
        file.write_all(completed[split..].as_bytes()).unwrap();
        let events = watch.read("terminal").unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "task.completed");
        assert_eq!(events[0].native_session_id.as_deref(), Some("main-session"));
        assert_eq!(events[0].created_at, 1791368591208);
        assert_eq!(
            events[0].detail,
            json!({"source":"codex-rollout","turn_id":"new-turn"})
        );
        assert!(watch.read("terminal").unwrap().is_empty());
        file.write_all(record("turn_aborted", "cancelled-turn").as_bytes())
            .unwrap();
        assert_eq!(
            watch.read("terminal").unwrap()[0].event_type,
            "agent.interrupted"
        );
        watch.hook_seen = true;
        watch.last_hook_completion = Some(1791368591208);
        file.write_all(record("task_complete", "hooked-turn").as_bytes())
            .unwrap();
        assert!(watch.read("terminal").unwrap().is_empty());
        // A prior turn's Stop must not hide a later completion whose Stop callback is missing.
        watch.last_hook_completion = Some(1791368591207);
        file.write_all(record("task_started", "missing-stop-turn").as_bytes())
            .unwrap();
        file.write_all(record("task_complete", "missing-stop-turn").as_bytes())
            .unwrap();
        let recovered = watch.read("terminal").unwrap();
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].event_type, "task.completed");
        drop(file);
        fs::remove_file(path).unwrap();
    }
}

impl CodexRolloutWatch {
    pub fn new(path: PathBuf, session_id: String) -> io::Result<Self> {
        let cursor = path.metadata()?.len();
        Ok(Self {
            path,
            session_id,
            cursor,
            hook_seen: false,
            last_hook_completion: None,
            turn_started_at: (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64,
        })
    }

    pub fn read(&mut self, terminal_id: &str) -> io::Result<Vec<AgentEvent>> {
        let file = File::open(&self.path)?;
        if file.metadata()?.len() < self.cursor {
            self.cursor = 0;
        }
        let mut reader = BufReader::new(file);
        reader.seek(SeekFrom::Start(self.cursor))?;
        let mut events = Vec::new();
        let mut line = Vec::new();
        loop {
            let consumed = reader.read_until(b'\n', &mut line)?;
            if consumed == 0 || !line.ends_with(b"\n") {
                break;
            }
            self.cursor += consumed as u64;
            if let Ok(value) = serde_json::from_slice::<Value>(&line) {
                if let Some(event) = self.map_event(terminal_id, &value) {
                    if event.event_type == "agent.thinking" {
                        self.turn_started_at = event.created_at;
                    }
                    let already_completed = event.event_type == "task.completed"
                        && self
                            .last_hook_completion
                            .is_some_and(|at| at >= self.turn_started_at);
                    if !already_completed
                        && (!self.hook_seen || event.event_type != "agent.thinking")
                    {
                        events.push(event);
                    }
                }
            }
            line.clear();
        }
        Ok(events)
    }

    fn map_event(&self, terminal_id: &str, value: &Value) -> Option<AgentEvent> {
        if value.get("type")?.as_str()? != "event_msg" {
            return None;
        }
        let payload = value.get("payload")?;
        let event_type = match payload.get("type")?.as_str()? {
            "task_started" => "agent.thinking",
            "task_complete" => "task.completed",
            "turn_aborted" => "agent.interrupted",
            _ => return None,
        };
        let turn_id = payload.get("turn_id")?.as_str()?;
        let timestamp = OffsetDateTime::parse(value.get("timestamp")?.as_str()?, &Rfc3339).ok()?;
        Some(AgentEvent {
            event_key: format!(
                "codex-rollout:{terminal_id}:{}:{turn_id}:{event_type}",
                self.session_id
            ),
            agent_type: "codex".into(),
            native_session_id: Some(self.session_id.clone()),
            terminal_id: terminal_id.into(),
            event_type: event_type.into(),
            detail: json!({"source": "codex-rollout", "turn_id": turn_id}),
            created_at: (timestamp.unix_timestamp_nanos() / 1_000_000) as i64,
        })
    }
}
