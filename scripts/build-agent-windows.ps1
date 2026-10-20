$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$csc = Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'Instale o .NET Framework 4.6.2 ou superior no Windows de compilacao.' }
$source = Join-Path $root 'agents\windows'
$icon = Join-Path $source 'branding\servitec.ico'
$agentOut = Join-Path $source 'bin\Release\net462'
$clientOut = Join-Path $source 'client\bin\Release\net462'
New-Item -ItemType Directory -Force $agentOut,$clientOut | Out-Null
& $csc /nologo /target:exe /optimize+ /platform:anycpu /langversion:5 "/win32icon:$icon" "/out:$agentOut\ServitecAgent.exe" /r:System.ServiceProcess.dll /r:System.Management.dll /r:System.Web.Extensions.dll /r:System.Net.Http.dll /r:System.Security.dll "$source\ServitecAgent.cs" "$source\AgentPolicy.cs"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o agente.' }
& $csc /nologo /target:winexe /optimize+ /platform:anycpu /langversion:5 "/win32icon:$icon" "/out:$clientOut\ServitecClient.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Net.Http.dll /r:System.Security.dll "$source\client\Client.cs" "$source\AgentPolicy.cs"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o aplicativo de chamados.' }
Copy-Item "$source\ServitecAgent.exe.config" "$agentOut\ServitecAgent.exe.config" -Force
Copy-Item "$source\ServitecAgent.exe.config" "$clientOut\ServitecClient.exe.config" -Force
python scripts/package-agent.py "$agentOut\ServitecAgent.exe"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao empacotar o agente.' }
foreach ($http in @($false,$true)) {
    $name = if ($http) { 'ServitecAgentSetupHttp.exe' } else { 'ServitecAgentSetup.exe' }
    $options = @('/nologo','/target:exe','/optimize+','/platform:anycpu','/langversion:5',"/win32icon:$icon", "/win32manifest:$source\installer\app.manifest", "/out:$source\$name", '/r:System.IO.Compression.dll', "/resource:$source\servitec-agent-windows.zip,Servitec.AgentPackage.zip", "$source\installer\Setup.cs")
    if ($http) { $options += '/define:HTTP_DEFAULT' }
    & $csc $options
    if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar $name" }
}
Write-Host 'Agente, aplicativo, pacote ZIP e instaladores compilados com o icone Servitec.'
