# Agente Windows e Windows Server — 1.2.0

Agente de inventário e telemetria para Windows 10/11 ou Windows Server 2016+, com .NET Framework 4.6.2+. Não executa comandos remotos nem coleta senhas ou arquivos pessoais. O aplicativo de abrir chamados usa autorização da empresa, sem login do usuário.

## Instalação

1. Baixe em **Download de Agentes** e execute como administrador.
2. O instalador padrão `ServitecAgentSetup.exe` já usa `https://vsuarez.ddns.net:3000`.
3. Informe somente o token da empresa. O agente e o aplicativo Abrir chamado são instalados juntos.

A empresa gera um token exclusivo no cadastro; ele permanece visível na ficha para operadores autorizados. Use o mesmo token em todos os agentes da empresa. Renovar o token é uma ação separada que invalida o anterior.

O instalador alternativo `ServitecAgentSetupHttp.exe` usa `http://vsuarez.ddns.net:3000` por escolha explícita; HTTP externo transmite o token e os dados sem criptografia. Não há downgrade automático de HTTPS. O ZIP inclui `instalar-agente.bat` (HTTPS) e `instalar-agente-http.bat` (HTTP).

Para configuração avançada, execute `instalar-agente.ps1 -ServerUrl https://outro-servidor.example`. Acrescente `-MonitorOnly` para não instalar o aplicativo de chamados ou `-UseHttp` para autorizar HTTP explicitamente. Configurações antigas de HTTP em LAN continuam compatíveis.

Após validar o formato da URL, o instalador solicita o token e somente depois verifica a conexão com a API. O limite de conexão é de 45 segundos, com até duas tentativas para falhas transitórias e mensagens para DNS, timeout, token inválido, porta incorreta e TLS. Certificados continuam sendo validados. Redirecionamentos não recebem o token.

HTTP/3000 e HTTPS/3000 precisam chegar ao sistema interno na porta 3000, por encaminhamento ou proxy reverso. Não use a porta 3001 do portal. A aplicação não altera NAT, roteador, DNS, certificado ou firewall.

## Dados coletados

CPU, memória, volumes e uptime são enviados periodicamente (30 segundos). Inventário completo é coletado a cada seis horas: fabricante, modelo, série, BIOS, Windows/build/arquitetura, processadores, placa-mãe, memória por slot, periféricos, discos físicos, vídeo, redes, programas e serviços. O estado do Defender depende do provedor disponível no Windows; antivírus de terceiros pode reportar somente identificação/estado bruto.

Dados ausentes permanecem desconhecidos. Não há scanner CVE, temperatura, contas locais, captura de senhas ou chaves completas de licença. Não há instalação remota de programas. Velocidade de rede é a reportada pelo adaptador, convertida para Mbps, não um teste de velocidade.

Reinstale o agente atualizado para habilitar os campos novos. Agentes antigos continuam aceitos. O identificador persistente da máquina é reutilizado pela reinstalação; a empresa e o servidor precisam continuar correspondendo à configuração desejada.

## Compilação e empacotamento

Use os projetos .NET Framework em `agents/windows`, `client` e `installer`. O empacotador `python scripts/package-agent.py --binary <caminho-do-ServitecAgent.exe>` gera um ZIP validado com os binários de Release e os scripts. A pasta Release do aplicativo deve conter o arquivo de configuração. Compile o instalador com o ZIP como recurso `Servitec.AgentPackage.zip`; a variante HTTP usa a constante `HTTP_DEFAULT`.

`tests/PolicyTests.cs` verifica as regras de URL e o caminho explícito de HTTP. Consulte [a ficha detalhada e a demonstração](../../docs/FICHA-CLIENTE-INVENTARIO.md).

Os dois instaladores usam agora a porta 3000, mas mantêm seus protocolos distintos. O servidor Node padrão atende HTTP nessa porta: nesse caso use o instalador HTTP. Usar HTTPS na mesma porta exige terminação TLS configurada; a liberação da porta no firewall não adiciona HTTPS.
