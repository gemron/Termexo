<p align="center">
  <img src="apps/desktop-ui/public/termexo-mark.svg" width="104" alt="Termexo logo">
</p>

<h1 align="center">Termexo</h1>

<p align="center">A local-first AI development workspace for agents, models, and connected devices</p>

<p align="center">
  <strong>English</strong> · <a href="./README.cn.md">简体中文</a>
</p>

<p align="center">
  <img alt="Version 0.3.2" src="https://img.shields.io/badge/version-0.3.2-58c7a0">
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white">
  <img alt="Angular 22" src="https://img.shields.io/badge/Angular-22-DD0031?logo=angular">
</p>

Termexo is a local-first AI development workspace and control plane. It brings projects,
terminals, native agent sessions, model/provider profiles, and runtime state into one
recoverable desktop environment instead of another isolated chat window.

The current desktop release focuses on coordinating local AI coding terminals. The roadmap
extends the same Workspace model into multi-agent orchestration, real-time provider Plan
quota visibility, secure workspace sharing, and access from trusted computers and phones.
Local project data and credentials remain protected by explicit device, permission, and
encryption boundaries.

> The latest published release is **V0.3.2, the Codex and multi-account workbench update**.
> It completes Codex model/account-aware launch and recovery, adds isolated Claude/ChatGPT
> accounts, resizable collapsible sidebars, and removes unfinished product surfaces.

![Termexo multi-terminal grid workbench](docs/images/termexo-workbench-v0.3.2.png)

<p align="center">
  <sub>Four active Claude Code and Codex terminals in a configurable 2 × 2 grid with explicit pane selection and the Inspector.</sub>
</p>

## V0.3.2 Updates

- Create, authenticate, manage, and switch isolated Claude Code and ChatGPT/Codex accounts.
- Launch or resume Codex with a selected account and optional model while keeping native rollout files read-only.
- Scan session indexes across system and managed account homes, and preserve the originating account during recovery.
- Resize and independently collapse both sidebars; widths and visibility persist across launches.
- Remove the Google CLI entry and hide unfinished Snapshot, Tasks, and prototype Git surfaces.
- Verify toolbar alignment, menus, dialogs, toast surfaces, compact layouts, and sidebar interactions with automated browser tests.

## V0.3.0 Updates

- Keep any number of terminal tabs and choose which terminals are visible in the active layout.
- Configure and persist grid layouts from `1–6 columns × 1–6 rows`; unused rows collapse automatically.
- Maximize an individual terminal or the entire workspace, then restore with `Shift+Esc`.
- Keep the Claude Code CLI while switching model profiles between Anthropic, DeepSeek,
  MiniMax, GLM, or a custom Anthropic-compatible endpoint.
- Batch-switch Claude Code terminals in the active workspace and restart them with their existing session IDs.
- Use `--resume` when a local transcript exists and fall back to `--session-id` when it does not.

- Detect the native Codex CLI executable and report its installed version without opening a console window.
- Start Codex in a selected workspace directory through the same managed PTY used by other terminals.
- Read Codex rollout metadata from `CODEX_HOME/sessions` without modifying native JSONL files.
- Resume a Codex session by its native UUID using `codex resume`.
- Show Claude and Codex sessions together in the Agent session center while preserving Agent-specific resume options.
- Search and filter sessions by agent, health, workspace, and scope, with partial-scan error handling.
- Adjust grid rows and columns with steppers, a visual preview, dimension swapping, and live capacity feedback.
- Use the new compact circuit-line identity across the desktop app, installers, and website.

## V0.4 Development

- Create global or workspace-scoped network profiles for HTTP, HTTPS, SOCKS, and `NO_PROXY`.
- Manage npm registry, proxy, `https-proxy`, `strict-ssl`, and enterprise CA settings without rewriting the user's global npm configuration.
- Keep proxy passwords in the operating-system credential store and reject credentials embedded directly in proxy URLs.
- Test DNS/TCP reachability and apply the effective workspace-over-global profile to Claude and Codex launch environments.
- Preview and confirm one-click Claude Code/Codex installation or upgrades from their official npm packages, with exact version or dist-tag selection.
- Apply the effective network profile to npm, preflight the registry, prevent overlapping mutations, enforce a timeout, and verify CLI health after completion.
- Multiple isolated Claude/ChatGPT accounts are now available; automatic rollback,
  system-proxy discovery, and Plan quota monitoring remain planned.

