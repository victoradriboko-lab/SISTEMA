# SISTEMA — Central interna de TI

Primeira versão independente de uma central de serviços em português. Node.js 24+, SQLite nativo e Python 3 para o agente Linux. Não exige instalação de pacotes externos.

## Executar

```sh
cd /workspace/SISTEMA
npm run check
npm test
npm start
```

O servidor escuta em 127.0.0.1:3000. A primeira abertura solicita cadastro do administrador (senha mínima de 12 caracteres). Faça esse cadastro antes de disponibilizar a aplicação a outras pessoas. Não existe usuário padrão. PORT e HOST permitem configurar a escuta. Para acesso pela rede, coloque atrás de proxy HTTPS e defina COOKIE_SECURE=1. Dados persistem em data/sistema.db; DATA_DIR permite outro diretório. Faça backups consistentes com SQLite; não copie apenas o arquivo principal durante gravações em modo WAL.

## Implementado

- Cadastro inicial de administrador, login com hash scrypt, sessão de oito horas e logout.
- Usuários e permissões: cadastro, edição, desativação e redefinição de senha por administrador; troca da própria senha para todos os perfis.
- Perfis Administrador, Técnico e Consulta como padrões; novos perfis e permissões configuráveis por operação, verificadas no servidor. Alterações de permissões encerram as sessões dos perfis afetados.
- Configurações de empresa/logotipo, alertas de chamados parados, importação de equipamentos CSV com prévia, histórico de atividades e backup consistente do banco.
- Chamados: criação, descrição, prioridade e transição de status.
- Inventário com responsável e sistema operacional.
- Token exclusivo por equipamento, exibido no cadastro.
- API de heartbeat e painel de comunicação recente (janela de 120 segundos).
- Agente inicial Linux que envia sistema operacional, carga de CPU e uso de disco a cada minuto. Carga de CPU é load average, não percentual. Não coleta memória nesta versão.

Cadastre um equipamento e guarde seu token. Em um terminal da máquina Linux a monitorar, configure SISTEMA_URL e SISTEMA_AGENT_TOKEN por mecanismo seguro de variáveis de ambiente, então execute `python3 agents/heartbeat.py`. Use HTTPS fora do loopback. O agente não executa comandos remotos nem acessa a tela. Não salve tokens no Git.

## Próximas etapas

Esta versão NÃO equivale a todos os recursos do Milvus. Acesso remoto está sinalizado como pendente na interface: será necessário selecionar e instalar RustDesk ou MeshCentral, configurar servidor, clientes, autorização e auditoria. Também faltam agente macOS, SLA contratado, anexos, integração de e-mail, recuperação de senha por e-mail, limitação de tentativas de login e alertas automáticos por e-mail. O agente Windows precisa de validação piloto no Windows antes de distribuição ampla. Antes de uso amplo, concluir os controles necessários ao seu ambiente e revisar a segurança e a rotina de backup. O cadastro inicial é destinado apenas ao primeiro administrador. Administradores podem redefinir senhas de outros usuários; a própria senha exige confirmação da senha atual.

## Validação

`npm test` inicia uma instância isolada com banco temporário e testa cadastro, bloqueio de recadastro, login, rejeição de acesso sem autenticação, criação e alteração de chamados, proteção de origem, inventário, heartbeat e logout. Não valida interface em navegador ou acesso remoto. `npm run check` verifica a sintaxe do servidor e dos scripts da interface. Os testes também verificam configurações, regras de atendimento, importação CSV, autorização por operação e abertura de uma nova instância com o backup baixado.

## Windows Server: inicio automatico na rede local

Atualize o checkout, pare o `npm start` manual com Ctrl+C e clique com o botao direito em `instalar-inicio-automatico.bat` → **Executar como administrador**. Requer Node.js 24+ e Windows PowerShell 5.1 com os modulos ScheduledTasks e NetSecurity. O BAT e independente: mantenha apenas esse arquivo junto ao `server.mjs`. Ele contem o instalador e cria automaticamente `data/executar-servidor.ps1`, sem depender da pasta `windows`. Os PS1 dessa pasta ficam como referencia da implementacao original.

