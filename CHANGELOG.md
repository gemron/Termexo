# Termexo Changelog

Release notes for every Termexo version, newest first. The current release is summarised in [README.md](README.md).

## V0.10.0

- Remote access is no longer confined to one local network. The desktop can dial out to a **relay**,
  and a phone or another computer then opens this machine's full workbench from anywhere — no public
  IP, no port forward. The relay is yours to host: a single cross-platform binary with its own admin
  console, in the [termexo-relay](https://github.com/gemron/termexo-relay) repository. Settings →
  remote access gained a section for it: give it the address, join with an enrolment code or an
  account on the relay, and the relay's address then sits beside the LAN ones in the same address
  list, QR code and all.
- **A relay cannot read the terminals it carries.** The `/ws` handshake between the browser and the
  desktop is now v2: the access token is never sent, it proves itself and keys the session instead,
  and every frame after that is sealed with AES-256-GCM under a key of its own per direction. A
  2.68 MB capture taken between a relay and a browser holds no token, no workspace name and no path,
  while the same browser renders all of them. A LAN page served over HTTPS gets this too.
- A relay can hang off another relay. An office relay behind NAT publishes its desktops on a public
  one, to any depth, and the desktop lists every address it can be reached at and which relay each
  one goes through.
- A device can require a relay sign-in before anyone reaches it — a gate on the relay's side, quite
  separate from the desktop's own access token.
- OpenCode terminals now show the ChatGPT Codex and OpenCode Go subscriptions connected through
  OpenCode in the provider allowance panel, including their five-hour, weekly and monthly windows
  and reset times. An unresolved default model shows both connected subscriptions; every figure is
  read directly from the service's own internal usage endpoint and treated as undocumented data.

## V0.9.0

- Antigravity is a fourth agent, alongside Claude Code, Codex CLI and OpenCode. Termexo detects
  the CLI where its installer puts it (it is not on PATH), lists the conversations it has on this
  machine and resumes them, offers its models and reasoning efforts, and reads its allowance
  through the CLI's own `/usage`.
- Antigravity reports what its agent is doing, which is how a terminal knows whether it is
  thinking, running a tool or waiting for an answer. It has no per-launch configuration of any
  kind, so this is the one place Termexo writes into a file it does not own: the status line in
  the CLI's own settings. Everything about it is reversible — a status line of the user's own is
  kept and put back, and the block is recognised by the command it points at rather than by a
  path, so a Termexo that moved still knows its own work.
- Every agent is now shown by the mark its own project publishes, wherever it appears: the
  new-terminal menu, a terminal's own title, the tab strip, the session centre, the settings
  health strips and the task board. Three of the four used to share one generic icon.
- A CLI can be installed from its vendor's own Windows installer instead of npm, where the vendor
  publishes one — Claude Code, Codex CLI and Antigravity do. npm can be pinned to a version and
  rolled back to one; a vendor's script always installs what that vendor currently publishes. The
  choice is the user's, and asking for one an agent does not have is refused rather than quietly
  swapped.
- Starting a session for an agent that is not installed now offers the installer from the dialog
  that discovered it, opened on that agent, instead of leaving the user to find the settings page
  and the right tab themselves.
- The split diff no longer draws a long line over the other column. Its columns grow to their own
  content and the panel scrolls sideways as a whole, and the column headings follow them.
- The diff toolbar steps through the changes in a file, by run of changed lines rather than by
  line, with `Alt+Up` and `Alt+Down`. Where a jump lands is marked, and it keeps the lines leading
  into the change in view.
- An OpenCode terminal reads its own state correctly again. OpenCode goes idle at the end of every
  step of its own loop, and the next step begins in the same instant; taking the first of those
  for a finished turn announced completion several times per turn, and announced it again while
  the agent sat waiting for an answer. Waiting for a person is no longer reported as work or as
  completion, and a subagent — OpenCode runs those as sessions of their own — no longer takes the
  turn over from the session that started it, which had left the real turn unable to end at all.

## V0.8.8

- Settings has a Storage panel. It names the data directory, lists what is in it with the size of
  each file, and gives the executable's own path and version. The database is the thing worth
  watching: one had reached 208 MB of agent events with nothing in the interface that could have
  said so.
- The data directory can be moved to another drive. Termexo's default sits on the system drive,
  which is the one that runs out. Choosing an empty directory copies everything there and records
  it for the next start.
- Nothing is deleted by the move. The previous copy stays exactly where it was and the panel names
  it, so a move that turns out to be wrong is undone by pointing the setting back — and the space
  is reclaimed by the user, once they are satisfied. The database makes its own copy rather than
  being copied as a file, because a file copy of an open database can be torn: SQLite's write-ahead
  log holds pages the file does not.
- A data directory that cannot be reached no longer stops Termexo starting. A drive that is not
  currently attached falls back to the default, and the panel reports which directory is actually
  in use — the setting is only reachable from inside the application, so being unable to start
  would leave no way to correct it.
- The provider allowance panel was reworked. Each row leads with a two-letter provider mark and
  carries the profile name above the provider it belongs to; a provider that could not be reached
  marks its row unavailable rather than showing a blank allowance, and the panel reports loading
  through aria-busy.

## V0.8.7

- A terminal can no longer be left permanently stuck. The screen kept for replay was parsed by a
  library that asserts its own invariants rather than repairing them, and a resize can break one:
  a wide character left where the narrower grid has no room for its second half was enough. The
  unwind poisoned the mutex the screen lives behind, and a poisoned mutex never recovers — every
  later read failed, so the terminal showed an empty screen marked "stopped" while its agent kept
  running with nothing able to reach it. Switching to an agent in one client and then activating
  it in another was a reliable way to reach it, because both the wide characters and the resize
  were there.
- The screen parser is now avt, the terminal model asciinema uses for its recorder, player and
  server. Fed the same 30 000 sessions of realistic agent output — mixed scripts, colours, cursor
  moves, scroll regions, the alternate screen and resizes — the previous parser failed 1 169 times
  and this one never did.
- A fault inside the parser now costs a terminal its scrollback rather than the terminal. The
  screen is rebuilt at the same grid and the terminal carries on, and a lock a panic had already
  poisoned is recovered instead of refused, so one fault can no longer disable everything behind
  it for the life of the process.
- A redraw that never answers no longer holds a terminal silent. Everything a terminal produces
  while one is in flight waits to be written until it ends, so a backend that never replied did
  not merely fail to redraw — it stopped the terminal showing anything at all. Falling behind is
  recoverable on the agent's next frame; silence is not.
- Reading a terminal's screen no longer blocks every other terminal. The snapshot was taken while
  holding the lock that each terminal's input, output, resize and launch passes through, so one
  terminal's redraw stalled all of them; it now runs outside that lock, as does encoding and
  publishing each chunk of output.
- Mouse reporting, bracketed paste and the keypad mode survive a reload. The new parser models the
  screen but not how input is reported, so those are read from the output stream and restored
  alongside it — losing the mouse ones is what stops a phone scrolling an agent's viewer.

## V0.8.6

- Reloading a window no longer kills the agents running in it. The backend outlives a reloaded
  window, but loading was treated as starting: a reload — or a right-click on a menu that still
  offered Reload — bumped every terminal's revision, which `create_terminal` reads as a relaunch
  and answers by killing the process that was running. A dozen agents mid-task were lost to one
  click. A terminal the backend is still running is now left at the launch it is running, so
  mounting it re-attaches instead, and its launch is no longer regenerated either — asking the CLI
  to hand over a session its own live process still holds is what raised the reclaim prompt on
  every reload.
- The desktop window no longer carries the browser behaviours it has no use for. It is a WebView2,
  so it arrived with Back, Reload, Save as and Print in its own menu and accelerators, where reload
  is worse than useless — it throws the workbench away and rebuilds it while the terminals keep
  running. Text fields keep their editing commands. Remote clients and the browser preview are
  untouched: those are real browsers, where the same menu carries the long-press selection a phone
  has no other way to reach, and reload is how a page recovers.
- Terminal replay now sends a screen rather than the output that drew it. The backend kept the raw
  PTY stream and replayed the tail of it, but that buffer has to be bounded, and a cut anywhere
  lands in the middle of a frame: the cursor position, character attributes, scroll region and
  screen mode that everything after the cut was written against are all in the part that was
  dropped. The emulator ran those instructions against whatever it happened to hold, which is why a
  reloaded page came back with duplicated frames, a misplaced cursor and rewrapped lines. The PTY's
  output is now parsed into a terminal of its own, and a client is sent a redraw of that screen —
  history, visible grid, cursor and input modes — which stands on its own. Mouse reporting is part
  of what is restored, so a phone can still scroll an agent's viewer after a reload.
- A resize no longer costs a terminal its history. The old buffer was discarded whenever the grid
  moved, because output drawn for one width cannot be replayed into another. The parsed screen is
  re-laid out at the new grid instead, the way the terminal in front of the user is.
- A burst of resync signals no longer redraws the same terminal several times over. The server
  raises one per gap it has to leave, and a client still settling after a reload leaves several, so
  passes ran concurrently over one connection: each released the buffered live output when it
  finished, so output held for the first was written into the middle of the second one's history,
  and each wrote its own idea of how far the stream had been consumed. The compounding part was
  worse — every extra redraw is work the interface must finish before it can read the socket again,
  and falling behind the socket is what raises the next resync. Redrawing one pass at a time, with
  later signals folded into a single follow-up, is what stops that feeding itself.
- Switching to a terminal that was off screen shows what it actually holds. A hidden panel is
  `display: none`: it has no size to fit to and never claims the terminal, so its history was
  written for whichever grid the PTY happened to have, into a renderer with nothing to paint onto.
  Switching to it then resized the emulator underneath frames drawn for the previous grid. Such a
  view now takes its own grid first and is drawn again from the backend's screen, and any change of
  grid — a window dragged wider, another client claiming the terminal — redraws from the same
  place, rather than leaving the emulator to rewrap frames an agent never drew that way.
- Addresses and file paths in terminal output can be opened with Ctrl and a click. An agent spends
  most of its output naming things the user then wants to look at: a file it changed, a test that
  failed at a line, a page it is quoting. Detection never touches the disk, so a word that merely
  looks like a path costs nothing, and the backend decides whether it exists. Paths naming an
  extension Windows runs rather than displays are revealed in the file manager instead of opened.
- Resuming a Codex session checks the rollout is still on disk first. The CLI answers a resume it
  cannot satisfy by exiting with "No saved session found", which left the terminal sitting at its
  shell prompt with the agent never started.
- A Codex turn ending on a side thread no longer reports the task as done. The CLI runs its
  catch-up recap on a thread of its own and a side conversation gets one too, neither of which is
  the task the user is watching; completion is now taken from the `Stop` hook, which fires only
  when the main turn ends. The session a terminal resumes into is taken from `session_id`, which
  names a rollout that exists, rather than from the thread id of whichever turn just finished.
- Agent events no longer grow without bound. A tool's result was stored whole, up to 2 MB in a
  single row, while the interface only ever reads a few short fields out of it — and it re-reads the
  newest 250 events every second, so all of it was parsed, re-serialised and sent across the IPC
  boundary once a second, for as long as the app was open. Details are now capped when written, a
  count limit backs up the 30-day window, and a database written before the cap is compacted and
  reclaimed on first launch.

## V0.8.5

- Termexo ships its own ConPTY. Every terminal runs through the pseudo console
  `CreatePseudoConsole` opens, and which one that was had been left to whatever the user's Windows
  build carries. ConPTY re-synthesises terminal input as Win32 key records before the program reads
  it back as VT, and older builds lose sequences in that round trip: `CSI Z` arrives as a plain Tab,
  so Claude Code never sees Shift+Tab, and mouse reports are dropped outright, so OpenCode cannot be
  scrolled. The same builds reflow wrapped lines themselves, which xterm then reflows a second time.
  `conpty.dll` and `OpenConsole.exe` — Microsoft.Windows.Console.ConPTY 1.24.260710001, MIT — now
  sit beside `termexo.exe` in both installers and in the npm package, which `portable-pty` prefers
  over the one in `kernel32.dll`, so every install behaves the same whatever Windows it runs on.
- The terminal is told which pseudo console it is attached to. On an old system ConPTY it stops
  reflowing wrapped lines on top of the reflow ConPTY has already done, rather than assuming the
  reflow is its own to perform.
- A WebView2 runtime too old to draw the interface now says so. Below Chromium 111 the stylesheets'
  `color-mix()` and `oklch()` colours are dropped and parts of the layout break, with nothing on
  screen connecting that to a runtime version; the notice names the version, the one it needs, the
  download page and the `winget` line, and keeps the address readable for when the browser cannot be
  launched from here. A runtime missing altogether — which an install from npm never had an
  installer to deploy — is reported before startup rather than failing behind a panic message no
  one sees.

## V0.8.4

- Codex scrolls on a phone. A finger drag reached xterm as a synthetic wheel event, and xterm reads
  a wheel two ways that a drag does not survive: it damps pixel deltas under 50px to 30%, taking a
  row-sized step for a trackpad's, and it answers the alternate buffer with a single arrow key
  however far the wheel turned. Codex CLI runs full-screen without tracking the mouse, so those
  arrow keys are all it ever sees — a drag of four rows moved its transcript one line, which on a
  phone reads as not scrolling at all. A drag now takes the route that matches the program on the
  other end: the wheel report an agent that tracks the mouse expects, one arrow key per row for a
  full-screen one, xterm's own scrollback for everything else. It follows the finger row for row.
- A wheel notch over a full-screen agent scrolls three lines rather than one, the distance both a
  native Windows terminal and xterm's own scrollback move, whichever unit the browser measures the
  wheel in.

## V0.8.3

- Typing keeps up with a busy Agent. Every synchronous backend command ran on the single IPC thread,
  so the Git overview poll — around half a second, every three — and the per-second event sync
  queued ahead of each keystroke, and keys arrived in bursts. Every command except `write_terminal`
  and `resize_terminal` now runs on the async thread pool, leaving the keystroke path the IPC thread
  to itself: measured p99 keystroke latency fell from 514ms to 19ms.
- Git status is watched rather than polled. A notify watcher per repository root, filtered to the
  paths that change what the overview shows and debounced, raises a repository-changed event the UI
  re-reads on, with a 60s safety poll behind it. One `git status --porcelain=v2 --branch` yields
  HEAD, branch and worktree together, and repository roots and HEAD-derived data are cached, cutting
  a poll from five to eight git processes down to one.
- Hook events stop piling up. The spool and its table grew without bound, into hundreds of megabytes
  that every launch re-read from the start. Events now carry only the fields the inspector reads,
  the spool cursor is persisted and a drained spool truncated, an index serves the newest-first
  read, and events older than 30 days are pruned on startup. The startup event read fell from around
  1.1s to a few milliseconds.
- Tasks can be interrupted and amended mid-run. Stopping a running task keeps its terminal and
  session, so it can resume or return to 待办, and a running task takes further instructions through
  the same Agent session instead of only after a failed verification.
- The Agent status panel gains a pinned overview — current Agent, lowest allowance, change count,
  branch, running count — above collapsible sections that remember what was left open.
- Thinking events name the Agent that produced them rather than whichever one was active (#21).

## V0.8.2

- Typing keeps up with a working agent. Every open terminal subscribed to the output stream
  separately, so each chunk an agent produced woke all of them and ran change detection across the
  whole workbench, and keystrokes queued behind that work. Output now arrives through one shared
  subscription dispatched by terminal id, registered outside the Angular zone, with change detection
  coalesced to one pass per frame.
- Restoring terminals no longer stalls. Replayed scrollback is marked as such so the task, handoff
  and startup readers skip it, rather than re-analysing every terminal's whole history on every
  reconnect.
- Emergency prompt drafts are mirrored in memory and written from an idle callback instead of
  parsing and rewriting the localStorage store on every keystroke, and typing no longer measures the
  DOM through `proposeDimensions`.
- Model profiles carry a 1M context switch and a reasoning effort level per agent — `claude
  --effort` and `codex -c model_reasoning_effort` — and both launch dialogs can override them for a
  single terminal.
- The empty workspace lists the same agents as the tab strip menu. Its button opened a plain Shell
  and left starting an Agent to a menu that had not been found yet.

## V0.8.1

- Open a first run on a guide rather than on three invented workspaces. A new install seeded
  samples named Termexo, MTS Cloud and Device Health, pointed at a path that exists on nobody's
  machine, whose Agent terminals resumed session ids that never existed — so the first screen was
  two terminals reporting "Invalid session ID". The workspace area now says what a workspace is,
  what the first three steps are, and that nothing leaves the machine, with one button that opens
  the create dialog. The browser preview keeps the samples: its simulated terminal has nothing to
  run in without them.
- Move new terminal onto the tab strip, where the plain + button already was, and give it the agent
  menu. It had sat in the window's own toolbar beside the workspace toggle — workspace-level company
  for an action that adds one tab to one strip — and the button now follows the last tab instead of
  waiting at the far end of an empty row.
- Open the terminal that was just created. The active terminal was set, but the task board and the
  Git view draw no terminal at all, so one started from either of them appeared nowhere and nothing
  said why. Every path that opens a terminal at the user's request now returns to the terminal view
  and reveals it in the layout.
- Light up the rows of that menu under the pointer: they hovered in a colour three shades from the
  menu's own background, which read as no hover at all. The Agents also come before the plain shell
  now, which is the order they are picked in, and the add button carries the accent instead of
  looking like the tab close buttons beside it.
- Rework the remote access settings. The listening address and the port are one setting but sat at
  opposite edges of the dialog, with a port field wide enough for a paragraph; the copy button
  wrapped below the link it copies; the address picker was narrower than that link; and the QR code
  stood beside empty space. The master switch is now set apart from the HTTPS option below it, with
  the connected-device count beside it rather than floating between two form fields.
- Fix the listening address and port not sitting on the same line. The port cell is taller because
  it carries the range hint, the grid stretched both labels to that height, and a grid label
  stretches its own rows — leaving the select several pixels deeper than the input beside it.

## V0.8.0

- Remote access. Turn it on in the settings and any phone, tablet, or second computer on the same
  network or VPN opens the whole workbench in a browser: the same workspaces and terminals, reading
  and writing the same live PTYs. Self-signed HTTPS by default, entered with an access token the
  settings panel can reveal, turn into a QR code, or rotate.
- Remote requests replay through the desktop's own command table rather than a second backend.
  Application commands are not covered by Tauri's ACL under a local origin, so every remote call
  must first pass an explicit allowlist — npm self-updates, native file reads and writes, and
  changing the remote access settings themselves are all refused.
- Terminals scroll by finger. xterm 6 draws the buffer to a canvas and moves its own scrollbar, so
  a drag reached nothing scrollable; it now synthesises a wheel event for xterm to dispatch, which
  scrolls the normal buffer and reports the wheel to full-screen agents such as Claude Code and
  OpenCode exactly as the desktop wheel does, with inertia after the finger lifts.
- A terminal's size follows whichever view is in use: work on the desktop and it uses the desktop's
  width, pick up the phone and it becomes the phone's, come back and it returns. Every other client
  renders that same grid, panning sideways when its window cannot hold it.
- The workbench fits a phone. Below 640px the split layouts fold to a single terminal, both side
  panels float over the workspace instead of taking a column of it, controls grow to a finger's
  size, and the tools at the right of the top bar collapse into one menu — the toolbar was
  scrolling nearly half its buttons, new terminal among them, out of reach behind a gesture
  nothing hinted at.
- Ask for a working folder in an in-app dialog rather than `window.prompt`, which some mobile
  browsers suppress outright, leaving a remote client no way to start a terminal at all. It arrives
  prefilled with the workspace folder, since the path names a folder on the machine running the
  desktop app and cannot be browsed from the phone holding the page.
- Keep the Git view on screen. It dropped back to the terminals whenever the repository overview
  went missing — which happens on every change of active terminal, and on any failed read — and it
  stopped polling the moment it was opened, so the one view that shows these changes was the only
  place they went stale. It now leaves only on a finished read that reports no repository, says why
  a read failed instead of rendering nothing, and returns to the file and diff layout it was left
  on.
- Fixed a terminal failing to restart with "invalid handle" or "end of file". portable-pty inverts
  the result of `TerminateProcess` on Windows, reporting a stale `GetLastError` value that has
  nothing to do with the call.

## V0.7.0

- Drop the system title bar and give the window its own chrome: the top bar now spans the whole window with minimise, maximise, and close at its right edge, and both side panels start beneath it the way an editor lays out. Dragging the bar moves the window and double-clicking it maximises, as before.
- Move the product mark and the settings entry into the title bar, and put the build version at the foot of the workspace panel, so the panel can be hidden without losing either.
- Replace the reveal button that only appeared once the workspace panel was hidden with a permanent Workspace toggle, and fold "new terminal" into the agent menu as a single New menu grouped into Terminal and AI Agents. Each agent now reports its installed version, or that it was not detected, before it is picked.
- Render terminals on the GPU, so a long scrollback scrolls without the stutter the DOM renderer produced. Machines without a usable GPU fall back to the previous renderer.
- Restore drag-to-reorder for terminal tabs in the desktop build, where the webview's own drag handling had been consuming the events.
- Keep a terminal on the account it was launched with when it reconnects, including after the app restarts. Its account directory, proxy settings, and provider key are rebuilt from what the terminal records, instead of being lost with the one-shot launch environment.
- Detect a finished sign-in on its own and refresh the account, rather than waiting for a login CLI that keeps running after the browser flow returns. Accounts are also re-read when the launch dialog or settings opens.
- Name the login account a terminal is running on in its header, and switch it from there: picking another account restarts that terminal on it with a new session, leaving its model, MCP profile, and automatic confirmation alone. The inspector's session details name the account too.
- Stop asking a signed-in managed Claude account to sign in again the first time a terminal opens on it. Claude runs its first-run wizard on `hasCompletedOnboarding` alone, and the wizard always includes a login step; earlier `claude auth login` builds never set the flag, so Termexo now sets it once the account directory holds credentials. An account that has not signed in still gets the wizard.
- Copy settings, instructions, plugins, and skills from one account to another. Credentials, account identity, and session history are never copied, so both accounts stay signed in as themselves.
- Say plainly, before launching, that a chosen account is not signed in yet and that the terminal will open on the CLI's own login prompt.
- Offer OpenCode the same resume settings as the other agents — model and automatic confirmation — and file an imported handoff under the workspace importing it, which previously left the record invisible once the preview closed.
- Warn when a generated handoff carries no evidence to pass on, instead of sending a package that looks complete but holds only its fallback task and summary.

## V0.6.2

- Draw terminal rows at the font's own line height, the spacing the Windows console uses. Rows were 35% taller than a native terminal, which loosened dense output and broke box-drawing frames apart between lines.

## V0.6.1

- Answer Claude Code's folder-trust screen by moving the highlight onto the option that grants trust. Its current build preselects "No, exit", so a task launched into a folder Claude had not seen before was declined by the automatic Enter instead of started.
- Tighten the inspector rail — smaller type, shorter section headers, denser agent rows, session details, allowance cards, and activity entries — so a workspace with several terminals shows its whole status column without scrolling.

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
