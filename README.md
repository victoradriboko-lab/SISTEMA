# SISTEMA — Central interna de TI

Primeira versão independente de uma central de serviços em português. Node.js 24+, SQLite nativo e Python 3 para o agente Linux. A recepção de e-mails utiliza ImapFlow e MailParser; instale as dependências com `npm ci`.

## Manual do usuário

Consulte o [manual em Word](docs/manual/Manual-do-Usuario-SERVITEC-VSA.docx) ou a [versão em PDF](docs/manual/Manual-do-Usuario-SERVITEC-VSA.pdf), com capa, sumário, imagens e instruções de uso dos módulos, incluindo o portal do cliente e backups.

## Executar

```sh
cd /workspace/SISTEMA
npm ci
npm run check
npm test
npm start
```

O servidor escuta em 127.0.0.1:3000. A primeira abertura solicita cadastro do administrador (senha mínima de 12 caracteres). Faça esse cadastro antes de disponibilizar a aplicação a outras pessoas. Não existe usuário padrão. PORT e HOST permitem configurar a escuta. O Painel do Cliente inicia separadamente em 127.0.0.1:3001. Para acesso pela rede, configure HOST e, para publicação externa, coloque atrás de proxy HTTPS e defina COOKIE_SECURE=1. Dados persistem em data/sistema.db; DATA_DIR permite outro diretório. Faça backups consistentes com SQLite; não copie apenas o arquivo principal durante gravações em modo WAL.

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

Esta versão NÃO equivale a todos os recursos do Milvus. Acesso remoto está sinalizado como pendente na interface: será necessário selecionar e instalar RustDesk ou MeshCentral, configurar servidor, clientes, autorização e auditoria. Também faltam agente macOS, SLA contratado, anexos, respostas/envio de e-mail, recuperação de senha por e-mail, limitação de tentativas de login e alertas automáticos por e-mail. O agente Windows precisa de validação piloto no Windows antes de distribuição ampla. Antes de uso amplo, concluir os controles necessários ao seu ambiente e revisar a segurança e a rotina de backup. O cadastro inicial é destinado apenas ao primeiro administrador. Administradores podem redefinir senhas de outros usuários; a própria senha exige confirmação da senha atual.

## Validação

`npm test` inicia uma instância isolada com banco temporário e testa cadastro, bloqueio de recadastro, login, rejeição de acesso sem autenticação, criação e alteração de chamados, proteção de origem, inventário, heartbeat e logout. Não valida interface em navegador ou acesso remoto. `npm run check` verifica a sintaxe do servidor e dos scripts da interface. Os testes também verificam configurações, regras de atendimento, importação CSV, autorização por operação e abertura de uma nova instância com o backup baixado.

## Windows Server: inicio automatico na rede local

Atualize o checkout, pare o `npm start` manual com Ctrl+C e clique com o botao direito em `instalar-inicio-automatico.bat` → **Executar como administrador**. Requer Node.js 24+ e Windows PowerShell 5.1 com os modulos ScheduledTasks e NetSecurity. O BAT e independente: mantenha apenas esse arquivo junto ao `server.mjs`. Ele contem o instalador e cria automaticamente `data/executar-servidor.ps1`, sem depender da pasta `windows`. Os PS1 dessa pasta ficam como referencia da implementacao original.

O instalador encontra a pasta e o Node.js automaticamente, registra `Servitec-Sistema` no Agendador de Tarefas (conta SYSTEM, sem exigir login), executa imediatamente e verifica `/api/state`. Configura HOST=0.0.0.0, PORT=3000, CLIENT_PORT=3001 e COOKIE_SECURE=0 para acesso HTTP pela LAN. As regras de firewall das portas 3000 e 3001 permitem apenas LocalSubnet; regras mais amplas criadas anteriormente nao sao removidas. Nao encaminhe a porta 3000 para a internet. A publicacao com dominio e HTTPS requer configuracao separada. Como a tarefa executa como SYSTEM, mantenha a pasta em local administrado, com permissao de alteracao apenas para pessoas confiaveis.

