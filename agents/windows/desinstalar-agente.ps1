$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Execute o PowerShell como administrador.' }
$service = Get-Service -Name 'ServitecAgent' -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne 'Stopped') { Stop-Service -Name 'ServitecAgent'; $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(45)) }
    & sc.exe delete ServitecAgent
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel remover o servico.' }
}
Write-Host 'Servico removido. Arquivos e dados foram preservados em Program Files e ProgramData.'
Write-Host 'No sistema, renove o token do equipamento para invalidar a credencial antiga.'
