@echo off
setlocal
cd /d "%~dp0"
set "SERVITEC_PROJECT=%~dp0"
set "SERVITEC_INSTALLER=%~f0"
echo ==================================================
echo  SERVITEC - Inicio automatico na rede local
echo ==================================================
echo.
echo Execute este arquivo como administrador.
echo Antes, pare o npm start manual usando Ctrl+C.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $text=[IO.File]::ReadAllText($env:SERVITEC_INSTALLER); $parts=$text -split '(?m)^# SERVITEC_POWERSHELL_START\r?$',2; if($parts.Count -ne 2){throw 'Instalador incompleto. Baixe o BAT novamente.'}; & ([scriptblock]::Create($parts[1])) } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }"
set "resultado=%errorlevel%"
echo.
if not "%resultado%"=="0" echo A instalacao nao foi concluida. Veja a mensagem acima.
pause
exit /b %resultado%
# SERVITEC_POWERSHELL_START
$ErrorActionPreference = 'Stop'
$taskName = 'Servitec-Sistema'
$ruleName = 'Servitec-Sistema-LAN-3000'
$project = $env:SERVITEC_PROJECT
$runner = Join-Path $project 'data\executar-servidor.ps1'
$legacyRunner = Join-Path $project 'windows\executar-servidor.ps1'

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Feche esta janela e clique com o botao direito no BAT: Executar como administrador.'
    }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    & $node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Instale Node.js 24 ou superior antes de continuar.' }
    if (-not (Test-Path -LiteralPath (Join-Path $project 'server.mjs'))) {
        throw 'Coloque este BAT na pasta do projeto, junto ao arquivo server.mjs.'
    }
    & $node --check (Join-Path $project 'server.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'O servidor apresentou um erro de sintaxe.' }

    $previous = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($previous) {
        if (-not ($previous.Actions.Arguments | Where-Object { ($_.Contains($runner) -or $_.Contains($legacyRunner)) })) {
            throw 'Ja existe uma tarefa Servitec-Sistema com outra configuracao. Ela foi preservada.'
        }
        Stop-ScheduledTask -TaskName $taskName
        Start-Sleep -Seconds 2
    }
    $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        throw 'A porta 3000 esta ocupada. Pare o npm start manual com Ctrl+C e execute este BAT novamente.'
    }

    New-Item -ItemType Directory -Path (Join-Path $project 'data') -Force | Out-Null
    $runnerContent = @'
param([Parameter(Mandatory = $true)][string]$NodePath)

$project = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $project
$env:HOST = '0.0.0.0'
$env:PORT = '3000'
# Acesso HTTP apenas na rede local. HTTPS usa outra configuracao.
$env:COOKIE_SECURE = '0'
$env:DATA_DIR = Join-Path $project 'data'
$log = Join-Path $env:DATA_DIR 'servidor.log'
New-Item -ItemType Directory -Path $env:DATA_DIR -Force | Out-Null
try {
    "`r`n[$(Get-Date -Format s)] Iniciando Servitec" | Out-File -LiteralPath $log -Append -Encoding utf8
    & $NodePath (Join-Path $project 'server.mjs') >> $log 2>&1
    exit $LASTEXITCODE
} catch {
    $_ | Out-File -LiteralPath $log -Append -Encoding utf8
    exit 1
}
'@
    [IO.File]::WriteAllText($runner, $runnerContent, [Text.Encoding]::ASCII)

    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -NodePath `"$node`"" `
        -WorkingDirectory $project
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $account = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $account -Force `
        -Description 'Central Servitec - Node.js na porta 3000, inicio sem login.' | Out-Null

    if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name $ruleName -DisplayName 'Servitec - porta 3000 somente rede local' `
            -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress LocalSubnet `
            -Action Allow -Profile Any | Out-Null
    }
    Start-ScheduledTask -TaskName $taskName
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/state' -TimeoutSec 2
            if ($null -ne $response.initialized) { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        throw "Tarefa cadastrada, mas o servidor nao respondeu. Consulte $project\data\servidor.log e o Agendador de Tarefas."
    }
    Write-Host ''
    Write-Host 'SUCESSO: sistema iniciado e configurado para iniciar ao ligar o servidor.' -ForegroundColor Green
    Write-Host 'Pode fechar esta janela. Nao precisa manter o npm start aberto.'
    Write-Host 'Acesse http://IP-DO-SERVIDOR:3000 em um computador da mesma rede.'
    Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'
    } | ForEach-Object { Write-Host ('Endereco possivel: http://' + $_.IPAddress + ':3000') }
    Write-Host "Log: $project\data\servidor.log"
    Write-Host 'Esta configuracao e para rede local HTTP; nao publique a porta 3000 na internet.'
    exit 0
} catch {
    Write-Host ('ERRO: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
