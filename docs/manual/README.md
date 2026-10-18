# Manual do usuário — SERVITEC VSA

- [Baixar o manual editável em Word](Manual-do-Usuario-SERVITEC-VSA.docx)
- [Ler o manual em PDF](Manual-do-Usuario-SERVITEC-VSA.pdf)

Edição 1.0, de 18/10/2026. O PDF tem 20 páginas. Inclui capa, sumário, oito imagens da aplicação e instruções para administradores, operadores e clientes. Referência funcional: revisão `577c433`.

As telas foram capturadas em uma instância isolada com dados fictícios. Não há tokens, senhas ou informações de clientes reais nos documentos. A atualização do manual não altera a aplicação nem o banco de produção.

## Atualizar a documentação

O conteúdo editável está em `conteudo.py`, e as capturas ficam em `imagens/`. O gerador cria o Word e o PDF a partir do mesmo conteúdo; o PDF é gerado diretamente, não convertido do Word. O Word utiliza tamanho A4, estilos de títulos, cabeçalhos, numeração automática no rodapé e quebras de página entre assuntos. Sua paginação pode variar conforme o editor e as fontes instaladas; confira o sumário após editar.

Dependências exclusivas da geração: Python 3, `python-docx`, `reportlab` e `Pillow`. O PDF usa as fontes Liberation Sans e Liberation Mono, compatíveis com Arial e Courier. O servidor Node.js não depende dessas ferramentas.

Na raiz do repositório, execute:

```sh
python scripts/generate-manual.py
```

Revise os dois arquivos antes de redistribuir, em especial após alterar conteúdo ou tamanho de imagens. A validação desta edição conferiu a estrutura do DOCX, suas oito imagens incorporadas, as 19 quebras de página e a apresentação das 20 páginas do PDF.