Dados continuam em `data/sistema.db`; o log fica em `data/servidor.log`. O instalador pode ser repetido para atualizar sua propria tarefa, mas preserva tarefas de mesmo nome com outra configuracao. Reinicia apos falha em intervalos de um minuto (ate 999 tentativas). A reinicializacao do Windows e o funcionamento da tarefa devem ser validados no proprio servidor; estes scripts nao foram executados em Windows no ambiente Linux de desenvolvimento.

Para atualizar depois, no PowerShell como administrador, dentro da pasta do projeto:

```powershell
Stop-ScheduledTask -TaskName 'Servitec-Sistema'
git pull --ff-only
# Confirme que o pull concluiu sem erros.
npm ci --omit=dev
# Confirme que a instalação concluiu sem erros antes de iniciar.
Start-ScheduledTask -TaskName 'Servitec-Sistema'
```

Para desinstalar apenas a inicializacao automatica e sua regra de firewall, preservando os dados:

```powershell
Stop-ScheduledTask -TaskName 'Servitec-Sistema'
Unregister-ScheduledTask -TaskName 'Servitec-Sistema' -Confirm:$false
Remove-NetFirewallRule -Name 'Servitec-Sistema-LAN-3000'
Remove-NetFirewallRule -Name 'Servitec-Clientes-LAN-3001'
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

Os perfis internos se aplicam a todos os dados do sistema. Para consulta restrita a uma empresa, use o cadastro separado em Acessos de clientes e o Painel do Cliente na porta dedicada. Controle remoto continua pendente. Alterações de senha, perfil ou situação encerram as sessões da conta afetada. O sistema impede desativar ou rebaixar o último administrador ativo. **Minha senha**, no topo da tela, permite alterar sua senha e exige novo login.

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
3. Atualize todos os arquivos com `git pull --ff-only`, execute `npm ci --omit=dev`, inicie a tarefa e use Ctrl+F5 no navegador. Não copie apenas `server.mjs`: ele agora depende de `configuration.mjs` e a interface usa `public/settings.js`.
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

### Modo claro e escuro

Depois de entrar, use a chave **Claro / Escuro** no topo direito, abaixo do nome e do perfil do usuário. Está disponível para administradores, técnicos, perfis internos personalizados e clientes. A chave indica o tema atual; clique ou use Espaço/Enter para alternar sem recarregar a página ou perder filtros, gráficos e formulários abertos.

A preferência é salva no navegador, separadamente para o sistema interno e o Painel do Cliente. O padrão continua escuro no sistema e claro no painel. Recarregar ou entrar novamente no mesmo navegador conserva a escolha; outros dispositivos têm sua própria preferência. Se o navegador bloquear o armazenamento local, a troca continua funcionando na página atual, mas não fica salva.

### Dashboard após o login

O login abre o **Dashboard** com saudação, horário da última atualização e oito indicadores: clientes, equipamentos, agentes online, equipamentos sem comunicação, chamados abertos, em atendimento, resolvidos e equipamentos em alerta. Também apresenta conectividade, distribuição dos chamados por situação, até seis clientes com mais equipamentos, alertas operacionais e os cinco últimos chamados.

Os dados vêm dos cadastros e da telemetria reais, conforme as permissões do usuário. Máquinas que nunca se comunicaram aparecem separadas das que ficaram offline. Alertas de recursos consideram apenas equipamentos online com CPU, memória ou algum disco a partir de 90%; chamados atrasados seguem as regras de atendimento configuradas. Sem dados, o painel mostra orientações; sem permissão, mostra informação indisponível, sem inventar valores.

Os dados são atualizados a cada dez segundos enquanto a aba está visível. Clicar num cliente abre o inventário filtrado, e o alerta de equipamento abre seus detalhes no monitoramento. A entrega não altera cadastros, tokens ou o banco de dados. Para atualizar a instalação, execute `git pull`, reinicie o sistema e recarregue o navegador com **Ctrl+F5**.

### Relatórios

O item **Relatórios** no menu lateral reúne:

- Chamados por cliente, por mês, por operador, por status e por prioridade.
- Equipamentos por cliente e situação dos agentes (online, sem comunicação e aguardando agente).

Os relatórios de chamados iniciam no mês atual, com filtros por cliente, data inicial/final, status e prioridade. **Limpar filtros** permite consultar todos os registros. O período considera a data de criação em UTC e inclui integralmente a data final; os totais por status refletem a situação atual dos chamados. Meses sem chamados não geram linhas. Os relatórios de equipamentos mostram o inventário atual, sem filtro de período. **Gerar relatório** atualiza os resultados; não há atualização automática durante a análise.

Cada relatório apresenta totais, um comparativo de até doze grupos e uma tabela com todos os grupos encontrados. **Exportar CSV** gera uma planilha UTF-8 com separador ponto e vírgula, com proteção contra interpretação de nomes como fórmulas. **Imprimir / PDF** abre a impressão do navegador, onde é possível salvar como PDF.

Para chamados por cliente, selecione a empresa em **Novo chamado**. Nos registros existentes, altere a coluna **Cliente** na lista de chamados. Essa alteração preserva a situação e o tempo naquela situação. Chamados sem vínculo continuam no grupo **Sem cliente**: a migração não atribui clientes automaticamente.

As permissões de origem continuam valendo: `tickets.read` permite relatórios de chamados; `assets.read`, relatórios de inventário; informações de conexão também exigem `monitor.read`. A alteração do cliente de um chamado exige `tickets.write`. A migração adiciona o vínculo do cliente sem apagar chamados ou dados existentes.

#### Chamados por operador

Em **Relatórios → Chamados por operador**, consulte totais de abertos, em atendimento e resolvidos por responsável atual. Combine filtros de operador, cliente, período de criação, status e prioridade. O filtro de operador também está disponível nos demais relatórios de chamados. A tabela e o CSV incluem o código do operador para distinguir usuários com nomes iguais.

Escolha **Operador responsável** em Novo chamado ou na coluna correspondente da lista. Só usuários ativos com `tickets.write` podem receber novas atribuições. A alteração exige essa mesma permissão e preserva o cliente, o status e o tempo naquela situação. Operadores desativados ou que perderam a permissão continuam nos relatórios dos chamados atribuídos a eles, mas não podem receber novos chamados.

Chamados existentes recebem operador vazio na migração e aparecem em **Sem operador** até serem atribuídos. O relatório considera o responsável atual, sem reconstruir atribuições anteriores. Nenhum chamado é atribuído automaticamente ao usuário que o criou.

#### Atendimentos internos e externos

O campo **Tipo de atendimento** aceita **Interno** e **Externo**, no cadastro e na lista de chamados. Ao mudar um chamado ainda não classificado para **Em atendimento** ou **Resolvido** pela interface, o sistema solicita a modalidade antes de salvar a mudança. Cancelar mantém a situação anterior. Alterar apenas a modalidade preserva o cliente, o operador, o status e o tempo na situação; a operação exige `tickets.write`.

Em **Relatórios → Internos e externos**, compare as modalidades por quantidade, situação e participação percentual no total filtrado. É possível apresentar apenas internos, apenas externos ou ambos, com filtros por cliente, operador, período de criação, status e prioridade, além de CSV e impressão/PDF. A participação considera todos os registros do filtro, inclusive os não classificados. O filtro de modalidade também está disponível nos outros relatórios de chamados.

A migração preserva os registros e deixa os antigos como **Não informado**, sem presumir uma modalidade. Eles podem ser classificados pela lista. A API mantém o campo opcional para compatibilidade e valida as modalidades quando informadas; a solicitação de classificação ao iniciar/concluir ocorre na interface. O relatório considera a classificação atual de cada chamado, sem contar múltiplas visitas ou alterações de modalidade como atendimentos separados.

#### Escolha do gráfico nos relatórios

Após gerar um relatório com dados, escolha **Visualização do gráfico → Barras** ou **Disco (pizza)** no resultado. A troca é imediata, usa os mesmos dados já filtrados e mantém a tabela e a exportação CSV. A escolha é preservada ao gerar novamente ou trocar de relatório durante a sessão da página. A impressão/PDF inclui o gráfico escolhido com sua legenda.

Barras mostram até doze grupos na ordem do relatório. O disco mostra quantidades e percentuais; quando houver mais de doze grupos, os onze maiores aparecem individualmente e os demais são reunidos em **Outros grupos (agrupados)**, preservando o total. A tabela e o CSV continuam completos. Resultados vazios não geram gráfico.

#### Personalização e modelos pessoais

Depois de gerar o relatório, abra **Personalizar relatório** para definir:

- Título e observação para apresentação/PDF.
- Colunas visíveis na tabela e na exportação CSV; a coluna de identificação do grupo permanece visível.
- Ordenação crescente/decrescente por nome, total ou outra coluna disponível.
- Indicador do gráfico, como total, abertos, em atendimento, resolvidos ou agentes online, conforme o relatório e as permissões.
- Máximo de 5, 10 ou 12 grupos no gráfico.
- Blocos que aparecem na apresentação: resumo, gráfico e tabela. Ao menos um deve permanecer selecionado.

Clique em **Aplicar personalização** para atualizar a apresentação usando os dados já consultados. O resumo conserva o total de registros filtrados; o gráfico informa separadamente o indicador selecionado. No disco, as participações são calculadas sobre esse indicador; no gráfico de barras, a ordenação acompanha as linhas. As colunas ocultas não são incluídas no CSV, mas a escolha visual não substitui as permissões de acesso. **Restaurar apresentação padrão** desfaz essas escolhas.

Use os atalhos **Mês atual**, **Mês anterior**, **Últimos 30 dias**, **Ano atual** ou **Todos** para preencher o período; clique em **Gerar relatório** para consultar os dados com o novo filtro.

Em **Salvar filtros e apresentação como modelo pessoal**, informe um nome. O modelo guarda o tipo de relatório, os filtros do resultado gerado e a apresentação já aplicada. Suas datas ficam fixas; ajuste o período ao reutilizar, quando necessário. Em **Meus modelos de relatório**, carregue ou exclua um modelo. Ao carregar, os resultados são consultados novamente, e as permissões atuais continuam valendo. Modelos não armazenam cópias dos dados.

Os modelos ficam no banco de dados, vinculados ao usuário, e continuam disponíveis após recarregar a página ou acessar de outro computador. Cada usuário vê apenas os próprios modelos e os tipos que pode consultar. Há um limite de cinquenta modelos por usuário; para alterar um modelo existente, salve com outro nome ou exclua a versão anterior. A migração apenas acrescenta a tabela de modelos e preserva os dados existentes.

### Recebimento de chamados por Gmail / Google Workspace

O menu **Central de e-mails** reúne **Aguardando aprovação**, chamados gerados, rejeitados, bloqueados, mensagens automáticas/ignoradas e remetentes vinculados. O administrador cadastra a caixa em **Configurações → E-mail**, com endereço, senha de app do Google e intervalo de coleta. O recebimento começa desativado. A ativação testa a conexão IMAP/TLS; não use a senha normal da conta Google. As políticas do Workspace precisam permitir IMAP, verificação em duas etapas e senhas de app. OAuth e envio de respostas não fazem parte desta conexão.

O primeiro e-mail de um endereço desconhecido fica na fila, sem criar chamado. Um operador com permissão de alterar chamados revisa o conteúdo, escolhe a empresa e aprova. **Memorizar este remetente** autoriza futuros e-mails desse endereço exato para aquela empresa. É possível liberar só a mensagem atual ou, opcionalmente, os outros e-mails pendentes sem alerta do mesmo remetente. Os chamados gerados ficam abertos, com prioridade Média, e aguardam atribuição de operador e modalidade de atendimento.

A primeira ativação define o ponto inicial na INBOX, sem importar o acervo antigo. Pausar/reativar a mesma caixa ou reiniciar o servidor retoma o último ponto salvo. **Reiniciar o ponto de coleta a partir de agora** é uma opção explícita que ignora mensagens ainda não importadas. A coleta não altera a marcação de lido e não apaga e-mails. Registros repetidos são deduplicados; respostas automáticas e listas são separadas; alertas de origem/conteúdo continuam pendentes mesmo para remetentes conhecidos. Anexos permanecem na caixa original; a central exibe apenas seus nomes e tamanhos.

Para atualizar o servidor, pare a tarefa, preserve um backup, execute `git pull --ff-only` e `npm ci --omit=dev`, e inicie novamente. Os instaladores completos de início automático também instalam as dependências. Não ative a caixa apenas para conferir as telas: use a importação manual de `.eml` com dados de teste. [Instruções completas de configuração, uso e recuperação](docs/EMAIL-GOOGLE-WORKSPACE.md).

### Painel do Cliente em outra porta

Um único `npm start` inicia o sistema interno e o painel em duas portas, usando o mesmo banco. A porta interna atual é preservada. O painel utiliza `CLIENT_PORT=3001` por padrão e `CLIENT_HOST` opcional (herda `HOST`). As portas precisam ser diferentes e estar livres; se uma não puder abrir, o processo encerra com erro no log. `CLIENT_PORT=0` é reservado a testes com porta temporária.

O painel tem login e sessões independentes, tema claro, navegação própria, filtros e gráficos. Operador e cliente podem manter sessões simultâneas no mesmo navegador. Cookies e sessões são verificados para a entrada correspondente; trocar de porta não concede acesso ao outro sistema.

Em **Acessos de clientes**, o administrador encontra o endereço para entregar ao cliente. Para domínio/proxy HTTPS, defina `CLIENT_PUBLIC_URL` com a URL pública real, sem caminho; por exemplo, `https://clientes.suaempresa.com.br`. Sem essa variável, é sugerido o endereço HTTP do servidor com a porta dedicada. A variável apenas informa a URL: não configura DNS, certificado ou proxy. `CLIENT_COOKIE_SECURE` permite ajustar o cookie do painel separadamente; se ausente, herda `COOKIE_SECURE`.

