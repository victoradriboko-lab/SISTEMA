@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 24 LTS em https://nodejs.org/
  echo Depois feche e abra novamente este arquivo.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo Atualize o Node.js para a versao 24 ou superior.
  pause
  exit /b 1
)
echo Abra http://localhost:3000 no navegador apos a inicializacao.
echo Mantenha esta janela aberta enquanto usa o sistema.
node server.mjs
pause
