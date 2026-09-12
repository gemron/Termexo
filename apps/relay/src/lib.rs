//! The Termexo relay service.
//!
//! A relay does three things: it accepts outbound tunnels from desktop apps and downstream relays,
//! it proxies `https://<relay>/d/<deviceId>/…` into those tunnels, and it serves a console for
//! managing who may connect. It never parses Termexo's own protocol — every stream inside a tunnel
//! is a plain HTTP/1.1 connection that the device serves with its own router.
//!
//! The wire format lives in `termexo-relay-protocol`, shared with the desktop app, and the design it
//! implements is `docs/architecture/relay-service.md`.

pub mod api;
pub mod audit;
pub mod auth;
pub mod bootstrap;
pub mod config;
pub mod console;
pub mod db;
pub mod forwarded;
pub mod proxy;
pub mod registry;
pub mod server;
pub mod state;
pub mod tls;
pub mod tunnel;
pub mod upstream;

pub use server::serve;
pub use state::RELAY_VERSION;
