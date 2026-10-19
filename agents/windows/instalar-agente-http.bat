@echo off
setlocal
cd /d "%~dp0"
echo SERVITEC - Instalacao com HTTP externo pre-configurado
echo Execute como administrador.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-agente.ps1" -UseHttp
set "resultado=%errorlevel%"
pause
exit /b %resultado%
