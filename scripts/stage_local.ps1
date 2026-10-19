param([ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$')][string]$Version = 'v0.2.0-beta.16')
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
start "" "%~dp0versions\$Version\EasyResume.exe" --browser chrome
"@
[IO.File]::WriteAllText((Join-Path $localRoot '启动 EasyResume.cmd'), $launcher.Replace("`n","`r`n"), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $localRoot '启动 Chrome 求职工作区.cmd'), $launcher.Replace('--browser chrome', '--browser chrome --open-jobs').Replace("`n","`r`n"), [Text.UTF8Encoding]::new($false))
$instructions = @"
# EasyResume 本地测试包 $Version

1. 关闭旧版 EasyResume 服务窗口（仅关闭浏览器标签页不会退出服务）。
2. 双击本文件旁的“启动 EasyResume.cmd”。工作台会明确使用正式Chrome打开，不改变系统默认浏览器。选择“启动 Chrome 求职工作区.cmd”会同时打开工作台、BOSS和智联职位入口；服务已运行时复用现有服务。每次点击都会打开这些页面，不是周期循环任务。没有安装Chrome时程序会说明手动打开的方法，不会静默改用其他浏览器。
3. 扩展第一次改用本目录的 extension 文件夹：在 Chrome/Edge 扩展管理页移除旧目录的 EasyResume，再加载此文件夹。以后这里的扩展更新后点一次“重新加载”，并刷新已打开的工作台、BOSS 和智联页面即可。
4. 保持工作台打开，扩展会自动连接；已配对会自动重连。没有连接时点击扩展的“查找并连接工作台”，仍失败可在设置里生成连接码备用。主动断开后不会自行重新配对。读取范围仍仅限BOSS和智联，没有增加站点权限。
5. 工作台“设置与连接 → 浏览器扩展 → 从浏览器整理岗位”也可定位并读取；多个招聘标签页会提示选择。在 BOSS 或智联左侧选中岗位，等待右侧详情加载后点“读取当前职位”，展开职位内容检查正文。批量默认最多20条、当前已加载列表；工作台勾选自动翻页后最多2页，扩展可配置最多5页。支持已适配的下一页按钮及两站已验证结构的列表末尾加载，可暂停、继续或停止。公司等信息有变化的旧岗位进入“待核对”，不会直接覆盖。

应用和扩展图标来自 Lucide FileCheck2（ISC，可免费商用，需保留许可）。许可及矢量文件在 versions/$Version/brand。

以后新版继续放在这个“本地验证”目录。启动入口与 extension 路径保持固定；versions 保留旧包用于回退。用户数据仍在 Windows 用户数据目录，不随程序覆盖或删除。升级后回退旧版前应先导出备份，未来数据库版本可能不支持降级。

这是未签名测试包；不要关闭防护软件。正式Chrome已验证BOSS列表由15条追加到30条、智联搜索列表由20条追加到40条。智联相邻操作至少间隔5秒；原岗位详情持续为空时只重选同一条一次，仍失败则暂停，不将本条算作成功。可在官网重新选择职位，等详情显示后继续；刷新页面后需停止旧任务再重新开始。真实通过范围见 versions/$Version/docs/STATUS.md；遇到验证码请在平台自行处理。

同名同公司的岗位若无法区分，批量会暂停。可在招聘网站点击“查看更多职位信息”，打开独立职位页后再读取。
"@
[IO.File]::WriteAllText((Join-Path $localRoot '使用说明.md'), $instructions, [Text.UTF8Encoding]::new($false))
Get-FileHash -LiteralPath (Join-Path $destination 'EasyResume.exe') -Algorithm SHA256 | Format-List
Write-Host "Local test directory ready: $localRoot"
