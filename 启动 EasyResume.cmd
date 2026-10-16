@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "本地验证\启动 EasyResume.cmd" (
  call "本地验证\启动 EasyResume.cmd"
) else (
  uv run easyresume
)
if errorlevel 1 pause