O instalador encontra a pasta e o Node.js automaticamente, registra `Servitec-Sistema` no Agendador de Tarefas (conta SYSTEM, sem exigir login), executa imediatamente e verifica `/api/state`. Configura HOST=0.0.0.0, PORT=3000 e COOKIE_SECURE=0 para acesso HTTP pela LAN. A regra de firewall criada permite apenas LocalSubnet; regras mais amplas criadas anteriormente nao sao removidas. Nao encaminhe a porta 3000 para a internet. A publicacao com dominio e HTTPS requer configuracao separada. Como a tarefa executa como SYSTEM, mantenha a pasta em local administrado, com permissao de alteracao apenas para pessoas confiaveis.

Dados continuam em `data/sistema.db`; o log fica em `data/servidor.log`. O instalador pode ser repetido para atualizar sua propria tarefa, mas preserva tarefas de mesmo nome com outra configuracao. Reinicia apos falha em intervalos de um minuto (ate 999 tentativas). A reinicializacao do Windows e o funcionamento da tarefa devem ser validados no proprio servidor; estes scripts nao foram executados em Windows no ambiente Linux de desenvolvimento.

Para atualizar depois, no PowerShell como administrador, dentro da pasta do projeto:

```powershell
Stop-ScheduledTask -TaskName 'Servitec-Sistema'
git pull --ff-only
# Confirme que o pull concluiu sem erros antes de iniciar.
Start-ScheduledTask -TaskName 'Servitec-Sistema'
```

Para desinstalar apenas a inicializacao automatica e sua regra de firewall, preservando os dados:

```powershell
Stop-ScheduledTask -TaskName 'Servitec-Sistema'
Unregister-ScheduledTask -TaskName 'Servitec-Sistema' -Confirm:$false
Remove-NetFirewallRule -Name 'Servitec-Sistema-LAN-3000'
```


## Usuários, senhas e permissões padrão

Entre como administrador e abra **Usuários e permissões**. Use **Novo usuário** para definir nome, e-mail de login, senha inicial (12 a 256 caracteres) e perfil. Em **Editar**, altere cadastro, perfil, situação ou defina nova senha para outro usuário. A senha existente nunca é exibida. Deixar a nova senha vazia mantém a anterior. Não há exclusão definitiva: desative a conta para bloquear acesso.

| Permissão | Administrador | Técnico | Consulta |
| --- | --- | --- | --- |
| Visualizar chamados, inventário e monitoramento | Sim | Sim | Sim |
| Criar chamados, mudar status e cadastrar equipamentos | Sim | Sim | Não |
| Gerenciar usuários, perfis e redefinir senhas de outros | Sim | Não | Não |
| Alterar a própria senha informando a atual | Sim | Sim | Sim |

A tabela acima descreve os perfis iniciais. Em **Configurações → Permissões**, o administrador pode alterar os acessos de Técnico e Consulta e criar perfis personalizados. As permissões de gerenciar usuários, permissões e sistema permanecem exclusivas do Administrador e não podem ser desmarcadas nele. Dependências entre consultar e alterar são validadas no servidor.

Os perfis se aplicam a todos os dados do sistema: ainda não há separação por empresa, setor ou solicitante. Controle remoto continua pendente. Alterações de senha, perfil ou situação encerram as sessões da conta afetada. O sistema impede desativar ou rebaixar o último administrador ativo. **Minha senha**, no topo da tela, permite alterar sua senha e exige novo login.

### Atualizar uma instalação existente

Pare a tarefa `Servitec-Sistema` (ou o processo manual), faça backup da pasta `data` com o sistema parado, atualize os arquivos pelo GitHub e inicie novamente. Não apague nem substitua o banco por um banco vazio. A primeira inicialização adiciona automaticamente as colunas de perfil e situação, preservando os dados e o login do administrador existente. Nenhuma senha padrão é criada. Atualize o navegador com Ctrl+F5. A migração foi testada com banco no formato anterior e após reinício, além dos testes de bloqueio de operações por perfil e dos fluxos de usuários no navegador.


## Configurações — versão 0.2.0

A navegação e o modelo de central de TI foram mantidos. As melhorias das referências foram adaptadas aos módulos existentes; não há módulos de compras, financeiro ou integração com Conta Azul nesta versão.

