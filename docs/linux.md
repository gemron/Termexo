# Linux desktop development and validation

Linux builds use GTK 3 and WebKitGTK 4.1. The source build supports native PTYs,
Secret Service credentials, Fontconfig font discovery, and opening paths/URLs through
`xdg-open`. Linux x64 desktop and npm distribution are published in v0.12.1. The
release workflow combines the Linux application with Windows and macOS payloads
in the same npm package; this guide covers source builds and local validation.

## Build and run

Install Node.js 24.15+ and Rust stable (at least 1.88), then install the native
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux).
On Ubuntu/Debian:

```sh
sudo apt-get update
sudo apt-get install -y bash curl build-essential pkg-config libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libdbus-1-dev \
  gnome-keyring fontconfig xdg-utils
npm --prefix apps/desktop-ui ci
npm run tauri:dev
```

Cargo can run directly on a fresh checkout; no generated workflow runtime is required.

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

Linux packaging excludes Windows ConPTY resources. The `.deb` declares GTK/WebKitGTK, font and desktop utility
dependencies. Windows-only features such as WeChat window automation remain unavailable.

### Linux npm distribution

After building the `.deb`, prepare a Linux-only npm archive and test a real installation:

```sh
npm run npm:stage:linux
npm run npm:pack:linux
npm run test:npm:linux
npm install --global ./validation-results/linux-npm/termexo-0.12.1.tgz
termexo
```

The stage command validates the `.deb` version/architecture, executable permissions,
and the x86_64 ELF header of the native binary. It produces
the Linux app archive, `.deb`, build record and SHA256 checksums. The npm launcher
extracts the entire `usr/` tree to `$XDG_CACHE_HOME/Termexo/npm/` (or `~/.cache`),
preserving executable modes and Tauri's resource layout; no root access or runtime
application download is needed. It checks graphical-session availability and uses
bounded `ldd` probes to explain missing shared libraries. Only Linux x64 with glibc
is bundled; other architectures and musl require a source build.
Local build records mark a dirty workspace explicitly; release artifacts come from the
tagged CI commit. Updating an npm installation uses `npm install --global termexo@latest`
and restarting the app; the Windows-only in-app automatic updater is not used on Unix.

Unlike `.deb` installation, npm cannot install GTK/WebKit or a keyring provider.
For Ubuntu 24.04+, install these first:

```sh
sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0t64 libayatana-appindicator3-1 \
  libsecret-1-0 gnome-keyring fontconfig xdg-utils
```

`test:npm:linux` installs the local tarball offline into an isolated global prefix,
checks the installed CLI and headless diagnostics, starts the actual GUI, then drives
the exact cached application using WebKitWebDriver and the eight-case Bash matrix.
Paths deliberately include spaces, apostrophes and Unicode. Reports are saved under
`validation-results/linux-npm/`. The CI workflow performs the same test under Xvfb.

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
fonts, seeded accounts, a saved Windows shell with `$SHELL` unset,
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

### Bash command audit

The Linux/Bash audit covers all six desktop launch adapters, account login commands,
CLI discovery, installer previews, generated hooks, and common-action recognition.
New terminals ask the host to resolve its default shell; legacy saved PowerShell
names still migrate on Unix. Linux discovery follows PATH order, checks execute
permissions, and does not implicitly search the project directory. HOME resolution
uses the native OS convention rather than preferring a Windows USERPROFILE value.
Unix session filtering preserves directory case and literal backslashes; Antigravity
workspace file URIs decode Unicode and reserved filename characters through the URL parser.
Claude/Codex version and account probes have bounded execution times.
Closing a terminal whose short-lived command has already exited also succeeds on Linux;
other process-termination errors remain visible.

Vendor shell installers run through Bash with `pipefail`; a failed curl download
cannot be hidden by an empty successful Bash process. Browser previews choose `.sh`
and POSIX quoting on Linux/macOS. Common-action recognition asks the agent to confirm
the host shell instead of prescribing PowerShell. Vendor URLs were checked for
availability; the audit does not reinstall or upgrade the user's CLIs.

