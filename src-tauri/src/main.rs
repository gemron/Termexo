#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("hook-event") => {
            if let Err(error) = termexo_lib::capture_hook_event_from_cli() {
                eprintln!("{error}");
                std::process::exit(1);
            }
            return;
        }
        Some("codex-notify") => {
            if let Err(error) = termexo_lib::capture_codex_notification_from_cli() {
                eprintln!("{error}");
                std::process::exit(1);
            }
            return;
        }
        _ => {}
    }

    termexo_lib::run();
}
