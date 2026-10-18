# SERVITEC VSA · melhorias de gestão de TI · versão 0.4.0

## Atualizar o Windows Server

1. Faça um backup completo na versão em uso e preserve a pasta `data`.
2. Pare a tarefa `Servitec-Sistema` e qualquer `npm start` manual.
3. Na pasta do projeto, execute `git pull --ff-only origin main` e `npm ci` com Node.js 24 ou superior.
4. Inicie novamente a tarefa. As migrações são aditivas: preservam contas, empresas, chamados e inventário.
5. Entre com o administrador, confira as novas permissões e configure cada contrato. A instalação existente não é atualizada automaticamente pelo GitHub.

Os dois painéis continuam nas suas portas atuais. O HTTPS e o firewall continuam sendo configurados no servidor. A atualização não instala o RustDesk nem altera o serviço do agente de telemetria.

## Empresas e contratos

No menu **Empresas e contratos**, selecione uma empresa já criada em **Equipamentos → Nova empresa / token**. A ficha reúne contatos, unidades, responsável técnico, referências de documentação, equipamentos e chamados.

Para editar a ficha e o contrato, é necessária a permissão **Gerenciar contratos, SLA e preventivas**. A consulta exige acesso aos chamados. Valores do contrato são apresentados somente a quem gerencia contratos; a rentabilidade tem permissão própria. Guarde senhas no **Cofre**, em vez das observações técnicas.

Na atualização 0.4.1, a mensalidade é calculada pelas quantidades contratadas: **computador R$ 90,00/mês, notebook R$ 90,00/mês e servidor R$ 300,00/mês**. Os preços unitários podem ser ajustados por empresa, com justificativa da complexidade ou condição negociada quando diferirem do padrão. O total é calculado no servidor em centavos e aparece discriminado na rentabilidade. As quantidades são informadas no contrato e não mudam automaticamente com os agentes do inventário. Contratos anteriores com mensalidade fixa são preservados até a escolha explícita do modelo por equipamentos.

Exemplo: 10 computadores + 5 notebooks + 2 servidores = R$ 1.950,00/mês. Se esses servidores forem negociados a R$ 450,00 pela complexidade, o total será R$ 2.250,00/mês.

Configure também horas previstas para acompanhamento (opcional), custo interno da hora e metas de primeira resposta e solução para cada prioridade, em minutos. Escolha atendimento 24x7 ou de segunda a sexta, com fuso horário e hora inicial/final. O calendário útil não desconta feriados específicos nem possui pausa por status.

Ativar SLA afeta novos chamados, inclusive por e-mail, portal e preventivas. Cada chamado preserva uma cópia das metas vigentes; mudar o contrato não reescreve prazos anteriores. A primeira resposta é marcada ao iniciar atendimento, resolver ou enviar mensagem pública como operador. Resolver registra a conclusão; reabrir mantém os prazos originais. Chamados antigos permanecem sem SLA. Trocar de empresa recalcula o SLA, mas a troca é recusada quando há conversa, anexos ou horas para preservar o histórico entre empresas.

Os chamados mostram a situação do SLA e o menu **Alertas** reúne prazos vencidos de chamados ainda ativos. Não são enviados alertas externos automaticamente.

## Histórico, conversa, anexos e horas

Em **Chamados**, clique em **Histórico, conversa e horas**. Os novos eventos registram criação, mudanças, autor e data. Eventos anteriores à atualização não são inventados retroativamente.

- **Nota interna**: aparece somente no sistema interno.
- **Mensagem para o cliente**: aparece no portal da empresa e pode gerar e-mail quando o SMTP estiver ativado.
- **Anexos**: até 512 KB por arquivo e 20 MB por chamado. A visibilidade é escolhida pelo operador; anexos enviados pelo cliente são públicos para sua empresa. O download exige autenticação e autorização.
- **Trabalho**: informe data, minutos, descrição e despesas ou deslocamento. O custo da hora é copiado do contrato vigente no momento do registro; alterar o contrato não muda o custo já registrado. Os registros são cumulativos, sem edição nesta versão.

Datas dos registros e agendas de preventivas usam UTC; os prazos do SLA consideram o fuso contratado. Os anexos MIME recebidos pelo Gmail continuam na caixa original; apenas seus nomes e tamanhos são importados.

