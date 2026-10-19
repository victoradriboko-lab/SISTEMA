# Ficha do cliente e inventário

Em **Cadastros → Clientes**, clique no nome ou em **Abrir**. Ao criar uma empresa, a ficha abre automaticamente. O cadastro inicial exige apenas o nome; preencha as demais seções quando necessário. Empresas existentes usam a mesma ficha, sem duplicação de cadastro.

A navegação da ficha reúne Dados, Equipes, Unidades, Contrato, Tickets programados, Alertas, Usuários do portal, Setores solicitantes, Grupos de categorias, Contatos, E-mail/domínio, Relatórios e Expediente.

- **Token:** é gerado uma única vez no cadastro da empresa, é exclusivo e aparece na listagem e na ficha para quem tem permissão de cadastrar equipamentos. Copiar ou abrir a ficha não altera o token. A renovação continua separada, com senha atual e aviso de invalidação dos agentes antigos. Exportações CSV não incluem tokens.
- **Dados:** razão social, nome fantasia, tipo, país, CNPJ/CPF, inscrição estadual, matriz, site, idioma, fuso, contatos e observações. As informações antigas de unidades e documentação continuam disponíveis. O nome identificador da conta é preservado.
- **Equipes:** vincule equipes já cadastradas em Cadastros → Equipes de Operadores. O vínculo não concede novas permissões a seus membros.
- **Unidades, contatos e categorias:** cadastros individuais por empresa; tornam-se sugestões na classificação dos tickets dessa empresa. Desativar preserva o histórico e retira a sugestão de novos preenchimentos.
- **Contrato:** reutiliza o contrato e o cálculo de cobrança anteriores. Alterar a ficha não redefine o contrato. Salvar contrato não apaga campos cadastrais novos ou antigos.
- **Tickets programados:** usam os planos e o agendador de preventivas existentes, com recorrência em dias e datas UTC. Geração depende de automações ativas. Pausar preserva planos e tickets já gerados.
- **Alertas:** limites de CPU, memória e disco e minutos sem comunicação por cliente; vazio herda os padrões existentes (90% e 5 minutos). Os limites são usados no próximo ciclo do serviço de alertas; a cor do indicador de uso instantâneo no inventário mantém a referência visual de 90%.
- **Portal:** criação e edição apenas por administrador, com empresa fixada na ficha. Login com e-mail e senha de pelo menos 8 caracteres. Senha vazia na edição mantém a anterior. Não há envio automático de senha por e-mail.
- **Setores:** reutilizam os registros de Cadastros → Setores dos Solicitantes.
- **E-mail/domínio:** registra referências da conta, sem autorizar automaticamente remetentes de um domínio. A autorização de remetentes permanece individual na Central de e-mails.
- **Relatórios:** totais e exportação CSV dos tickets exclusivos da conta.
- **Expediente:** calendário personalizado ou baseado em expediente já cadastrado, fuso horário, dias, horas e feriados (asterisco para recorrência anual). A inclusão dos feriados cadastrados é explícita. Calendário 24x7 não interrompe em feriados. O contrato guarda uma cópia do calendário: alterações posteriores no cadastro global não mudam contratos nem prazos antigos automaticamente.

## Inventário → Equipamentos

A tabela compacta apresenta status, uptime, cliente, nome, IP/MAC quando coletados, responsável, sistema, alertas ativos, CPU/RAM/disco, tickets vinculados, grupo, perfil e última comunicação. Filtros de cliente, busca, status, grupo, perfil e local podem ser combinados. A página mostra 10 equipamentos; sem filtro de cliente, inclui todas as empresas. Exportar inclui os resultados filtrados, sem tokens.

**Atualizar em massa** permite alterar apenas os campos marcados: responsável, grupo, perfil e home office. Selecione até 100 equipamentos. A operação valida o lote completo antes de gravar, preservando tokens, empresa, inventário e métricas. Grupo/perfil são rótulos de organização e não alteram permissões. Não há exclusão de dispositivos nesta atualização.

Vulnerabilidades, atualização do sistema e SNMP ainda não são coletados; a interface informa essa ausência. Antivírus exige o agente 1.2 e um provedor compatível no Windows. Não interpreta falta de dados como ausência de vulnerabilidades. CPU/RAM/disco ficam cinza quando a amostra é antiga ou ausente. O contador de tickets considera apenas tickets vinculados explicitamente ao equipamento.

As ferramentas anteriores de empresas, tokens, duplicidades e aplicativos autorizados permanecem no bloco expansível acima da tabela. **Ver** abre a telemetria existente; não executa comandos nem força coleta na máquina.

## Atualização no servidor

Antes de atualizar, use o backup completo do sistema ou uma cópia consistente com o processo parado. Preserve a pasta `DATA_DIR`, o banco SQLite e as chaves locais, incluindo `security.key` e a chave do e-mail se existente. Atualize somente o código e dependências e reinicie o processo. Não substitua a pasta de dados por dados de demonstração.

