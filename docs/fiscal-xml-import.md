# Importação manual de XML fiscal

A interface do módulo fiscal permite selecionar todos os XMLs de uma única vez,
inclusive milhares de arquivos. Na hospedagem atual da API em Vercel Functions,
o navegador divide a seleção em lotes internos de até 20 arquivos e até 3 MiB
de conteúdo por requisição, deixando margem para o multipart sob o limite de
4,5 MB da plataforma. Os lotes são enviados sequencialmente. Falhas de
transporte são divididas em lotes menores e arquivos individuais recebem
tentativas adicionais. Cada requisição tem timeout de 90 segundos no navegador;
se a API não responder, o lote é dividido para nova tentativa. Arquivos acima
de 3 MiB são identificados e não enviados
por esta tela; exigem um fluxo de upload direto ao R2. O serviço NestJS aceita
XMLs de até 10 MB quando o transporte permite.

Ao terminar, a interface mantém selecionados os XMLs com erro para uma nova
tentativa na mesma aba. Os documentos já persistidos continuam idempotentes.

Os lotes internos são enviados pelos endpoints autenticados:

- `POST /api/admin/fiscal/documentos/importar-xml`: disponível para staff e
  associa cada documento aos clientes cadastrados encontrados entre seus
  participantes fiscais;
- `POST /api/fiscal/documentos/importar-xml`: disponível para cliente e aceita
  somente documentos dos quais o CNPJ/CPF da empresa logada participa.

O corpo usa `multipart/form-data`, com os arquivos no campo `files`. O limite de
20 itens existe somente por requisição para controlar memória e tempo de
processamento da API; não é um limite da operação apresentada ao usuário. A
operação ainda depende de a aba e o computador permanecerem ativos; não há fila
persistente de importação em segundo plano.

## Classificação

São importados somente documentos processados e com protocolo fiscal válido:

- `nfeProc`, modelo 55: NF-e;
- `nfeProc`, modelo 65: NFC-e;
- `cteProc`, modelo 57: CT-e.

Eventos, resumos, CT-e OS e outros modelos são descartados. XML malformado,
sem protocolo válido, com DTD/entidade, chave inválida ou associação indevida
ao cliente retorna erro individual sem interromper os demais arquivos do lote.

No CT-e, participar do documento não basta para produzir fato fiscal. O XML é
armazenado para todos os clientes-alvo encontrados, mas a escrituração só é
ativada quando o CNPJ/CPF do cliente coincide com o tomador resolvido por
`toma3` ou `toma4`. A decisão e o motivo ficam disponíveis nas consultas de
CT-e; remetente, expedidor, recebedor ou destinatário que não seja o tomador
permanece fora da apuração.

## Idempotência e storage

A unicidade `(cliente_id, chave_acesso)` continua sendo a autoridade contra
duplicidade. O XML fica em
`clientes/{cnpj}/fiscais/{ano}/{mes}/{tipo}/{chave}.xml`, inclusive nas
reimportações. A criação usa uma escrita condicional para evitar sobrescrever
uma chave ocupada. Se a gravação no banco falhar, o XML canônico não é removido
automaticamente, pois outro processo pode já estar usando a mesma chave. Um
registro resumido existente pode ser substituído pelo XML completo, e o objeto
anterior é limpo após a gravação.

A importação manual usa `nsu = 0` e não altera o controle de NSU da distribuição
automática. Cada documento importado gera o evento de auditoria
`DOCUMENTO_FISCAL_XML_IMPORTADO`.

Para migrar os caminhos antigos no ambiente local (`DATABASE_URL` em localhost
e bucket R2 `teste`), execute `node --env-file=.env
scripts/migrate-fiscal-xml-keys.mjs` para a prévia e acrescente `--apply` para
copiar e atualizar. O script confere o SHA-256 da cópia, atualiza `xml_key`
condicionalmente e só então remove o objeto antigo. Pode ser executado de novo
para retomar registros pendentes. Chaves antigas sem objeto no R2 permanecem
intactas e precisam do XML original ou de acesso ao bucket de origem.

Cada CT-e também gera `CTE_ESCRITURADO` ou `CTE_NAO_ESCRITURAVEL`. A linha
fiscal é idempotente por documento e vive em
`documentos_fiscais_cte_escrituracao`, separada dos itens de mercadoria de
NF-e/NFC-e.

## Exclusão da movimentação do mês

Para refazer a importação de uma competência, a movimentação importada pode ser
excluída pelos endpoints:

- `DELETE /api/admin/fiscal/documentos/movimentacao?clienteId={uuid}&competencia=AAAA-MM`;
- `DELETE /api/fiscal/documentos/movimentacao?competencia=AAAA-MM` (empresa logada).

São removidos somente os documentos importados manualmente (`nsu = 0`) do mês:
NF-e, NFC-e e CT-e pela data de emissão e NFS-e pela competência declarada
(ou data de emissão, se ausente). Documentos da distribuição automática da
SEFAZ são preservados, pois não seriam recuperados pelo controle de NSU. Itens,
escrituração de CT-e, eventos fiscais e decisões de crédito saem em cascata;
vínculos do CIAP ficam com o documento anulado.

A operação usa o mesmo lock de escopo do fechamento EFD e retorna `409` se
houver fechamento `FECHADO` corrente na competência. Os XMLs/PDFs são apagados
do R2 após o commit; falhas nessa limpeza são registradas em log e contadas em
`objetos_nao_removidos`, sem desfazer a exclusão. É gerado o evento de
auditoria `MOVIMENTACAO_FISCAL_MES_EXCLUIDA`.

## Resposta

A resposta informa totais de registros importados e duplicados, arquivos
ignorados, erros e o resultado detalhado de cada arquivo. Um mesmo XML pode
gerar mais de um registro no fluxo administrativo quando mais de um cliente
cadastrado participa da operação.
