param(
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$')]
    [string]$ReleaseVersion = 'v0.2.0-beta.9'
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess) { throw 'Build requires Windows x64' }
uv sync --frozen
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed' }
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Node dependencies failed' }
uv run ruff check backend tests scripts
if ($LASTEXITCODE -ne 0) { throw 'Python checks failed' }
uv run pytest -q
if ($LASTEXITCODE -ne 0) { throw 'Python tests failed' }
uv run python scripts/check_fixtures.py
if ($LASTEXITCODE -ne 0) { throw 'Fixture privacy checks failed' }
pnpm typecheck
if ($LASTEXITCODE -ne 0) { throw 'Type checks failed' }
pnpm test
if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed' }
pnpm build
if ($LASTEXITCODE -ne 0) { throw 'Frontend or extension build failed' }
uv run python scripts/licenses.py
if ($LASTEXITCODE -ne 0) { throw 'License inventory failed' }
pnpm licenses list --prod --json | Out-File -LiteralPath artifacts/licenses/node-dependencies.json -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Node license inventory failed' }
$frontendPath = (Resolve-Path -LiteralPath apps/workbench/dist).Path
$migrationPath = (Resolve-Path -LiteralPath backend/easyresume/migrations).Path
$iconPath = (Resolve-Path -LiteralPath assets/brand/easyresume.ico).Path
$distributionPath = Join-Path 'artifacts/windows' $ReleaseVersion
uv run pyinstaller --noconfirm --onedir --name EasyResume --icon $iconPath --distpath $distributionPath --workpath artifacts/pyinstaller --specpath artifacts/spec --paths backend --add-data "$frontendPath;frontend" --add-data "$migrationPath;easyresume/migrations" --collect-data tzdata --collect-all pypdf --hidden-import easyresume.api --copy-metadata easyresume --copy-metadata pydantic scripts/frozen_entry.py
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed' }
$packagePath = (Resolve-Path -LiteralPath (Join-Path $distributionPath 'EasyResume')).Path
$artifactRoot = (Resolve-Path -LiteralPath artifacts).Path
if (-not $packagePath.StartsWith($artifactRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package directory escaped artifacts root' }
foreach ($name in @('LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'README.en.md', 'README.ja.md', 'README.ko.md')) {
    Copy-Item -LiteralPath $name -Destination (Join-Path $packagePath $name) -Force
}
foreach ($item in @(@{source='docs';name='docs'}, @{source='artifacts/licenses';name='licenses'}, @{source='apps/extension/.output/chrome-mv3';name='extension'}, @{source='assets/brand';name='brand'})) {
    $targetPath = [IO.Path]::GetFullPath((Join-Path $packagePath $item.name))
    if (-not $targetPath.StartsWith($packagePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Copy target escaped package root' }
    if (Test-Path -LiteralPath $targetPath) { Remove-Item -LiteralPath $targetPath -Recurse -Force }
    Copy-Item -LiteralPath $item.source -Destination $targetPath -Recurse
}
$env:EASYRESUME_TEST_EXE = Join-Path $packagePath 'EasyResume.exe'
uv run python tests/e2e/frozen_smoke.py
if ($LASTEXITCODE -ne 0) { throw 'Packaged executable checks failed' }
uv run python scripts/package_release.py --version $ReleaseVersion --package $packagePath
if ($LASTEXITCODE -ne 0) { throw 'Release archive verification failed' }
Write-Host "Test distribution ready: $packagePath/EasyResume.exe"
Write-Host 'Unsigned test build; clean Windows / antivirus acceptance still requires independent verification.'
