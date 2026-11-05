//! Compose launch-scoped Codex configuration without turning flags into prompt text.
use crate::platform::shell_quote;

pub(crate) fn append_overrides(command: &mut String, configs: &[String]) {
    let options = configs
        .iter()
        .map(|value| format!(" -c {}", shell_quote(value)))
        .collect::<String>();
    let bytes = command.as_bytes();
    let mut quote = None;
    let mut index = 0;
    let mut position = command.len();
    while index < bytes.len() {
        match (quote, bytes[index]) {
            (None, b'\\') | (Some(b'"'), b'\\') => index += 1,
            (None, b'\'' | b'"') => quote = Some(bytes[index]),
            (Some(current), value) if current == value => quote = None,
            (None, b' ') if bytes[index..].starts_with(b" -- ") => {
                position = index;
                break;
            }
            _ => {}
        }
        index += 1;
    }
    command.insert_str(position, &options);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_services_compose_before_the_prompt_and_preserve_quoted_paths() {
        let mut command =
            "'/path -- with spaces/codex' resume 'session' -- 'prompt -- keep unchanged'"
                .to_owned();
        append_overrides(
            &mut command,
            &["mcp_servers.termexo-desktop.enabled=true".into()],
        );
        append_overrides(&mut command, &["mcp_servers.one_ring.enabled=true".into()]);
        assert!(command.ends_with(" -- 'prompt -- keep unchanged'"));
        assert!(command.starts_with("'/path -- with spaces/codex' resume 'session' -c "));
        assert!(command.contains("mcp_servers.termexo-desktop.enabled=true"));
        assert!(command.contains("mcp_servers.one_ring.enabled=true"));
    }
}
