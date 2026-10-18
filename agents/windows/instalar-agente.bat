@echo off
setlocal
cd /d "%~dp0"
echo SERVITEC - Agente para Windows e Windows Server
echo Execute como administrador.
if not exist "%~dp0instalar-agente.ps1" (
  echo Primeiro extraia TODOS os arquivos do ZIP usando Extrair tudo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-agente.ps1"
set "resultado=%errorlevel%"
pause
exit /b %resultado%
