$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
$AE = [System.Windows.Automation.AutomationElement]
$tokens = $null
$parseErrors = $null
$source = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'desktop.ps1')
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($name in @('Submit-Message','Wait-SendButton','Valid-ClickBounds','Valid-ClickHit')) {
    $function = $ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
    . ([scriptblock]::Create($function.Extent.Text))
}

# These fixtures execute the production coordinator with fake UI elements. No
# live window, native mouse call, message, or real delay is involved.
function Start-Sleep { param($Milliseconds) }
function Pattern($element, $identifier) { return $element }
function Chat-Input($root) { return $script:composer }
function Chat-Title($root) { return $script:title }
function Bubble($id) {
    $bubble = [pscustomobject]@{Current=[pscustomobject]@{Name='notification'}; Identity=$id}
    $bubble | Add-Member ScriptMethod GetRuntimeId { return @(42,$this.Identity) }
    return $bubble
}
function Match-Elements($root, $property, $value) {
    if ($value -eq [System.Windows.Automation.ControlType]::Button) {
        $script:buttonReads++
        $button = [pscustomobject]@{Current=[pscustomobject]@{Name='Send'; IsEnabled=($script:buttonReads -gt $script:delay); IsOffscreen=$false}}
        if ($script:scenario -eq 'duplicate-button') { return ,@($button,$button) }
        return ,@($button)
    }
    return ,$script:messages
}
function Click-Snapshot($element, $windowRoot) {
    if (-not $element.Current.IsEnabled -or $script:scenario -eq 'invalid-bounds') { return $null }
    if ($script:scenario -eq 'repositioning' -and $script:buttonReads -le 3) { return $null }
    if ($script:scenario -eq 'moving-button' -and $script:buttonReads -le 3) { return @{Signature=[string]$script:buttonReads} }
    return @{Signature='stable button and parent bounds'}
}
function Verified-Click($element, $processId, [scriptblock]$beforeClick) {
    if ($script:scenario -eq 'occluded') { throw 'occluded' }
    if ($script:scenario -eq 'changed-chat') { $script:title='different chat' }
    if ($script:scenario -eq 'changed-draft') { $script:composer.Current.Value='user edit' }
    & $beforeClick
    $script:clicks++
    if ($script:scenario -ne 'no-effect') { $script:composer.Current.Value='' }
    if ($script:scenario -in @('sent','delayed','repositioning','moving-button')) { $script:messages += Bubble 2 }
}
function Check($scenario, $success, $clicks, $attempted) {
    $script:scenario=$scenario
    $script:title='target'
    $script:messages=@((Bubble 1)) # An identical historical message must not prove delivery.
    $script:composer=[pscustomobject]@{Current=[pscustomobject]@{Value='';IsReadOnly=$false}}
    $script:composer | Add-Member ScriptMethod SetValue { param($text) $this.Current.Value=$text }
    if ($scenario -eq 'existing-draft') { $script:composer.Current.Value='user draft' }
    if ($scenario -eq 'read-only') { $script:composer.Current.IsReadOnly=$true }
    $script:delay=if ($scenario -eq 'never-ready') { 100 } elseif ($scenario -eq 'delayed') { 3 } else { 0 }
    $script:buttonReads=0
    $script:clicks=0
    $didAttempt=$false
    $result=$null
    $failure=$null
    try { $result=Submit-Message $null 123 'target' 'notification' ([ref]$didAttempt) } catch { $failure=$_ }
    $passed=($null -ne $result -and $result.status -eq 'submitted')
    if ($passed -ne $success -or $script:clicks -ne $clicks -or $didAttempt -ne $attempted) {
        throw "Delivery fixture $scenario failed: success=$passed clicks=$script:clicks attempted=$didAttempt error=$failure"
    }
    if ($script:clicks -gt 0 -and $script:buttonReads -lt 4) { throw 'Clicked before four stable snapshots' }
    if ($scenario -in @('delayed','repositioning','moving-button') -and $script:buttonReads -ne 7) { throw 'Did not wait for enabled and stable Send' }
    if ($scenario -eq 'existing-draft' -and $script:composer.Current.Value -cne 'user draft') { throw 'Overwrote user draft' }
    if ($scenario -eq 'changed-draft' -and $script:composer.Current.Value -cne 'user edit') { throw 'Overwrote changed draft' }
}
Check 'sent' $true 1 $true
Check 'delayed' $true 1 $true
Check 'no-effect' $false 1 $true
Check 'old-message-only' $false 1 $true
Check 'duplicate-button' $false 0 $false
Check 'existing-draft' $false 0 $false
Check 'read-only' $false 0 $false
Check 'changed-chat' $false 0 $false
Check 'changed-draft' $false 0 $false
Check 'occluded' $false 0 $false
Check 'repositioning' $true 1 $true
Check 'moving-button' $true 1 $true
Check 'never-ready' $false 0 $false
Check 'invalid-bounds' $false 0 $false

function Hit($identity, $processId=123, $windowHandle=0, $isWindow=$false) {
    return @{Identity=$identity;ProcessId=$processId;WindowHandle=$windowHandle;IsWindow=$isWindow}
}
function Check-HitFixture($chain, $expected) {
    if ((Valid-ClickHit $chain 'button' 123 456) -ne $expected) { throw 'Click identity fixture failed' }
}
Check-HitFixture @((Hit 'label'),(Hit 'button')) $true
Check-HitFixture @((Hit 'root' 123 456 $true)) $true
Check-HitFixture @((Hit 'other-control'),(Hit 'root' 123 456 $true)) $false
Check-HitFixture @((Hit 'other-window' 123 789 $true)) $false
Check-HitFixture @((Hit 'root' 999 456 $true)) $false
Check-HitFixture @((Hit 'button' 999)) $false

$windowRect=[System.Windows.Rect]::new(100,100,1000,800)
$parentRect=[System.Windows.Rect]::new(900,800,120,55)
$validRect=[System.Windows.Rect]::new(920,810,60,32)
$staleRect=[System.Windows.Rect]::new(1500,500,60,32)
if (-not (Valid-ClickBounds $validRect $parentRect $windowRect)) { throw 'Valid button bounds rejected' }
if (Valid-ClickBounds $staleRect $parentRect $windowRect) { throw 'Stale off-window bounds accepted' }
if (Valid-ClickBounds $validRect ([System.Windows.Rect]::new(200,200,100,100)) $windowRect) { throw 'Button outside its parent accepted' }
if (Valid-ClickBounds ([System.Windows.Rect]::Empty) $parentRect $windowRect) { throw 'Empty button bounds accepted' }
Write-Output '24 delivery fixtures passed'
