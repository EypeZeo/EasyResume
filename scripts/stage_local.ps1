param([ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$')][string]$Version = 'v0.2.0-beta.3')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot "artifacts/windows/$Version/EasyResume"
if (-not (Test-Path -LiteralPath (Join-Path $source 'EasyResume.exe'))) { throw 'Build the Windows package first.' }
$localRoot = Join-Path $projectRoot '本地验证'
$versionsRoot = Join-Path $localRoot 'versions'
$destination = Join-Path $versionsRoot $Version
if (Test-Path -LiteralPath $destination) { throw 'Version already staged; choose a new version to preserve rollback.' }
New-Item -ItemType Directory -Path $versionsRoot -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Recurse
$extension = [IO.Path]::GetFullPath((Join-Path $localRoot 'extension'))
if (-not $extension.StartsWith([IO.Path]::GetFullPath($localRoot) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid extension target' }
if (Test-Path -LiteralPath $extension) {
    $backup = [IO.Path]::GetFullPath((Join-Path $localRoot ('extension-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
    if (-not $backup.StartsWith([IO.Path]::GetFullPath($localRoot) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid backup target' }
    Move-Item -LiteralPath $extension -Destination $backup
}
Copy-Item -LiteralPath (Join-Path $source 'extension') -Destination $extension -Recurse
$launcher = @"
@echo off
chcp 65001 >nul
echo EasyResume $Version
echo 如果旧版仍在运行，请先关闭旧版服务窗口，再启动新版。
start "" "%~dp0versions\$Version\EasyResume.exe"
"@
[IO.File]::WriteAllText((Join-Path $localRoot '启动 EasyResume.cmd'), $launcher.Replace("`n","`r`n"), [Text.UTF8Encoding]::new($false))
$instructions = @"
# EasyResume 本地测试包 $Version

1. 关闭旧版 EasyResume 服务窗口（仅关闭浏览器标签页不会退出服务）。
2. 双击本文件旁的“启动 EasyResume.cmd”。浏览器会打开工作台。
3. 扩展第一次改用本目录的 extension 文件夹：在 Chrome/Edge 扩展管理页移除旧目录的 EasyResume，再加载此文件夹。以后这里的扩展更新后点一次“重新加载”，并刷新已打开的工作台、BOSS 和智联页面即可。
4. 保持工作台打开，扩展会自动连接；已配对会自动重连。没有连接时点击扩展的“查找并连接工作台”，仍失败可在设置里生成连接码备用。主动断开后不会自行重新配对。
5. 在 BOSS 或智联左侧选中岗位，等待右侧详情加载后点“读取当前职位”。批量读取默认最多20条、当前已加载列表；勾选自动翻页后最多5页，支持已适配的下一页按钮和智联列表末尾加载。可暂停、继续或停止。

应用和扩展图标来自 Lucide FileCheck2（ISC，可免费商用，需保留许可）。许可及矢量文件在 versions/$Version/brand。

以后新版继续放在这个“本地验证”目录。启动入口与 extension 路径保持固定；versions 保留旧包用于回退。用户数据仍在 Windows 用户数据目录，不随程序覆盖或删除。升级后回退旧版前应先导出备份，未来数据库版本可能不支持降级。

这是未签名测试包；不要关闭防护软件。BOSS调试连接出现返回首页、智联部分详情请求未完成，真实完整批量兼容性仍需在你的登录页面继续检查，遇到验证码应在平台自行处理。
"@
[IO.File]::WriteAllText((Join-Path $localRoot '使用说明.md'), $instructions, [Text.UTF8Encoding]::new($false))
Get-FileHash -LiteralPath (Join-Path $destination 'EasyResume.exe') -Algorithm SHA256 | Format-List
Write-Host "Local test directory ready: $localRoot"
