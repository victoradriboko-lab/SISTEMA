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
- Perfis Administrador, Técnico e Consulta, com autorização verificada no servidor e revogação de sessões após mudanças de senha, perfil ou situação.
- Chamados: criação, descrição, prioridade e transição de status.
- Inventário com responsável e sistema operacional.
- Token exclusivo por equipamento, exibido no cadastro.
- API de heartbeat e painel de comunicação recente (janela de 120 segundos).
- Agente inicial Linux que envia sistema operacional, carga de CPU e uso de disco a cada minuto. Carga de CPU é load average, não percentual. Não coleta memória nesta versão.

Cadastre um equipamento e guarde seu token. Em um terminal da máquina Linux a monitorar, configure SISTEMA_URL e SISTEMA_AGENT_TOKEN por mecanismo seguro de variáveis de ambiente, então execute `python3 agents/heartbeat.py`. Use HTTPS fora do loopback. O agente não executa comandos remotos nem acessa a tela. Não salve tokens no Git.

## Próximas etapas

Esta versão NÃO equivale a todos os recursos do Milvus. Acesso remoto está sinalizado como pendente na interface: será necessário selecionar e instalar RustDesk ou MeshCentral, configurar servidor, clientes, autorização e auditoria. Também faltam agentes Windows/macOS, alertas, SLA, anexos, e-mail, recuperação de senha por e-mail, limitação de tentativas de login, revogação/rotação de tokens e trilha de auditoria. Antes de uso amplo, concluir esses controles e revisar a segurança e o backup. O cadastro inicial é destinado apenas ao primeiro administrador. Administradores podem redefinir senhas de outros usuários; a própria senha exige confirmação da senha atual.

## Validação

`npm test` inicia uma instância isolada com banco temporário e testa cadastro, bloqueio de recadastro, login, rejeição de acesso sem autenticação, criação e alteração de chamados, proteção de origem, inventário, heartbeat e logout. Não valida interface em navegador ou acesso remoto. `npm run check` verifica a sintaxe do servidor.

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


## Usuários, senhas e permissões

Entre como administrador e abra **Usuários e permissões**. Use **Novo usuário** para definir nome, e-mail de login, senha inicial (12 a 256 caracteres) e perfil. Em **Editar**, altere cadastro, perfil, situação ou defina nova senha para outro usuário. A senha existente nunca é exibida. Deixar a nova senha vazia mantém a anterior. Não há exclusão definitiva: desative a conta para bloquear acesso.

| Permissão | Administrador | Técnico | Consulta |
| --- | --- | --- | --- |
| Visualizar chamados, inventário e monitoramento | Sim | Sim | Sim |
| Criar chamados, mudar status e cadastrar equipamentos | Sim | Sim | Não |
| Gerenciar usuários, perfis e redefinir senhas de outros | Sim | Não | Não |
| Alterar a própria senha informando a atual | Sim | Sim | Sim |

Os perfis se aplicam a todos os dados do sistema: ainda não há separação por empresa, setor ou solicitante. Controle remoto continua pendente. Alterações de senha, perfil ou situação encerram as sessões da conta afetada. O sistema impede desativar ou rebaixar o último administrador ativo. **Minha senha**, no topo da tela, permite alterar sua senha e exige novo login.

### Atualizar uma instalação existente

Pare a tarefa `Servitec-Sistema` (ou o processo manual), faça backup da pasta `data` com o sistema parado, atualize os arquivos pelo GitHub e inicie novamente. Não apague nem substitua o banco por um banco vazio. A primeira inicialização adiciona automaticamente as colunas de perfil e situação, preservando os dados e o login do administrador existente. Nenhuma senha padrão é criada. Atualize o navegador com Ctrl+F5. A migração foi testada com banco no formato anterior e após reinício, além dos testes de bloqueio de operações por perfil e dos fluxos de usuários no navegador.