Esta versão cria tabelas complementares e índices com `IF NOT EXISTS`; não apaga nem recria registros antigos e não redefine senhas ou tokens. SLA novo usa o calendário salvo na abertura do ticket; tickets anteriores mantêm o snapshot e seus prazos.

## Ficha detalhada de cada equipamento

No inventário, clique no nome ou em **Ver**. A ficha reúne dados gerais e 18 seções: telemetria, alterações, periféricos, armazenamento, overview, alertas, contas, software, redes, serviços, vídeo, perfil, remoto, tickets, senhas, documentos, fotos e vulnerabilidades.

O agente Windows 1.2 coleta placa-mãe, RAM por slot, periféricos, vídeo, discos físicos, usuário logado, build do Windows e estado do Defender quando o provedor estiver disponível, além da coleta anterior. Dados indisponíveis aparecem como não coletados; ausência de estado do Defender não é interpretada como antivírus desligado. Informações do produto antivírus de terceiros são reportadas sem presumir seu estado. Os programas não são comparados a um catálogo de versões e não são instalados remotamente. Temperatura, erros SMART, scanner CVE, contas locais e senhas do Windows não são coletados.

A ficha distingue campos manuais dos campos recebidos do agente. Apelido, unidade, patrimônio, compra, garantia, observações, localização e ID RustDesk podem ser preenchidos manualmente sem substituir dados coletados. IP externo e coordenadas não são obtidos automaticamente. O mapa usa apenas coordenadas informadas. As alterações de inventário são registradas a partir desta versão, sem reconstruir histórico inexistente; a tela mostra até 200 alterações dos últimos 30 dias. O histórico armazenado permanece no banco.

As listas têm pesquisa e paginação. Os gráficos usam amostras recebidas; o painel mostra até 25 leituras recentes, e a API conserva o histórico recente de até 120. Amostras antigas enviadas após uma queda não fazem o equipamento aparecer como online. A retenção da telemetria continua em até 48 horas.

Tickets criados na ficha ficam vinculados ao equipamento e à sua empresa. **Reconhecer alerta** registra ciência, sem forçar uma resolução falsa. O serviço resolve o alerta quando a condição deixa de ocorrer. O acesso remoto continua exigindo autorização explícita, RustDesk e a permissão existente.

Documentos e fotos ficam vinculados ao equipamento no SQLite, com limite de 512 KB por arquivo e 20 MB por equipamento. Fotos aceitam PNG, JPEG e WebP, com conferência da assinatura do arquivo. Credenciais são vinculadas ao cofre criptografado da mesma empresa; a listagem não retorna segredos. A revelação exige a autenticação já usada pelo cofre e o código de segundo fator, se habilitado. A tela oculta o segredo após 30 segundos.

### Equipamento de teste

Administradores podem usar **Inventário → Equipamentos → Equipamento de teste**. Essa ação explícita cria uma empresa separada e o equipamento **NOTE-DEMO-SERVITEC**, identificados como demonstração. Dados e gráficos são simulados. A atualização do código nunca cria equipamentos de exemplo automaticamente.

Clicar novamente reutiliza a demonstração existente. **Simular nova leitura** atualiza somente esse equipamento. Equipamentos reais recusam a operação. Sem simular novamente, a última comunicação envelhece normalmente; a demonstração não simula conexão permanente. Ela aparece na listagem e nos totais da empresa demonstrativa, sem se misturar aos dados de outra empresa.

### Atualizar o agente

Atualize o código do servidor primeiro. Baixe o instalador atual em Download de Agentes e reinstale nos equipamentos para receber os novos campos. Agentes antigos continuam aceitos e não apagam campos ampliados anteriores apenas por omiti-los. A coleta completa acontece periodicamente (até seis horas); métricas continuam a cada 30 segundos.

Os instaladores vêm configurados para `https://vsuarez.ddns.net:3000` (padrão) ou, quando escolhido explicitamente, `http://vsuarez.ddns.net:3000`. Só é necessário informar o token. HTTP transmite os dados sem criptografia. Não há fallback automático de HTTPS para HTTP. O instalador solicita o token logo após validar a URL e depois testa a API, com limite de 45 segundos e até duas tentativas para falhas transitórias; rejeita redirecionamentos e continua validando certificados. Publicar o código não configura o roteador, NAT, DNS, firewall ou proxy reverso: HTTP/3000 e HTTPS/3000 precisam encaminhar à porta interna correta (3000, não ao portal 3001).

[Prévia da ficha com equipamento demonstrativo e dados simulados](imagens/equipamento-demo.png).

Os dois instaladores usam agora a porta 3000, mas mantêm seus protocolos distintos. O servidor Node padrão atende HTTP nessa porta: nesse caso use o instalador HTTP. Usar HTTPS na mesma porta exige terminação TLS configurada; a liberação da porta no firewall não adiciona HTTPS.