**Windows Server já instalado:** atualize com `git pull --ff-only` e execute **liberar-painel-cliente.bat** como administrador. O BAT reinicia a tarefa `Servitec-Sistema`, quando existente, e libera apenas a porta 3001 para a rede local, sem regravar a tarefa ou mudar sua porta interna. Se a execução for manual, reinicie o processo antes de rodar o BAT. Para porta personalizada, ajuste `CLIENT_PORT` no ambiente da aplicação e configure a regra correspondente. O instalador completo de início automático também foi atualizado para as duas portas padrão.

Para acesso pela internet, configure domínio e HTTPS no proxy, encaminhando o painel para sua porta dedicada. O BAT de LAN não publica HTTPS. Consulte [configuração e diagnóstico do Painel do Cliente](docs/PAINEL-DO-CLIENTE.md).

### Portal de clientes: acesso somente à própria empresa

Como administrador, abra **Acessos de clientes** no menu principal e clique em **Novo acesso**. Informe nome, e-mail, senha e a empresa autorizada. Cadastre a empresa previamente em **Equipamentos → Nova empresa/token**, se necessário. É possível criar vários acessos para a mesma empresa.

O cliente entra pelo endereço dedicado do **Painel do Cliente**, na porta **3001** por padrão, com tela própria e visual claro. A porta do sistema interno continua sendo a configurada em `PORT` (padrão 3000). Contas de clientes não fazem login na entrada interna, e contas de operadores não fazem login no painel do cliente. Entregue as credenciais pelo seu canal habitual; o cadastro não envia mensagens automaticamente. Use esse menu para clientes: o perfil interno **Visualizador** continua destinado à equipe e não restringe os dados a uma empresa.

