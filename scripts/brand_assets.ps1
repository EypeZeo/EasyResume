# Lucide FileCheck2 (ISC), adapted to EasyResume's green tile. Windows build utility.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $projectRoot 'assets/brand'
$webRoot = Join-Path $projectRoot 'apps/workbench/public'
$extensionRoot = Join-Path $projectRoot 'apps/extension/public'
foreach ($folder in @($assetRoot, $webRoot, $extensionRoot, (Join-Path $extensionRoot 'icon'))) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
}
$svg = @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#20594f"/><g transform="translate(11 10) scale(1.75)" fill="none" stroke="#f4f8e9" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path stroke="#c7df9e" d="m3 15 2 2 4-4"/></g></svg>
'@
foreach ($folder in @($assetRoot, $webRoot, $extensionRoot)) {
    [IO.File]::WriteAllText((Join-Path $folder 'logo.svg'), $svg, [Text.UTF8Encoding]::new($false))
}
$master = [Drawing.Bitmap]::new(512, 512)
$graphics = [Drawing.Graphics]::FromImage($master)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.ScaleTransform(8, 8)
$tile = [Drawing.Drawing2D.GraphicsPath]::new()
foreach ($arc in @(@(0,0,32,32,180,90), @(32,0,32,32,270,90), @(32,32,32,32,0,90), @(0,32,32,32,90,90))) {
    $tile.AddArc([single]$arc[0], [single]$arc[1], [single]$arc[2], [single]$arc[3], [single]$arc[4], [single]$arc[5])
}
$tile.CloseFigure()
$brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#20594f'))
$graphics.FillPath($brush, $tile)
$graphics.TranslateTransform(11,10)
$graphics.ScaleTransform(1.75,1.75)
$pen = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#f4f8e9'), 1.9)
$pen.StartCap = $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
$outline = [Drawing.Drawing2D.GraphicsPath]::new()
$outline.AddLine(4,22,18,22)
$outline.AddArc(16,18,4,4,90,-90)
$outline.AddLine(20,20,20,7)
$outline.AddLine(20,7,15,2)
$outline.AddLine(15,2,6,2)
$outline.AddArc(4,2,4,4,270,-90)
$outline.AddLine(4,4,4,8)
$graphics.DrawPath($pen,$outline)
$fold = [Drawing.Drawing2D.GraphicsPath]::new()
$fold.AddLine(14,2,14,6)
$fold.AddArc(14,4,4,4,180,-90)
$fold.AddLine(16,8,20,8)
$graphics.DrawPath($pen,$fold)
$pen.Color = [Drawing.ColorTranslator]::FromHtml('#c7df9e')
$graphics.DrawLines($pen, [Drawing.PointF[]]@([Drawing.PointF]::new(3,15),[Drawing.PointF]::new(5,17),[Drawing.PointF]::new(9,13)))
$graphics.Dispose()
foreach ($size in @(16,32,48,128,256)) {
    $bitmap = [Drawing.Bitmap]::new($size,$size)
    $resizer = [Drawing.Graphics]::FromImage($bitmap)
    $resizer.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $resizer.DrawImage($master,0,0,$size,$size)
    $path = Join-Path $assetRoot "$size.png"
    $bitmap.Save($path,[Drawing.Imaging.ImageFormat]::Png)
    if ($size -le 128) { Copy-Item -LiteralPath $path -Destination (Join-Path $extensionRoot "icon/$size.png") -Force }
    $resizer.Dispose()
    $bitmap.Dispose()
}
$master.Dispose(); $pen.Dispose(); $brush.Dispose(); $tile.Dispose(); $outline.Dispose(); $fold.Dispose()
# ICO container with a lossless 256px PNG frame (supported by Windows Vista and later).
$png = [IO.File]::ReadAllBytes((Join-Path $assetRoot '256.png'))
$stream = [IO.File]::Create((Join-Path $assetRoot 'easyresume.ico'))
$writer = [IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte[]]@(0,0,0,0)); $writer.Write([uint16]1); $writer.Write([uint16]32)
$writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
$writer.Dispose()
Copy-Item -LiteralPath (Join-Path $assetRoot '32.png') -Destination (Join-Path $webRoot 'favicon.png') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'apps/workbench/node_modules/lucide-react/LICENSE') -Destination (Join-Path $assetRoot 'LICENSE-LUCIDE.txt') -Force
Write-Host 'Brand assets generated (Lucide ISC attribution in assets/brand/LICENSE-LUCIDE.txt).'