### Substituição autorizada dos tokens longos de empresa

Por solicitação explícita do proprietário, que informou não haver agentes ativos, esta atualização troca os tokens de empresa com mais de 10 caracteres por valores únicos de 10 letras e números na primeira inicialização do servidor. Tokens antigos ficam inválidos. Clientes, usuários, equipamentos, senhas e históricos permanecem intactos. A migração é transacional e idempotente: os tokens curtos não mudam nos reinícios seguintes. Novos cadastros, importações e renovações usam o mesmo formato curto. Use o instalador/agente 1.2.1 e copie o token exatamente, respeitando maiúsculas e minúsculas. A troca não encurta senhas, hashes, chaves internas do aplicativo ou tokens individuais antigos dos equipamentos.

### Diagnóstico de amostras rejeitadas

O servidor aceita valores sentinela numéricos de contadores WMI opcionais como desconhecidos (nulos), sem rejeitar o restante da coleta. Valores malformados e métricas de uso fora dos limites continuam sendo recusados. Em Configurações → Atividades, a ação `agent.sample.rejected` mostra o motivo da rejeição.

O agente 1.2.2 registra o detalhe JSON do erro sem exibir o token e registra `Primeira coleta aceita pelo servidor. Cadastro e comunicacao confirmados.` quando a API confirmar a coleta. O log fica em `C:\ProgramData\ServitecAgent\agent.log`.

### Falha ao parar o serviço durante reinstalação

O instalador 1.2.3 trata serviço já parado, inicializando, parando ou sem resposta. A recuperação de um serviço travado verifica o processo específico e seu caminho antes de encerrá-lo. Processos divergentes são preservados e a atualização é interrompida. Reinstalações conservam o identificador da máquina e não apagam a fila de amostras pendentes.


## Portal do cliente: computadores da empresa

A navegação do portal agora inclui **Computadores da empresa**. A listagem é de consulta, com busca, filtro de comunicação, paginação de 20 itens e atualização a cada 10 segundos. Mostra nome, código, responsável, sistema operacional e última comunicação. O servidor fixa a empresa pelo vínculo da sessão: não aceita consultar outra empresa e não retorna tokens, inventário bruto, cofre nem ações administrativas. Equipamentos sem empresa não aparecem no portal.

A identidade Servitec T.I. usa o logo oficial em menu, telas de entrada, cabeçalho do portal e rodapés. A imagem padrão vem de `https://www.servitecbrasil.com.br/logo.svg`; portanto depende de acesso ao site no navegador. Se não carregar, aparece o nome em texto. Um logotipo já salvo em Configurações → Dados da empresa tem prioridade e é servido localmente, sem substituir a configuração existente. Nenhum dado ou token é alterado por esta atualização.

Validação: testes de isolamento entre empresas, filtros, paginação, recusa de alterações e revogação de sessão após troca do vínculo, além de navegação em computador e celular. O teste de navegador simula indisponibilidade do logo remoto; não confirma o download do SVG em produção.

## Excluir equipamentos sem apagar o histórico

Em **Inventário → Equipamentos**, marque um ou mais equipamentos e clique em **Excluir selecionados**. Após confirmar, os equipamentos saem da categoria Ativos e passam para **Excluídos**, sempre como offline e somente para consulta. Na categoria Excluídos, selecione registros e use **Restaurar selecionados** para recolocá-los em Ativos. É possível operar até 100 registros por vez.

O arquivamento guarda data e operador na tabela aditiva `asset_archive`. Não altera o cadastro original, token, vínculo com a empresa, identificação da máquina, métricas anteriores, documentos ou tickets. As comunicações posteriores do agente são ignoradas enquanto o equipamento estiver excluído; o vínculo permanece para impedir novo cadastro automático da mesma instalação. Ao restaurar, a coleta pode voltar a atualizar o cadastro original.

Equipamentos excluídos ficam fora do monitoramento ativo, do painel principal e da listagem do portal do cliente. Não geram novos alertas automáticos. A ficha interna continua disponível com indicação de equipamento excluído, offline e com dados históricos. Edição nessa ficha e atualização em massa exigem restaurar primeiro. Histórico e contratos existentes são preservados.

Validação: 47 testes passaram, incluindo migração aditiva repetida, preservação integral dos registros, isolamento do portal, recusa de lotes inválidos sem alterações parciais, coleta ignorada sem criar duplicados, persistência após reinício e restauração. O fluxo de seleção, confirmação/cancelamento, consulta e restauração foi verificado no navegador, incluindo tela móvel.

Atualização do servidor: faça uma cópia consistente do banco, preserve `DATA_DIR` e a chave de segurança existente, atualize somente o código e reinicie o processo. Nenhum registro anterior é arquivado automaticamente; isso ocorre apenas por seleção explícita na interface. Esta mudança não exige reinstalar o agente.
