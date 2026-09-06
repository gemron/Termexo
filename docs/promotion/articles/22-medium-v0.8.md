<!--
Platform: Medium
Title: The Workbench Follows You to the Other Room
Subtitle: How Termexo 0.8 puts a running Windows agent terminal into a phone browser, and the three decisions that made it work
Category: Programming / Developer Tools
Tags: AI, Programming, Developer Tools, Windows, Open Source
Disclosure: Written by the Termexo maintainer. No V0.8 cover image exists yet; every screenshot in the body is from the real product.
-->

# The Workbench Follows You to the Other Room

*How Termexo 0.8 puts a running Windows agent terminal into a phone browser — and the three engineering decisions that made it work.*

You start a long refactor with Claude Code, watch the first few tool calls go well, and walk away. Ten minutes later, in another room, your phone buzzes: a terminal needs attention. The agent has stopped on an approval prompt, and it will keep waiting, patiently, doing nothing, until you are back in front of the machine that owns the PTY.

Termexo has been good at the first half of that problem for a while. It maps each agent's events into a shared set of states — running, thinking, waiting for input, waiting for approval, completed, failed — and raises a banner, a Windows notification, and a taskbar alert pointing at the terminal that needs you. But a notification you can only acknowledge is a polite way of saying "walk back to your desk."

Version 0.8 closes that gap. **Termexo** is an MIT-licensed, local-first workbench for coding agents on Windows: an Angular 22 frontend inside a Tauri 2 / Rust shell that launches real PTYs running Claude Code, Codex CLI, and OpenCode, and persists workspaces in SQLite. In 0.8, it also serves that same workbench over your own network.

![Termexo open in a phone browser, on top of the desktop it is connected to](../assets/termexo-remote-v0.8.png)

Turn on remote access in settings and any phone, tablet, or second computer on the same LAN or VPN opens the full workbench in a browser: the same workspaces, the same terminals, reading and writing the same PTY processes running on the desktop right now. Not a read-only mirror, and not a second set of sessions. It is self-signed HTTPS behind an access token; the settings panel shows the token, turns it into a QR code, and rotates it on demand.

Three decisions did most of the work.

## 1. Don't write a second backend — replay requests through the one that already exists

The obvious way to build this is a web server: HTTP routes wired to the terminal manager, the workspace database, and the agent adapters, kept in step with the desktop app forever. That is two implementations of the same product, and the second one drifts.

So a request arriving on the socket is instead turned into an `InvokeRequest` and handed to the main webview, where it goes through the same command table, the same handlers, and the same deserialization the desktop UI uses. There is exactly one implementation of "create a terminal" or "list sessions."

That buys correctness and costs you the framework's safety net. Tauri's ACL does not cover application commands under a local origin, and a bridge that replays requests into the main webview necessarily claims a local origin. The ACL therefore cannot tell a remote request from a local one, which means **an explicit allowlist is the only authorization boundary in this design.** Not defense in depth, not a second line behind a framework check: the only one.

So the list is enumerated rather than filtered, and anything not named is refused. The npm self-update is refused. Native filesystem reads and writes are refused. And changing the remote access settings themselves is refused, so a remote client cannot widen its own access or rotate its own token. To change what remote access can do, you go to the keyboard of the machine serving it.

## 2. A finger drag that reached nothing scrollable

The first time I opened the workbench on a phone, the terminal was there, the output was live, and scrolling back through it was impossible.

xterm 6 draws the buffer onto a canvas and paints its own scrollbar, so there is no tall DOM element behind your finger for the browser to scroll: a drag across the terminal lands on a fixed-size canvas with nothing scrollable underneath it. On the desktop this never comes up, because a mouse wheel over the terminal is an event xterm already understands.

So the fix was to give the drag the shape of the thing that already works: it is converted into synthesized wheel events and handed to xterm to dispatch. In the normal buffer, that scrolls the scrollback exactly as the wheel does. In a full-screen TUI — Claude Code and OpenCode both run as one — xterm reports the wheel to the application in whatever way that application subscribed to it, so the TUI scrolls its own view instead of the emulator scrolling out from under it. Behaviour matches the desktop wheel in both cases, and releasing the drag carries momentum.

Translating a new input method into input the system already handles beats teaching the system a second vocabulary: one code path stayed authoritative for "how far did this terminal scroll," and TUIs that have never heard of touch events got touch scrolling for free.

## 3. One PTY has one size, so it belongs to whoever is using it

This is the constraint you cannot design around. A pseudo-terminal has one number of rows and one number of columns. Every client attached to it sees the same grid, because there is only one grid, and there is no per-viewer reflow to be had.

So Termexo hands the size to the end that is actually being used. Work at the desk and the PTY takes the desktop's width. Pick up the phone and drive it from there, and it becomes the phone's width. Go back to the desk and it changes back. Every other client renders that same grid and pans horizontally when its window cannot fit it — honest about what is happening, rather than pretending a narrow viewport can reflow a terminal that has already been drawn.

![The desktop workbench: a two-terminal grid with real command output](../assets/termexo-workbench-v0.8.png)

Around that, the phone got a layout of its own. Below 640px the split layout collapses to a single terminal, the side panels float above the work area instead of taking a column away from it, controls grow to thumb-sized targets, and the tools on the right of the top bar collapse into a "more" menu.

One smaller fix mattered more than it looks. Creating a terminal in the browser used to ask for the directory with `window.prompt`, which some mobile browsers block outright — so on those devices, remote clients could not create a terminal at all. It is now an in-app dialog, prefilled with the current workspace directory. A feature that depends on a host dialog quietly does not exist on some client you did not test.

## The other line in 0.8: a Git view scoped to the session

Remote access is the headline, but the smaller change is the one I use most often. The Git view now follows the current terminal and takes that terminal's HEAD at launch as its baseline, so it answers "what did *this session* touch" rather than "what is dirty in this repository." It lists the files the session changed and what it committed, gives any file a single-column or side-by-side diff with +N / −N line counts, and keeps reading the repository while you look at it. It also refuses to lose your place: switching terminals or failing to read the repository never throws you back to the terminal view, a failed read says why, and leaving and returning puts you on the same file with the same diff layout. Native session files stay read-only, as they always have.

## The boundaries, stated plainly

- **Windows only.** There is no macOS or Linux build.
- **Remote access is for trusted networks** — a home LAN or a VPN. The certificate is self-signed, so browsers warn you and every device needs one manual confirmation.
- **The token is full control of Termexo on that machine.** Treat it as a key to the box, not a share link.
- **The remote client cannot change the remote access settings**, import or export network configuration, or trigger the npm self-update.
- **A terminal has one size, set by whoever adjusted it last.** Opening a terminal on your phone changes the column count on the desktop too.
- The task board does not sync; tasks live in each browser's local storage. Codex third-party endpoints must be Responses API compatible, and not every model is.

## Try it

Termexo runs on Windows 10 and 11 x64 with WebView2 and Node.js 18.18+, under the MIT License. The current version is 0.8.1:

```powershell
npx termexo@latest
```

- Website: https://www.termexo.com
- GitHub: https://github.com/gemron/Termexo
- Release: https://github.com/gemron/Termexo/releases/tag/v0.8.1
- npm: https://www.npmjs.com/package/termexo

If you have ever walked back to your desk just to type "yes," I would like to hear how this holds up on your network and your devices. Try it, open an issue for whatever breaks, and send a pull request if you want to fix something. Star it only if it actually helped.

*Disclosure: I am the maintainer of Termexo. The screenshots in this article are of the real application.*