## Why Termexo

AI coding tools usually run in isolated terminals and sessions. As the number of projects
grows, developers have to remember:

- which terminal belongs to which project, branch, and agent;
- which sessions are running, waiting for input, or waiting for approval;
- how to resume a specific Claude session;
- how model, endpoint, API key, and MCP configurations fit together;
- which parts of a workspace can actually be restored after an application restart.

Termexo uses the **Workspace** as its organizing unit and turns this scattered state into
a local control plane that is observable, recoverable, and extensible.

## Implemented Features

| Capability               | Current implementation                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Workspace management     | Create, rename, theme, manually reorder, and switch workspaces; persist paths, layouts, and terminal configuration |
| Multi-terminal workbench | Unlimited tabs, explicit pane selection, configurable 1–6 row/column grids, pane/workspace maximize, and real PTYs |
| Claude Code detection    | Detect `claude.exe` / `claude.cmd`, version, and health on Windows                                                 |
| Start agent sessions     | Launch Claude or Codex with a working directory, isolated login account, and Agent-specific model configuration    |
| Session center           | Read-only multi-account Claude/Codex discovery, search, workspace filtering, and native resume                     |
| Agent status tracking    | Isolated hooks per terminal for thinking, tool use, approval, user input, completion, and failure states           |
| Model and MCP profiles   | Manage endpoints, keys, and MCP configuration; switch Claude CLI across Anthropic-compatible backends              |
| Network and npm profiles | Scope HTTP/HTTPS/SOCKS and npm settings globally or per workspace, test reachability, and inject them at launch    |
| Account management       | Manage multiple isolated Claude and ChatGPT/Codex logins, defaults, authentication status, and launch-time choice  |
| Managed CLI lifecycle    | Preview, confirm, install, or upgrade official Claude Code and Codex npm packages, then verify the result          |
| Local data and secrets   | Store workspace/session/event data in SQLite and API keys in Windows Credential Manager                            |
| Browser preview          | Preview the complete UI without Rust and exercise layout flows through an interactive simulated terminal           |

![Termexo model profiles](docs/images/termexo-model-profiles.png)

<p align="center">
  <sub>Models, endpoints, and credential entry are managed in one place. Stored secrets are never returned to the frontend.</sub>
</p>

## Design Goals

1. **Local first** — Project paths, terminals, session indexes, and configuration stay on
   the local machine by default. Termexo does not require a Termexo cloud service.
2. **Preserve native agent semantics** — Prefer native session and configuration
   mechanisms instead of pretending that a terminated process is still alive.
3. **Coordinate terminals, do not replace them** — Termexo provides the workbench,
   state, and orchestration layer. Commands still run inside real PTYs and agents.
4. **Make agent state observable** — Map agent-specific events into common running,
   thinking, input, approval, completed, and failed states.
5. **Keep security boundaries explicit** — Secrets belong in the operating-system
   credential store, not in SQLite, snapshots, hook payloads, or logs.
6. **Grow into a multi-agent architecture** — Evolve around adapters, PTY, hooks,
   snapshots, and routing boundaries so more CLIs can be added without rebuilding the core.
7. **Extend workspaces across trusted devices** — Add sharing, remote access, mobile
   approvals, and collaboration without weakening local ownership or security boundaries.

## Current Boundaries

- Claude Code remains the most complete event Adapter. Codex supports native detection,
  model/account-aware launch, multi-account local session discovery, and resume; Codex
  hooks and unified runtime events are not implemented yet.
- When the app exits, terminated operating-system processes are not “fake restored.”
  Termexo restores terminal configuration; historical Claude sessions must be resumed
  explicitly from the session center.
- Claude and Codex JSONL files are read-only. Termexo never edits, renames, or deletes them.
- Snapshot, Git, and task orchestration surfaces remain hidden until their production
  backends are implemented.
- Automatic permission approval, cross-agent session migration, and cross-agent batch
  model-switch transactions are outside the current release.

See [Termexo.md](./Termexo.md) for the complete product plan and
[V0.2 architecture](./docs/architecture/v0.2.md) for current technical boundaries.

## Quick Start

### Requirements

- Windows 10/11;
- Node.js `^22.22.3`, `^24.15.0`, or `>=26.0.0`;
- Rust stable, Visual Studio C++ Build Tools, and WebView2 for the desktop runtime;
- a local Claude Code installation for Claude integration.