O painel apresenta **Visão geral** e **Meus chamados**, com totais por situação, gráficos de barras ou disco por mês, situação, modalidade e prioridade, filtros por período, situação e texto, detalhes e paginação de vinte chamados. A atualização automática ocorre a cada dez segundos enquanto a página está visível. O acesso permite apenas consulta e alteração da própria senha; não permite criar ou editar chamados, acessar equipamentos, usuários, configurações ou relatórios internos.

Cada acesso consulta exclusivamente os chamados vinculados à empresa escolhida, com validação no servidor em todas as consultas. Vincule os chamados à empresa no cadastro ou na lista interna: registros antigos sem empresa não aparecem no portal. Alterar filtros ou endereços manualmente não permite consultar outra empresa.

Em **Acessos de clientes → Editar / redefinir senha**, o administrador pode alterar a empresa, redefinir a senha ou desativar o acesso. Salvar uma alteração encerra as sessões desse cliente; ele precisa entrar novamente com os dados atuais. O perfil do portal é fixo e não recebe permissões internas pelo editor de perfis.

A atualização acrescenta os campos de tipo de conta e empresa ao cadastro de usuários, preservando os usuários internos existentes. Os acessos ficam no banco e são incluídos nos backups já disponíveis.

### Backup completo e agendado no servidor

