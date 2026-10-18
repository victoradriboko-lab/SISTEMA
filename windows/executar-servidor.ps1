param([Parameter(Mandatory = $true)][string]$NodePath)

$project = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $project
$env:HOST = '0.0.0.0'
$env:PORT = '3000'
$env:CLIENT_PORT = '3001'
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
