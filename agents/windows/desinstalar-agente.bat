@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0desinstalar-agente.ps1"
set "resultado=%errorlevel%"
pause
exit /b %resultado%
