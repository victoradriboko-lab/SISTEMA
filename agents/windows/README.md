# Agente Servitec para Windows e Windows Server — 1.0.0

Agente de telemetria, sem controle de tela, execucao remota de comandos ou acesso a arquivos pessoais. O executavel usa .NET Framework ja instalado no Windows; nao exige Node.js, Python ou SDK .NET na maquina monitorada.

## Requisitos

- Windows 10/11 ou Windows Server 2016, 2019, 2022 ou 2025, com Windows PowerShell 5.1 e .NET Framework 4.6.2 ou superior. Windows Server Core depende de WMI/CIM e .NET Framework disponiveis.
- Administrador local para instalar e remover o servico.
- Servidor SISTEMA atualizado para 0.3.0 e acessivel por HTTPS com certificado valido.
- Para teste em LAN, aceita HTTP somente para IP literal privado (10/8, 172.16/12, 192.168/16) ou loopback, apos confirmacao explicita. Nao use HTTP atraves da internet. Nomes DNS exigem HTTPS.

## Instalar

1. No sistema, abra Equipamentos → Nova empresa / token. Cadastre a empresa e guarde o token exibido. Use o mesmo token em todos os computadores e servidores desse cliente. O primeiro inventario cadastra cada maquina automaticamente.
2. Na pagina Equipamentos, clique em Baixar instalador .exe e salve na maquina monitorada.
3. Abra ServitecAgentSetup.exe e aceite a solicitacao de administrador. O instalador extrai automaticamente os arquivos e abre a configuracao no console. A opcao Pacote ZIP continua disponivel; nesse caso, extraia TODOS os arquivos e execute instalar-agente.bat como administrador.
4. Informe a URL base do servidor (sem caminhos) e cole o token na entrada oculta. O instalador verifica acesso e token antes de registrar o servico.
5. Confira o servico ServitecAgent no services.msc e os dados na pagina Monitoramento. A primeira coleta completa pode levar alguns minutos.

O servico funciona como LocalSystem e inicia automaticamente sem login. Arquivos ficam em Program Files/ServitecAgent; configuracao, fila e log em ProgramData/ServitecAgent. As pastas ficam restritas a SYSTEM e Administradores. O token e protegido com DPAPI LocalMachine, nao fica em texto puro no config.json. Nao copie essa configuracao para outras maquinas ou para imagens de clonagem.

O executavel do agente tem checksum SHA-256 verificado pelo instalador; o instalador .exe incorpora esse mesmo pacote e nao baixa codigo durante a instalacao. Esse checksum detecta corrupcao; nao substitui assinatura digital. O agente e o instalador ainda nao tem certificado de assinatura de codigo; o Windows pode mostrar editor desconhecido. Obtenha o pacote apenas do seu servidor confiavel/GitHub do projeto; nao desative protecoes do Windows para executa-lo.

## Coleta e comunicacao

- A cada 30 segundos: CPU (%), memoria total/disponivel/uso (%), discos locais fixos e tempo ligado.
- No inicio e a cada seis horas: hostname, fabricante, modelo, numero de serie, BIOS, dominio, versao e arquitetura do Windows, tipo workstation/server/controlador de dominio, processadores, interfaces de rede, programas e servicos de inicio automatico.
- Limites: ate 500 programas de HKLM (32/64 bits), 300 servicos automaticos e 32 interfaces. Programas exclusivos do perfil de cada usuario nao sao coletados. Servicos representam o estado no momento do inventario, nao um teste em tempo real de disponibilidade da aplicacao. Uma consulta WMI indisponivel pode deixar campos vazios.
- Comunicacao apenas de saida; nao abre portas na maquina monitorada. HTTPS usa a validacao normal do Windows e nao segue redirecionamentos com o token. Proxies/certificados corporativos precisam estar configurados para a conta de servico. Mantenha o relogio do Windows sincronizado; amostras com mais de cinco minutos no futuro ou sete dias no passado sao recusadas.
- Em falha, guarda ate 120 amostras em disco, tenta novamente com espera progressiva de ate cinco minutos e descarta as mais antigas ao atingir o limite. A amostra atual vai antes do backlog, que e reenviado em lotes de ate tres; perdas acima do limite sao esperadas.
- O token da empresa aceita varias identidades de instalacao e separa seus equipamentos. Ao renovar esse token, atualize TODOS os agentes da empresa; os cadastros e historicos sao preservados. Tokens individuais antigos continuam funcionando para compatibilidade. Amostras repetidas nao duplicam o historico, e amostras antigas nao substituem dados mais recentes nem deixam a maquina aparentemente online.
- Painel atualiza a cada 10 segundos; conexao fica offline apos dois minutos sem amostra atual. Historico retido por ate 48 horas, com limpeza periodica e limite aproximado de 5.760 amostras por equipamento. Detalhes mostram as ultimas 120 amostras.

## Operacao

Log: C:/ProgramData/ServitecAgent/agent.log. Rotacao em 1 MB, com um arquivo anterior. Falhas sao registradas sem token ou corpo de requisicoes. O Windows tenta reiniciar o servico em 1, 2 e 5 minutos em caso de encerramento inesperado.

Para renovar token ou mudar URL: pare o servico, renove o token no sistema quando necessario e execute novamente o instalador. O instalador preserva a identidade local, atualiza o executavel e limpa a fila antiga para nao enviar amostras para o registro errado.

Para remover: execute desinstalar-agente.bat como administrador. Configuracao e logs sao preservados. A renovacao do token da empresa revoga a credencial em TODOS os agentes desse cliente. Remova arquivos locais posteriormente se nao precisar deles.

## Validacao desta entrega

Executavel compilado em Linux para .NET Framework 4.6.2, sem avisos ou erros. Politicas de HTTPS/LAN testadas com o mesmo codigo-fonte; sintaxe dos instaladores conferida com o parser PowerShell. Comunicacao, autorizacao, deduplicacao, amostras atrasadas e painel validados com dados de teste. Instalacao do servico, DPAPI, consultas WMI/Registro, coleta real e reinicio do Windows precisam de validacao piloto numa maquina Windows e num Windows Server antes de distribuicao ampla.

O bootstrap ServitecAgentSetup.exe pede elevacao pelo manifesto do Windows, extrai o pacote numa pasta temporaria restrita dentro de Program Files/ServitecAgent e a remove ao terminar. Nao inclui token ou URL preconfigurados. O pedido de elevacao/UAC e a execucao final tambem precisam de validacao piloto no Windows.
