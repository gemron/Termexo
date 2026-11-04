# Termexo

This package runs the Windows, macOS or Linux desktop application for
[Termexo](https://www.termexo.com/). Let a connected AI use MCP to operate
Claude Code, Codex, OpenCode, Pi Agent, Grok Build, and Antigravity terminals: find a
terminal, send a prompt, submit it, and read the actual reply. All six agents
run in a local workbench you can view and take over. Keep projects, native sessions,
content previews and optional phone access together. MIT licensed, with no Termexo
account required. Install and sign in to the Agent CLIs you use; Termexo does not
include a model subscription.

## Install

The npm launcher requires Node.js 18.18 or later.

| Operating system | Included architecture | Requirements |
| --- | --- | --- |
| Windows | x64 | Windows 10 build 17763+; WebView2 Chromium 111+ |
| macOS | Apple Silicon (arm64) and Intel (x64) | macOS 12+ |
| Linux | x64 | glibc, GTK 3, WebKitGTK 4.1 and a graphical desktop session |

```sh
npm install --global termexo@latest
termexo
```

The same npm package includes four complete application builds across these three
operating systems, selecting the matching one locally. No separate Termexo
application download is needed. To update a global installation, run the install
command again, then restart Termexo and your Agent terminals.

You can also run without a global installation:

```sh
npx termexo@latest
```

For a specific published release, run `npx termexo@0.12.1`.

### Linux system libraries

Unlike a `.deb` installation, npm does not install desktop libraries or run `sudo`.
On Ubuntu 24.04 and later, install the required system libraries first:

```sh
sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0t64 libayatana-appindicator3-1 \
  libsecret-1-0 gnome-keyring fontconfig xdg-utils
```

Other distributions require equivalent libraries; musl/Alpine and Linux ARM builds
are not included. Saving API keys needs an unlocked Secret Service keyring.

## Commands

```text
termexo              Start the bundled Termexo desktop app
termexo start        Start the bundled Termexo desktop app
termexo download     Open the latest release page
termexo --version    Show the launcher version
termexo --help       Show command help
```

Set `TERMEXO_PATH` to another `termexo.exe`, `Termexo.app`, or Linux executable to override the
bundled application. On macOS, the matching app is extracted once into
`~/Library/Caches/Termexo/npm/` and opened through Launch Services. Its archive
preserves executable permissions, resources and signatures. macOS packages use
ad-hoc signing and are not notarized; macOS may ask you to allow the app in
Privacy & Security. Windows packages are unsigned while code-signing approval is pending.

On Linux, the complete `usr/bin` + `usr/lib/Termexo` application is extracted into
`${XDG_CACHE_HOME:-~/.cache}/Termexo/npm/`, preserving executable permissions and
application resources. Cache entries include the version, architecture and
archive hash. Missing shared libraries, unsupported architectures and headless
launches produce a diagnostic. Application data remains in its separate XDG data
directory. `--help` and `--version` work without a display.

Linux desktop and npm distribution are available in v0.12.1. For source builds and
local package validation, see the [Linux guide](https://github.com/gemron/Termexo/blob/main/docs/linux.md).

## Version 0.12.1

- Windows x64, macOS Apple Silicon / Intel and Linux x64 builds in one npm package.
- Multiple content preview tabs and syntax highlighting that keeps source whitespace intact.
- Saved project actions with working directories and environment variables.
- Native Agent sessions, account and model profiles, and task status visibility.
- Optional remote access, including read-only links; the host computer must stay on.
- Local MCP control of supported agent terminals and tasks.
- Removal of the built-in One Ring workflow engine and its bundled Node.js runtime
  to reduce package size. Public MCP tools and ordinary Agent terminals remain available.

GitHub Actions builds and publishes the combined npm package and the Windows EXE/MSI,
macOS DMG and Linux `.deb` installers. See the [release notes](https://github.com/gemron/Termexo/releases/tag/v0.12.1)
and [full changelog](https://github.com/gemron/Termexo/blob/main/CHANGELOG.md).

## Let one AI operate another through MCP

Install and sign in to the agent CLIs you want to use, then:

1. In **Settings → AI control (MCP)**, enable the local server, keep automatic
   connection enabled, allow terminal access, and click Apply. Also allow task
   access if you want to create and execute tasks. Check for Running.
2. Start or restart an agent terminal in Termexo. All six supported agents
   connect automatically as `termexo-desktop`; no address or token to copy.
3. Send this to the AI terminal and check for your actual workspaces and terminals:

> Use Termexo MCP to list my workspaces and terminals, and tell me which are running. Do not change anything yet.

Open an OpenCode terminal in the workbench, then try this from the connected AI:

> Use Termexo MCP to find the running OpenCode terminal in the current workspace. Send hi, submit Enter, and read its reply. If several terminals match, list their names so I can choose.

Existing-terminal interaction works with all six agent types. Task-board
execution supports Claude Code, Codex, OpenCode, Pi Agent, and Grok Build; start
Antigravity in the workbench first, then operate its terminal. The terminal
creation tool creates a Shell. Input delivery and task startup do not mean
completion: keep reading output and task status to check the actual result.

The MCP server is off by default and listens only on localhost, separately
from phone remote access. Terminal and task access default on when enabled;
settings access is separate, and agent tool approvals still apply. Keep the desktop window
open while using MCP. Grok and Antigravity use user-level configuration;
disabling automatic connection removes Termexo-owned entries.

Read the [English user guide](https://www.termexo.com/guide.en.html#ai-control)
or [中文使用说明](https://www.termexo.com/guide.html#ai-control) for first-call
examples, external clients and downloadable PDFs.

Project source and desktop releases are available at
[github.com/gemron/Termexo](https://github.com/gemron/Termexo).