## Portal com abertura de solicitações

Em **Acessos de clientes**, marque **Permitir abrir chamados e responder mensagens** para cada pessoa autorizada. Os acessos existentes continuam somente de consulta até a liberação explícita. Alterar o cadastro encerra as sessões daquele cliente.

O cliente usa **Abrir solicitação**, descreve o problema e acompanha a conversa e os arquivos públicos da própria empresa. O sistema fixa a empresa da conta e a prioridade inicial como Média. Ele não pode atribuir operador, alterar status, registrar horas, consultar custos ou acessar outra empresa. Contas somente de consulta também podem ler as conversas públicas, mas não enviar mensagens ou arquivos.

## Gmail e conversas por e-mail

A aprovação de remetentes continua na **Central de e-mails**. Respostas com cabeçalhos `In-Reply-To` ou `References` são vinculadas a um chamado existente somente quando o remetente está aprovado para a mesma empresa. A referência deve apontar a uma mensagem recebida ou enviada que pertence àquele chamado; o número no assunto, sozinho, não é usado para vincular.

Em **Configurações → E-mail**, existe a opção separada **Enviar confirmações e mensagens públicas por Gmail SMTP**, desativada por padrão. Usa a conta e a senha de app já cadastradas, com TLS em `smtp.gmail.com:465`. A política do Workspace precisa permitir esse acesso. Não há OAuth nesta versão.

São enfileiradas confirmações de novos chamados de remetentes aprovados/solicitantes autenticados e mensagens públicas de operadores. Notas internas não são enviadas. Antes de enviar, a fila revalida empresa e destinatário. Consultas de SMTP são feitas a cada 15 segundos com a aplicação ligada. A configuração mostra a fila e seus estados. Uma falha ambígua fica como `uncertain`; uma interrupção durante envio pode deixar `sending`. Não há reenvio automático desses estados: confira a pasta Enviados para evitar duplicação e envie manualmente se necessário. Desativar SMTP pausa os itens ainda pendentes; reativá-lo retoma a fila. As cópias de backup cancelam itens pendentes e desativam o envio.

As verificações automatizadas usam um transporte simulado: nenhum e-mail real foi enviado durante os testes. É necessário validar a conta real no servidor.

## Alertas e preventivas

**Alertas** mantém um único incidente ativo por equipamento e tipo. Ausência de comunicação precisa ultrapassar 5 minutos; CPU, RAM ou disco precisam ficar acima de 90% por pelo menos 2 minutos observados nos ciclos de verificação. A verificação ocorre a cada minuto. Cadastros que nunca se conectaram não geram alerta de indisponibilidade. Normalizar resolve o incidente; reconhecer registra o operador. Os alertas não abrem chamados automaticamente.

Em **Preventivas**, crie uma atividade por empresa, intervalo de 1 a 366 dias e próxima data. Cada ocorrência abre um chamado de prioridade Baixa. Uma restrição única impede repetir a mesma ocorrência entre processos. Após uma parada, uma ocorrência vencida é aberta; a próxima é agendada a partir da data atual para evitar uma enxurrada de chamados antigos. É possível pausar cada plano.

O administrador pode pausar ou retomar todas as automações de alertas e preventivas. Essa opção vem pausada nas cópias restauradas e deve ser revista após a recuperação.

## Rentabilidade

A permissão **Consultar rentabilidade e custos** libera o menu. Selecione o mês do trabalho e compare por empresa: mensalidade calculada pelas quantidades e preços atuais do contrato (ou valor fixo anterior), composição por tipo, horas registradas/previstas, custo das horas, despesas e margem estimada.

A margem é mensalidade menos custos registrados. Não inclui impostos, faturamento efetivo, descontos, pró-rata, contas a receber nem um histórico contábil de mensalidades. Mudar a mensalidade muda a referência de receita exibida para qualquer mês; custos de trabalho permanecem com o valor da hora salvo no lançamento. Use esta visão como estimativa operacional.

## Acesso remoto

A integração inicial usa **RustDesk**. Instale e configure o aplicativo no computador do operador e no equipamento do cliente. Para produção, configure o servidor RustDesk e suas chaves com o responsável pela infraestrutura.

