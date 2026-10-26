function Initialize-WindowApi {
    if ('TermexoWeChatWindow' -as [type]) { return }
    Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class TermexoWeChatWindow {
    public delegate bool EnumProc(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    public static IntPtr RootAt(int x, int y) { return GetAncestor(WindowFromPoint(new Point { X=x, Y=y }), 2); }
    public static uint ProcessOf(IntPtr window) { uint process; GetWindowThreadProcessId(window, out process); return process; }
    public static IntPtr OwnerOf(IntPtr window) { return GetWindow(window, 4); }
    public static string ClassOf(IntPtr window) {
        var text = new StringBuilder(256); GetClassName(window, text, text.Capacity); return text.ToString();
    }
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int max);
    public static IntPtr[] Find(int[] processIds) {
        var result = new List<IntPtr>();
        EnumWindows((window, parameter) => {
            uint process; GetWindowThreadProcessId(window, out process);
            if (Array.IndexOf(processIds, (int)process) < 0 || GetWindow(window, 4) != IntPtr.Zero) return true;
            var text = new StringBuilder(256); GetWindowText(window, text, text.Capacity);
            var title = text.ToString();
            if (title == "微信" || title == "Weixin" || title == "WeChat") result.Add(window);
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
}
'@
}
function Window-Element($handle) { return $AE::FromHandle([IntPtr]$handle) }
function Window-State($handle) {
    Initialize-WindowApi
    return @{
        Exists=[TermexoWeChatWindow]::IsWindow($handle)
        Visible=[TermexoWeChatWindow]::IsWindowVisible($handle)
        Minimized=[TermexoWeChatWindow]::IsIconic($handle)
        Foreground=([TermexoWeChatWindow]::GetAncestor([TermexoWeChatWindow]::GetForegroundWindow(),2) -eq [IntPtr]$handle)
    }
}
function Request-WindowRestore($handle) { [void][TermexoWeChatWindow]::ShowWindowAsync($handle,9) }
function Request-WindowForeground($handle) {
    [void][TermexoWeChatWindow]::SetForegroundWindow($handle)
    try { (Window-Element $handle).SetFocus() } catch { }
}
function Choose-WechatWindow($candidates) {
    $visible = @($candidates | Where-Object { $_.Visible })
    if ($visible.Count -eq 1) { return $visible[0].Handle }
    if ($visible.Count -gt 1) { throw '存在多个微信主窗口，无法唯一确认；未输入、未发送。' }
    $main = @($candidates | Where-Object { $_.HasMainView })
    if ($main.Count -ne 1) { throw '无法唯一识别已登录的微信主窗口，请先登录桌面微信；未输入、未发送。' }
    return $main[0].Handle
}
function Find-WechatWindow {
    Initialize-WindowApi
    $processIds = [int[]]@(Get-Process -Name Weixin,WeChat -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    if ($processIds.Count -eq 0) { throw '桌面微信未运行，请先登录；未输入、未发送。' }
    $candidates = @()
    foreach ($handle in [TermexoWeChatWindow]::Find($processIds)) {
        $visible = [TermexoWeChatWindow]::IsWindowVisible($handle)
        $hasMainView = $false
        if (-not $visible) {
            try {
                $root = Window-Element $handle
                $views = Match-Elements $root $AE::AutomationIdProperty 'MainView'
                $hasMainView = $views.Count -eq 1
            } catch { }
        }
        $candidates += @{Handle=$handle;Visible=$visible;HasMainView=$hasMainView}
    }
    return Choose-WechatWindow $candidates
}
function Ready-WechatWindow($handle) {
    $initial = Window-State $handle
    if (-not $initial.Exists) { throw '微信主窗口已关闭；未输入、未发送。' }
    if ($initial.Minimized -or -not $initial.Visible) { Request-WindowRestore $handle }
    Start-Sleep -Milliseconds 150
    Request-WindowForeground $handle
    $stable = 0
    $signature = ''
    for ($round=0; $round -lt 24; $round++) {
        Start-Sleep -Milliseconds 150
        $status = Window-State $handle
        if (-not $status.Exists) { throw '微信主窗口已关闭；未输入、未发送。' }
        try {
            $root = Window-Element $handle
            $rect = $root.Current.BoundingRectangle
            $ready = ($status.Visible -and -not $status.Minimized -and $status.Foreground -and
                $root.Current.IsEnabled -and $root.Current.Name -in @('微信','Weixin','WeChat') -and
                -not $rect.IsEmpty -and $rect.Width -gt 100 -and $rect.Height -gt 100)
            if ($ready) {
                $fresh = $rect.ToString()
                if ($fresh -ceq $signature) { $stable++ } else { $signature=$fresh; $stable=1 }
                if ($stable -ge 4) { return $root }
            } else { $stable=0; $signature='' }
        } catch { $stable=0; $signature='' }
        if ($round -eq 5 -and $status.Visible -and -not $status.Minimized -and -not $status.Foreground) { Request-WindowForeground $handle }
    }
    throw '微信未能恢复到前台并稳定显示，可能存在弹窗或前台切换受阻；未输入、未发送。'
}
