# Central de e-mails — Gmail e Google Workspace

## Fluxo de atendimento

1. Um cliente envia uma solicitação à caixa de atendimento cadastrada no sistema.
2. Se o endereço ainda não tem autorização, a mensagem aparece em **Central de e-mails → Aguardando aprovação**, sem gerar chamado.
3. Um operador revisa a mensagem, escolhe a empresa correspondente e clica em **Aprovar e abrir chamado**.
4. Se **Memorizar este remetente para os próximos chamados** estiver marcado, os próximos e-mails desse endereço exato abrem chamados para a empresa escolhida. Não há autorização automática de todo o domínio.
5. Os chamados ficam **Abertos**, com prioridade **Média**, sem operador e modalidade definidos. A equipe assume e classifica o atendimento pela tela de Chamados. O portal do cliente passa a exibi-los porque possuem o vínculo da empresa.

O vínculo identifica a empresa para atendimento, não autentica a pessoa e não cria uma conta no Painel do Cliente. Confira a origem antes de aprovar. E-mails sinalizados pelos cabeçalhos recebidos, como DMARC fail/spam, e conteúdo HTML que não pôde ser convertido continuam exigindo revisão, mesmo com remetente autorizado. Essa triagem não substitui os controles antispam e autenticação de domínio do Google Workspace.

## Preparar o servidor

Use Node.js 24 ou superior. Esta entrega adiciona dependências npm para IMAP e interpretação de MIME. Antes de reiniciar uma instalação atualizada, execute `npm ci --omit=dev` na pasta do projeto. Não é necessário instalar nada nas estações monitoradas para receber e-mails.

Exemplo de atualização no PowerShell como administrador:

```powershell
cd C:\Servitec\SISTEMA
Stop-ScheduledTask -TaskName 'Servitec-Sistema'
# Preserve uma cópia anterior da instalação e dos dados com o processo parado.
git pull --ff-only
# Continue somente se o Pull concluir sem erros.
npm ci --omit=dev
# Continue somente se a instalação concluir sem erros.
Start-ScheduledTask -TaskName 'Servitec-Sistema'
```

O instalador completo de início automático executa a instalação das dependências quando encontra `package-lock.json`. O servidor precisa acessar o registro npm durante a instalação e `imap.gmail.com:993` durante a coleta. Não há porta de entrada adicional para receber: a conexão IMAP parte do servidor para o Google. As portas interna e do Painel do Cliente continuam separadas.

## Preparar a conta Google Workspace

Use uma conta dedicada de atendimento, por exemplo `suporte@suaempresa.com.br`. Um Grupo do Google ou um alias não possui senha própria de IMAP: informe a conta real que recebe as mensagens.

