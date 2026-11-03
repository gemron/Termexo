# Windows endpoint-security reports

Termexo Windows releases are currently unsigned. The prepared SignPath
workflow still requires project approval and signing configuration; see
[Windows builds and signing](windows-build.md). Code signing identifies the
publisher and protects integrity, but does not guarantee acceptance by a company's
endpoint policy or prove that an antivirus detection is a false positive.

When reporting a block, retain the threat name, affected file path, event time and
action from the Kaspersky Endpoint Security event or the company's management
console. The blocked object may be the installer, `termexo.exe`, or a child
runtime; these require different investigations. The available event fields are
described in [Kaspersky's threat-processing documentation](https://support.kaspersky.com/KESWin/11.4.0/en-US/213725.htm).

To generate a local file inventory for IT or a vendor investigation, run from the
repository root in PowerShell:

```powershell
./scripts/inspect-windows-release.ps1
```

The report at `artifacts/windows-security/report.json` includes SHA-256 hashes,
file sizes, Authenticode status, publishers and timestamps for the local program,
installers and bundled Windows runtimes. It does not execute those files, upload
samples or change security settings. Its source commit identifies the current
checkout; only CI build records establish which commit produced a binary.

For v0.11.0 the local ConPTY DLL and OpenConsole executable carry valid Microsoft
signatures, and the bundled Node executable carries a valid OpenJS Foundation
signature. These checks cover those component files; they do not establish why
Termexo was blocked. A detection without a threat name or affected path remains
unresolved until the endpoint event or company IT report is available.
