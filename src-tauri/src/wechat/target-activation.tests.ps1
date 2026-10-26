$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
$AE = [System.Windows.Automation.AutomationElement]
$source = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'desktop.ps1')
$parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($name in @('Chat-Opened','Wait-Chat','Wait-SearchSelection','Open-TargetChat','Valid-SearchPopup')) {
    $fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    . ([scriptblock]::Create($fn.Extent.Text))
}
function Start-Sleep { param($Milliseconds) }
function Pattern($element,$identifier) { return $element }
function Row($identity) {
    $row=[pscustomobject]@{Identity=$identity}
    $row | Add-Member ScriptMethod GetRuntimeId { return @(42,$this.Identity) }
    return $row
}
function Chat-Title($root) {
    $script:titleReads++
    if ($script:scenario -eq 'late-title' -and $script:clicks -gt 0 -and $script:titleReads -ge 3) { $script:title='target' }
    return $script:title
}
function Match-Elements($root,$property,$value) {
    if ($value -eq [System.Windows.Automation.ControlType]::Edit) { return ,@($script:search) }
    if ($value -eq 'search_list' -and $script:searchOpen) { return ,@([pscustomobject]@{Current=[pscustomobject]@{IsOffscreen=$false}}) }
    return ,@()
}
function Search-Matches($root,$target) {
    $script:searchReads++
    $rows=@((Row 1))
    if ($script:scenario -eq 'no-result') { $rows=@() }
    if ($script:scenario -eq 'duplicate') { $rows+=Row 2 }
    if ($script:scenario -eq 'changed-result' -and $script:searchReads -gt 4) { $rows=@((Row 2)) }
    return @{Elements=$rows;Truncated=($script:scenario -eq 'truncated')}
}
function Search-ClickRoot($element,$mainRoot) {
    if ($script:scenario -eq 'blocked') { throw 'Unrelated popup must not be clicked' }
    return $script:popupRoot
}
function Click-Snapshot($element,$root) {
    $script:snapshotReads++
    $signature=if ($script:scenario -eq 'moving-popup' -and $script:snapshotReads -le 3) { [string]$script:snapshotReads } else { 'stable' }
    return @{Signature=$signature}
}
function Verified-Click($element,$processId,[scriptblock]$beforeClick,$clickRoot) {
    if ($clickRoot.Current.NativeWindowHandle -ne 2) { throw 'Search click used the main window instead of its popup' }
    if ($script:scenario -eq 'changed-query') { $script:search.Current.Value='user edit' }
    & $beforeClick
    $script:clicks++
    $script:searchOpen=$false
    $script:search.Current.Value=''
    if ($script:scenario -notin @('wrong-title','late-title')) { $script:title='target' }
}
function Check-Activation($scenario,$success,$clicks) {
    $script:scenario=$scenario
    $script:title=if ($scenario -eq 'start-target') { 'target' } else { 'other chat' }
    $script:searchOpen=$false
    $script:searchReads=0
    $script:snapshotReads=0
    $script:titleReads=0
    $script:clicks=0
    $script:popupRoot=[pscustomobject]@{Current=[pscustomobject]@{NativeWindowHandle=2}}
    $mainRoot=[pscustomobject]@{Current=[pscustomobject]@{NativeWindowHandle=1}}
    $script:search=[pscustomobject]@{Current=[pscustomobject]@{Name='Search';Value=''}}
    $script:search | Add-Member ScriptMethod SetFocus { }
    $script:search | Add-Member ScriptMethod SetValue {param($text) $this.Current.Value=$text; $script:searchOpen=($text -ne '') }
    if ($scenario -eq 'existing-search') { $script:search.Current.Value='user query' }
    $result=$null
    $failure=$null
    try { $result=Open-TargetChat $mainRoot 123 'target' } catch { $failure=$_ }
    if (($null -ne $result) -ne $success -or $script:clicks -ne $clicks) {
        throw "Activation fixture $scenario failed: clicks=$script:clicks error=$failure"
    }
    if ($success -and ($script:title -cne 'target' -or $script:searchOpen -or $script:titleReads -lt 3)) { throw 'Destination was not stably verified' }
    if ($scenario -eq 'moving-popup' -and $script:snapshotReads -ne 7) { throw 'Moving popup accepted too early' }
    if ($scenario -eq 'existing-search' -and $script:search.Current.Value -cne 'user query') { throw 'Changed existing search' }
    if ($scenario -eq 'changed-query' -and $script:search.Current.Value -cne 'user edit') { throw 'Erased user edit' }
}
Check-Activation 'switch-other' $true 1
Check-Activation 'start-target' $true 1
Check-Activation 'late-title' $true 1
Check-Activation 'moving-popup' $true 1
Check-Activation 'duplicate' $false 0
Check-Activation 'truncated' $false 0
Check-Activation 'no-result' $false 0
Check-Activation 'blocked' $false 0
Check-Activation 'changed-result' $false 0
Check-Activation 'changed-query' $false 0
Check-Activation 'wrong-title' $false 1
Check-Activation 'existing-search' $false 0

function Check-Popup($owner,$processId,$class,$expected) {
    if ((Valid-SearchPopup @{Owner=$owner;ProcessId=$processId;Class=$class} 1 123) -ne $expected) { throw 'Popup ownership fixture failed' }
}
Check-Popup 1 123 'Qt51514QWindowToolSaveBits' $true
Check-Popup 1 123 'Qt6QWindowToolSaveBits' $true
Check-Popup 2 123 'Qt51514QWindowToolSaveBits' $false
Check-Popup 1 999 'Qt51514QWindowToolSaveBits' $false
Check-Popup 1 123 'Qt51514QWindowIcon' $false
Check-Popup 1 123 'OtherQWindowToolSaveBits' $false
Check-Popup 1 123 '' $false
Write-Output '19 target activation fixtures passed'
