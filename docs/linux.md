# Linux desktop development and validation

Linux builds use GTK 3 and WebKitGTK 4.1. The source build supports native PTYs,
Secret Service credentials, Fontconfig font discovery, and opening paths/URLs through
`xdg-open`. The existing npm distribution still contains Windows and macOS applications;
build Linux from source or use the artifact from the Linux workflow.

## Build and run

Install Node.js 24.15+ and Rust stable (at least 1.88), then install the native
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux).
On Ubuntu/Debian:

```sh
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libdbus-1-dev \
  gnome-keyring fontconfig xdg-utils
npm --prefix apps/desktop-ui ci
npm run tauri:dev
```

Run in a graphical desktop session. Saving API keys requires an unlocked Secret Service
provider on the session D-Bus, such as GNOME Keyring or a KWallet installation exposing
Secret Service. Credentials are never stored in SQLite or plaintext as a fallback.
On desktops that do not unlock their keyring on login, unlock it with the desktop's
password/keyring manager before saving credentials.

The app imports the user's login PATH so npm/version-manager CLI installations can be
detected when launched from the desktop. If `$SHELL` is unset or unusable, Linux uses
`/bin/sh`. Saved Windows shells resolve to this machine's default shell.
Timed CLI probes and installers run in separate Unix process groups so their
background children cannot keep output pipes open after completion or timeout.
Application data defaults to `$XDG_DATA_HOME/dev.agentdock.desktop`, or
`~/.local/share/dev.agentdock.desktop` when `XDG_DATA_HOME` is unset.

```sh
npm run tauri:build                 # Release .deb in src-tauri/target/release/bundle/deb/
npm run tauri:build -- --debug      # Faster debug .deb in src-tauri/target/debug/bundle/deb/
```

Linux packaging excludes Windows ConPTY resources and bundles the Linux Node runtime
and One Ring engine. The `.deb` declares GTK/WebKitGTK, font and desktop utility
dependencies. Windows-only features such as WeChat window automation remain unavailable.

### Graphics compatibility

Local validation on Ubuntu 26.04 passed in the Wayland session with default graphics
settings. Forcing X11 under XWayland stalled WebKit startup on this machine; the same
desktop checks passed with `WEBKIT_DISABLE_DMABUF_RENDERER=1`:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri:dev
```

This is an opt-in [WebKitGTK graphics workaround](https://v2.tauri.app/develop/debug/linux-graphics/).
The application preserves the default rendering path on working setups. The headless
Xvfb workflow sets this variable because it has no native DMABUF presentation path.

## Test the real application

Use the platform's [WebDriver setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/).
No browser preview or mocked Tauri backend is involved in this smoke test.

```sh
sudo apt-get install -y webkit2gtk-driver xvfb
cargo install tauri-driver --locked
npm run tauri:build -- --debug
npm run test:desktop:linux
```

For a release executable, set `TERMEXO_DESKTOP_BINARY=src-tauri/target/release/termexo`.
For a display-less CI environment use
`WEBKIT_DISABLE_DMABUF_RENDERER=1 dbus-run-session -- xvfb-run -a npm run test:desktop:linux`.
The driver and installed WebKitGTK should use matching versions. `WEBKIT_WEBDRIVER`
and `TAURI_DRIVER` override their executable paths.

The smoke test creates a separate temporary home and XDG data directories, starts
the native desktop, and checks WebKit compatibility, Unix PTY reporting, system
fonts, bundled One Ring, seeded accounts, a saved Windows shell with `$SHELL` unset,
a project path containing spaces and Chinese characters, rendered terminals, real
PTY input/output and resize, SQLite workspace restore, PTY reattachment, and closure.
It writes a screenshot, terminal output, driver log, and JSON report to
`validation-results/linux/` (override with `TERMEXO_SMOKE_OUTPUT`).

### Authenticated Codex test

To also test a real model response, log in to Codex first and opt in explicitly:

```sh
TERMEXO_SMOKE_REAL_AGENT=codex \
  TERMEXO_DESKTOP_BINARY=src-tauri/target/release/termexo \
  TERMEXO_SMOKE_OUTPUT=validation-results/linux-real-agent \
  npm run test:desktop:linux
```

This uses the existing `CODEX_HOME` (or `~/.codex`) for authentication and makes a
real model call. The desktop prepares and launches an interactive Codex terminal
in a temporary project with read-only permissions. The agent runs `pwd` and reads
a file containing a fresh random value; the test reads the native transcript without
modifying it and strictly checks the final assistant reply, native tool/completion
events, and unchanged project files. It saves `real-agent.png`,
`real-agent.json`, terminal output, and event records. This test is excluded from CI
and the default smoke run because it requires credentials and consumes model usage.

Local validation passed with Codex CLI 0.166.0 and GPT-6.1-Sol, including actual
Linux command execution and the desktop's completed status.

```sh
npm test
npm run one-ring:test
node --test scripts/one-ring-bridge.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
# Uses the session's actual keyring; the temporary probe entry is deleted afterwards.
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked \
  config::tests::secure_storage_round_trips_a_credential -- --ignored --exact
```

The Linux workflow builds on Ubuntu 24.04, extracts the generated `.deb`, runs its
executable in Xvfb and an isolated D-Bus session, and uploads the package and smoke
artifacts. The workflow must run on
GitHub to establish its result; local validation does not certify other distributions,
architectures or other authenticated Agent workflows.
