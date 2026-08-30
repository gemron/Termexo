# Termexo Changelog

Release notes for every Termexo version, newest first. The current release is summarised in [README.md](README.md).

## V0.6.0

- Run OpenCode as a third first-class agent beside Claude Code and Codex, with the same launch, resume, restart-restore, and automatic-confirmation controls.
- Turn a task into a running agent terminal from the task board: each task carries its project, agent, model, and acceptance criteria, and moves through todo, executing, completed, and verified as its terminal reports status.
- Launch any agent with automatic confirmation — `--permission-mode auto` for Claude, `--approve-for-me` for Codex, and `--auto` for OpenCode — so the AUTO chip means the same thing whichever agent drew it.
- Reclaim a Claude session the CLI still holds open through background-session inspection, fork, and attach, instead of starting a terminal that exits on its first message.
- Reorder terminal tabs by dragging, close one with the middle mouse button, scroll the tab strip with the wheel, and drive the workbench from the keyboard.
- Bound every CLI version and session probe with a timeout that terminates the whole Windows command tree, so an unresponsive agent no longer hangs the session centre.
- Skip a single unreadable session record instead of failing the whole list, matching how the Claude and Codex transcript scanners already behave.

## V0.5.0

- Capture live Claude Code and Codex input independently per terminal, recover unsent drafts after an abnormal close, and keep submitted prompt history searchable, favoritable, and pinnable.
- Redact common API keys, bearer tokens, passwords, and secrets before prompt assets or handoff packages are persisted.
- Generate terminal- or workspace-scoped handoff packages with task state, session summaries, recent prompts, terminal output, Git status/diff, changed files, validation evidence, risks, and next actions.
- Enforce a configurable Token budget and truncate bulky terminal output or Git diff without breaking UTF-8 content.
- Export and import readable Markdown or machine-readable JSON handoff documents, then send the handoff directly to another Claude Code or Codex terminal to continue work.
- Keep Chinese IME composition anchored to the active terminal caret when another terminal is producing output.

## V0.4.0

- Create global or workspace-scoped network profiles for HTTP, HTTPS, SOCKS, and `NO_PROXY`.
- Manage npm registry, proxy, `https-proxy`, `strict-ssl`, and enterprise CA settings without rewriting the user's global npm configuration.
- Keep proxy passwords in the operating-system credential store and reject credentials embedded directly in proxy URLs.
- Test DNS/TCP reachability and apply the effective workspace-over-global profile to Claude and Codex launch environments.
- Preview and confirm one-click Claude Code/Codex installation or upgrades from their official npm packages, with exact version or dist-tag selection.
- Apply the effective network profile to npm, preflight the registry, prevent overlapping mutations, enforce a timeout, and verify CLI health after completion.
- Discover standard proxy environment variables or the current Windows user proxy and import it as an editable Profile without reading passwords.
- Restore the previously detected CLI version automatically when npm mutation or post-install health verification fails.
- Switch one or many Claude/Codex terminals as a transaction: preflight every launch, and restore original commands, sessions, and profiles after a partial failure.
- Extract per-turn Token usage from native Claude/Codex event and transcript data, then show cumulative totals, Tokens/minute, per-terminal totals, and a recent activity curve.
- Configure a Plan allowance, reset time, and alert threshold per provider Profile. The inspector shows remaining allowance, reset countdown, one-time threshold warnings, and blocks switching to an exhausted Profile.
- Provider quota APIs are not universally available. V0.4 labels configured/local figures as estimates and unsupported providers as unavailable instead of presenting estimates as official data.

## V0.3.18 Updates

- Model profiles are organised by provider. One profile now holds the Claude side (Anthropic
  protocol) and the Codex side (OpenAI protocol) together — a model and endpoint each, a switch
  each, both on by default, and one shared API key. A provider serves the two agents on different
  paths (DeepSeek answers on `/anthropic` and `/v1`), which the previous single-endpoint profile
  could not express.
- DeepSeek, MiniMax, GLM, Kimi, and SCNet ship as presets taken from their published API docs.
  Selecting a provider fills both sides at once and shows where the values came from. The official
  Anthropic and OpenAI presets remain, alongside a blank Custom entry, and every field stays
  editable.
- A side the provider publishes no endpoint for switches itself off rather than sitting half
  configured, so "enabled" always means "reachable".
- Launching an agent only ever picks a profile enabled for it: naming one that is switched off for
  that agent falls back to the default instead of pointing it at the other protocol's URL.
- On upgrade, existing single-protocol profiles move to the side their protocol served, with the
  other side left off.
- Fix Codex never actually switching to a third-party provider. The endpoint was passed as
  `OPENAI_BASE_URL` and `OPENAI_MODEL`, neither of which Codex reads — it resolves providers from
  its own config, so every session kept talking to the official endpoint. Termexo now declares the
  provider through the `-c` overrides Codex supports (`model_provider`, `base_url`, `env_key`,
  `wire_api`), with the API key staying in the environment rather than on the command line. Note
  that current Codex speaks only the Responses API (`{base_url}/responses`), so reaching a provider
  depends on it offering that interface.