Como administrador, abra **Configurações → Backups**. O agendamento inicia desativado. Informe uma pasta absoluta **no servidor**, fora da instalação e da pasta de dados; por exemplo, `D:\Backups\SERVITEC` se a aplicação estiver em `C:\Servitec\SISTEMA`. A pasta pode ser criada ao salvar. Para compartilhamento de rede, use um caminho UNC como `\\servidor-arquivos\backups\SERVITEC`; não dependa de uma unidade mapeada de outra sessão do Windows.

Configure a frequência **A cada hora**, **Diário** ou **Semanal**, o horário, o dia semanal, o fuso (por exemplo, `America/Sao_Paulo`) e a quantidade de cópias a manter, de 1 a 365. Na frequência por hora, considera-se o minuto do campo horário. Confirme sua senha para salvar. O sistema testa a gravação antes de persistir a configuração e informa a próxima execução. **Fazer backup completo agora** usa o destino salvo e também exige sua senha. O histórico apresenta conclusão, falhas e cópias removidas pela retenção.

A conta que executa a tarefa **Servitec-Sistema** precisa conseguir ler a instalação e gravar no destino. No Windows, configure a pasta com acesso apenas para administradores e a conta do serviço. Se a tarefa usa SYSTEM, o acesso a compartilhamentos depende das permissões da conta do computador na rede; use uma conta de serviço com acesso adequado quando necessário. A aplicação não armazena usuário/senha de compartilhamento nem altera as ACLs do Windows. A pasta contém dados e tokens; os backups não são criptografados pela aplicação.

