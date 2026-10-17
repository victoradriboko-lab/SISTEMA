@echo off
setlocal
cd /d "%~dp0"
echo ==================================================
echo  SERVITEC - Inicio automatico na rede local
echo ==================================================
echo.
echo Execute este arquivo como administrador.
echo Antes, pare o npm start manual usando Ctrl+C.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\instalar-tarefa.ps1"
set "resultado=%errorlevel%"
echo.
if not "%resultado%"=="0" echo A instalacao nao foi concluida. Veja a mensagem acima.
pause
exit /b %resultado%
