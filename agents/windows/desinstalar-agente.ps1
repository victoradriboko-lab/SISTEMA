$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Execute o PowerShell como administrador.' }
$service = Get-Service -Name 'ServitecAgent' -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne 'Stopped') { Stop-Service -Name 'ServitecAgent'; $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(45)) }
    & sc.exe delete ServitecAgent
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel remover o servico.' }
}
$clientExe = Join-Path $env:ProgramFiles 'ServitecClient\ServitecClient.exe'
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('CommonDesktopDirectory'),(Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'SERVITEC VSA'))) {
    foreach ($name in @('Servitec T.i. - Abrir Chamado.lnk','SERVITEC VSA - Abrir chamado.lnk')) {
        $link = Join-Path $folder $name
        if (Test-Path -LiteralPath $link) {
            $shortcut = $shell.CreateShortcut($link)
            if ($shortcut.TargetPath -eq $clientExe) { Remove-Item -LiteralPath $link -Force }
        }
    }
}
Write-Host 'Atalhos de atendimento deste aplicativo removidos. Arquivos do cliente foram preservados.'
Write-Host 'Servico removido. Arquivos e dados foram preservados em Program Files e ProgramData.'
Write-Host 'No sistema, renove o token do equipamento para invalidar a credencial antiga.'
