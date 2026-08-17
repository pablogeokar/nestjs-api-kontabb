# Importação manual de XML fiscal

A interface do módulo fiscal permite selecionar todos os XMLs de uma única vez,
inclusive centenas de arquivos. O navegador divide a seleção em lotes internos
de até 20 arquivos e os envia sequencialmente, consolidando o progresso e o
resultado sem exigir ação adicional do usuário. Cada XML possui limite de 10 MB.

Os lotes internos são enviados pelos endpoints autenticados:

- `POST /api/admin/fiscal/documentos/importar-xml`: disponível para staff e
  associa cada documento aos clientes cadastrados encontrados entre seus
  participantes fiscais;
- `POST /api/fiscal/documentos/importar-xml`: disponível para cliente e aceita
  somente documentos dos quais o CNPJ/CPF da empresa logada participa.

O corpo usa `multipart/form-data`, com os arquivos no campo `files`. O limite de
20 itens existe somente por requisição para controlar memória e tempo de
processamento da API; não é um limite da operação apresentada ao usuário.

## Classificação

São importados somente documentos processados e com protocolo fiscal válido:

- `nfeProc`, modelo 55: NF-e;
- `nfeProc`, modelo 65: NFC-e;
- `cteProc`, modelo 57: CT-e.

Eventos, resumos, CT-e OS e outros modelos são descartados. XML malformado,
sem protocolo válido, com DTD/entidade, chave inválida ou associação indevida
ao cliente retorna erro individual sem interromper os demais arquivos do lote.

## Idempotência e storage

A unicidade `(cliente_id, chave_acesso)` continua sendo a autoridade contra
duplicidade. O arquivo recebe uma key imutável com UUID; se a persistência não
ocorrer, o objeto recém-enviado é removido. Um registro resumido existente pode
ser substituído pelo XML completo, e o objeto anterior é limpo após a gravação.

A importação manual usa `nsu = 0` e não altera o controle de NSU da distribuição
automática. Cada documento importado gera o evento de auditoria
`DOCUMENTO_FISCAL_XML_IMPORTADO`.

## Resposta

A resposta informa totais de registros importados e duplicados, arquivos
ignorados, erros e o resultado detalhado de cada arquivo. Um mesmo XML pode
gerar mais de um registro no fluxo administrativo quando mais de um cliente
cadastrado participa da operação.