O agendador roda dentro do processo Node.js e verifica a agenda a cada trinta segundos. Mantenha o sistema em execução pela tarefa automática já instalada. O estado persiste no banco: ao reiniciar com uma execução vencida, é feita uma cópia de recuperação, seguida da próxima data futura, sem reproduzir todas as execuções perdidas. Falhas são registradas e a tentativa seguinte segue a agenda. Cópias simultâneas são bloqueadas. Uma parada abrupta pode deixar uma pasta `.parcial-*`, que não é considerada um backup concluído.

Cada execução bem-sucedida cria uma pasta `servitec-vsa-AAAAMMDDTHHMMSSZ-identificador` com:

- `sistema/`: arquivos da aplicação e `data/sistema.db`, além dos demais arquivos regulares de dados. O banco é copiado consistentemente pela API de backup SQLite e verificado com `integrity_check`.
- `manifest.json`: lista de arquivos, tamanhos e hashes SHA-256 para conferência de integridade.
- `COMO-RESTAURAR.txt`: instruções de recuperação.

São excluídos `.git`, `node_modules`, diretórios de compilação `bin`/`obj`, logs e links simbólicos. A cópia não inclui o Windows, o executável do Node.js, credenciais de tarefas, certificados externos, proxy ou variáveis externas do servidor. Sessões de login são removidas, e o agendamento de backup e o recebimento de e-mails ficam **desativados no banco da cópia**, para revisão após a restauração. O banco original continua com sua configuração ativa. O download manual de banco em **Configurações → Sistema** também permanece disponível e desativa o agendamento apenas na cópia baixada.