### 1. Clone and install frontend dependencies

```powershell
git clone https://github.com/gemron/Termexo.git
cd Termexo
npm --prefix apps/desktop-ui install
```

### 2. Run the browser preview

```powershell
npm run dev
```

Open <http://127.0.0.1:4200>. Browser mode uses a simulated terminal with `help`,
`status`, `git status`, and `clear`, making it suitable for UI development and review.

### 3. Run the desktop application

```powershell
npm run tauri:dev
```

Desktop mode uses real PTYs. If Claude Code is not available on PATH, specify it:

```powershell
$env:TERMEXO_CLAUDE_PATH = "C:\path\to\claude.exe"
npm run tauri:dev
```

## How It Works

```mermaid
flowchart LR
    UI["Angular Desktop UI"]
    IPC["Tauri Commands"]
    PTY["PTY Service"]
    Adapter["Claude Adapter"]
    Hooks["Hooks / Event Pipeline"]
    DB[("SQLite")]
    Vault["Windows Credential Manager"]
    Claude["Claude Code"]

    UI <--> IPC
    IPC --> PTY
    PTY --> Claude
    IPC --> Adapter
    Adapter --> Claude
    Claude --> Hooks
    Hooks --> DB
    IPC <--> DB
    IPC --> Vault
```

- **Angular UI** — workspaces, terminal layouts, session center, settings, and Inspector.
- **Tauri Commands** — a minimal IPC boundary between the frontend and desktop core.
- **PTY Service** — creates, writes to, resizes, and closes real terminal processes.
- **Claude Adapter** — installation detection, read-only session scanning, and native launch/resume.
- **Hooks Pipeline** — receives Claude hooks, deduplicates events, and maps common agent states.
- **SQLite / Credential Manager** — stores structured local data and sensitive credentials separately.

## Data and Security

| Data                                  | Storage                          | Policy                                       |
| ------------------------------------- | -------------------------------- | -------------------------------------------- |
| Workspaces and terminal configuration | SQLite                           | Local persistence                            |
| Claude session index                  | SQLite                           | Upserted from read-only Claude JSONL parsing |
| Agent events                          | JSONL spool + SQLite             | Deduplicated by `event_key`                  |
| Model and MCP profiles                | SQLite                           | Plaintext API keys never enter the database  |
| API keys                              | Windows Credential Manager       | The frontend can read only `hasCredential`   |
| Native Claude sessions                | `%USERPROFILE%\.claude\projects` | Read-only; never written back                |

For compatibility with early installations, the database filename and some internal Tauri
identifiers still use a legacy name. This does not affect the Termexo product name or new
`TERMEXO_*` environment variables.

## Roadmap

| Version | Goal                                                             | Status   |
| ------- | ---------------------------------------------------------------- | -------- |
| V0.1    | Workspace, multi-terminal, PTY, and SQLite foundation            | Complete |
| V0.2    | Claude detection, session resume, hooks, and profiles            | Complete |
| V0.3    | Codex CLI adapter and unified Claude/Codex session center        | Current  |
| V0.4    | Account/provider control, CLI/network lifecycle, rollback, and Plan visibility | In progress |
| V0.5    | Session summaries and cross-agent migration                      | Planned  |
| V0.6    | Multi-agent collaboration, task orchestration, and notifications | Planned  |
| V0.7    | Workspace sharing, remote computers, and mobile access           | Planned  |
| V1.0    | Stable release, security hardening, and complete recovery UX     | Planned  |

## Repository Layout

```text
Termexo/
├── apps/desktop-ui/       # Angular desktop UI and browser preview
├── src-tauri/             # Rust core, PTY, agents, hooks, database, and commands
├── docs/architecture/     # Architecture notes for implemented versions
├── docs/images/           # README screenshots
└── Termexo.md             # Product design and long-term roadmap
```

## Development and Verification

```powershell
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm --prefix apps/desktop-ui run e2e:smoke
npm run tauri:build
```

With the local development server running, regenerate the README screenshots with:

```powershell
npm run capture:readme
```

## Contributing

Use [Issues](https://github.com/gemron/Termexo/issues) to report bugs, discuss design
decisions, or propose features. Before submitting code, make sure the change fits the
current release scope and add tests for behavior changes.

## License

This repository does not currently declare an open-source license. Until one is added,
do not assume permission to copy, modify, or redistribute the project.
