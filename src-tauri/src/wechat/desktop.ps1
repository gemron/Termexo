$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__TERMEXO_PAYLOAD__')) | ConvertFrom-Json
$AE = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]::Descendants
__TERMEXO_TARGET_RESOLUTION__
__TERMEXO_WINDOW_ACTIVATION__
function Match-Elements($root, $property, $value) {
    $condition = [System.Windows.Automation.PropertyCondition]::new($property, $value)
    $found = $root.FindAll($scope, $condition)
    $result = @()
    for ($i=0; $i -lt $found.Count; $i++) { $result += $found.Item($i) }
    return ,$result
}
function Pattern($element, $identifier) {
    $pattern = $null
    if (-not $element.TryGetCurrentPattern($identifier, [ref]$pattern)) { throw '微信未提供所需的可访问性操作模式；未发送。' }
    return $pattern
}
function Chat-Title($root) {
    $all = Match-Elements $root $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)
    $titles = @($all | Where-Object { $_.Current.AutomationId.EndsWith('.current_chat_name_label') })
    if ($titles.Count -ne 1) { return '' }
    return $titles[0].Current.Name
}
function Chat-Input($root) {
    $inputs = Match-Elements $root $AE::AutomationIdProperty 'chat_input_field'
    if ($inputs.Count -ne 1) { throw '无法唯一识别微信消息输入框；未发送。' }
    return $inputs[0]
}
function Search-Matches($root, [string]$target = $payload.target) {
    $lists = Match-Elements $root $AE::AutomationIdProperty 'search_list'
    $lists = @($lists | Where-Object { -not $_.Current.IsOffscreen })
    if ($lists.Count -ne 1) { return @{Elements=@(); Signature=''; Truncated=$false} }
    $children = $lists[0].FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $rows = @()
    $elements = @()
    for ($i=0; $i -lt $children.Count; $i++) {
        $element = $children.Item($i)
        if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::ListItem) { continue }
        $elements += $element
        $rows += @{Name=$element.Current.Name; Id=$element.Current.AutomationId}
    }
    $parsed = Resolve-SearchRows $rows $target
    $resolvedElements = @($parsed.Indices | ForEach-Object { $elements[$_] })
    $signature = ($resolvedElements | ForEach-Object { $_.GetRuntimeId() -join '.' }) -join '|'
    return @{Elements=$resolvedElements; Signature=$signature; Truncated=$parsed.Truncated}
}
function Chat-Opened($root, [string]$target = $payload.target) {
    $lists = Match-Elements $root $AE::AutomationIdProperty 'search_list'
    $lists = @($lists | Where-Object { -not $_.Current.IsOffscreen })
    return ($lists.Count -eq 0 -and (Chat-Title $root) -ceq $target)
}
function Wait-Chat($root, [string]$target = $payload.target) {
    $stable = 0
    for ($i=0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 150
        if (Chat-Opened $root $target) { $stable++ } else { $stable=0 }
        if ($stable -ge 3) { return $true }
    }
    return $false
}
function Valid-SearchPopup($info, $mainHandle, $processId) {
    return ($info.Owner -eq $mainHandle -and $info.ProcessId -eq $processId -and
        $info.Class.StartsWith('Qt',[StringComparison]::Ordinal) -and
        $info.Class.EndsWith('QWindowToolSaveBits',[StringComparison]::Ordinal))
}
function Search-ClickRoot($element, $mainRoot) {
    Initialize-WindowApi
    $rect = $element.Current.BoundingRectangle
    if ($rect.IsEmpty -or $rect.Width -lt 2 -or $rect.Height -lt 2) { throw '搜索项坐标尚未就绪。' }
    $hitRoot = [TermexoWeChatWindow]::RootAt([int][Math]::Floor($rect.X+$rect.Width/2),[int][Math]::Floor($rect.Y+$rect.Height/2))
    $mainHandle = [IntPtr]::new($mainRoot.Current.NativeWindowHandle)
    if ($hitRoot -eq $mainHandle) { return $mainRoot }
    $info = @{Owner=[TermexoWeChatWindow]::OwnerOf($hitRoot);ProcessId=[TermexoWeChatWindow]::ProcessOf($hitRoot);Class=[TermexoWeChatWindow]::ClassOf($hitRoot)}
    if (-not (Valid-SearchPopup $info $mainHandle $mainRoot.Current.ProcessId)) { throw '搜索结果被无关窗口遮挡，未点击。' }
    # Search lives in a separate Qt tool window owned by WeChat. This exception
    # applies only to the exact resolved search row, never to the Send button.
    $popup = Window-Element $hitRoot
    if ([IntPtr]::new($popup.Current.NativeWindowHandle) -ne $hitRoot) { throw '无法核对微信搜索弹层，未点击。' }
    return $popup
}
function Wait-SearchSelection($root, [string]$target, $searchValue) {
    $stable = 0
    $signature = ''
    for ($round=0; $round -lt 24; $round++) {
        Start-Sleep -Milliseconds 150
        if ($searchValue.Current.Value -cne $target) { throw '微信搜索已被修改；未点击、未发送。' }
        $found = Search-Matches $root $target
        if ($found.Truncated) { throw '联系人/群搜索结果被截断，无法排除隐藏重名目标；未发送。' }
        if ($found.Elements.Count -gt 1) { throw '找到多个同名联系人/群，无法唯一确定目标；未发送。' }
        if ($found.Elements.Count -ne 1) { $stable=0; $signature=''; continue }
        try {
            $clickRoot = Search-ClickRoot $found.Elements[0] $root
            $snapshot = Click-Snapshot $found.Elements[0] $clickRoot
            if ($null -eq $snapshot) { $stable=0; $signature=''; continue }
            $fresh = $snapshot.Signature+'|'+$clickRoot.Current.NativeWindowHandle
            if ($fresh -ceq $signature) { $stable++ } else { $stable=1; $signature=$fresh }
            if ($stable -ge 4) { return @{Element=$found.Elements[0];Root=$clickRoot} }
        } catch { $stable=0; $signature='' }
    }
    throw '无法唯一定位稳定的微信搜索结果；未点击、未发送。'
}
function Open-TargetChat($root, $processId, [string]$target) {
    $searches = Match-Elements $root $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)
    $searches = @($searches | Where-Object { $_.Current.Name -in @('搜索','Search') })
    if ($searches.Count -ne 1) { throw '无法唯一识别微信搜索框；未发送。' }
    $searchValue = Pattern $searches[0] ([System.Windows.Automation.ValuePattern]::Pattern)
    if (-not [string]::IsNullOrEmpty($searchValue.Current.Value)) { throw '微信搜索框已有内容，请先清空搜索；未发送。' }
    try {
        $searches[0].SetFocus()
        $searchValue.SetValue($target)
        $selection = Wait-SearchSelection $root $target $searchValue
        $identity = $selection.Element.GetRuntimeId() -join '.'
        Verified-Click $selection.Element $processId {
            $fresh = Search-Matches $root $target
            if ($searchValue.Current.Value -cne $target -or $fresh.Truncated -or $fresh.Elements.Count -ne 1 -or
                ($fresh.Elements[0].GetRuntimeId() -join '.') -cne $identity) { throw '搜索目标在点击前发生变化；未点击、未发送。' }
        } $selection.Root
        if (-not (Wait-Chat $root $target)) { throw '搜索目标未能打开或聊天标题不匹配；未填写、未发送。' }
        return '已核对原生搜索弹层并点击唯一目标，完整聊天标题已稳定匹配'
    } finally {
        try { if ($searchValue.Current.Value -ceq $target) { $searchValue.SetValue('') } } catch { }
    }
}
function Valid-ClickBounds($rect, $parentRect, $windowRect) {
    return (-not $rect.IsEmpty -and $rect.Width -ge 2 -and $rect.Height -ge 2 -and
        -not [double]::IsInfinity($rect.X) -and -not [double]::IsInfinity($rect.Y) -and
        $parentRect.Contains($rect) -and $windowRect.Contains($rect))
}
function Click-Snapshot($element, $windowRoot) {
    if ($element.Current.IsOffscreen -or -not $element.Current.IsEnabled) { return $null }
    $rect = $element.Current.BoundingRectangle
    $parent = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($element)
    if ($null -eq $parent -or -not (Valid-ClickBounds $rect $parent.Current.BoundingRectangle $windowRoot.Current.BoundingRectangle)) { return $null }
    Initialize-WindowApi
    if ([TermexoWeChatWindow]::RootAt([int][Math]::Floor($rect.X+$rect.Width/2),[int][Math]::Floor($rect.Y+$rect.Height/2)) -ne [IntPtr]::new($windowRoot.Current.NativeWindowHandle)) { return $null }
    return @{Rectangle=$rect; Signature=(($element.GetRuntimeId() -join '.')+'|'+$rect.ToString()+'|'+$parent.Current.BoundingRectangle.ToString()+'|'+$windowRoot.Current.BoundingRectangle.ToString())}
}
function Valid-ClickHit($chain, $identity, $processId, $windowHandle) {
    foreach ($node in $chain) {
        if ($node.Identity -ceq $identity -and $node.ProcessId -eq $processId) { return $true }
    }
    # WeChat's Qt provider sometimes returns only the native window, even over a
    # correctly positioned control. Accept that exact root only; another control,
    # owned popup, process or window never qualifies for this path.
    return ($chain.Count -gt 0 -and $chain[0].IsWindow -and
        $chain[0].WindowHandle -eq $windowHandle -and $chain[0].ProcessId -eq $processId)
}
function Verified-Click($element, $processId, [scriptblock]$beforeClick = {}, $windowRoot, [switch]$CheckOnly) {
    if (-not ('TermexoWeChatMouse' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TermexoWeChatMouse {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    public static uint ForegroundProcess() { uint process; GetWindowThreadProcessId(GetForegroundWindow(), out process); return process; }
    public static bool SameRootAt(int x, int y, IntPtr window) { return GetAncestor(WindowFromPoint(new Point { X=x, Y=y }), 2) == window; }
}
'@
    }
    $snapshot = Click-Snapshot $element $windowRoot
    if ($null -eq $snapshot) { throw '目标元素坐标无效、不可见或不可操作；未点击、未发送。' }
    $rect = $snapshot.Rectangle
    $point = [System.Windows.Point]::new([Math]::Floor($rect.X+$rect.Width/2), [Math]::Floor($rect.Y+$rect.Height/2))
    $identity = $element.GetRuntimeId() -join '.'
    $windowHandle = [IntPtr]::new($windowRoot.Current.NativeWindowHandle)
    function Check-Hit {
        if ([TermexoWeChatMouse]::ForegroundProcess() -ne $processId) { throw '微信已失去前台焦点；未点击。' }
        $fresh = Click-Snapshot $element $windowRoot
        if ($null -eq $fresh -or $fresh.Signature -cne $snapshot.Signature) { throw '目标元素位置仍在变化；未点击。' }
        if (-not [TermexoWeChatMouse]::SameRootAt([int]$point.X,[int]$point.Y,$windowHandle)) { throw '按钮所在位置被其他窗口遮挡；未点击。' }
        $hit = $AE::FromPoint($point)
        $chain = @()
        for ($depth=0; $depth -lt 12 -and $null -ne $hit; $depth++) {
            $chain += @{Identity=($hit.GetRuntimeId() -join '.'); ProcessId=$hit.Current.ProcessId; IsWindow=($hit.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window); WindowHandle=$hit.Current.NativeWindowHandle}
            $hit = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($hit)
        }
        if (-not (Valid-ClickHit $chain $identity $processId $windowHandle.ToInt64())) { throw '元素命中检查不匹配；未点击。' }
    }
    Check-Hit
    if ($CheckOnly) { return @{status='ready'; detail='已核对按钮边界、原生窗口及 UIA 命中；未移动鼠标、未点击。'} }
    $old = [TermexoWeChatMouse+Point]::new()
    [void][TermexoWeChatMouse]::GetCursorPos([ref]$old)
    if (-not [TermexoWeChatMouse]::SetCursorPos([int]$point.X,[int]$point.Y)) { throw '无法定位到已核对的目标元素；未点击。' }
    try {
        Start-Sleep -Milliseconds 150
        Check-Hit
        & $beforeClick
        [TermexoWeChatMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
        try { Start-Sleep -Milliseconds 60 } finally { [TermexoWeChatMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
    } finally {
        $current = [TermexoWeChatMouse+Point]::new()
        [void][TermexoWeChatMouse]::GetCursorPos([ref]$current)
        if ($current.X -eq $point.X -and $current.Y -eq $point.Y) { [void][TermexoWeChatMouse]::SetCursorPos($old.X,$old.Y) }
    }
}
function Wait-SendButton($root, [string]$target, [string]$message) {
    $stable = 0
    $signature = ''
    for ($round=0; $round -lt 40; $round++) {
        Start-Sleep -Milliseconds 150
        $current = Pattern (Chat-Input $root) ([System.Windows.Automation.ValuePattern]::Pattern)
        if ((Chat-Title $root) -cne $target -or $current.Current.Value -cne $message) {
            throw '目标或草稿在发送前发生变化；未点击发送，请检查微信草稿。'
        }
        $allButtons = Match-Elements $root $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Button)
        $buttons = @($allButtons | Where-Object { $_.Current.Name -in @('发送','Send') })
        if ($buttons.Count -ne 1) { throw '无法唯一识别微信发送按钮；未点击发送，请检查微信草稿。' }
        $snapshot = Click-Snapshot $buttons[0] $root
        if ($null -eq $snapshot) { $stable=0; $signature=''; continue }
        if ($snapshot.Signature -ceq $signature) { $stable++ } else { $stable=1; $signature=$snapshot.Signature }
        if ($stable -ge 4) { return $buttons[0] }
    }
    throw '微信发送按钮坐标或可用状态未稳定；未点击发送，请检查微信草稿。'
}
function Submit-Message($root, $processId, [string]$target, [string]$message, [ref]$attempted) {
    if ((Chat-Title $root) -cne $target) { throw '目标聊天发生变化；未输入、未发送。' }
    $input = Chat-Input $root
    $value = Pattern $input ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($value.Current.IsReadOnly -or -not [string]::IsNullOrEmpty($value.Current.Value)) {
        throw '目标输入框不可写或已有草稿；未发送。'
    }
    $messageId = 'chat_message_list.qt_scrollarea_viewport.chat_bubble_item_view'
    $existing = Match-Elements $root $AE::AutomationIdProperty $messageId
    $previous = @($existing | Where-Object { $_.Current.Name -ceq $message } | ForEach-Object { $_.GetRuntimeId() -join '.' })
    $script:stage = '填写消息'
    $value.SetValue($message)
    $script:stage = '等待发送按钮'
    $button = Wait-SendButton $root $target $message
    $script:stage = '点击前校验'
    Verified-Click $button $processId {
        $current = Pattern (Chat-Input $root) ([System.Windows.Automation.ValuePattern]::Pattern)
        if ((Chat-Title $root) -cne $target -or $current.Current.Value -cne $message) {
            throw '目标或草稿在点击前发生变化；未点击发送，请检查微信草稿。'
        }
        $attempted.Value = $true
        $script:stage = '点击发送'
    } $root
    $script:stage = '确认新消息'
    for ($round=0; $round -lt 20; $round++) {
        Start-Sleep -Milliseconds 150
        if ((Chat-Title $root) -cne $target) { throw '发送后聊天发生变化，结果无法确认；不会自动重试。' }
        $current = Pattern (Chat-Input $root) ([System.Windows.Automation.ValuePattern]::Pattern)
        $allMessages = Match-Elements $root $AE::AutomationIdProperty $messageId
        $messages = @($allMessages | Where-Object { $_.Current.Name -ceq $message -and ($_.GetRuntimeId() -join '.') -cnotin $previous })
        if ([string]::IsNullOrEmpty($current.Current.Value) -and $messages.Count -gt 0) {
            return @{status='submitted'; detail='微信输入框已清空，消息列表中已出现新的本条消息；不代表对方已读或网络最终投递。'}
        }
    }
    throw '已点击发送，但微信界面未确认新消息；不会自动重试，请人工检查。'
}
$submitted = $false
$stage = '恢复微信窗口'
try {
    $window = Find-WechatWindow
    $root = Ready-WechatWindow $window
    $wechatProcessId = $root.Current.ProcessId
    if ($root.Current.Name -notin @('微信','Weixin','WeChat')) { throw '未识别到已登录的微信主窗口；未发送。' }
    $stage = '检查现有草稿'
    # Never replace a user's existing chat draft, even when it belongs to a different chat.
    $oldInput = Chat-Input $root
    $oldValue = Pattern $oldInput ([System.Windows.Automation.ValuePattern]::Pattern)
    if (-not [string]::IsNullOrEmpty($oldValue.Current.Value)) { throw '微信当前聊天存在草稿，请先处理草稿；未发送。' }
    $stage = '搜索并打开目标'
    $activation = Open-TargetChat $root $wechatProcessId ([string]$payload.target)
    $input = Chat-Input $root
    $value = Pattern $input ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($value.Current.IsReadOnly -or -not [string]::IsNullOrEmpty($value.Current.Value)) { throw '目标输入框不可写或已有草稿；未发送。' }
    $buttons = Match-Elements $root $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Button)
    $buttons = @($buttons | Where-Object { $_.Current.Name -in @('发送','Send') })
    if ($buttons.Count -ne 1) { throw '无法唯一识别微信发送按钮；未输入、未发送。' }
    if ($payload.mode -eq 'probe') {
        if ($buttons[0].Current.IsOffscreen -or $buttons[0].Current.BoundingRectangle.IsEmpty) { throw '微信发送按钮不可见；未输入、未发送。' }
        @{status='ready'; detail=('已唯一匹配并打开目标，输入框可写且为空，已识别唯一可见发送按钮；未输入消息、未点击发送。激活路径：'+($activation -join ' → ')+'。实际发送仍需单独验证。')} | ConvertTo-Json -Compress
        exit 0
    }
    Submit-Message $root $wechatProcessId ([string]$payload.target) ([string]$payload.message) ([ref]$submitted) | ConvertTo-Json -Compress
    exit 0
} catch {
    @{status=$(if ($submitted) {'uncertain'} else {'failed'}); detail=('['+$stage+'] '+$_.Exception.Message)} | ConvertTo-Json -Compress
    exit 0
}