A retenção só remove cópias concluídas e identificadas por este sistema na mesma pasta de destino, depois de concluir uma nova cópia. Arquivos de terceiros e cópias em destinos anteriores são preservados. Não há exclusão automática de cópias incompletas.

#### Restaurar uma cópia completa

1. Pare o processo e a tarefa **Servitec-Sistema** e preserve a instalação atual antes da substituição.
2. Copie o conteúdo de `sistema/` do backup para uma pasta nova. Use juntos o código e o banco dessa cópia; não misture WAL/SHM antigos com `data/sistema.db` restaurado.
3. Disponibilize Node.js 24 ou superior e execute `npm ci --omit=dev` na pasta restaurada. Se usar `DATA_DIR`, ajuste-o para a pasta `data` restaurada. Reconfigure HOST, PORT, HTTPS e a tarefa do Windows conforme seu ambiente.
4. Inicie o sistema, faça login novamente, confira os registros e revise o destino e a agenda antes de reativar os backups. A recuperação substitui os dados pelo momento da cópia.

A pasta restaurada não contém os metadados Git. Para retomar atualizações pelo GitHub, prepare um checkout do código correspondente e migre os dados com o sistema parado. A validação automatizada desta entrega criou backups, conferiu hashes, retenção e agenda vencida e iniciou uma instalação restaurada com login e chamados preservados. Acesso a discos/compartilhamentos e permissões da tarefa devem ser conferidos no seu Windows Server.

### Gestão de TI · versão 0.4.0

A versão inclui ficha de empresas e contratos com SLA por prioridade/calendário,
conversas e notas internas, anexos autenticados, apontamento de horas e custos,
solicitações opcionais pelo portal, respostas de e-mail por referência, fila SMTP
Gmail opt-in, alertas persistentes, preventivas, estimativa de rentabilidade,
integração de abertura do RustDesk com autorização, TOTP, cofre e conferência de backups.

Consulte o [guia de atualização e uso da versão 0.4.0](docs/melhorias-v0.4.0.md)
para configuração, permissões, implantação no Windows Server e limites das integrações.
O RustDesk e a conta real do Google Workspace precisam de configuração no servidor.

Na versão 0.4.1, contratos calculam a mensalidade por quantidades contratadas:
computador/notebook R$ 90,00 e servidor R$ 300,00 por mês, com preços negociados
por empresa e justificativa de complexidade. Valores fixos anteriores são preservados
até a conversão explícita. O inventário não altera a cobrança automaticamente.

Na versão 0.4.3, o agente oferece o aplicativo nativo **SERVITEC VSA — Abrir chamado**,
sem login, autorizado pela empresa configurada durante a instalação. A credencial do
aplicativo permite somente enviar solicitações daquela empresa. O portal continua
exigindo conta para consultas. Atualize o servidor e reinstale o novo agente nos PCs.
Veja o [guia do aplicativo](agents/windows/README.md#aplicativo-de-atendimento-sem-login-e-atalhos--versão-043).