## V0.3.17 Updates

- Fix the IME candidate window appearing in a screen corner, with a second small box pinned to the
  top-left. The IME anchors to xterm's hidden textarea, which xterm moves only once the cursor
  moves inside the viewport — before that it sits off-screen (`left: -9999em`, zero-sized). Typing
  on a terminal that has just opened, or one scrolled away from its cursor, left Windows without a
  caret rect. Termexo now re-anchors it from the cursor coordinates when a composition starts or
  the terminal takes focus.
- Waiting statuses can be cleared. Each entry in the global notice panel has a clear button, and
  the header clears them all at once. A waiting terminal returns to Running and a completed one to
  Idle, so the bell, the attention banner, and the terminal header all settle together; the agent
  raises a fresh notice when something changes.

## V0.3.16 Updates

- Fix right-click pasting twice in Claude Code. Claude turns on mouse reporting (`?1000h`), so
  xterm forwarded the right button to it and Claude read the clipboard and pasted a copy of its
  own on top of Termexo's. Codex leaves mouse reporting off, which is why only Claude doubled the
  text. The right button is now stopped before it reaches xterm and Termexo alone acts on it —
  copy with a selection, paste without one. No TUI receives the right button any more, matching
  the Windows terminal convention Termexo already follows.

## V0.3.15 Updates

- Fix Shift+Tab doing nothing in Claude Code and other agents. xterm emits no input for that
  combination, so the key never reached the terminal; Termexo now sends the reverse-tab sequence
  (CSI Z) and stops the browser from treating it as focus navigation.
- Fix right-click paste inserting the text twice. Paste previously came from the native WebView2
  menu and the agent handled it again; Termexo now owns the right-click — copy when there is a
  selection, paste when there is not, written exactly once.
- Rename a terminal by double-clicking its title. Enter saves, Escape cancels.
- The model name in each agent terminal's header is now a button that switches only that
  terminal. The toolbar button becomes "Switch all", making the batch scope explicit.
- The agent menu closes on an outside click or Escape.
- CLI upgrade checks query the published version before comparing, so an already-current CLI no
  longer offers an upgrade — only "Reinstall anyway" — and installs show a progress indicator.
- Builds installed through npm can update themselves: Termexo closes, npm installs the new
  version, and the app reopens. Windows locks a running executable, so the install has to happen
  after the app exits. Installer builds still open the release page.

## V0.3.14 Updates

- Fix agents hanging on every message when a proxy was entered as `https://`. A proxy URL's
  scheme says how to *reach the proxy*, not what it forwards: `https://` asks the client to
  complete a TLS handshake with the proxy port, which ordinary proxies drop, so requests stall
  until they time out. Saving now rejects it and suggests the corrected address.
- Proxy connectivity tests go beyond a TCP handshake: they issue a `CONNECT` through the proxy
  and verify the tunnel actually reaches the model endpoint, distinguishing authentication
  required (407), a refused destination, and a tunnel that opens but leads nowhere.
- Add import/export for proxy profiles. Exported files carry **no passwords** and no
  machine-local credential handles; imported profiles are always created fresh, never overwrite
  a profile of the same name, never become the default, and pass the same validation as a
  manual save.
- Setting `NO_PROXY` now also sets npm's `noproxy`, since npm's own config outranks the
  environment variable and would otherwise bypass the exclusion list.

## V0.3.13 Updates

- Add update checks: once at launch, then every 6 hours against the latest GitHub release. A
  published update raises an in-app notice and a Windows notification, and the download page is
  one click away. Each version is announced only once.
- Update checks can be switched off under Settings → Diagnostics, which stops the background
  requests immediately. Failed checks stay silent; only a manual check reports an error.
- Fix the top toolbar overlapping the window buttons in narrow windows, while keeping the
  toolbar centred on wide ones.
- Refine the Diagnostics and CLI panels: an unavailable CLI no longer keeps the success palette,
  body text is larger, the selected agent card reads more clearly, and the detail grids collapse
  earlier in narrow windows.

## V0.3.12 Updates

- Fix terminal model profiles being lost on restart. The backend snapshot struct was missing the
  `profileId` and `mcpProfileId` fields, so switching to a third-party model and reopening the
  window fell back to the native default. The session model persistence V0.3.11 announced never
  actually worked; it does now.
- Fix missing Windows notifications when Termexo runs from npm. The app registers its
  AppUserModelID at startup, so toasts are delivered even without an installer.
- Report notification delivery failures instead of swallowing them, so a failed toast falls back
  to a system dialog.

## V0.3.11 Updates

- Keep the model profile a session last ran with when resuming it, so a third-party model no longer
  falls back to the native default after restarting the app. An explicit pick in the resume settings
  still wins.
- Rebuild the session center around the session list: agent health collapses into a status line,
  search and filters share one toolbar row, and the resume settings fold into an expandable panel
  that summarizes the active profiles while collapsed.
- Fix the Codex resume settings grid, where the model field wrapped onto its own row out of
  alignment with the rest of the form.

