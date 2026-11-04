param(
    [string]$ReleaseDirectory = (Join-Path $PSScriptRoot '../src-tauri/target/release'),
    [string]$OutputPath = (Join-Path $PSScriptRoot '../artifacts/windows-security/report.json')
)

$ErrorActionPreference = 'Stop'
$releaseRoot = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content -LiteralPath (Join-Path $repositoryRoot 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version
$files = @(
    (Join-Path $releaseRoot 'termexo.exe'),
    (Join-Path $releaseRoot "bundle/nsis/Termexo_${version}_x64-setup.exe"),
    (Join-Path $releaseRoot "bundle/msi/Termexo_${version}_x64_en-US.msi"),
    (Join-Path $repositoryRoot 'src-tauri/vendor/conpty/conpty.dll'),
    (Join-Path $repositoryRoot 'src-tauri/vendor/conpty/OpenConsole.exe')
)
$inventory = @($files | ForEach-Object {
    $filePath = $_
    if (Test-Path -LiteralPath $filePath -PathType Leaf) {
        $file = Get-Item -LiteralPath $filePath
        $signature = Get-AuthenticodeSignature -LiteralPath $filePath
        [ordered]@{
            path = $(if ($file.FullName.StartsWith($repositoryRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
                $file.FullName.Substring($repositoryRoot.Length).TrimStart('\', '/')
            } else { $file.FullName })
            bytes = $file.Length
            sha256 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
            signature = $signature.Status.ToString()
            publisher = $signature.SignerCertificate.Subject
            certificateThumbprint = $signature.SignerCertificate.Thumbprint
            timestamped = $null -ne $signature.TimeStamperCertificate
        }
    } else {
        [ordered]@{ path = $filePath; missing = $true }
    }
})
$report = [ordered]@{
    schemaVersion = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    configuredVersion = $version
    sourceCommit = (git -C $repositoryRoot rev-parse HEAD)
    workingTreeDirty = [bool](git -C $repositoryRoot status --porcelain)
    note = 'Inventory only. Source commit describes the current checkout, not verified binary provenance. This is not an antivirus scan.'
    files = $inventory
}
$destination = [System.IO.Path]::GetFullPath($OutputPath)
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($destination)) | Out-Null
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $destination -Encoding UTF8
Write-Output "Windows release inventory: $destination"
