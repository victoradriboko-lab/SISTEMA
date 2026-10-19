# Preservação de dados em atualizações

Regra do proprietário: atualizações devem preservar os dados existentes da plataforma.

- Alterações de código e interface não autorizam alterar registros de produção.
- Preserve clientes, usuários, senhas, permissões, equipamentos, tokens, chamados, contratos, histórico e configurações.
- Quando necessária, use migração aditiva e idempotente, compatível com instalações existentes. Não apague nem recrie tabelas ou registros como parte de uma atualização comum.
- Não inclua banco de exemplo, carga inicial ou redefinição de credenciais no fluxo de atualização. Não substitua a pasta de dados, o banco SQLite ou a chave de segurança existente.
- Só altere dados existentes quando o usuário solicitar essa alteração explicitamente. Se uma migração exigir transformar valores existentes, apresente o impacto antes de executá-la em produção.
- Valide mudanças de persistência usando banco temporário com registros anteriores; nunca use produção para testes.
- Mantenha instruções de atualização com backup consistente, preservação de DATA_DIR e reinicialização do processo.