The following optional check executes the generated commands through real Bash PTYs
using recording CLI fixtures, including executable paths with quotes/spaces/Unicode
and arguments containing apostrophes, `$HOME`, `!`, and command substitutions:

```sh
TERMEXO_SMOKE_BASH_MATRIX=1 \
  TERMEXO_DESKTOP_BINARY=src-tauri/target/release/termexo \
  TERMEXO_SMOKE_OUTPUT=validation-results/linux-bash \
  npm run test:desktop:linux
```

It checks six launch commands and Claude/Codex login commands and records literal
argv in `bash-matrix.json`. This certifies command transport through Bash, not real
authentication or model compatibility for the recording fixtures. Run authenticated
Codex checks separately; the two modes cannot be combined.

Local audit validation on 2026-11-02 used Ubuntu 26.04, Bash 5.3.9, Node 24.21.0,
and Codex CLI 0.166.0. Rust passed 465 tests (5 ignored), the frontend passed 819
tests across 99 files, command/bridge Node checks passed 10 tests, the npm launcher
passed 16 tests. Frontend production and
Linux `.deb` builds also passed. Both native suites ran the extracted `.deb` executable
and passed all 14 desktop checks; the Bash suite additionally passed all 8 argv cases,
and the authenticated Codex suite verified the exact final reply after Bash tool execution.
No test-owned processes remained after cleanup. Local reports are under
`validation-results/linux-bash-audit/` and `validation-results/linux-bash-real-agent/`.

The follow-up on 2026-11-03 passed 823 frontend tests across 100 files, 465 Rust
tests (5 ignored), and 23 npm launcher tests. The rebuilt application was packed,
installed offline through npm, launched through its installed command, and passed
15 native desktop checks plus the eight Bash argv cases from its extracted cache.
An authenticated Codex run from that same npm payload returned the exact random
fixture contents, and a native notification was acknowledged over the session D-Bus.
Reports are in `validation-results/linux-npm/` and its `real-agent/` subdirectory.
All four browser suites (`e2e:smoke`, `e2e:responsive`, `e2e:v05`, `e2e:todos`)
also passed on Linux Chromium after updating their current menu, directory-prompt,
model-editor and task lifecycle interactions. The install panel remains disabled
in browser preview; actual installation/launch is covered by the native npm test.

On Linux, notifications use the session notification daemon. On Unix, denied or
unavailable system notifications retain the in-app notice without opening a modal
dialog. Intentional PTY shutdown carries an explicit stop reason, so it becomes
STOPPED instead of a failed-agent alert. Unexpected unsuccessful exits still fail.
For an optional real notification delivery check in a desktop session, add
`TERMEXO_SMOKE_NOTIFICATION=1` to a native smoke run; it requires a running notification
daemon and displays one normal test notification.

Browser preview scripts (`e2e:smoke`, `e2e:responsive`, `e2e:v05`, `e2e:todos`,
`capture:readme`) find Chromium/Chrome/Edge on Linux, macOS and Windows, or use the
Playwright browser cache. `BROWSER_PATH` overrides detection; `EDGE_PATH` remains
supported. Chinese selector-based checks use an explicit Chinese browser locale.
Platform detection alone does not guarantee that every older UI assertion matches
the current interface.

The browser suites use the current in-app directory prompt instead of `window.prompt`
and build fixture paths from the host repository/temp directory. The responsive check
keeps the short-window workbench itself above the 720px breakpoint after accounting
for sidebars; it also checks the separate narrow-window layout.

The following remain explicitly platform-specific:

- Linux npm payloads currently target x64/glibc only; Linux ARM and musl are not bundled.
- WebView2/CDP desktop recording (`capture:demo`, `e2e:desktop`, `e2e:desktop:v05`)
  remains Windows-only. Linux native testing uses `test:desktop:linux` instead.
- MSI/NSIS/ConPTY/MSVC scripts, Windows WeChat window automation, and macOS signing
  stay platform-specific. Their presence is not evidence of a Linux execution path.

```sh
npm test
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
