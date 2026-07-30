# Termexo npm launcher

This package is the official Windows launcher for
[Termexo](https://www.termexo.com/), a local-first workspace for AI coding
agents, models, and terminals.

## Install

Termexo currently supports Windows.

```powershell
npm install --global termexo
termexo
```

The npm package contains the launcher, not the desktop application. Install the
latest Termexo desktop release first:

```powershell
termexo download
```

## Commands

```text
termexo              Start Termexo
termexo start        Start Termexo
termexo download     Open the latest release page
termexo --version    Show the launcher version
termexo --help       Show command help
```

If Termexo is installed in a custom directory, set `TERMEXO_PATH` to the full
path of `termexo.exe`.

Project source and desktop releases are available at
[github.com/gemron/Termexo](https://github.com/gemron/Termexo).
