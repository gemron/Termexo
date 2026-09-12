//! Points `include_dir!` at the console bundle.
//!
//! The console is a second Angular application in the desktop workspace, and building it needs the
//! pinned Node toolchain. Making `cargo test` depend on that would be a trap for anyone touching
//! only the Rust side, so the build falls back to a placeholder page that says how to produce the
//! real bundle. The binary is therefore always linkable; only a release build ships the console.

use std::path::{Component, Path, PathBuf};

/// Where `npm run build:relay-console` puts its output, relative to this manifest.
const CONSOLE_BUNDLE_DIRECTORY: &str = "../desktop-ui/dist/relay-console/browser";
/// Served instead when the bundle has not been built.
const CONSOLE_PLACEHOLDER_DIRECTORY: &str = "console-placeholder";
/// Read by `console.rs` through `include_dir!("$TERMEXO_RELAY_CONSOLE_DIR")`.
const CONSOLE_DIRECTORY_VARIABLE: &str = "TERMEXO_RELAY_CONSOLE_DIR";

fn main() {
    let manifest_directory = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("cargo always sets CARGO_MANIFEST_DIR"),
    );
    let bundle = normalize(&manifest_directory.join(CONSOLE_BUNDLE_DIRECTORY));
    let placeholder = normalize(&manifest_directory.join(CONSOLE_PLACEHOLDER_DIRECTORY));

    // Both are watched: appearing and disappearing must each trigger a rebuild, or the binary keeps
    // serving whichever directory happened to exist the first time.
    println!("cargo:rerun-if-changed={}", bundle.display());
    println!("cargo:rerun-if-changed={}", placeholder.display());
    println!("cargo:rerun-if-changed=build.rs");

    let selected = if bundle.is_dir() { bundle } else { placeholder };
    println!(
        "cargo:rustc-env={CONSOLE_DIRECTORY_VARIABLE}={}",
        selected.display()
    );
}

/// Resolves `..` textually so the emitted path is readable in build logs.
///
/// `fs::canonicalize` would do it, but on Windows it returns a `\\?\` extended path that is awkward
/// to read and that some tools refuse; the input is an absolute path with no symlinks of our own
/// making, so plain component folding is enough.
fn normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}
