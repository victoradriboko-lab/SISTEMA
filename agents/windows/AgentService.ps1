# Para apenas o servico deste agente; nao encerra processos pelo nome.
function Stop-ServitecAgentForUpdate {
    param(
        [Parameter(Mandatory=$true)][string]$ExpectedPath,
        [ValidateRange(1,120)][int]$TimeoutSeconds = 45
    )
    $service = Get-Service -Name 'ServitecAgent' -ErrorAction SilentlyContinue
    if (-not $service) { return }
    $expected = [IO.Path]::GetFullPath($ExpectedPath)
    $readService = { Get-CimInstance Win32_Service -Filter "Name='ServitecAgent'" -ErrorAction Stop }
    $installed = & $readService
    if (-not $installed -or [IO.Path]::GetFullPath(([string]$installed.PathName).Trim().Trim('"')) -ine $expected) {
        throw 'O servico aponta para outro executavel. Ele foi preservado.'
    }
    $service.Refresh()
    if ($service.Status -eq 'Stopped') { return }
    try {
        Write-Host 'Parando o servico existente do agente...'
        if ($service.Status -eq 'StartPending') { $service.WaitForStatus('Running',[TimeSpan]::FromSeconds($TimeoutSeconds)) }
        $service.Refresh()
        if ($service.Status -eq 'Stopped') { return }
        if ($service.Status -ne 'StopPending') { $service.Stop() }
        $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds($TimeoutSeconds))
        return
    } catch {
        $stopError = $_.Exception.GetBaseException().Message
    }
    $service.Refresh()
    if ($service.Status -eq 'Stopped') { return }
    $installed = & $readService
    if ($installed.State -eq 'Stopped') { return }
    $agentProcessId = [int]$installed.ProcessId
    if ($agentProcessId -le 0 -or [IO.Path]::GetFullPath(([string]$installed.PathName).Trim().Trim('"')) -ine $expected) {
        throw ('Nao foi possivel confirmar o processo do agente. Reinicie o Windows e tente novamente. Detalhe: ' + $stopError)
    }
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $agentProcessId) -ErrorAction Stop
    if (-not $process -or -not $process.CreationDate -or -not $process.ExecutablePath -or [IO.Path]::GetFullPath([string]$process.ExecutablePath) -ine $expected) {
        throw 'O PID do servico nao corresponde ao executavel esperado. Nenhum processo foi encerrado; reinicie o Windows e tente novamente.'
    }
    # Revalida PID, caminho e data de criacao antes de encerrar um processo travado.
    $current = & $readService
    $currentProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $agentProcessId) -ErrorAction Stop
    if ($current.State -eq 'Stopped') { return }
    if ([int]$current.ProcessId -ne $agentProcessId -or [IO.Path]::GetFullPath(([string]$current.PathName).Trim().Trim('"')) -ine $expected -or -not $currentProcess -or $currentProcess.CreationDate -ne $process.CreationDate -or [IO.Path]::GetFullPath([string]$currentProcess.ExecutablePath) -ine $expected) {
        throw 'O processo mudou durante a verificacao. Nenhum processo foi encerrado; execute novamente o instalador.'
    }
    Write-Host 'O servico nao respondeu. Encerrando somente o processo verificado do agente para atualizar...' -ForegroundColor Yellow
    try {
        Stop-Process -Id $agentProcessId -Force -ErrorAction Stop
        $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(15))
    } catch {
        throw ('Nao foi possivel parar o agente. Reinicie o Windows e execute o instalador novamente. Detalhe: ' + $_.Exception.GetBaseException().Message)
    }
}