- Habilite a verificação em duas etapas da Conta Google.
- Se a política da sua organização permitir, gere uma senha de app em [Senhas de app da Conta Google](https://myaccount.google.com/apppasswords).
- O administrador do Workspace precisa permitir acesso IMAP e uso de senhas de app para essa conta. Políticas de segurança, chaves físicas obrigatórias e proteções da conta podem impedir esse método.
- Não utilize a senha normal do Google. Esta versão utiliza IMAP com senha de app; ainda não implementa autorização OAuth do Google. Se a organização exigir OAuth e proibir senhas de app, essa conexão não pode ser ativada com o método atual.

A aplicação usa TLS com validação de certificado e exige TLS 1.2 ou superior. Não há opção para desabilitar a validação. Em redes com inspeção TLS, configure certificados confiáveis para o processo Node.js conforme a política da empresa.

## Cadastrar e testar a caixa

Como administrador, entre em **Configurações → E-mail**:

1. Informe o endereço da caixa, a senha de app e o intervalo, de 60 a 3.600 segundos.
2. Salve inicialmente com **Ativar recebimento automático** desmarcado, confirmando sua senha de administrador do sistema.
3. Clique em **Testar conexão salva**, informando novamente sua senha de administrador. O teste abre a INBOX somente para leitura e não importa mensagens.
4. Ative o recebimento e salve. A ativação também testa a conexão; se falhar, a alteração não é aplicada.
5. Envie uma nova solicitação de teste de outro endereço e confira a central depois do intervalo. A credencial real deve ser digitada na plataforma, não em mensagens de chat ou no GitHub.

Na primeira ativação ou ao trocar a caixa, a coleta começa depois do ponto atual da INBOX; o acervo antigo não é importado automaticamente. Pausar e reativar a mesma caixa preserva o último UID recebido e recupera as mensagens que chegaram durante a pausa. Reiniciar o servidor com a coleta já ativa também retoma o cursor.

A opção **Reiniciar o ponto de coleta a partir de agora** define um novo ponto inicial e ignora os e-mails ainda não importados. Use-a somente quando essa for a intenção. Se a identificação IMAP da caixa mudar, a coleta é desativada e exige essa revisão explícita. Trocar a empresa de um remetente não altera o cursor da caixa.

Deixar a senha de app vazia ao editar conserva a credencial, desde que o endereço seja o mesmo. Trocar o endereço exige uma nova credencial para ativar. Para remover a senha salva, desative a coleta e marque a opção de remoção.

## Aprovação e vínculos por empresa

Em **Central de e-mails → Aguardando aprovação**, clique em **Revisar e liberar**. Consulte remetente, assunto, texto, nomes dos anexos, alertas e vínculos existentes.

- Escolha a empresa responsável pelo atendimento.
- Mantenha **Memorizar este remetente** marcado para autorizar os próximos e-mails.
- Desmarque essa opção para liberar somente a solicitação atual.
- Marque **Liberar também os outros e-mails pendentes sem alerta deste endereço** somente se quiser liberar o lote apresentado. A opção começa desmarcada. Outras mensagens sinalizadas continuam na fila.
- Clique em **Aprovar e abrir chamado**. O histórico registra os chamados gerados, a empresa e o operador responsável pela liberação.

Em **Remetentes e vínculos**, também é possível cadastrar endereços antecipadamente, corrigir a empresa ou bloquear o remetente. A mudança vale para futuras mensagens; não move chamados já existentes nem libera pendências sem revisão. Vários e-mails podem apontar para a mesma empresa. Cada endereço corresponde a uma única empresa no vínculo atual.

## Rejeição, bloqueio e consulta

**Rejeitar e manter no histórico** exige motivo e trata apenas aquela mensagem. Não exclui o e-mail no Gmail nem bloqueia futuras mensagens automaticamente.

**Bloquear remetente para próximos e-mails** abre o cadastro com situação Bloqueado. Confirme para impedir geração automática de chamados por esse endereço. Novas mensagens ficam em **Bloqueados**. Pendências anteriores e chamados existentes permanecem no histórico.

A central oferece pesquisa, abas por situação e paginação de vinte registros. A lista e os indicadores são consultados a cada dez segundos enquanto a página está visível. A tela de revisão não é substituída durante a seleção da empresa. **Buscar novos e-mails** executa a coleta imediatamente usando a configuração salva.

## Importar uma mensagem antiga ou testar o fluxo

No Gmail, baixe a mensagem original em formato `.eml`. Na central, expanda **Importar um e-mail manualmente (.eml)**, selecione o arquivo e importe. O limite desse upload é 512 KB. A importação utiliza o mesmo fluxo de aprovação e vínculos da coleta automática; um remetente já autorizado pode gerar chamado imediatamente.

Importar novamente o mesmo conteúdo não gera outro registro. Use dados fictícios para treinamento. A importação não marca, apaga nem envia mensagens pelo Gmail.

## Limites desta entrega

- Uma caixa Gmail/Workspace por instalação, com leitura da **INBOX**, sem monitorar Spam, Lixeira ou todas as etiquetas.
- Cada e-mail aceito gera um chamado, exceto duplicados. Não há agrupamento automático de respostas em uma conversa já aberta. Uma resposta normal ao atendimento pode, portanto, gerar outro chamado.
- Respostas automáticas identificadas, listas e mensagens da própria caixa do sistema são separadas em **Automáticos / ignorados**. E-mails acima de 5 MB não são importados integralmente e recebem um registro de limite para consulta à caixa original.
- São examinadas até cinquenta mensagens novas por rodada, com retomada por UID e deduplicação por conteúdo. Falhas preservam o último ponto confirmado e são exibidas na configuração e na central.
- Texto completo limitado a 80 mil caracteres na central; a descrição do chamado é resumida ao limite de 5 mil caracteres. HTML é convertido em texto e não é executado na plataforma.
- São mostrados nomes e tamanhos de até trinta anexos; os arquivos ficam no Gmail. A aplicação não os copia para chamados ou para o portal.
- Não há envio SMTP, confirmação automática, resposta ao remetente, atualização de chamados por resposta ou recuperação de senha por e-mail nesta entrega.

## Permissões e proteção das credenciais

Somente administradores configuram, testam ou removem a credencial da caixa, confirmando a própria senha. A permissão interna **Visualizar chamados** permite consultar a central; a permissão de criar/alterar chamados também permite importar, aprovar, rejeitar e gerenciar remetentes. Perfis de consulta não recebem ações de escrita. Contas do Painel do Cliente não acessam a fila, a configuração ou os vínculos dos remetentes.

A senha de app é criptografada com AES-256-GCM. A chave fica em `DATA_DIR/email-secret.key`, fora dos arquivos públicos e do Git. A API nunca devolve a senha nem sua versão criptografada. A configuração, os vínculos e as ações são auditados sem registrar a senha.

Restrinja a pasta de dados e o destino dos backups à conta do serviço e aos administradores. A criptografia não substitui as permissões do Windows: quem tiver o banco e a chave poderá recuperar a credencial. Não mova apenas a chave ou apenas o banco para outra instalação sem seguir a recuperação adequada.

## Backup e recuperação

O backup completo inclui banco, código, dependências declaradas e a chave local da pasta de dados; `node_modules` é excluído e deve ser recriado com `npm ci --omit=dev`. A cópia vem com recebimento automático **desativado**, assim como a agenda de backup, e sem sessões ou trava de sincronização ativa. Após restaurar, revise e teste a caixa antes de ativar.

O download de **Configurações → Sistema** contém apenas o banco. Ele também desativa a coleta na cópia, mas não contém `email-secret.key`. Sem a chave correspondente, restaure um backup completo ou salve uma nova senha de app na plataforma antes de testar/ativar. A fila e os vínculos permanecem no banco; registros não são apagados pela atualização.

## Diagnóstico

| Situação | Conferir |
| --- | --- |
| Credenciais recusadas | Endereço, senha de app, verificação em duas etapas e permissão de IMAP/senhas de app no Workspace. |
| Caixa ativa, e-mail antigo não apareceu | Primeira ativação começa do ponto atual. Importe o `.eml` original se necessário. |
| Novo e-mail não aparece | Destino correto, entrega na INBOX, intervalo de coleta, servidor ligado, saída para TCP 993 e último erro exibido. |
| Remetente aprovado continua pendente | Alertas de autenticação/conteúdo, endereço exato diferente, vínculo sem empresa válida ou mensagem recebida antes da aprovação. |
| Mensagem em Automáticos / ignorados | Cabeçalhos de resposta automática/lista, remetente igual à caixa ou limite de tamanho. |
| Mudou a identificação da caixa | Revise a mensagem de estado e, se apropriado, use reinício explícito do ponto de coleta. |
| Erro de chave local após restauração | Restaure `email-secret.key` do mesmo backup completo ou salve uma nova senha de app. |
| Dependência não encontrada | Com a aplicação parada, execute `npm ci --omit=dev` na instalação e reinicie. |

Os testes automatizados usam mensagens de demonstração e um conector simulado para falhas/retomada. As telas foram validadas no navegador. A autenticação e o recebimento na caixa real do Google precisam ser testados com a conta da sua empresa depois da configuração; nenhuma credencial real foi utilizada durante o desenvolvimento.
