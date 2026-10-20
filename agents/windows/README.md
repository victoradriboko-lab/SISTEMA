# Agente Windows e Windows Server — 1.2.4

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

## Tokens de empresa com 10 caracteres

Novos cadastros, importações e renovações geram tokens únicos de 10 letras e números, com diferenciação entre maiúsculas e minúsculas. Copie o valor exatamente como aparece na ficha. O instalador e o agente 1.2.1 aceitam esse formato. As chaves internas do aplicativo e tokens individuais legados de equipamentos não foram encurtados.

## Correção de rejeição HTTP 400 — versão 1.2.2

Velocidades desconhecidas de adaptadores WMI (como UINT64_MAX) não são enviadas como velocidades reais. O servidor atualizado aceita contadores opcionais desconhecidos de rede, slots e tipos/velocidades de memória como nulos, mantendo os demais dados válidos. Métricas de uso e capacidades continuam sendo validadas estritamente.

O agente agora registra o motivo JSON devolvido pelo servidor em rejeições e confirma no log a primeira coleta aceita. Tokens são ocultados nas mensagens. A auditoria do servidor registra rejeições por empresa/equipamento, sem registrar o token. Erros internos de persistência passam a retornar HTTP 500 em vez de parecerem erros de validação.

O agente 1.2.1 já consegue reenviar as amostras com os contadores especiais após atualizar o servidor. A versão 1.2.2 acrescenta prevenção na coleta e diagnóstico local. O serviço iniciado, por si só, não comprova que a API aceitou a coleta.

## Atualização de serviço existente — versão 1.2.3

O instalador tenta parar normalmente o serviço, inclusive aguardando estados de inicialização/parada. Se o serviço não responder, valida caminho, PID e data de criação do processo antes de encerrar somente o executável do agente. Caminhos ou processos divergentes são preservados; sem identificação segura, a atualização pede reinicialização do Windows.

O agente interrompe consultas de inventário ao receber a solicitação de parada e informa prazo ao controlador de serviços. A fila de coletas pendentes é mantida quando servidor e token não mudam. Ao mudar servidor/token, a fila anterior é arquivada localmente em `C:\ProgramData\ServitecAgent\queue-preservada-*` e não é reenviada no novo contexto. Identidade da máquina, dados da plataforma e histórico são preservados.

Validação de cenários de serviço e fila: `tests/ServiceUpdateTests.ps1`. O teste usa serviços/processos simulados e não encerra processos reais.


## Aplicativo de atendimento — versão 1.2.4

O aplicativo Abrir chamado usa a identidade Servitec T.I., com cabeçalho preto, marca em roxo, área clara, campos brancos e botão verde. O formulário e a autorização da empresa continuam os mesmos. O instalador continua preservando a identificação da máquina e a fila local.

Para receber a nova interface, atualize o servidor, baixe novamente o instalador HTTP ou HTTPS apropriado e execute-o como administrador na máquina. Feche o aplicativo Abrir chamado antes de reinstalar. Os atalhos existentes continuam funcionando; seu nome no Windows é mantido para evitar atalhos duplicados.

Validação: compilação .NET Framework 4.6.2, hashes do pacote, instaladores HTTP/HTTPS e testes da política do agente. A renderização nativa do Windows deve ser conferida na máquina após a atualização.

### Ícone Servitec nos downloads e atalhos

O arquivo `branding/servitec.ico` contém o símbolo Servitec adaptado da imagem
fornecida, com transparência e tamanhos de 16 a 256 pixels. Os três projetos
incorporam esse ícone. O aplicativo de chamados também usa o ícone na janela;
os atalhos usam explicitamente o primeiro ícone de `ServitecClient.exe`.

No Windows com .NET Framework 4.6.2 ou superior e Python 3, execute na raiz:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-agent-windows.ps1
```

O script recompila agente e aplicativo, recalcula os hashes do ZIP e recompila
os instaladores HTTPS e HTTP. O workflow `build-agent-windows.yml` executa esse
processo no GitHub e atualiza os três arquivos de download após uma compilação
bem-sucedida. Se a política da branch recusar o envio automático, baixe o
artefato do workflow e atualize os arquivos por um PR.

Atualize o código no servidor após a compilação. Instalações existentes recebem
os novos ícones ao reinstalar/atualizar com o pacote novo. O Windows pode manter
um ícone antigo em cache por algum tempo. A personalização não adiciona uma
interface de bandeja ao serviço e não altera tokens ou dados de instalação.

Na plataforma, o nome apresentado no download é `App-Servitec.exe`.
A alternativa HTTP é `App-Servitec-HTTP.exe`. Os nomes internos dos binários
permanecem compatíveis com a instalação e o serviço existentes.