- **Permissões:** matriz por perfil, novos perfis personalizados, dependências entre acessos e bloqueio da API mesmo que o cliente tente chamar uma operação escondida na tela. Perfis novos começam sem acesso. Permissões de administração são fixas.
- **Atendimento:** destaque amarelo/vermelho de chamados parados na mesma situação, em dias inteiros. Padrão: amarelo em 2 dias e vermelho em 5. Mudar o status reinicia a contagem; salvar o mesmo status não reinicia. Chamados resolvidos não recebem alertas. Nos dados anteriores à atualização, o ponto inicial é a data de criação. Não se trata de SLA contratado e não há envio de e-mail.
- **Empresa:** nome fantasia, razão social, CNPJ, inscrição estadual, endereço, cidade/UF, telefone, e-mail, site e logotipo PNG/JPEG/WebP (até 256 KB). Apenas nome e presença do logo são públicos para personalizar a entrada; demais dados exigem permissão. O upload não aceita SVG ou código executável.
- **Importações:** CSV UTF-8 separado por ponto e vírgula ou vírgula, com prévia e confirmação. Cabeçalhos `codigo` e `nome` são obrigatórios; `responsavel` e `sistema` são opcionais. Acentos nos cabeçalhos também são reconhecidos. Limites: 512 KB e 1.000 registros. Códigos são únicos e diferenciam maiúsculas/minúsculas. Códigos duplicados no arquivo ou linhas inválidas rejeitam todo o arquivo antes de gravar. Reimportar atualiza por código; colunas opcionais ausentes preservam os valores e células vazias limpam os valores. Equipamentos antigos sem código são preservados.
- **Atividades:** registros de login/saída, tentativas de login recusadas, usuários, perfis, permissões, chamados, equipamentos, importações, regras e backups. Exibe páginas de 100 registros; senhas e tokens não são gravados nesse histórico. A interface não oferece exclusão do histórico. Não é um log externo à prova de alteração por administradores do servidor.
- **Sistema:** versão e revisão Git carregadas no início do processo, contagens e backup SQLite com confirmação da senha do administrador. O banco baixado é consistente mesmo com WAL, não inclui sessões de login e inclui hashes de senhas, tokens de agentes e dados da empresa; guarde-o em local protegido. O backup não contém o código da aplicação. A atualização continua pelo GitHub; a interface não executa pacotes JSON ou código enviado pelo navegador.

Depois de importar equipamentos, use **Vincular cliente** para organizar os cadastros. Para novas instalações, cadastre a empresa em **Equipamentos → Nova empresa / token** e use o token da empresa nos agentes. Tokens individuais antigos continuam funcionando; sua renovação individual permanece disponível apenas no fluxo de compatibilidade dos cadastros sem cliente.

Exemplo de CSV:

```csv
codigo;nome;responsavel;sistema
TI-001;Notebook recepção;Equipe TI;Windows 11
TI-002;Servidor de arquivos;Infraestrutura;Linux
```

### Atualizar e recuperar no Windows Server

1. Pare `Servitec-Sistema` e verifique que o processo da aplicação encerrou.
2. Anote o commit atual (`git rev-parse HEAD`) e copie a pasta `data` inteira, com o sistema parado, para uma pasta de backup fora do checkout.
3. Atualize todos os arquivos com `git pull --ff-only`, inicie a tarefa e use Ctrl+F5 no navegador. Não copie apenas `server.mjs`: ele agora depende de `configuration.mjs` e a interface usa `public/settings.js`.
4. A migração é aditiva: preserva usuários, senhas, chamados, equipamentos e tokens, cria as tabelas de configurações e adiciona código de equipamento e início da situação do chamado. As permissões já configuradas são preservadas em reinícios futuros.

Para recuperar apenas um backup baixado nesta versão: pare a tarefa, preserve uma cópia da pasta `data` atual, separe os antigos arquivos `sistema.db`, `sistema.db-wal` e `sistema.db-shm` em outro local, copie o arquivo baixado como `data/sistema.db` e inicie a tarefa. Não misture arquivos WAL/SHM antigos com um banco restaurado. Os usuários precisam fazer login novamente. Essa recuperação substitui o estado do banco pelo momento do backup.

