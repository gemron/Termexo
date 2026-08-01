# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Termexo is a Windows-only, local-first desktop control plane for AI coding terminals: an
Angular 22 frontend inside a Tauri 2 / Rust shell that launches real PTYs running Claude Code
and Codex CLI, tracks their state through hooks, and persists workspaces in SQLite.

`开发规范.md` is the repository's authoritative code-quality specification (single
responsibility, DRY, no magic values, no dead code left behind). Follow it when writing or
refactoring code here.

## Commands

Run from the repository root. `apps/desktop-ui` is the only npm workspace with dependencies —
install with `npm --prefix apps/desktop-ui install`.

```powershell
npm run dev                 # Browser preview on http://127.0.0.1:4200 (no Rust required)
npm run build               # Angular production build -> apps/desktop-ui/dist/
npm test                    # Frontend unit tests (Vitest), single run
npm run tauri:dev           # Full desktop app with real PTYs
npm run tauri:build         # Release bundle
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
```

Run a single frontend test file or filter by test name:

```powershell
npm --prefix apps/desktop-ui test -- --watch=false --include src/app/core/services/app-state.service.spec.ts
npm --prefix apps/desktop-ui test -- --watch=false --filter "restores"
```

Browser smoke tests need `npm run dev` already running and Microsoft Edge (override with
`EDGE_PATH`); the desktop smoke test needs a release build of `termexo.exe`:

```powershell
npm --prefix apps/desktop-ui run e2e:smoke        # Main UI flows
npm --prefix apps/desktop-ui run e2e:responsive   # Layout across viewports
npm --prefix apps/desktop-ui run e2e:desktop      # Drives the real app over CDP
npm run capture:readme                            # Regenerate docs/images screenshots
```

### Toolchain notes

- `scripts/run-angular.mjs` and `scripts/run-tauri.mjs` spawn the **pinned Node binary** from
  `apps/desktop-ui/node_modules/node/bin/node.exe`, not system Node. Invoke the npm scripts
  rather than calling `ng` or `tauri` directly.
- `npm run tauri:dev|build` goes through `scripts/tauri-msvc.cmd`, which sources
  `VsDevCmd.bat` (Visual Studio 2022 Build Tools, Desktop C++ workload) and prefers the
  vendored toolchain in `.tooling/cargo` + `.tooling/rustup` when present. A bare `cargo build`
  in a shell without the MSVC environment will fail to link.
- One Rust test is `#[ignore]`d because it writes to the real Windows Credential Manager; run
  it explicitly with `cargo test -- --ignored` when touching `CredentialStore`.

## Architecture

### Dual runtime: browser preview and desktop

The same Angular app runs in a plain browser (for UI work without Rust) and inside the Tauri
webview. `isTauriRuntime()` in `core/services/tauri-runtime.ts` checks for
`__TAURI_INTERNALS__`, and **every service that reaches the backend branches on it**:
`TerminalGatewayService` emulates a small shell, `WorkspaceRepository` falls back to
`localStorage`, `AgentService` returns stub installations with a "run the desktop app"
diagnostic. Any new `invoke()` call needs a browser-mode fallback or the preview breaks.

### Two-phase agent launch

The frontend never handles secrets and never builds a command line itself:

1. `prepare_claude_launch` / `prepare_codex_launch` (`src-tauri/src/commands/agent.rs`) resolve
   the model profile, account profile, and effective network profile; read API keys from the
   credential store; write the per-terminal hook configuration; stash the full environment map
   in `LaunchEnvironmentStore` keyed by `terminalId`; and return only an `AgentLaunchSpec`
   (a command string plus executable path).
2. The frontend then calls `create_terminal` with the **same `terminalId`**. `PtyManager::start`
   pulls the environment out of the store (a take, not a read) and injects it into the PTY.

The caller generates `terminalId` with `crypto.randomUUID()` before step 1 and reuses it — see
`app.ts` (`launchCodex`, `launchClaude`, `resumeSession`).

### Hook and event pipeline

