param(
    [string]$ServerUrl = 'https://vsuarez.ddns.net:3000',
    [switch]$MonitorOnly,
    [switch]$UseHttp
)
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'AgentNetwork.ps1')
    . (Join-Path $PSScriptRoot 'AgentService.ps1')
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Clique com o botao direito no BAT e escolha Executar como administrador.' }
    if (([Version](Get-CimInstance Win32_OperatingSystem).Version).Major -lt 10) { throw 'Requer Windows 10/11 ou Windows Server 2016 ou superior.' }
    $release = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full').Release
    if ($release -lt 394802) { throw 'Instale Microsoft .NET Framework 4.6.2 ou superior antes de continuar.' }
    $binary = Join-Path $PSScriptRoot 'ServitecAgent.exe'
    if (-not (Test-Path -LiteralPath $binary) -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'ServitecAgent.sha256'))) { throw 'Extraia servitec-agent-windows.zip e execute o BAT de dentro da pasta extraida. O BAT sozinho nao instala o agente.' }
    $expected = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ServitecAgent.sha256') -Raw).Trim()
    if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash -ne $expected) { throw 'O executavel nao corresponde ao pacote. Baixe e extraia o ZIP completo novamente.' }
    foreach ($required in @('ServitecAgent.exe.config','desinstalar-agente.ps1','AgentNetwork.ps1','AgentService.ps1')) { if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $required))) { throw 'Extraia todos os arquivos do pacote antes de instalar.' } }
    $server = $ServerUrl.Trim().TrimEnd('/')
    if ($UseHttp) {
        if (-not $PSBoundParameters.ContainsKey('ServerUrl')) { $server = 'http://vsuarez.ddns.net:3000' }
        $originalUri = [Uri]$server
        $builder = New-Object UriBuilder($originalUri)
        $builder.Scheme = 'http'
        if ($originalUri.IsDefaultPort) { $builder.Port = -1 }
        $server = $builder.Uri.AbsoluteUri.TrimEnd('/')
    }
    Write-Host ('Servidor pre-configurado: ' + $server)
    $uri = [Uri]$server
    $allowLan = $false
    if ($UseHttp) { & $binary --check-url-http $server } else { & $binary --check-url $server }
    if ($LASTEXITCODE -ne 0) { throw 'URL invalida. Use HTTPS sem caminho ou o instalador HTTP para acesso externo por HTTP.' }
    $allowPublicHttp = [bool]$UseHttp -and $uri.Scheme -eq 'http'
    if ($allowPublicHttp) { Write-Host 'Modo HTTP externo selecionado: token e dados trafegam sem criptografia.' -ForegroundColor Yellow }
    if ($uri.Scheme -eq 'http' -and -not $allowPublicHttp) {
        if ((Read-Host 'HTTP nao criptografa os dados. Confirma uso somente na rede local? Digite SIM') -cne 'SIM') { throw 'Use um endereco HTTPS para continuar.' }
        $allowLan = $true
    }
    Write-Host 'Informe o token abaixo e pressione Enter. A entrada fica oculta por seguranca.'
    $secure = Read-Host 'Cole o token da empresa cliente (entrada oculta)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $token = $token.Trim()
    if ($token -cnotmatch '^[A-Za-z0-9]{10}$') { throw 'O token deve ter 10 letras e numeros. Copie o token atual na ficha da empresa cliente.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Write-Host 'Token informado. Verificando a conexao com a API do servidor...'
    $state = Invoke-ServitecAgentRequest -Server $server -Path '/api/state'
    if ($state.portal -eq 'client') { throw 'O dominio aponta para o Painel do Cliente (porta 3001). Configure o proxy HTTPS para o sistema interno na porta 3000.' }
    if ($null -eq $state.initialized) { throw 'A resposta nao identifica a API do sistema interno. Confira o destino do proxy HTTPS.' }
    # Nao segue redirecionamentos com o token e mantem a validacao TLS.
    $checked = Invoke-ServitecAgentRequest -Server $server -Path '/api/agent/check' -Token $token
    if ($checked.ok -ne $true -or $checked.protocolVersion -ne 1) { throw 'A API do agente respondeu em formato incompativel. Atualize o servidor.' }
    $installClient = -not $MonitorOnly
    if ($installClient) {
        $clientBinary = Join-Path $PSScriptRoot 'ServitecClient.exe'
        $clientHash = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ServitecClient.sha256') -Raw).Trim()
        if ($clientHash -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $clientBinary -Algorithm SHA256).Hash -ne $clientHash) { throw 'Aplicativo de atendimento invalido. Baixe novamente o pacote completo.' }
    }

    $target = Join-Path $env:ProgramFiles 'ServitecAgent'
    $data = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'ServitecAgent'
    $service = Get-Service -Name 'ServitecAgent' -ErrorAction SilentlyContinue
    if ($service) {
        $installed = Get-CimInstance Win32_Service -Filter "Name='ServitecAgent'"
        if ($installed.PathName.Trim(' ').Trim('"') -ne (Join-Path $target 'ServitecAgent.exe')) { throw 'Existe um servico com este nome em outra pasta. Ele foi preservado.' }
    }
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
    $old = $null
    $sameContext = $false
    Add-Type -AssemblyName System.Security
    if (Test-Path -LiteralPath $configFile) {
        $old = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
        $parsed = [Guid]::Empty
        if ([Guid]::TryParse([string]$old.machineId,[ref]$parsed)) { $machineId = $parsed.ToString() }
        try {
            $oldBytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([string]$old.protectedToken),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
            $oldToken = [Text.Encoding]::UTF8.GetString($oldBytes)
            $sameContext = ([string]$old.serverUrl).TrimEnd('/') -ceq $server -and $oldToken -ceq $token
            [Array]::Clear($oldBytes,0,$oldBytes.Length)
        } catch { $sameContext = $false } finally { $oldToken = $null }
    }
    $support = $null
    if ($installClient) {
        $support = Invoke-ServitecAgentRequest -Server $server -Path '/api/agent/support/enroll' -Method POST -Token $token -Body @{machineId=$machineId;name=$env:COMPUTERNAME}
        if ([string]$support.supportToken -notmatch '^[a-f0-9]{64}$') { throw 'Autorizacao do aplicativo invalida.' }
    }
    $phase = 'service'
    Stop-ServitecAgentForUpdate -ExpectedPath (Join-Path $target 'ServitecAgent.exe')
    Add-Type -AssemblyName System.Security
    $encrypted = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($token),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    $config = @{serverUrl=$server;protectedToken=[Convert]::ToBase64String($encrypted);machineId=$machineId;intervalSeconds=30;allowInsecureLan=$allowLan;allowInsecureHttp=$allowPublicHttp}
    $config | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding UTF8
    $token = $null
    $queue = Join-Path $data 'queue'
    if ((Test-Path -LiteralPath $queue) -and -not $sameContext) {
        $archive = Join-Path $data ('queue-preservada-' + [Guid]::NewGuid().ToString('N'))
        Move-Item -LiteralPath $queue -Destination $archive
        Write-Host 'A fila anterior foi preservada separadamente porque o servidor/token mudou.'
    }
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
    if ($installClient) {
        # Pasta publica separada: o usuario pode executar o cliente sem ler o token/DPAPI do servico.
        $clientTarget = Join-Path $env:ProgramFiles 'ServitecClient'
        New-Item -ItemType Directory -Path $clientTarget -Force | Out-Null
        if ((Get-Item -LiteralPath $clientTarget -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Pasta do aplicativo nao pode ser um link.' }
        $clientAcl = New-Object Security.AccessControl.DirectorySecurity
        $clientAcl.SetAccessRuleProtection($true,$false)
        foreach ($sid in @('S-1-5-18','S-1-5-32-544','S-1-5-32-545')) {
            $rights = if ($sid -eq 'S-1-5-32-545') { 'ReadAndExecute' } else { 'FullControl' }
            $rule = New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),$rights,'ContainerInherit,ObjectInherit','None','Allow')
            $clientAcl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $clientTarget -AclObject $clientAcl
        if (@(Get-ChildItem -LiteralPath $clientTarget -Force).Count -gt 0) {
            & icacls.exe ($clientTarget + '\*') /reset /T /C | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel proteger o aplicativo do cliente.' }
        }
        Copy-Item -LiteralPath $clientBinary -Destination (Join-Path $clientTarget 'ServitecClient.exe') -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ServitecClient.exe.config') -Destination $clientTarget -Force
        $protectedSupport = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes([string]$support.supportToken),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
        @{serverUrl=$server;companyName=[string]$support.companyName;protectedSupportToken=[Convert]::ToBase64String($protectedSupport);allowInsecureLan=$allowLan;allowInsecureHttp=$allowPublicHttp} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $clientTarget 'portal.json') -Encoding UTF8
        $shell = New-Object -ComObject WScript.Shell
        $menu = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'SERVITEC VSA'
        New-Item -ItemType Directory -Path $menu -Force | Out-Null
        foreach ($shortcutFolder in @([Environment]::GetFolderPath('CommonDesktopDirectory'),$menu)) {
            $shortcut = $shell.CreateShortcut((Join-Path $shortcutFolder 'SERVITEC VSA - Abrir chamado.lnk'))
            $shortcut.TargetPath = Join-Path $clientTarget 'ServitecClient.exe'
            $shortcut.WorkingDirectory = $clientTarget
            $shortcut.Description = 'Abrir chamado no Painel do Cliente SERVITEC VSA'
            $shortcut.Save()
        }
        Write-Host 'Atalhos SERVITEC VSA - Abrir chamado criados na Area de Trabalho e no menu Iniciar.' -ForegroundColor Green
    }
    $support = $null
    Write-Host 'Servico instalado e iniciado. Aguarde no log a mensagem: Primeira coleta aceita pelo servidor.' -ForegroundColor Green
    Write-Host 'Confira Monitoramento no sistema. Log: C:\ProgramData\ServitecAgent\agent.log'
    Write-Host 'Nao e necessario abrir portas de entrada nas maquinas monitoradas.'
    exit 0
} catch {
    Write-Host ('ERRO: ' + $_.Exception.Message) -ForegroundColor Red
    if ($phase -eq 'service') { Write-Host 'Falha ao atualizar o servico local. O erro acima nao e uma rejeicao de URL ou token.' }
    else { Write-Host 'Confira o acesso ao servidor e o token da empresa.' }
    exit 1
}