## V0.3.10 Updates

- Add Simplified Chinese, English, Spanish, French, German, Japanese, and Korean interface support.
- Follow the operating-system language by default, react to system-language changes, and fall back
  to English when the locale is not supported.
- Add a compact language picker to the main toolbar; manual selections apply immediately, persist
  across restarts, and can return to automatic system-language mode at any time.
- Localize the workspace, terminal layout, Agent status, session center, model switching, settings,
  directory picker, runtime diagnostics, in-app alerts, Windows notifications, and taskbar prompts.
- Add language-family resolution, persistence, interpolation, and document-locale tests while
  retaining the complete existing desktop UI test suite.

## V0.3.9 Updates

- Rebuild restored Claude launch commands, model profiles, credentials, provider URLs, and hook
  environments before mounting terminals; migrate legacy `MiniMax-M3[1m]` profiles to
  `MiniMax-M3` so restored MiniMax sessions no longer fall back to Claude Sonnet.
- Add Codex lifecycle hooks for prompts, tools, permissions, compaction, subagents, completion, and
  session boundaries, with accurate terminal states for new and restored sessions.
- Add persistent waiting/approval banners, Windows notifications, and taskbar attention while
  keeping completed-task feedback concise and actionable.
- Add workspace merging with terminal preservation and safe persistence.
- Improve responsive sidebar behavior, terminal refitting, grid sizing, maximized/fullscreen views,
  hidden initial Codex commands, and narrow-window usability.
- Document the repository architecture and release workflow for Claude Code contributors.

## V0.3.8 Updates

- Enable keyring's native Windows Credential Manager backend instead of its process-local mock
  backend, so MiniMax and other model-provider API keys survive new sessions and app restarts.
- Read back every credential immediately after writing it and fail the save if secure storage did
  not persist the exact secret.
- Add compile-time backend coverage and an explicit native credential-store round-trip test.
- Existing V0.3.7 users need to re-enter third-party model-provider API keys once after upgrading.

## V0.3.7 Updates

- Add safe workspace deletion and a native folder picker when creating a workspace.
- Surface waiting-input, approval, and completed terminals across every workspace through a global
  attention center and prominent notifications.
- Keep workspace terminal views mounted, stabilize xterm sizing and focus after workspace switches,
  and restore reliable mouse-wheel scrollback without selecting an unrelated pane.
- Align the animated terminal status indicator before the title and improve its running-state
  background treatment.
- Integrate Codex's native `agent-turn-complete` notification so new and resumed sessions reliably
  transition from running or thinking to completed.
- Regenerate restored Codex launch commands before terminal mounting so existing workspaces also
  receive native completion events instead of remaining in a stale running state.
- Route a missing MiniMax or other compatible-provider API key directly to the affected Profile,
  require a replacement before saving or switching, and keep the value in Windows secure storage.
- Turn each workspace color into a complete application theme, including DaisyUI surfaces, sidebars,
  dialogs, terminal background, selection, ANSI accents, and cursor.

## V0.3.6 Updates

- Verify model-profile API keys against Windows secure storage instead of trusting a stale database
  reference.
- Treat a deleted secure-storage entry as an unconfigured credential and stop preserving invalid
  references when a profile is saved.
- Replace the low-level keyring error during provider switching with an actionable localized prompt.

## V0.3.5 Updates

- Adjust terminal font size from the workspace toolbar and persist the preference between launches.
- Move CLI tabs left or right without disrupting the selected terminal or workspace order.
- Make waiting, approval, rate-limit, and completed states visually distinct in tabs, panels, and
  the Inspector; keep up to 250 Agent events and show more recent activity.
- Preserve xterm scrollback and refit terminals when hidden panes become visible, fixing terminals
  that could no longer scroll vertically.
- Start a fresh session when switching model providers, validate custom provider credentials, and
  update the MiniMax preset to `MiniMax-M3[1m]`.
- Detect Claude 429/rate-limit and timeout failures, surface actionable notices, and resolve
  managed-account sessions against the correct isolated Claude configuration directory.
- Explain that an explicit native session resume reloads its historical context, while provider
  switching deliberately avoids replaying the previous session.

## V0.3.4 Updates

- Apply the Termexo DaisyUI theme from the document root so global surfaces inherit the correct
  foreground and background colors on every supported system.
- Replace OKLCH-only critical theme tokens with equivalent hexadecimal colors and use
  `color-mix()` only as a progressive enhancement.
- Add explicit website and desktop color fallbacks to prevent black text on black backgrounds.
- Extend browser smoke coverage to verify the root theme and computed foreground/background
  contrast.

## V0.3.3 Updates

- Published the official [`termexo`](https://www.npmjs.com/package/termexo) package with the
  complete Windows x64 desktop executable included.
- Run the desktop app directly with `npx termexo@latest`, or install the command globally with
  `npm install --global termexo@latest`.
- Kept the package practical for npm delivery: about 4.8 MB compressed and 13.6 MB installed.
- Added release-time PE validation, build-to-package SHA-256 verification, isolated installation
  tests, and direct process-launch verification.

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
