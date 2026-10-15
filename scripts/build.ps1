$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
uv sync --frozen
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed' }
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Node dependencies failed' }
pnpm build
if ($LASTEXITCODE -ne 0) { throw 'Frontend or extension build failed' }
uv run python scripts/licenses.py
if ($LASTEXITCODE -ne 0) { throw 'License inventory failed' }
pnpm licenses list --prod --json | Out-File -LiteralPath artifacts/licenses/node-dependencies.json -Encoding utf8
$frontendPath = (Resolve-Path -LiteralPath apps/workbench/dist).Path
$migrationPath = (Resolve-Path -LiteralPath backend/easyresume/migrations).Path
uv run pyinstaller --noconfirm --onedir --name EasyResume --distpath artifacts/windows --workpath artifacts/pyinstaller --specpath artifacts/spec --paths backend --add-data "$frontendPath;frontend" --add-data "$migrationPath;easyresume/migrations" --collect-data tzdata --collect-all pypdf --hidden-import easyresume.api --copy-metadata easyresume --copy-metadata pydantic scripts/frozen_entry.py
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed' }
Copy-Item -LiteralPath LICENSE -Destination artifacts/windows/EasyResume/LICENSE.txt
Copy-Item -LiteralPath THIRD_PARTY_NOTICES.md -Destination artifacts/windows/EasyResume/THIRD_PARTY_NOTICES.md
Copy-Item -LiteralPath README.md -Destination artifacts/windows/EasyResume/README.md
Copy-Item -LiteralPath artifacts/licenses -Destination artifacts/windows/EasyResume/licenses -Recurse -Force
Copy-Item -LiteralPath apps/extension/.output/chrome-mv3 -Destination artifacts/windows/EasyResume/extension -Recurse -Force
Write-Host 'Test distribution ready: artifacts/windows/EasyResume/EasyResume.exe'
Write-Host 'Unsigned test build; clean Windows / antivirus acceptance still requires independent verification.'
