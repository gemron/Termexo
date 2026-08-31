<!--
Platform: Medium
Title: I Built a Local Windows Workbench for Claude Code, Codex, and OpenCode
Subtitle: What changed from Termexo 0.4 to 0.6—and why managing attention matters more than opening more terminals
Tags: AI, Programming, Open Source, Developer Tools, Windows
Disclosure: Written by the Termexo maintainer. AI-assisted cover; real product screenshots in the body.
-->

# I Built a Local Windows Workbench for Claude Code, Codex, and OpenCode

*What changed from Termexo 0.4 to 0.6—and why managing attention matters more than opening more terminals.*

Once coding agents move from an occasional experiment to part of your daily workflow, the bottleneck changes. The models may keep working in parallel, but your attention does not.

I regularly had Claude Code and Codex running across several projects. One terminal was executing tests, another was waiting for approval, and yesterday’s useful session was buried under a different branch or account. Opening more terminal windows was easy. Knowing which one needed me—and preserving enough context to continue safely—was not.

That is why I built **Termexo**, an MIT-licensed, local-first Windows workbench for coding agents. Version 0.6 now treats Claude Code, Codex, and OpenCode as first-class agents in the same workflow.

![Termexo 0.6](../assets/termexo-cover-v0.6.png)

## A workbench around native CLIs, not another chat UI

Termexo does not replace the agents or reimplement their protocols. Each CLI still runs in a real PTY. The desktop application adds a workspace layer around them: terminal layout, observable state, native-session discovery, model and network profiles, prompt assets, handoffs, and executable tasks.

A workspace can contain any number of terminals. You choose which ones remain visible and arrange them in a persistent grid of up to six rows and six columns. Project folders, tabs, layouts, models, and themes survive application restarts.

More importantly, Termexo maps each agent’s events into a shared set of states: running, thinking, waiting for input, waiting for approval, completed, and failed. A persistent banner, Windows notification, and taskbar alert point back to the terminal that actually needs attention.

![Multiple coding agents in a persistent workspace](../assets/termexo-workbench.png)

The goal is not to make four terminals look tidy. It is to stop polling four terminals just to find out whether anything changed.

## Version 0.4: make execution, networking, and model selection predictable

The 0.4 line focused on operational foundations.

Network profiles can be global or scoped to one workspace and cover HTTP, HTTPS, SOCKS, `NO_PROXY`, npm registry settings, and enterprise certificate authorities. Proxy passwords go to the operating-system credential store. CLI installation and upgrades are previewed, checked against the active network profile, and rolled back when post-install health checks fail.

Provider profiles keep models, endpoints, and credentials together. Claude Code can use Anthropic, DeepSeek, MiniMax, GLM, or a custom Anthropic-compatible endpoint without rebuilding environment variables for every terminal. API keys are stored in Windows Credential Manager rather than SQLite or frontend state.

Model switching is treated as a transaction. Termexo validates every target configuration first, then restarts the affected terminals. If only part of the operation succeeds, it restores the previous command, session, and profile where possible. A visible success state that still sends requests to the old endpoint is worse than an explicit failure.

![Provider profiles and endpoint settings](../assets/termexo-models.png)

Termexo also extracts local token activity from native events and session files. Plan limits, reset times, and warning thresholds can be configured per provider. When a provider does not expose an official quota API, the interface says “estimated” or “unavailable” instead of presenting local telemetry as authoritative billing data.

Version 0.4.5 added searchable previews of locally installed terminal fonts and continued fixing Windows IME candidate positioning—small details that matter when the application stays open all day.

## Version 0.5: prompts and handoffs become reusable assets

Starting an agent is only the first half of the workflow. The harder question is how to move the right context when responsibility changes.

Termexo 0.5 captures input independently for each terminal. Unsent drafts survive an unexpected close, while submitted prompts can be searched, pinned, favorited, deleted, and reused.

It can also generate a handoff package from one terminal or an entire workspace. A package may include:

- task status and a session summary;
- recent prompts and bounded terminal output;
- Git status, diff, and changed files;
- completed verification, known risks, and next steps.

Handoffs can be exported as readable Markdown or machine-readable JSON, imported again, or sent directly to another Claude Code or Codex terminal. A configurable token budget limits large terminal output and Git diffs without splitting UTF-8 characters. Common API keys, bearer tokens, passwords, and secrets are redacted before storage.

This is intentionally not a private-transcript conversion. Termexo moves a sanitized work package; it does not rewrite one vendor’s native conversation into another vendor’s session format.

## Version 0.6: a task board that actually runs agents

OpenCode became Termexo’s third first-class agent in version 0.6. Launch, session discovery and resume, restart restoration, state mapping, and optional automatic confirmation now follow the same workflow as Claude Code and Codex.

The new task board connects planning to execution. A task can carry a project, priority, acceptance criteria, target agent, and model. Starting it creates a real agent terminal. The card then moves through backlog, running, completed, and accepted states according to the terminal’s status.

![A task becomes a real agent terminal and remains linked to acceptance](../assets/termexo-task-board.png)

This is not just a Kanban board with manual drag-and-drop. The task, the native agent session, and the human acceptance decision remain part of one chain. When an agent reports completion, a person can accept the result or send it back for further work.

All three agents expose an optional auto-confirm mode with the same visible `AUTO` marker. It is useful for bounded tasks in repositories you fully trust. Unknown scripts, sensitive data, and elevated operations should still keep human approval in the loop.

The terminal workbench was also rebuilt around faster navigation: tabs can be dragged, middle-clicked to close, switched with the mouse wheel, and controlled from the keyboard. For Claude sessions still owned by a background CLI process, Termexo can inspect, fork, or attach instead of performing a normal resume that exits after the first message.

## Native session recovery, with an honest boundary

Termexo discovers sessions across projects, accounts, branches, and models, then uses the CLIs’ own recovery mechanisms:

```text
claude --resume
codex resume
opencode --session
```

The original session files remain read-only. Termexo does not rename, modify, or delete them.

Recovery is not process checkpointing. After a crash or reboot, the old PTY and operating-system process are gone. Termexo creates a fresh PTY and asks the CLI to resume its native session ID. Conversation context, workspace configuration, and files already written to disk remain; an operation that was in flight must be checked before continuing.

![Native session discovery and resume](../assets/termexo-session-center.png)

That distinction matters for migrations, pushes, network requests, and other non-idempotent actions. A tool should make the boundary visible rather than imply that a dead process was preserved perfectly.

## Local-first does not mean “the model never uses the network”

Termexo requires no Termexo account and runs no Termexo cloud relay. Workspace state and session indexes stay in local SQLite storage. Credentials stay in Windows Credential Manager. Native agent histories remain read-only.

The agent CLIs still connect to whichever model provider you select, under that provider’s terms and privacy policy. Termexo is the local management and orchestration layer, not a proxy that hides where model requests go.

The application is most useful when you maintain several projects, run more than one coding agent, resume historical sessions frequently, or need workspace-specific network and model settings. If you only open one CLI for one short conversation, a native terminal may already be enough.

## Try it with one command

Termexo currently targets Windows 10 and 11 and is available under the MIT License. With Node.js and WebView2 installed, the complete desktop application can be launched through npm:

```powershell
npx termexo@latest
```

- Website: https://www.termexo.com
- GitHub: https://github.com/gemron/Termexo
- Latest release: https://github.com/gemron/Termexo/releases/latest
- npm: https://www.npmjs.com/package/termexo

If you already run Claude Code, Codex, or OpenCode in parallel, I would value concrete workflow and failure reports. The problem Termexo is trying to solve is deliberately narrow: let agents spend more time doing the work without making people spend more time managing a wall of terminals.

*Disclosure: I am the maintainer of Termexo. The cover image was AI-assisted; screenshots in the article are from the real product.*