No menu **Acesso remoto**, quem tem a permissão específica informa equipamento, ID RustDesk numérico, motivo e autorização do responsável. O sistema registra a solicitação e oferece um link para abrir o aplicativo instalado. A aprovação no equipamento remoto e a segurança da conexão são controladas pelo RustDesk.

O registro indica uma solicitação autorizada, sem confirmar que houve conexão, sem medir duração real e sem gravar a tela. O agente SERVITEC continua coletando telemetria; não passa a controlar a máquina por causa desta atualização. O RustDesk não é instalado automaticamente.

## Segurança e cofre

**Segurança da conta** permite ativar TOTP com Google Authenticator ou Microsoft Authenticator. Informe sua senha, adicione a chave manualmente ao autenticador e confirme um código. Guarde os oito códigos de recuperação fora do sistema; cada um funciona uma vez e só é exibido na ativação. As sessões são encerradas ao ativar ou desativar o segundo fator. Depois do login, um mesmo código TOTP não pode ser reutilizado; espere o próximo código para operações sensíveis.

O login limita tentativas por endereço de origem e e-mail durante 15 minutos. Operações sensíveis também têm limitação. O sistema não confia em `X-Forwarded-For`; atrás de um proxy, o endereço observado será o do proxy. O HTTPS é necessário na exposição pública.

O **Cofre** exige permissão própria, inicialmente disponível somente ao administrador. Guarde credenciais por empresa. Revelar exige senha e segundo fator quando ativado, registra auditoria e oculta o segredo da tela após 60 segundos. Não há cópia automática para a área de transferência.

TOTP e cofre usam AES-256-GCM com chave local `data/security.key`. A chave precisa acompanhar o banco no backup completo; não a publique no GitHub. Perder a chave impede decifrar esses registros. As permissões do Windows sobre a pasta de dados e de backups devem limitar o acesso às contas responsáveis pelo serviço.

## Backups e recuperação

Em **Configurações → Backups**, o histórico apresenta o número de cada cópia. Use **Verificar arquivos e banco**, informando número e senha, para comparar SHA-256/tamanho dos arquivos e executar `PRAGMA integrity_check` no banco da cópia. A verificação é somente de integridade: não inicia uma instalação restaurada.

As cópias incluem anexos armazenados no banco e as chaves locais. Sessões são removidas, SMTP/recebimento são desativados, envios pendentes são cancelados e automações de alertas/preventivas ficam pausadas. A restauração exige `npm ci`, pois `node_modules` não faz parte da cópia.

Para um ensaio operacional, restaure em outra pasta e portas livres, mantenha a instalação isolada, instale dependências e confira login, empresas, chamados e anexos. A suíte de testes inicia uma cópia restaurada com dados de teste; a rotina de integridade não substitui o ensaio no seu Windows Server. Nenhuma restauração foi executada no seu servidor real.

## Aplicativo de atendimento sem login · atualização 0.4.3

O instalador cria **SERVITEC VSA — Abrir chamado** na Área de Trabalho e no menu
Iniciar. O aplicativo agora usa uma janela nativa e a autorização do token da empresa
informado na instalação; não exige navegador, conta do portal ou senha do usuário.

O instalador obtém uma autorização exclusiva por computador, apenas para criar
chamados, protegida no Windows por DPAPI. O token da empresa fica restrito ao
serviço. Nome e contato são declarados pelo solicitante, sem autenticação pessoal;
o sistema identifica essa origem no chamado. Não são usados para vincular remetentes
nem enviar e-mails automaticamente. A empresa e a prioridade são definidas pelo servidor.

Não há acesso a histórico, gráficos ou outras informações por essa autorização.
O portal mantém suas contas e permissões para consultas. Em Equipamentos, consulte
ou revogue os aplicativos autorizados. Renovar o token da empresa também invalida as
autorizações anteriores. Há proteção contra reenvio duplicado e limite de dez chamados
por hora por dispositivo. Sem rede, o aplicativo informa a falha e permite repetir o envio.

Atualize primeiro a plataforma e depois execute novamente o novo instalador nos PCs.
Na instalação, ENTER inclui o aplicativo; N instala somente o monitoramento. O piloto
nativo no Windows ainda é necessário; os testes de API e compilação foram executados.
