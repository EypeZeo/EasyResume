@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "artifacts\windows\v0.2.0-beta.1\EasyResume\EasyResume.exe" (
  start "" "artifacts\windows\v0.2.0-beta.1\EasyResume\EasyResume.exe"
) else (
  uv run easyresume
)
if errorlevel 1 pause