Para retornar a uma versão anterior do código, mantenha a aplicação parada e restaure **o código e o banco correspondentes ao mesmo backup anterior à atualização**. Não execute código antigo com os novos perfis personalizados: versões antigas não conhecem a nova matriz de permissões. A recuperação perde alterações posteriores ao backup; preserve o estado atual antes de qualquer retorno. Não há botão de reversão automática ou exclusão de dados nesta atualização.


## Agente Windows / Windows Server — versão do sistema 0.3.0

O pacote atende Windows 10/11 e Windows Server 2016 ou superior (.NET Framework 4.6.2+, PowerShell 5.1). O agente é um serviço nativo `ServitecAgent`; a máquina monitorada não precisa de Node.js ou Python.

1. Atualize o **servidor**: pare `Servitec-Sistema`, preserve uma cópia de `data`, faça Pull de todos os arquivos e inicie a tarefa. A migração cria o histórico de telemetria e preserva usuários, equipamentos e dados anteriores.
2. Em **Equipamentos → Nova empresa / token**, cadastre o cliente e guarde o token. Use esse token nos agentes de todas as máquinas dessa empresa. Clique em **Baixar instalador .exe**. É necessário ter permissão para cadastrar equipamentos.
3. Na máquina a monitorar, abra **ServitecAgentSetup.exe** e aceite a solicitação de administrador. Os arquivos são extraídos automaticamente. O ZIP com BAT continua disponível como alternativa. Informe a URL base do servidor e cole o token na entrada oculta. Use o mesmo token da empresa nos equipamentos desse cliente; cada instalação tem sua própria identificação e cadastro automático.
4. Confira **Monitoramento → Detalhes**. A primeira coleta pode levar alguns minutos. O serviço inicia após reiniciar o Windows, sem precisar entrar em uma conta de usuário.

Métricas são coletadas a cada 30 segundos; inventário e serviços automáticos, no início e a cada seis horas. A página consulta o servidor a cada 10 segundos, sem substituir formulários abertos. Offline após dois minutos sem amostra atual; uso de CPU/RAM/disco de 90% ou mais fica em destaque. Os valores exibidos são as últimas amostras recebidas, e ficam identificados como offline quando a comunicação para.

O histórico mantém até 48 horas, com limpeza periódica e aproximadamente 5.760 amostras por equipamento; a tela detalhada mostra as últimas 120. Amostras têm identificador e horário de coleta: reenvios não duplicam o histórico, e backlog antigo não substitui métricas atuais nem simula conexão online. O token da empresa identifica o cliente, e a identidade local do agente separa as máquinas. Tokens individuais antigos continuam vinculados a uma única instalação. Agentes Linux anteriores continuam aceitos com esses tokens antigos; tokens de empresa exigem o protocolo Windows com identidade de instalação.

O agente só faz conexões de saída e valida certificados HTTPS normalmente. O instalador não segue redirecionamentos levando o token. Para a rede local, permite HTTP apenas por IP privado ou loopback e com confirmação explícita; não use esse modo pela internet. Token protegido por DPAPI, pastas restritas a administradores/SYSTEM, fila limitada a 120 amostras e log com rotação. Não há acesso remoto à tela, execução de comandos ou atualização remota de executáveis.

[Manual do agente, requisitos e diagnóstico](agents/windows/README.md).

### Compilar novamente o agente (desenvolvimento)

Requer SDK .NET 8 e acesso ao NuGet para assemblies de referência do .NET Framework; isso só é necessário na máquina de desenvolvimento. Python 3 é usado apenas para gerar o ZIP.

```sh
dotnet build agents/windows/ServitecAgent.csproj -c Release
dotnet run --project agents/windows/tests/PolicyTests.csproj -c Release
python3 scripts/package-agent.py agents/windows/bin/Release/net462/ServitecAgent.exe
```

O ZIP versionado inclui o executável compilado, seu checksum SHA-256, configuração de runtime, instaladores e fontes. Após qualquer alteração de C# ou instaladores, recompile e gere o pacote antes de distribuir. O checksum confirma integridade, não assinatura/autenticidade; ainda não há assinatura digital de código.

