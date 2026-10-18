# Painel do Cliente — porta e visual exclusivos

A aplicação possui duas entradas HTTP no mesmo processo Node.js e compartilha o mesmo banco. O servidor interno conserva sua porta atual. Os clientes utilizam uma página própria com tema claro, login exclusivo, Visão geral e Meus chamados. Permissões e vínculos por empresa permanecem validados no servidor.

## Aparência

No topo direito, abaixo do nome do cliente, o botão **Modo claro / Modo escuro** alterna a aparência do painel. A escolha fica salva no navegador para esta entrada e não altera a preferência do sistema interno. Não é necessário recarregar: filtros, formulários e gráficos permanecem como estão.

## Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Porta do sistema interno; mantém o valor configurado na instalação. |
| `HOST` | `127.0.0.1` | Interface de rede do sistema interno. |
| `CLIENT_PORT` | `3001` | Porta do Painel do Cliente; deve ser diferente da interna. |
| `CLIENT_HOST` | Valor de `HOST` | Interface do painel. Permite restringir ao proxy local. |
| `CLIENT_PUBLIC_URL` | Endereço HTTP sugerido com a porta do painel | URL pública mostrada no cadastro interno de acessos. Use a URL HTTPS real quando houver proxy. Sem caminho, credenciais, consulta ou fragmento. |
| `COOKIE_SECURE` | Desativado | Cookie seguro do sistema interno. Defina `1` em HTTPS. |
| `CLIENT_COOKIE_SECURE` | Valor de `COOKIE_SECURE` | Ajuste separado do cookie do painel. Defina `1` em HTTPS. |

Exemplo de inicialização manual no PowerShell, para a rede local:

```powershell
cd C:\Servitec\SISTEMA
$env:HOST = '0.0.0.0'
$env:PORT = '3000' # Preserve a porta já usada pelo sistema interno.
$env:CLIENT_PORT = '3001'
$env:COOKIE_SECURE = '0'
$env:CLIENT_COOKIE_SECURE = '0'
npm start
```

Execute apenas um processo: não abra outro `npm start` para o painel. Na rede local, acesse o endereço do servidor com `:3001`. O mesmo processo mantém as duas entradas; se uma porta estiver ocupada, o processo encerra com erro em vez de anunciar o sistema como pronto. A porta `0` escolhe uma porta temporária e é destinada aos testes, não a endereços fixos de produção.

## Atualizar uma instalação Windows existente

1. Preserve o backup anterior. Pare a tarefa ou execução manual, atualize todos os arquivos com `git pull --ff-only` e confira se o comando concluiu sem erros.
2. Se usa a tarefa padrão, execute `liberar-painel-cliente.bat` como administrador. Ele reinicia `Servitec-Sistema`, espera o painel responder e cria uma regra de entrada TCP 3001 restrita a `LocalSubnet`. Não substitui o executável da tarefa, variáveis do runner, configurações HTTPS, porta interna ou banco. Se executa manualmente, reinicie o processo antes de executar o BAT.
3. Abra `http://IP-DO-SERVIDOR:3001` de um computador da mesma rede. No sistema interno, entre em **Acessos de clientes** e confirme o endereço exibido.
4. Oriente os clientes a utilizar o novo endereço. Cadastros, senhas, vínculos e chamados são preservados. As sessões antigas de clientes, criadas na entrada interna, não são aceitas no painel: é necessário entrar novamente.

O BAT de liberação atende à porta padrão 3001 e não cria uma tarefa caso ela não exista. Para `CLIENT_PORT` personalizado, configure essa variável no ambiente usado para iniciar a aplicação e crie uma regra correspondente. O instalador completo `instalar-inicio-automatico.bat` é destinado ao modelo padrão de LAN e configura as duas portas 3000/3001; não o utilize para substituir uma instalação com portas/HTTPS personalizados sem revisar a configuração.

Os scripts foram conferidos com o parser PowerShell. Firewall, Agendador e acesso real pela rede precisam ser verificados no seu Windows Server.

