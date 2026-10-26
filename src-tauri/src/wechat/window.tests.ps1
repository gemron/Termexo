$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName WindowsBase
function Candidate($handle,$visible,$main) { return @{Handle=$handle;Visible=$visible;HasMainView=$main} }
function Check-Choice($rows,$expected) {
    $result=$null
    try { $result=Choose-WechatWindow $rows } catch { if ($null -ne $expected) { throw } }
    if ($result -ne $expected) { throw 'Window choice fixture failed' }
}
Check-Choice @((Candidate 1 $true $true),(Candidate 2 $false $false)) 1
Check-Choice @((Candidate 1 $false $true),(Candidate 2 $false $false)) 1
Check-Choice @((Candidate 1 $true $true),(Candidate 2 $true $true)) $null
Check-Choice @((Candidate 1 $false $true),(Candidate 2 $false $true)) $null
Check-Choice @((Candidate 2 $false $false)) $null
Check-Choice @() $null
Check-Choice @((Candidate 1 $true $true)) 1

# Exercise the production restoration coordinator without touching live windows.
function Start-Sleep { param($Milliseconds) }
function Window-State($handle) {
    $script:stateReads++
    return @{Exists=($script:scenario -ne 'closed');Visible=$script:visible;Minimized=$script:minimized;Foreground=$script:foreground}
}
function Request-WindowRestore($handle) {
    $script:restores++
    if ($script:scenario -ne 'stuck') { $script:visible=$true; $script:minimized=$false }
}
function Request-WindowForeground($handle) {
    $script:activations++
    if ($script:scenario -ne 'blocked') { $script:foreground=$true }
}
function Window-Element($handle) {
    $script:elementReads++
    $x=if ($script:scenario -eq 'moving' -and $script:elementReads -le 3) { 100+$script:elementReads } else { 100 }
    return [pscustomobject]@{Current=[pscustomobject]@{Name='WeChat';IsEnabled=($script:scenario -ne 'modal');BoundingRectangle=[System.Windows.Rect]::new($x,100,900,600)}}
}
function Check-Restore($scenario,$success,$restoreCalls) {
    $script:scenario=$scenario
    $script:visible=$scenario -ne 'tray'
    $script:minimized=$scenario -in @('minimized','stuck')
    $script:foreground=$false
    $script:stateReads=0
    $script:elementReads=0
    $script:restores=0
    $script:activations=0
    $result=$null
    $failure=$null
    try { $result=Ready-WechatWindow 1 } catch { $failure=$_ }
    if (($null -ne $result) -ne $success -or $script:restores -ne $restoreCalls) {
        throw "Window restore fixture $scenario failed: restores=$script:restores error=$failure"
    }
    if ($success -and $script:elementReads -lt 4) { throw 'Did not wait for stable window geometry' }
    if ($scenario -eq 'moving' -and $script:elementReads -ne 7) { throw 'Moving window accepted too early' }
    if ($scenario -eq 'blocked' -and $script:activations -ne 2) { throw 'Foreground retry was not bounded' }
}
Check-Restore 'minimized' $true 1
Check-Restore 'tray' $true 1
Check-Restore 'normal' $true 0
Check-Restore 'moving' $true 0
Check-Restore 'stuck' $false 1
Check-Restore 'modal' $false 0
Check-Restore 'blocked' $false 0
Check-Restore 'closed' $false 0
Write-Output '15 window fixtures passed'