**Validação feita nesta entrega:** compilação do executável para .NET Framework 4.6.2 sem erros/avisos; 18 verificações da política de conexão compartilhada com o agente; sintaxe dos instaladores conferida com o parser PowerShell; testes da API/protocolo, permissão, tokens, amostras atrasadas/duplicadas e compatibilidade do agente antigo; navegação, download, histórico e atualização automática no navegador e layout móvel com telemetria simulada. **Validação ainda necessária no Windows:** instalação e reinício do serviço, DPAPI/ACL, coleta WMI/Registro e envio de dados reais numa estação e num Windows Server. Os testes em Linux não substituem esse piloto.


## Instalador único — versão 0.3.1

**Equipamentos → Baixar instalador .exe** fornece `ServitecAgentSetup.exe`, acessível apenas a usuários com permissão de cadastrar equipamentos. O instalador contém o pacote completo, solicita elevação via manifesto `requireAdministrator`, extrai em pasta temporária restrita dentro de Program Files/ServitecAgent, executa a configuração existente e remove os temporários. Continua pedindo a URL do servidor e o token em entrada oculta; o download não incorpora credenciais.

Não é necessário extrair ZIP nem executar BAT ao usar esse instalador. O fluxo usa um console com perguntas; não é um assistente gráfico. Requisitos de Windows/.NET, comunicação e serviço são os mesmos da versão 0.3.0. O instalador ainda não possui assinatura digital de editor. UAC, instalação e coleta reais devem ser verificados no piloto Windows.

Para reconstruir depois de gerar o pacote ZIP:

```sh
dotnet build agents/windows/installer/ServitecAgentSetup.csproj -c Release
```

Copie `agents/windows/installer/bin/Release/net462/ServitecAgentSetup.exe` para `agents/windows/ServitecAgentSetup.exe` antes de distribuir. O ZIP é incorporado durante a compilação: ao atualizar o agente ou instaladores, gere novamente o ZIP e recompile também o instalador único.

### Identidade visual SERVITEC VSA

A plataforma usa o nome **Sistema Informática SERVITEC VSA**, com tema tecnológico escuro, detalhes em ciano, painéis com bordas discretas e layout adaptado para celular. O nome da plataforma permanece fixo; o nome fantasia cadastrado em Configurações → Empresa aparece no cabeçalho, e o logotipo personalizado continua disponível no menu. Os dados da empresa e os módulos existentes são preservados.

Para atualizar uma instalação existente, execute `git pull` na pasta do projeto, reinicie o sistema e atualize o navegador com **Ctrl+F5**. Se a instalação usa a tarefa automática do Windows, reinicie essa tarefa pelo Agendador de Tarefas.

### Clientes, tokens e inventário

Em **Equipamentos**, use **Nova empresa / token** e guarde o token apresentado uma única vez. O mesmo token instala os agentes de todas as máquinas desse cliente; o primeiro inventário cadastra cada equipamento automaticamente. Selecione a empresa no filtro para ver seus equipamentos ordenados por nome. **Sem cliente** mostra os cadastros antigos, que podem ser vinculados sem apagar dados. Ao cadastrar manualmente, escolha a empresa no formulário.

Nomes iguais dentro da mesma empresa são sinalizados como **possíveis duplicados**. A plataforma pergunta qual cadastro manter; confirme apenas quando for o mesmo equipamento. É possível manter separados. Ao unir, o cadastro escolhido conserva seus dados, incorpora o histórico e, se não tiver inventário, aproveita o do outro cadastro. As identidades dos agentes passam a apontar para ele. Não há exclusão automática e nomes iguais de empresas diferentes não são unidos. A identificação é pelo nome: nomes diferentes ou máquinas clonadas com a mesma identidade local exigem conferência manual.

Para renovar, selecione a empresa e clique em **Renovar token da empresa**, confirmando sua senha. O token anterior deixa de funcionar para todos os agentes desse cliente; reinstale/configure os agentes com o novo token. Equipamentos e históricos permanecem. O token permite enviar dados de novas máquinas para aquela empresa; compartilhe-o somente com quem instala seus agentes.

Após atualizar o servidor, os agentes existentes continuam funcionando com seus tokens individuais. Para usar o modelo por empresa, configure novamente o agente com o token da empresa e revise eventuais duplicados com os cadastros antigos depois de vinculá-los. O instalador atualizado já pede o token da empresa.
