# Compatibilidade: Windows PowerShell 5.1 / .NET Framework 4.6.2.
function Invoke-ServitecAgentRequest {
    param(
        [Parameter(Mandatory=$true)][string]$Server,
        [Parameter(Mandatory=$true)][string]$Path,
        [ValidateSet('GET','POST')][string]$Method = 'GET',
        [string]$Token,
        [object]$Body,
        [ValidateRange(1,120)][int]$TimeoutSeconds = 45,
        [ValidateRange(1,3)][int]$Attempts = 2
    )
    $baseUri = [Uri]$Server
    if (-not $baseUri.IsAbsoluteUri -or $baseUri.Scheme -notin @('http','https') -or $baseUri.UserInfo -or $baseUri.Query -or $baseUri.Fragment -or $baseUri.AbsolutePath -ne '/' -or -not $Path.StartsWith('/api/')) { throw 'Endereco da API invalido.' }
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $request = $null
        $response = $null
        try {
            Write-Host ('Conectando a ' + $baseUri.Authority + ' - tentativa ' + $attempt + '/' + $Attempts + ' (limite ' + $TimeoutSeconds + 's)...')
            $request = [Net.HttpWebRequest]::Create($Server.TrimEnd('/') + $Path)
            $request.Method = $Method
            $request.AllowAutoRedirect = $false
            $request.Timeout = $TimeoutSeconds * 1000
            $request.ReadWriteTimeout = $TimeoutSeconds * 1000
            $request.Accept = 'application/json'
            $request.UserAgent = 'ServitecAgentSetup/1.1'
            if ($Token) { $request.Headers['Authorization'] = 'Bearer ' + $Token }
            if ($Method -eq 'POST') {
                $request.ContentType = 'application/json; charset=utf-8'
                $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress))
                $request.ContentLength = $bytes.Length
                $stream = $request.GetRequestStream()
                try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
            }
            $response = $request.GetResponse()
            $status = [int]$response.StatusCode
            if ($status -ge 300 -and $status -lt 400) { throw 'O servidor redirecionou a requisicao. Configure o HTTPS para atender diretamente este dominio; o token nao sera reenviado para outro endereco.' }
            if ($status -ne 200 -and $status -ne 201) { throw ('Resposta HTTP inesperada: ' + $status) }
            $reader = New-Object IO.StreamReader($response.GetResponseStream())
            try {
                $buffer = New-Object char[] 32769
                $length = 0
                while ($length -lt $buffer.Length) {
                    $read = $reader.Read($buffer,$length,$buffer.Length-$length)
                    if ($read -eq 0) { break }
                    $length += $read
                }
                if ($length -gt 32768) { throw 'Resposta da API acima do limite esperado.' }
                $content = -join $buffer[0..([Math]::Max(0,$length-1))]
                if (-not $length) { throw 'O servidor retornou resposta vazia.' }
                try { return ($content | ConvertFrom-Json) } catch { throw 'O dominio respondeu, mas nao retornou JSON da API SERVITEC. Confira o destino do proxy HTTPS.' }
            } finally { $reader.Dispose() }
        } catch {
            $web = $_.Exception
            while ($web -and -not ($web -is [Net.WebException])) { $web = $web.InnerException }
            if (-not $web) { throw }
            $statusCode = 0
            if ($web.Response -is [Net.HttpWebResponse]) { $statusCode = [int]$web.Response.StatusCode }
            $retry = $web.Status -in @([Net.WebExceptionStatus]::Timeout,[Net.WebExceptionStatus]::ConnectFailure,[Net.WebExceptionStatus]::NameResolutionFailure,[Net.WebExceptionStatus]::ReceiveFailure,[Net.WebExceptionStatus]::SendFailure,[Net.WebExceptionStatus]::ConnectionClosed,[Net.WebExceptionStatus]::KeepAliveFailure) -or $statusCode -in @(502,503,504)
            if ($web.Response) { $web.Response.Dispose() }
            if ($retry -and $attempt -lt $Attempts) { Write-Host 'Falha temporaria de conexao. Tentando novamente...' -ForegroundColor Yellow; Start-Sleep -Seconds 2; continue }
            if ($statusCode -eq 401) { throw 'HTTP 401: token nao reconhecido ou revogado. Use o token vigente da empresa cliente.' }
            if ($statusCode -eq 403) { throw 'HTTP 403: acesso recusado. Confira o token, a empresa e as regras do proxy/firewall.' }
            if ($statusCode -eq 404) { throw 'HTTP 404: API do agente nao encontrada. O dominio deve apontar para o sistema interno na porta 3000, e nao para o Painel do Cliente (3001).' }
            if ($statusCode -in @(502,503,504)) { throw ('HTTP ' + $statusCode + ': o proxy HTTPS nao conseguiu atender a API. Confira se o sistema esta rodando e se o proxy encaminha para a porta 3000.') }
            if ($web.Status -in @([Net.WebExceptionStatus]::TrustFailure,[Net.WebExceptionStatus]::SecureChannelFailure)) { throw 'Falha de certificado ou TLS. Confira certificado valido para este dominio, cadeia de confianca e suporte a TLS 1.2. A verificacao do certificado permanece ativada.' }
            if ($web.Status -in @([Net.WebExceptionStatus]::NameResolutionFailure,[Net.WebExceptionStatus]::ProxyNameResolutionFailure)) { throw 'Nao foi possivel resolver o dominio ou o proxy. Confira DNS e a configuracao de rede deste computador.' }
            if ($web.Status -eq [Net.WebExceptionStatus]::Timeout) { throw ('Tempo limite ao acessar ' + $baseUri.Authority + '. Confira a porta ' + $baseUri.Port + ', o encaminhamento para a porta 3000 e o acesso a este dominio de dentro da sua rede (NAT loopback/DNS interno).') }
            if ($web.Status -eq [Net.WebExceptionStatus]::ConnectFailure) { throw ('Nao foi possivel conectar a ' + $baseUri.Authority + '. Confira a porta ' + $baseUri.Port + ', o firewall e o encaminhamento para o servidor.') }
            if ($statusCode) { throw ('A API recusou a requisicao: HTTP ' + $statusCode + '. Confira o servidor e o proxy HTTPS.') }
            throw ('Falha de comunicacao com a API: ' + $web.Status + '. Confira a rede e o proxy HTTPS.')
        } finally {
            if ($response) { $response.Dispose() }
            if ($request) { $request.Abort() }
        }
    }
}
