$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$flags = [Reflection.BindingFlags]'Instance,NonPublic'
$root = Split-Path $PSScriptRoot -Parent
foreach ($name in @('ServitecAgentSetup.exe','ServitecAgentSetupHttp.exe')) {
    $assembly = [Reflection.Assembly]::LoadFile((Join-Path $root $name))
    $type = $assembly.GetType('Servitec.Setup.SetupForm', $true)
    $form = [Activator]::CreateInstance($type, $true)
    function Field($name) { $type.GetField($name,$flags).GetValue($form) }
    function Call($name, [object[]]$values = @()) { $type.GetMethod($name,$flags).Invoke($form,$values) }
    try {
        if ((Field 'page') -ne 0) { throw 'Assistente deve iniciar nas boas-vindas.' }
        Call 'Advance'
        if ((Field 'page') -ne 1) { throw 'Tela de informacoes ausente.' }
        Call 'Advance'
        if ((Field 'page') -ne 2 -or (Field 'next').Text -ne 'Instalar') { throw 'Configuracao deve preceder a instalacao.' }
        $token = Field 'token'
        if (-not $token.UseSystemPasswordChar -or $token.MaxLength -ne 10) { throw 'Campo do token deve ficar oculto e limitado.' }
        $expected = if ($name -eq 'ServitecAgentSetupHttp.exe') { 'http://vsuarez.ddns.net:3000' } else { 'https://vsuarez.ddns.net:3000' }
        if ($type.GetProperty('Server',$flags).GetValue($form,$null) -cne $expected) { throw 'Protocolo pre-configurado incorreto.' }
        $type.GetField('secret',$flags).SetValue($form,'aB3dE5gH7j')
        Call 'Report' @([int]60,'Configurando aB3dE5gH7j')
        Call 'Report' @([int]35,'Mensagem atrasada')
        if ((Field 'progress').Value -ne 60) { throw 'Progresso nao pode retroceder.' }
        $log = (Field 'details').Text
        if ($log.Contains('aB3dE5gH7j') -or -not $log.Contains('[token oculto]')) { throw 'Token exposto nos detalhes.' }
        Call 'Report' @([int]150,'Concluido')
        if ((Field 'progress').Value -ne 100) { throw 'Barra deve limitar o progresso a 100%.' }
        $type.GetField('installing',$flags).SetValue($form,$true)
        $closing = New-Object System.Windows.Forms.FormClosingEventArgs ([System.Windows.Forms.CloseReason]::UserClosing),$false
        $form.GetType().GetMethod('OnFormClosing',$flags).Invoke($form,@($closing))
        if (-not $closing.Cancel) { throw 'Fechamento deve ser bloqueado durante a instalacao.' }
        Write-Output "PASS: $name - navegacao, protocolo, token oculto, progresso e fechamento."
    } finally { $form.Dispose() }
}
