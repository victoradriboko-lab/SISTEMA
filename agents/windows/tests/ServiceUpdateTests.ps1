$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\AgentService.ps1')
$script:expected = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'ServitecAgent.exe'))
$script:born = [DateTime]'2026-01-01'
function Get-Service { param($Name,$ErrorAction) return $script:service }
function Get-CimInstance {
    param($ClassName,$Filter,$ErrorAction)
    if($ClassName -eq 'Win32_Service'){
        $script:serviceReads++
        $path = if($script:mode -eq 'foreignService') { $script:expected+'.other' } else { $script:expected }
        $number = if($script:mode -eq 'changedPid' -and $script:serviceReads -ge 3) {4243} else {4242}
        return [pscustomobject]@{PathName=('"'+$path+'"');ProcessId=$number;State=[string]$script:service.Status}
    }
    $script:processReads++
    $path = if($script:mode -eq 'foreignProcess'){$script:expected+'.other'}else{$script:expected}
    $created = if($script:mode -eq 'changedCreation' -and $script:processReads -gt 1){$script:born.AddSeconds(1)}else{$script:born}
    return [pscustomobject]@{ExecutablePath=$path;CreationDate=$created}
}
function Stop-Process { param($Id,[switch]$Force,$ErrorAction) if($Id -ne 4242){throw 'PID indevido'};$script:kills++;$script:service.Status='Stopped' }
function Run-Case($mode,$state,$expectedKills,$expectedStops,$rejected){
    $script:mode=$mode;$script:kills=0;$script:stops=0;$script:serviceReads=0;$script:processReads=0
    $script:service=[pscustomobject]@{Status=$state}
    $script:service|Add-Member ScriptMethod Refresh {}
    $script:service|Add-Member ScriptMethod Stop { $script:stops++;if($script:mode -ne 'normal'){throw 'Servico nao responde'};$this.Status='Stopped' }
    $script:service|Add-Member ScriptMethod WaitForStatus {param($state,$time) if($script:mode -eq 'normal'){$this.Status=[string]$state};if([string]$this.Status -ne [string]$state){throw 'Timeout'} }
    $failed=$false
    try{Stop-ServitecAgentForUpdate -ExpectedPath $script:expected -TimeoutSeconds 1}catch{$failed=$true}
    if($failed -ne $rejected -or $script:kills -ne $expectedKills -or $script:stops -ne $expectedStops){throw "Cenario falhou: $mode, estado $state"}
}
Run-Case 'normal' 'Stopped' 0 0 $false
Run-Case 'normal' 'Running' 0 1 $false
Run-Case 'normal' 'StopPending' 0 0 $false
Run-Case 'normal' 'StartPending' 0 1 $false
Run-Case 'stuck' 'Running' 1 1 $false
Run-Case 'foreignService' 'Running' 0 0 $true
Run-Case 'foreignProcess' 'Running' 0 1 $true
Run-Case 'changedPid' 'Running' 0 1 $true
Run-Case 'changedCreation' 'Running' 0 1 $true
$errors=$null;$tokens=$null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\instalar-agente.ps1'),[ref]$tokens,[ref]$errors)|Out-Null
if($errors.Count){throw $errors[0]}
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\instalar-agente.ps1'))
$start=$source.IndexOf("    $"+'queue = Join-Path')
$end=$source.IndexOf("    Copy-Item -LiteralPath $"+'binary',$start)
$queueBlock=[scriptblock]::Create($source.Substring($start,$end-$start))
$data=Join-Path ([IO.Path]::GetTempPath()) ('servitec-queue-test-'+[Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path (Join-Path $data 'queue') -Force|Out-Null
    [IO.File]::WriteAllText((Join-Path $data 'queue/amostra.json'),'preservar')
    $sameContext=$true;& $queueBlock
    if(-not(Test-Path -LiteralPath (Join-Path $data 'queue/amostra.json'))){throw 'Fila do mesmo cliente foi alterada'}
    $sameContext=$false;& $queueBlock
    $archives=@(Get-ChildItem -LiteralPath $data -Directory -Filter 'queue-preservada-*')
    if($archives.Count -ne 1 -or [IO.File]::ReadAllText((Join-Path $archives[0].FullName 'amostra.json')) -ne 'preservar'){throw 'Fila anterior nao foi preservada'}
} finally {if(Test-Path -LiteralPath $data){Remove-Item -LiteralPath $data -Recurse -Force}}
Write-Output 'PASS: 9 cenarios de servico, preservacao da fila e sintaxe do instalador.' 
