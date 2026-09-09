# Bundled ConPTY

`conpty.dll` and `OpenConsole.exe` from the [`Microsoft.Windows.Console.ConPTY`][pkg] package,
version **1.24.260710001** (file version 1.24.2607.10001), MIT licensed, sourced from
[microsoft/terminal][repo].

## Why they are here

`portable-pty` opens a pseudo console through `CreatePseudoConsole`. It prefers a `conpty.dll`
sitting next to the executable and only falls back to the one in `kernel32.dll`, which is whatever
ConPTY the user's Windows build happens to carry. That inbox version decides how faithfully input
reaches an agent, and older ones lose sequences on the way: `CSI Z` arrives as a plain Tab, so Claude
Code never sees Shift+Tab, and mouse reports are dropped entirely, so OpenCode cannot be scrolled.
The same versions reflow wrapped lines themselves, which xterm then reflows a second time.

Shipping these two files puts every install on the same modern ConPTY regardless of its Windows
build. `conpty.dll` looks for `OpenConsole.exe` beside itself, so both are staged into the directory
that holds `termexo.exe` — by `bundle.resources` in `tauri.conf.json` for the installers, and by
`packages/termexo/scripts/stage-binary.mjs` for the npm distribution.

## Updating

Download the package and copy the two binaries back into this directory:

```powershell
$version = '1.24.260710001'
Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.windows.console.conpty/$version/microsoft.windows.console.conpty.$version.nupkg" -OutFile conpty.zip
Expand-Archive conpty.zip -DestinationPath conpty-package
Copy-Item conpty-package/runtimes/win-x64/native/conpty.dll .
Copy-Item conpty-package/build/native/runtimes/x64/OpenConsole.exe .
```

Termexo ships x64 only, so the arm64 and x86 payloads in the package are not used.

[pkg]: https://www.nuget.org/packages/Microsoft.Windows.Console.ConPTY
[repo]: https://github.com/microsoft/terminal
