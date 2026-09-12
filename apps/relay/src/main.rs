//! The `termexo-relay` executable: argument parsing, logging and the two subcommands.

use std::process::ExitCode;

use clap::Parser;
use termexo_relay::bootstrap;
use termexo_relay::config::{AdminCommand, Cli, Command};
use termexo_relay::upstream;
use tracing_subscriber::EnvFilter;

/// Log level when `RUST_LOG` says nothing. `info` covers tunnel lifecycle and start-up without
/// narrating every proxied request.
const DEFAULT_LOG_FILTER: &str = "info";

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    initialize_logging();

    let outcome = match cli.command {
        Command::Serve(args) => termexo_relay::serve(args).await,
        Command::Link(args) => upstream::link(&args).await,
        Command::Admin {
            command: AdminCommand::ResetPassword(args),
        } => bootstrap::reset_password(&args),
    };

    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn initialize_logging() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER)),
        )
        .init();
}