`termexo.exe` is both the GUI app and its own hook CLI. `src-tauri/src/main.rs` dispatches
`hook-event`, `codex-notify`, and `codex-hook-event` subcommands before Tauri ever starts.

- Claude gets a generated per-terminal `--settings` JSON registering command hooks that
  re-invoke the executable.
- Codex gets `-c notify=[...]` and `-c hooks.<Event>=[...]` TOML overrides (written as TOML
  *literal* strings so they survive the Windows npm `.cmd` shim) plus `TERMEXO_CODEX_*` env vars.

Both paths append to a JSONL spool in the app data directory. `sync_agent_events` reads it
incrementally from a byte cursor, deduplicates by `event_key` into the `agent_events` table, and
the frontend polls it. Raw event types are mapped to terminal states by the `EVENT_STATUS` table
in `core/models/agent.models.ts` — a new event type must be handled in both the Rust mapper
(`src-tauri/src/hooks/mod.rs`) and that map.

### Secrets boundary

`CredentialStore` (`src-tauri/src/config/mod.rs`) wraps `keyring` with the `windows-native`
feature under service name `dev.agentdock.desktop`. `set()` reads the secret back and returns
`CredentialNotPersisted` if storage silently dropped it (the V0.3.8 fix). SQLite stores only a
`credential_target` string; profile structs serialized to the frontend expose `hasCredential`,
never the value. Do not add a field that would return a key to the UI, and keep keys out of hook
payloads, snapshots, and logs.

### Agent adapters

`agent::AgentAdapter` (`detect` / `list_sessions` / `build_launch_command`) is implemented by
`ClaudeCodeAdapter` and `CodexCliAdapter`. Native transcript files (`~/.claude/projects/**/*.jsonl`,
`CODEX_HOME/sessions`) are **read-only**: parse them, upsert into `agent_sessions`, and store any
Termexo-specific metadata in Termexo's own database. Never write, rename, or delete them.
Windows executable detection order is `TERMEXO_CLAUDE_PATH` → `claude.exe` on PATH →
`claude.cmd` on PATH → common npm/local bin directories.

### Persistence

`WorkspaceDatabase::open` runs every file in `src-tauri/migrations/` unconditionally via
`execute_batch` on each startup, so **migrations must be idempotent** (`CREATE TABLE IF NOT
EXISTS`, guarded `ALTER`) and there is no version table or rollback. Data-shape fixes run as
separate functions afterward (see `migrate_legacy_minimax_m3_model`) and must tolerate being
re-applied.

### Legacy identifiers (intentional)

The database file is `agentdock.db`, the Tauri/keyring identifier is `dev.agentdock.desktop`,
and `agentdock.workspaces.v1` is still read as a legacy localStorage key. These are kept for
compatibility with early installations — do not rename them.

## Conventions

- **User-facing strings are Simplified Chinese**, including error messages returned from Rust
  `#[tauri::command]` functions — commands return `Result<T, String>` and the frontend surfaces
  the string directly in a toast. Code identifiers and comments stay English.
- Angular 22 standalone components with signals; no NgModules, no `*ngIf`/`*ngFor` — use `@if` /
  `@for`. State lives in `AppStateService` (workspaces, terminals, layout) and `AgentService`
  (IPC, sessions, profiles, event polling).
- Styling is Tailwind 4 + DaisyUI 5. Workspace theme colors are applied as CSS custom properties
  from the document root and must resolve to concrete hex values, not OKLCH-only tokens
  (`color-mix()` is a progressive enhancement only).
- Prettier: `printWidth: 100`, single quotes, Angular parser for HTML.
- The production build enforces bundle budgets (1100 kB initial, 20 kB per component stylesheet).

## Releasing

The version string is duplicated across `package.json`, `apps/desktop-ui/package.json`,
`packages/termexo/package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`, and is
referenced in both READMEs. `packages/termexo` is the npm distribution wrapper; its `prepack`
stages the built Windows executable into `vendor/win32-x64/`.