## Publicar com domínio e HTTPS

Exemplo de organização:

- Equipe: `https://sistema.suaempresa.com.br` → proxy para a porta interna existente.
- Clientes: `https://clientes.suaempresa.com.br` → proxy para `127.0.0.1:3001`.

Configure DNS, certificados e os dois destinos no proxy. Preserve o cabeçalho `Host` público, incluindo a porta externa quando ela não for a padrão, para que a verificação de origem das operações funcione. Defina no ambiente efetivo da tarefa/processo:

```powershell
$env:CLIENT_PORT = '3001'
$env:CLIENT_HOST = '127.0.0.1'
$env:CLIENT_PUBLIC_URL = 'https://clientes.suaempresa.com.br'
$env:CLIENT_COOKIE_SECURE = '1'
```

As variáveis devem ser configuradas no runner ou mecanismo que inicia a tarefa, não apenas em uma janela de PowerShell independente. Reinicie a aplicação após alterar valores. Se ambos os acessos usam HTTPS, defina também `COOKIE_SECURE=1`.

O navegador pode utilizar HTTPS na porta 443 de cada domínio enquanto os destinos do proxy continuam em portas diferentes no servidor. Se precisar de uma porta HTTPS externa específica, configure essa porta e certificado no proxy e inclua-a em `CLIENT_PUBLIC_URL`. A aplicação Node.js fornece HTTP para o proxy; as variáveis não criam certificados, regras de roteador ou publicação externa. Não encaminhe diretamente a porta HTTP 3001 à internet.

## Contas e sessões

- Crie e gerencie clientes em **Acessos de clientes**, na entrada interna. Contas de clientes não são contas de operadores.
- O painel só autentica contas de clientes; o sistema interno só autentica contas internas. Não há cadastro inicial de administrador pela porta do painel.
- O cookie do sistema interno continua `session`; o painel utiliza `servitec_client_session`. Como cookies não são separados por porta, o servidor também verifica o tipo de entrada salvo na sessão e o tipo atual da conta. Renomear ou copiar cookies não permite trocar de sistema.
- A migração acrescenta `sessions.audience`, preservando sessões internas existentes. Alterações administrativas de acessos e troca de senha continuam revogando sessões no banco compartilhado.
- Cada cliente vê apenas os chamados da empresa vinculada, com filtros, gráficos, descrição e situação. Não há criação ou edição de chamados pelo cliente.
- O painel não oferece inventário, usuários, configurações, backup ou APIs de agentes. O monitoramento dos agentes continua utilizando a URL do sistema interno.

## Diagnóstico

| Sintoma | Verificação |
| --- | --- |
| Painel não abre na rede | Processo atualizado e reiniciado, porta 3001 livre, `CLIENT_HOST`/`HOST`, firewall e `/api/state` na porta do painel. |
| Nenhum dos acessos inicia | Consulte `data/servidor.log`: conflito de porta ou configuração inválida encerra o processo. |
| Link no cadastro aponta para HTTP/porta interna do proxy | Configure `CLIENT_PUBLIC_URL` com a URL HTTPS pública correta e reinicie. |
| Login retorna origem inválida | Proxy deve preservar o `Host` público com a porta correta. Não desative a verificação de origem. |
| Login não persiste por HTTP | Confira `CLIENT_COOKIE_SECURE`: cookies `Secure` exigem HTTPS. Em LAN HTTP, utilize `0`; em produção HTTPS, utilize `1`. |
| Cliente tenta a porta interna | Entregue o endereço do Painel do Cliente exibido no cadastro de acessos. |
| Cliente não vê um chamado | Confira vínculo do chamado com a empresa e filtros aplicados. |

Validação: testes automatizados das duas entradas, migração, isolamento de sessões/contas/origens e dados; navegador com sessões simultâneas, filtros, gráficos, atualização, troca de senha, saída, desativação e telas de 320/390 pixels. Essas verificações não configuram nem substituem a publicação no servidor do usuário.
