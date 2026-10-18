@echo off
setlocal
set "SERVITEC_PORTAL_INSTALLER=%~f0"
echo ==================================================
echo  SERVITEC - Liberar Painel do Cliente na rede local
echo ==================================================
echo.
echo Execute como administrador apos atualizar o sistema.
echo A tarefa Servitec-Sistema sera reiniciada, se existir.
echo A porta do sistema interno e sua configuracao serao preservadas.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $text=[IO.File]::ReadAllText($env:SERVITEC_PORTAL_INSTALLER); $parts=$text -split '(?m)^# SERVITEC_POWERSHELL_START\r?$',2; if($parts.Count -ne 2){throw 'BAT incompleto. Baixe novamente.'}; & ([scriptblock]::Create($parts[1])) } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }"
set "resultado=%errorlevel%"
echo.
if not "%resultado%"=="0" echo A configuracao nao foi concluida. Veja a mensagem acima.
pause
exit /b %resultado%
# SERVITEC_POWERSHELL_START
$ErrorActionPreference = 'Stop'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Clique com o botao direito no BAT: Executar como administrador.'
    }
    $task = Get-ScheduledTask -TaskName 'Servitec-Sistema' -ErrorAction SilentlyContinue
    if ($task) {
        Stop-ScheduledTask -TaskName 'Servitec-Sistema'
        Start-Sleep -Seconds 2
        Start-ScheduledTask -TaskName 'Servitec-Sistema'
    }
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/state' -TimeoutSec 2
            if ($response.portal -eq 'client') { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        throw 'O Painel do Cliente nao respondeu na porta 3001. Confira a atualizacao e o log data\servidor.log. Se a execucao for manual, reinicie o npm start. Para CLIENT_PORT personalizado, configure a regra de firewall para aquela porta.'
    }
    $ruleName = 'Servitec-Clientes-LAN-3001'
    if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name $ruleName -DisplayName 'Servitec - Painel do Cliente porta 3001 somente rede local' `
            -Direction Inbound -Protocol TCP -LocalPort 3001 -RemoteAddress LocalSubnet `
            -Action Allow -Profile Any | Out-Null
    }
    Write-Host 'SUCESSO: Painel do Cliente disponivel na rede local.' -ForegroundColor Green
    Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'
    } | ForEach-Object { Write-Host ('Painel do Cliente: http://' + $_.IPAddress + ':3001') }
    Write-Host 'Este BAT nao altera a tarefa, a porta interna, as credenciais nem o banco.'
    Write-Host 'Para internet, configure dominio e HTTPS. Nao encaminhe a porta HTTP 3001 diretamente.'
    exit 0
} catch {
    Write-Host ('ERRO: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
