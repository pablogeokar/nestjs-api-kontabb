# Importação manual de XML fiscal

O módulo fiscal aceita lotes manuais de até 20 arquivos, com limite de 10 MB
por XML, pelos endpoints autenticados:

- `POST /api/admin/fiscal/documentos/importar-xml`: disponível para staff e
  associa cada documento aos clientes cadastrados encontrados entre seus
  participantes fiscais;
- `POST /api/fiscal/documentos/importar-xml`: disponível para cliente e aceita
  somente documentos dos quais o CNPJ/CPF da empresa logada participa.

O corpo usa `multipart/form-data`, com os arquivos no campo `files`.

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
