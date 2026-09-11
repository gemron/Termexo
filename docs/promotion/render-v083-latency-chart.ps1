Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap(1580, 676)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(248, 250, 252))
$ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 35, 46))
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(85, 101, 115))
$before = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(129, 145, 162))
$after = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 145, 113))
$titleFont = New-Object System.Drawing.Font('Microsoft YaHei', 30, [System.Drawing.FontStyle]::Bold)
$labelFont = New-Object System.Drawing.Font('Microsoft YaHei', 20)
$smallFont = New-Object System.Drawing.Font('Microsoft YaHei', 16)
$valueFont = New-Object System.Drawing.Font('Microsoft YaHei', 26, [System.Drawing.FontStyle]::Bold)
$graphics.DrawString('终端按键延迟 p99：优化前后对比', $titleFont, $ink, 70, 42)
$graphics.DrawString('Termexo v0.8.3 发布记录中的测量值 · 非独立复测', $labelFont, $muted, 72, 108)
$axisPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(218, 225, 230), 2)
$originX = 265
$scale = 1.8
foreach ($tick in @(0,100,200,300,400,500,600)) {
    $tickX = $originX + $tick * $scale
    $graphics.DrawLine($axisPen, $tickX, 207, $tickX, 464)
    $graphics.DrawString([string]$tick, $smallFont, $muted, ($tickX - 12), 480)
}
$graphics.DrawString('优化前', $labelFont, $ink, 80, 252)
$graphics.DrawString('优化后', $labelFont, $ink, 80, 377)
$graphics.FillRectangle($before, $originX, 242, [single](514 * $scale), 66)
$graphics.FillRectangle($after, $originX, 367, [single](19 * $scale), 66)
$graphics.DrawString('514 ms', $valueFont, $ink, 1210, 247)
$graphics.DrawString('19 ms', $valueFont, $ink, 323, 372)
$graphics.DrawString('延迟 / 毫秒（线性坐标，从 0 开始）', $smallFont, $muted, 900, 530)
$graphics.DrawString('来源：github.com/gemron/Termexo/releases/tag/v0.8.3', $smallFont, $muted, 72, 586)
$graphics.DrawString('结果随设备与负载变化；p99 并非平均延迟。', $smallFont, $muted, 72, 623)
$bitmap.Save((Join-Path $PSScriptRoot 'assets/termexo-v0.8.3-latency-chart.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
