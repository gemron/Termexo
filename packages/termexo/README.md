# Termexo npm launcher

This package runs the official Windows desktop executable for
[Termexo](https://www.termexo.com/), a local-first workspace for AI coding
agents, models, and terminals.

## Install

Termexo currently supports Windows.

```powershell
npm install --global termexo
termexo
```

The Windows desktop executable is included in the npm package, so no separate
Termexo installation is required. You can also run it without a global install:

```powershell
npx termexo
```

## Commands

```text
termexo              Start the bundled Termexo desktop app
termexo start        Start the bundled Termexo desktop app
termexo download     Open the latest release page
termexo --version    Show the launcher version
termexo --help       Show command help
```

Set `TERMEXO_PATH` to the full path of another `termexo.exe` to override the
bundled executable.

## Version 0.10.11

Fixes Codex resume and completion states, Grok Windows status hooks, and empty
Antigravity MCP configuration. Adds agent-specific mobile shortcuts, remote-access
setup guidance, and clearer MCP instructions. Restart Agents after updating.

## Local MCP control

Version 0.10.10 adds 19 MCP tools for terminals, tasks and permitted settings.
In the desktop app, open **Settings → AI control (MCP)**, enable the local
server, choose access scopes and click Apply. With automatic connection enabled,
new Claude Code, Codex, OpenCode, Grok Build and Antigravity sessions launched
by Termexo connect as `termexo-desktop`. Restart already running Agents.

The server listens only on localhost. Terminal and task access default on when
the server is enabled; settings access is separate. Keep the desktop window
open while using MCP. Grok and Antigravity use user-level configuration;
disabling automatic connection removes Termexo-owned entries.

Read the [English user guide](https://www.termexo.com/guide.en.html#ai-control)
or [中文使用说明](https://www.termexo.com/guide.html#ai-control) for first-call
examples, external clients and downloadable PDFs.

Project source and desktop releases are available at
[github.com/gemron/Termexo](https://github.com/gemron/Termexo).
