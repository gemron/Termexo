# Termexo npm launcher

This package runs the official Windows desktop executable for
[Termexo](https://www.termexo.com/). Let a connected AI use MCP to operate
Claude Code, Codex, OpenCode, Grok Build, and Antigravity terminals: find a
terminal, send a prompt, submit it, and read the actual reply. All five agents
run in a local Windows workbench you can view and take over.

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

## Version 0.10.13

Cleans up the Windows proxy environment, applies the default network profile to
every terminal, rescues session scans on older OpenCode CLIs, and strips
instruction markup from Codex session titles. Restart Agents after updating.

## Let one AI operate another through MCP

Install and sign in to the agent CLIs you want to use, then:

1. In **Settings → AI control (MCP)**, enable the local server, keep automatic
   connection enabled, allow terminal access, and click Apply. Also allow task
   access if you want to create and execute tasks. Check for Running.
2. Start or restart an agent terminal in Termexo. All five supported agents
   connect automatically as `termexo-desktop`; no address or token to copy.
3. Send this to the AI terminal and check for your actual workspaces and terminals:

> Use Termexo MCP to list my workspaces and terminals, and tell me which are running. Do not change anything yet.

Open an OpenCode terminal in the workbench, then try this from the connected AI:

> Use Termexo MCP to find the running OpenCode terminal in the current workspace. Send hi, submit Enter, and read its reply. If several terminals match, list their names so I can choose.

Existing-terminal interaction works with all five agent types. Task-board
execution supports Claude Code, Codex, OpenCode, and Grok Build; start
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
