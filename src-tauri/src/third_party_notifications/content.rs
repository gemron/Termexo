//! Channel-independent, bounded plain-text notifications.
use time::{format_description, OffsetDateTime, UtcOffset};

#[derive(Clone, Copy, Debug)]
pub enum NotificationKind {
    Completed,
    Error,
    Approval,
    Input,
}

impl NotificationKind {
    pub fn parse(key: &str) -> Result<Self, String> {
        match key {
            "completed" => Ok(Self::Completed),
            "error" => Ok(Self::Error),
            "approval" => Ok(Self::Approval),
            "input" => Ok(Self::Input),
            _ => Err("不支持的第三方通知事件。".into()),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Completed => "任务完成",
            Self::Error => "错误 / 限流",
            Self::Approval => "等待授权",
            Self::Input => "等待输入",
        }
    }

    fn guidance(self) -> &'static str {
        match self {
            Self::Completed => "任务已完成，请回到 Termexo 查看结果。",
            Self::Error => "Agent 发生错误或限流，请回到 Termexo 查看原因并处理。",
            Self::Approval => {
                "Agent 正在等待操作确认，请回到 Termexo 查看并决定；本消息不会批准任何操作。"
            }
            Self::Input => "Agent 正在等待补充信息，请回到 Termexo 输入后继续。",
        }
    }
}

pub struct NotificationContent<'a> {
    pub kind: NotificationKind,
    pub project: &'a str,
    pub task: &'a str,
    pub session: Option<&'a str>,
    pub agent: Option<&'a str>,
    pub model: Option<&'a str>,
    pub branch: Option<&'a str>,
}

/// Use the same timestamp as the durable delivery record. If Windows cannot
/// supply the local offset, explicitly show UTC rather than guessing a timezone.
pub fn format_notification(
    content: &NotificationContent<'_>,
    at_ms: u64,
) -> Result<String, String> {
    let offset = UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC);
    format_at(content, at_ms, offset)
}

fn format_at(
    content: &NotificationContent<'_>,
    at_ms: u64,
    offset: UtcOffset,
) -> Result<String, String> {
    let at = OffsetDateTime::from_unix_timestamp_nanos(i128::from(at_ms) * 1_000_000)
        .map_err(|_| "通知时间无效。")?
        .to_offset(offset);
    let description = format_description::parse_borrowed::<3>(
        "[year]-[month]-[day] [hour]:[minute]:[second] UTC[offset_hour sign:mandatory]:[offset_minute]",
    )
    .map_err(|_| "通知时间格式无效。")?;
    let timestamp = at.format(&description).map_err(|_| "通知时间无法显示。")?;
    let project = line(content.project);
    let task = line(content.task);
    let mut rows = vec![
        format!("[Termexo · {}]", content.kind.label()),
        format!("通知时间：{timestamp}"),
        format!(
            "项目：{}",
            if project.is_empty() {
                "未命名项目"
            } else {
                &project
            }
        ),
        format!(
            "任务：{}",
            if task.is_empty() {
                "Agent 会话"
            } else {
                &task
            }
        ),
    ];
    let agent = content.agent.map(|key| match key {
        "claude" => "Claude Code",
        "codex" => "Codex CLI",
        "opencode" => "OpenCode",
        "pi" => "Pi Agent",
        "grok" => "Grok Build",
        "antigravity" => "Antigravity",
        other => other,
    });
    for (label, value) in [
        ("会话", content.session),
        ("Agent", agent),
        ("模型", content.model),
        ("分支", content.branch),
    ] {
        if let Some(value) = value.map(line).filter(|value| !value.is_empty()) {
            rows.push(format!("{label}：{value}"));
        }
    }
    rows.push(String::new());
    rows.push(content.kind.guidance().into());
    Ok(rows.join("\n"))
}

fn line(value: &str) -> String {
    let plain: String = value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect();
    let normalized = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut characters = normalized.chars();
    let mut result: String = characters.by_ref().take(160).collect();
    if characters.next().is_some() {
        result.push('…');
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> NotificationContent<'static> {
        NotificationContent {
            kind: NotificationKind::Completed,
            project: "Termexo",
            task: "修复通知",
            session: Some("Codex CLI 3"),
            agent: Some("codex"),
            model: Some("example-model"),
            branch: Some("main"),
        }
    }

    fn instant() -> u64 {
        (OffsetDateTime::parse(
            "2026-10-24T16:30:45Z",
            &format_description::well_known::Rfc3339,
        )
        .unwrap()
        .unix_timestamp_nanos()
            / 1_000_000) as u64
    }

    #[test]
    fn includes_local_date_timezone_and_available_context() {
        let message =
            format_at(&sample(), instant(), UtcOffset::from_hms(8, 0, 0).unwrap()).unwrap();
        assert_eq!(message, "[Termexo · 任务完成]\n通知时间：2026-10-25 00:30:45 UTC+08:00\n项目：Termexo\n任务：修复通知\n会话：Codex CLI 3\nAgent：Codex CLI\n模型：example-model\n分支：main\n\n任务已完成，请回到 Termexo 查看结果。");
        let message = format_at(
            &sample(),
            instant(),
            UtcOffset::from_hms(0, -30, 0).unwrap(),
        )
        .unwrap();
        assert!(message.contains("2026-10-24 16:00:45 UTC-00:30"));
        assert!(format_at(&sample(), instant(), UtcOffset::UTC)
            .unwrap()
            .contains("UTC+00:00"));
        assert!(format_at(&sample(), u64::MAX, UtcOffset::UTC).is_err());
    }

    #[test]
    fn gives_event_specific_next_steps_and_keeps_approval_reminder_only() {
        for (key, label, action) in [
            ("completed", "任务完成", "查看结果"),
            ("error", "错误 / 限流", "查看原因并处理"),
            ("approval", "等待授权", "本消息不会批准任何操作"),
            ("input", "等待输入", "输入后继续"),
        ] {
            let mut content = sample();
            content.kind = NotificationKind::parse(key).unwrap();
            let message = format_at(&content, instant(), UtcOffset::UTC).unwrap();
            assert!(message.starts_with(&format!("[Termexo · {label}]")));
            assert!(message.contains(action));
        }
        assert!(NotificationKind::parse("execute").is_err());
    }

    #[test]
    fn omits_unknown_metadata_and_keeps_multiline_or_long_names_bounded() {
        let mut content = sample();
        content.project = " Project\n name\t ";
        content.session = None;
        content.agent = None;
        content.model = Some("  ");
        content.branch = None;
        let message = format_at(&content, instant(), UtcOffset::UTC).unwrap();
        assert!(message.contains("项目：Project name\n"));
        for label in ["会话：", "Agent：", "模型：", "分支："] {
            assert!(!message.contains(label));
        }
        let long = "长".repeat(3000);
        content.project = &long;
        content.task = &long;
        content.session = Some(&long);
        content.agent = Some(&long);
        content.model = Some(&long);
        content.branch = Some(&long);
        let message = format_at(&content, instant(), UtcOffset::UTC).unwrap();
        assert!(message.chars().count() < 1500);
        assert!(message.contains('…'));
    }
}
