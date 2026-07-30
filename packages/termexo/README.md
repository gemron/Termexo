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

Project source and desktop releases are available at
[github.com/gemron/Termexo](https://github.com/gemron/Termexo).
