<!--
Platform: Product Hunt
Title: Termexo 0.8 — answer your desktop coding agents from your phone browser
Category: Developer Tools
Tags: Developer Tools, Artificial Intelligence, Productivity, Windows, Open Source
Disclosure: Submitted by the Termexo maintainer. No V0.8 cover image exists yet; all gallery images listed here are real product screenshots.
-->

# Product Hunt V0.8 launch fields

## Product

Termexo

## Launch name

Termexo 0.8

## Tagline

Answer your desktop coding agents from your phone browser

## Short description

Termexo runs Claude Code, Codex CLI, and OpenCode in real PTY terminals on Windows. Turn on remote access and any phone, tablet, or second computer on your LAN or VPN opens the same workbench in a browser, reading and writing the same running terminals. Local-first and MIT licensed.

## Topics

- Developer Tools
- Artificial Intelligence
- Productivity

## Maker comment

Hi Product Hunt — I'm the maintainer of Termexo.

Termexo is a local-first Windows workbench for coding agents: real PTYs running Claude Code, Codex CLI, and OpenCode, with persistent workspaces, a shared state model (running, thinking, waiting for input, waiting for approval, completed, failed), and native session recovery through each CLI's own mechanism.

The thing that kept bothering me was walking away from the desk. Termexo would tell me a terminal was waiting for approval, but answering it meant going back to the machine. V0.8 fixes that:

- **Remote access.** Enable it in settings, and any phone, tablet, or second computer on the same LAN or VPN opens the full workbench in a browser — the same workspaces, the same terminals, live read and write against the same PTY processes. Not a read-only mirror, not a second set of sessions. Self-signed HTTPS with an access token; the settings panel shows the token, generates a QR code, and rotates it on demand.
- **One backend, not two.** Remote requests are replayed through the desktop's own command table rather than a parallel web API, so there is one implementation of every command. The trade-off is that Tauri's ACL does not cover application commands under a local origin, and the bridge necessarily claims a local origin — so an explicit allowlist is the only authorization boundary. The npm self-update, native file reads and writes, and changing the remote access settings themselves are all refused.
- **Touch scrolling that actually works.** xterm 6 paints the buffer to a canvas, so a finger drag reached nothing scrollable. Drags are now converted into synthesized wheel events, which scroll the normal buffer and get reported to full-screen TUIs like Claude Code the way they subscribe to them, with momentum after release.
- **Mobile layout.** Below 640px the split view collapses to a single terminal, side panels float over the work area instead of taking a column, controls are thumb-sized, and top-bar tools move into a "more" menu. Creating a terminal no longer needs a system dialog, which some mobile browsers block outright.
- **Session-scoped Git view.** It follows the current terminal and uses that terminal's HEAD at launch as the baseline, so you see what this session changed and committed, with single-column or side-by-side diffs and +N / −N counts.

Honest boundaries: Termexo is **Windows only**. Remote access is meant for trusted networks (home LAN or VPN); the certificate is self-signed, so browsers warn once per device, and the token is equivalent to full control of Termexo on that machine. The remote client cannot change the remote access settings, import or export network configuration, or trigger the self-update. A PTY has one size, so opening a terminal on your phone changes the column count on the desktop. The task board does not sync between clients. Native session files stay read-only, API keys stay in Windows Credential Manager, and there is no Termexo account and no cloud relay — remote access is the only outbound connection, and you turn it on, hand out the token, and switch it off yourself.

Try it with `npx termexo@latest`. I'd especially like to hear from people who run agents on a desktop and are away from it often: what did you actually need to do from the other room?

## Gallery plan (media order)

No V0.8 cover image exists yet — cover to be produced. Use real product screenshots in this order until it does:

1. `assets/termexo-remote-v0.8.png` — a phone opening the workbench through remote access, over the desktop it is connected to (lead image for this launch)
2. `assets/termexo-workbench-v0.8.png` — the V0.8 desktop workbench, two-terminal grid with real command output
3. `assets/termexo-git-v0.8.png` — session-scoped Git view: changed files, commit graph, diff
4. `assets/termexo-task-board.png` — tasks launching as real agent terminals
5. `assets/termexo-session-center.png` — native session discovery and resume
6. `assets/termexo-models.png` — model and provider profiles

## Links

- Website: https://www.termexo.com
- GitHub: https://github.com/gemron/Termexo
- Release: https://github.com/gemron/Termexo/releases/tag/v0.8.1
- npm: https://www.npmjs.com/package/termexo
