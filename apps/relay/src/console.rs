//! The embedded admin console.
//!
//! `build.rs` points `TERMEXO_RELAY_CONSOLE_DIR` either at the built Angular bundle or at a
//! placeholder page, so the binary always links even when only the Rust side has been built.

use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use include_dir::{include_dir, Dir};

static CONSOLE: Dir<'_> = include_dir!("$TERMEXO_RELAY_CONSOLE_DIR");

/// Everything under here is the console; `/` redirects into it.
pub const CONSOLE_PATH_PREFIX: &str = "/console";
const CONSOLE_ROOT: &str = "/console/";
const INDEX_DOCUMENT: &str = "index.html";

const CONSOLE_MISSING: &str = "控制台资源缺失，请重新构建中继。";

/// Content types for what an Angular bundle actually contains. Anything else is served as an opaque
/// download rather than guessed at.
const CONTENT_TYPES: [(&str, &str); 12] = [
    ("html", "text/html; charset=utf-8"),
    ("js", "text/javascript; charset=utf-8"),
    ("mjs", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("json", "application/json; charset=utf-8"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("webp", "image/webp"),
    ("ico", "image/x-icon"),
    ("woff2", "font/woff2"),
    ("txt", "text/plain; charset=utf-8"),
];

const DEFAULT_CONTENT_TYPE: &str = "application/octet-stream";

/// `GET /` sends the operator to the console rather than to a blank page.
pub fn redirect_to_console() -> Response {
    (StatusCode::FOUND, [(header::LOCATION, CONSOLE_ROOT)]).into_response()
}

/// Serves one console asset, falling back to the shell document for client-side routes.
pub fn serve(request_path: &str) -> Response {
    let Some(asset_path) = console_asset_path(request_path) else {
        return (StatusCode::NOT_FOUND, "资源不存在。").into_response();
    };
    let Some(file) = CONSOLE
        .get_file(&asset_path)
        .or_else(|| CONSOLE.get_file(INDEX_DOCUMENT))
    else {
        return (StatusCode::SERVICE_UNAVAILABLE, CONSOLE_MISSING).into_response();
    };

    (
        [
            (header::CONTENT_TYPE, content_type(file.path())),
            // The bundle is replaced by a relay upgrade the browser has no other way to learn
            // about, so every document is revalidated.
            (header::CACHE_CONTROL, "no-cache"),
        ],
        file.contents().to_vec(),
    )
        .into_response()
}

/// Maps a request path to a file inside the bundle.
///
/// A path without a file extension is an Angular route, not a file, so it gets the shell document.
/// Returns `None` for anything that tries to climb out of the bundle.
fn console_asset_path(request_path: &str) -> Option<String> {
    let relative = request_path
        .strip_prefix(CONSOLE_PATH_PREFIX)?
        .trim_start_matches('/');
    if relative
        .split('/')
        .any(|segment| segment == ".." || segment == ".")
    {
        return None;
    }
    if relative.is_empty() || extension_of(relative).is_none() {
        return Some(INDEX_DOCUMENT.to_string());
    }
    Some(relative.to_string())
}

fn content_type(path: &std::path::Path) -> &'static str {
    path.extension()
        .and_then(|extension| extension.to_str())
        .and_then(|extension| {
            CONTENT_TYPES
                .iter()
                .find(|(known, _)| known.eq_ignore_ascii_case(extension))
                .map(|(_, value)| *value)
        })
        .unwrap_or(DEFAULT_CONTENT_TYPE)
}

fn extension_of(path: &str) -> Option<&str> {
    let file = path.rsplit('/').next()?;
    let (_, extension) = file.rsplit_once('.')?;
    (!extension.is_empty()).then_some(extension)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn a_client_side_route_resolves_to_the_shell_document() {
        for path in [
            "/console",
            "/console/",
            "/console/devices",
            "/console/audit/1",
        ] {
            assert_eq!(
                console_asset_path(path).as_deref(),
                Some(INDEX_DOCUMENT),
                "{path} should serve the shell"
            );
        }
    }

    #[test]
    fn a_file_request_resolves_to_that_file() {
        assert_eq!(
            console_asset_path("/console/main-ABC123.js").as_deref(),
            Some("main-ABC123.js")
        );
        assert_eq!(
            console_asset_path("/console/assets/logo.svg").as_deref(),
            Some("assets/logo.svg")
        );
    }

    #[test]
    fn a_path_that_climbs_out_of_the_bundle_is_refused() {
        assert_eq!(console_asset_path("/console/../relay.db"), None);
        assert_eq!(console_asset_path("/console/assets/../../key.pem"), None);
        assert_eq!(console_asset_path("/d/abc/"), None);
    }

    #[test]
    fn content_types_cover_a_bundle_and_fall_back_safely() {
        assert_eq!(
            content_type(Path::new("index.html")),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            content_type(Path::new("main-ABC.js")),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(content_type(Path::new("font.woff2")), "font/woff2");
        assert_eq!(content_type(Path::new("data.bin")), DEFAULT_CONTENT_TYPE);
        assert_eq!(content_type(Path::new("noextension")), DEFAULT_CONTENT_TYPE);
    }

    #[test]
    fn the_bundle_always_carries_a_shell_document() {
        // Either the built console or the placeholder page; a binary without one could not serve
        // the console at all, and that is worth catching at test time rather than in production.
        assert!(CONSOLE.get_file(INDEX_DOCUMENT).is_some());
    }
}
