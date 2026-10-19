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

Vulnerabilidades, antivírus, atualização do sistema e SNMP ainda não são coletados pelo agente atual; a interface informa essa ausência. Não interpreta falta de dados como ausência de vulnerabilidades. CPU/RAM/disco ficam cinza quando a amostra é antiga ou ausente. O contador de tickets considera apenas tickets vinculados explicitamente ao equipamento.

As ferramentas anteriores de empresas, tokens, duplicidades e aplicativos autorizados permanecem no bloco expansível acima da tabela. **Ver** abre a telemetria existente; não executa comandos nem força coleta na máquina.

## Atualização no servidor

Antes de atualizar, use o backup completo do sistema ou uma cópia consistente com o processo parado. Preserve a pasta `DATA_DIR`, o banco SQLite e as chaves locais, incluindo `security.key` e a chave do e-mail se existente. Atualize somente o código e dependências e reinicie o processo. Não substitua a pasta de dados por dados de demonstração.

Esta versão cria tabelas complementares e índices com `IF NOT EXISTS`; não apaga nem recria registros antigos e não redefine senhas ou tokens. SLA novo usa o calendário salvo na abertura do ticket; tickets anteriores mantêm o snapshot e seus prazos.
