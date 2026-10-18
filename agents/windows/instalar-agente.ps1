$ErrorActionPreference = 'Stop'
try {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Clique com o botao direito no BAT e escolha Executar como administrador.' }
    if (([Version](Get-CimInstance Win32_OperatingSystem).Version).Major -lt 10) { throw 'Requer Windows 10/11 ou Windows Server 2016 ou superior.' }
    $release = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full').Release
    if ($release -lt 394802) { throw 'Instale Microsoft .NET Framework 4.6.2 ou superior antes de continuar.' }
    $binary = Join-Path $PSScriptRoot 'ServitecAgent.exe'
    if (-not (Test-Path -LiteralPath $binary) -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'ServitecAgent.sha256'))) { throw 'Extraia servitec-agent-windows.zip e execute o BAT de dentro da pasta extraida. O BAT sozinho nao instala o agente.' }
    $expected = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ServitecAgent.sha256') -Raw).Trim()
    if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash -ne $expected) { throw 'O executavel nao corresponde ao pacote. Baixe e extraia o ZIP completo novamente.' }
    foreach ($required in @('ServitecAgent.exe.config','desinstalar-agente.ps1')) { if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $required))) { throw 'Extraia todos os arquivos do pacote antes de instalar.' } }
    Write-Host 'Exemplo HTTPS: https://ti.suaempresa.com.br'
    Write-Host 'Teste LAN: http://192.168.1.100:3000 (apenas IP privado; sem criptografia)'
    $server = (Read-Host 'Endereco do servidor, incluindo http:// ou https://').Trim().TrimEnd('/')
    $uri = [Uri]$server
    $allowLan = $false
    & $binary --check-url $server
    if ($LASTEXITCODE -ne 0) { throw 'URL invalida. Use HTTPS sem caminho, ou HTTP com IP privado da rede local.' }
    if ($uri.Scheme -eq 'http') {
        if ((Read-Host 'HTTP nao criptografa os dados. Confirma uso somente na rede local? Digite SIM') -cne 'SIM') { throw 'Use um endereco HTTPS para continuar.' }
        $allowLan = $true
    }
    $secure = Read-Host 'Cole o token da empresa cliente (entrada oculta)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($token -notmatch '^[a-fA-F0-9]{64}$') { throw 'O token deve ser o token de 64 caracteres gerado no cadastro da empresa cliente.' }
    $token = $token.ToLowerInvariant()
    # Confirma o destino sem desativar validacao TLS e sem seguir redirecionamentos com o token.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $request = [Net.HttpWebRequest]::Create($server + '/api/agent/check')
    $request.Method = 'GET'; $request.AllowAutoRedirect = $false; $request.Timeout = 15000
    $request.Headers['Authorization'] = 'Bearer ' + $token
    $response = $request.GetResponse(); try { if ([int]$response.StatusCode -ne 200) { throw 'Servidor recusou o token.' } } finally { $response.Dispose() }

    $target = Join-Path $env:ProgramFiles 'ServitecAgent'
    $data = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'ServitecAgent'
    $service = Get-Service -Name 'ServitecAgent' -ErrorAction SilentlyContinue
    if ($service) {
        $installed = Get-CimInstance Win32_Service -Filter "Name='ServitecAgent'"
        if ($installed.PathName.Trim(' ').Trim('"') -ne (Join-Path $target 'ServitecAgent.exe')) { throw 'Existe um servico com este nome em outra pasta. Ele foi preservado.' }
    }
    if ($service) { Stop-Service -Name 'ServitecAgent'; $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(45)) }
    New-Item -ItemType Directory -Path $target,$data -Force | Out-Null
    # Apenas SYSTEM e Administradores podem ler o token protegido e alterar o agente.
    foreach ($folder in @($target,$data)) {
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true,$false)
        foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
            $identity = New-Object Security.Principal.SecurityIdentifier($sid)
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $folder -AclObject $acl
        if (@(Get-ChildItem -LiteralPath $folder -Force).Count -gt 0) {
            & icacls.exe ($folder + '\*') /reset /T /C | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel proteger os arquivos do agente.' }
        }
    }
    $machineId = [Guid]::NewGuid().ToString()
    $configFile = Join-Path $data 'config.json'
    if (Test-Path -LiteralPath $configFile) {
        $old = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
        $parsed = [Guid]::Empty
        if ([Guid]::TryParse([string]$old.machineId,[ref]$parsed)) { $machineId = $parsed.ToString() }
    }
    Add-Type -AssemblyName System.Security
    $encrypted = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($token),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    $config = @{serverUrl=$server;protectedToken=[Convert]::ToBase64String($encrypted);machineId=$machineId;intervalSeconds=30;allowInsecureLan=$allowLan}
    $config | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding UTF8
    $token = $null
    $queue = Join-Path $data 'queue'
    if (Test-Path -LiteralPath $queue) { Get-ChildItem -LiteralPath $queue -Filter '*.json' -File | Remove-Item -Force }
    Copy-Item -LiteralPath $binary -Destination (Join-Path $target 'ServitecAgent.exe') -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ServitecAgent.exe.config') -Destination $target -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'desinstalar-agente.ps1') -Destination $target -Force
    if (-not $service) { New-Service -Name 'ServitecAgent' -DisplayName 'Servitec - Agente de monitoramento' -BinaryPathName ('"' + (Join-Path $target 'ServitecAgent.exe') + '"') -StartupType Automatic | Out-Null }
    else { Set-Service -Name 'ServitecAgent' -StartupType Automatic }
    & sc.exe failure ServitecAgent reset= 86400 actions= restart/60000/restart/120000/restart/300000 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel configurar recuperacao do servico.' }
    & sc.exe failureflag ServitecAgent 1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel configurar recuperacao de falhas.' }
    Start-Service -Name 'ServitecAgent'
    Start-Sleep -Seconds 3
    if ((Get-Service -Name 'ServitecAgent').Status -ne 'Running') { throw 'Servico encerrou. Consulte C:\ProgramData\ServitecAgent\agent.log' }
    Write-Host 'Servico instalado e iniciado. A coleta completa pode levar ate alguns minutos.' -ForegroundColor Green
    Write-Host 'Confira Monitoramento no sistema. Log: C:\ProgramData\ServitecAgent\agent.log'
    Write-Host 'Nao e necessario abrir portas de entrada nas maquinas monitoradas.'
    exit 0
} catch {
    Write-Host ('ERRO: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Confira HTTPS, certificado, acesso ao servidor e o token da empresa.'
    exit 1
}
