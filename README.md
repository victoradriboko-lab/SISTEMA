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
- Chamados: criação, descrição, prioridade e transição de status.
- Inventário com responsável e sistema operacional.
- Token exclusivo por equipamento, exibido no cadastro.
- API de heartbeat e painel de comunicação recente (janela de 120 segundos).
- Agente inicial Linux que envia sistema operacional, carga de CPU e uso de disco a cada minuto. Carga de CPU é load average, não percentual. Não coleta memória nesta versão.

Cadastre um equipamento e guarde seu token. Em um terminal da máquina Linux a monitorar, configure SISTEMA_URL e SISTEMA_AGENT_TOKEN por mecanismo seguro de variáveis de ambiente, então execute `python3 agents/heartbeat.py`. Use HTTPS fora do loopback. O agente não executa comandos remotos nem acessa a tela. Não salve tokens no Git.

## Próximas etapas

Esta versão NÃO equivale a todos os recursos do Milvus. Acesso remoto está sinalizado como pendente na interface: será necessário selecionar e instalar RustDesk ou MeshCentral, configurar servidor, clientes, autorização e auditoria. Também faltam agentes Windows/macOS, alertas, SLA, anexos, e-mail, gestão de usuários e perfis, recuperação de senha, limitação de tentativas de login, revogação/rotação de tokens e trilha de auditoria. Antes de uso amplo, concluir esses controles e revisar a segurança e o backup. O cadastro inicial é destinado apenas ao primeiro administrador; todos os acessos atuais possuem as mesmas permissões.

## Validação

`npm test` inicia uma instância isolada com banco temporário e testa cadastro, bloqueio de recadastro, login, rejeição de acesso sem autenticação, criação e alteração de chamados, proteção de origem, inventário, heartbeat e logout. Não valida interface em navegador ou acesso remoto. `npm run check` verifica a sintaxe do servidor.
