$ErrorActionPreference = 'Stop'
$taskName = 'Servitec-Sistema'
$ruleName = 'Servitec-Sistema-LAN-3000'
$project = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'executar-servidor.ps1'

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
        throw 'Mantenha o BAT e a pasta windows junto ao server.mjs, na pasta do projeto.'
    }
    & $node --check (Join-Path $project 'server.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'O servidor apresentou um erro de sintaxe.' }

    $previous = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($previous) {
        if (-not ($previous.Actions.Arguments | Where-Object { $_.Contains($runner) })) {
            throw 'Ja existe uma tarefa Servitec-Sistema com outra configuracao. Ela foi preservada.'
        }
        Stop-ScheduledTask -TaskName $taskName
        Start-Sleep -Seconds 2
    }
    $listener = Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        throw 'Uma das portas 3000/3001 esta ocupada. Pare o processo manual ou libere a porta antes de executar novamente.'
    }

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
        -Description 'Central Servitec - equipe na porta 3000 e clientes na porta 3001, inicio sem login.' | Out-Null

    if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name $ruleName -DisplayName 'Servitec - porta 3000 somente rede local' `
            -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress LocalSubnet `
            -Action Allow -Profile Any | Out-Null
    }
    $clientRuleName = 'Servitec-Clientes-LAN-3001'
    if (-not (Get-NetFirewallRule -Name $clientRuleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name $clientRuleName -DisplayName 'Servitec - Painel do Cliente porta 3001 somente rede local' `
            -Direction Inbound -Protocol TCP -LocalPort 3001 -RemoteAddress LocalSubnet `
            -Action Allow -Profile Any | Out-Null
    }
    Start-ScheduledTask -TaskName $taskName
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/state' -TimeoutSec 2
            if ($null -ne $response.initialized) {
                $clientResponse = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/state' -TimeoutSec 2
                if ($clientResponse.portal -eq 'client') { $ready = $true; break }
            }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        throw "Tarefa cadastrada, mas o servidor nao respondeu. Consulte $project\data\servidor.log e o Agendador de Tarefas."
    }
    Write-Host ''
    Write-Host 'SUCESSO: sistema iniciado e configurado para iniciar ao ligar o servidor.' -ForegroundColor Green
    Write-Host 'Pode fechar esta janela. Nao precisa manter o npm start aberto.'
    Write-Host 'Equipe: http://IP-DO-SERVIDOR:3000 | Clientes: http://IP-DO-SERVIDOR:3001 (rede local).'
    Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'
    } | ForEach-Object {
        Write-Host ('Equipe: http://' + $_.IPAddress + ':3000')
        Write-Host ('Painel do Cliente: http://' + $_.IPAddress + ':3001')
    }
    Write-Host "Log: $project\data\servidor.log"
    Write-Host 'Esta configuracao e para rede local HTTP; nao publique as portas HTTP 3000/3001 na internet; configure HTTPS separadamente.'
    exit 0
} catch {
    Write-Host ('ERRO: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
