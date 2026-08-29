# Escrituração fiscal de CT-e

O CT-e modelo 57 é armazenado como documento fiscal, mas só produz
escrituração para a empresa que contratou o transporte. O tomador é resolvido
no grupo `ide`: `toma3` aponta para remetente, expedidor, recebedor ou
destinatário; `toma4` identifica um terceiro. CNPJ e CPF são comparados somente
após normalização para dígitos.

## Decisão fiscal

- cliente diferente do tomador: `NAO_ESCRITURAVEL`, motivo
  `CLIENTE_NAO_E_TOMADOR`;
- cliente tomador: entrada de serviço de transporte;
- Simples Nacional sem apuração separada: documento escriturado, crédito zero;
- subcontratação e redespacho (`tpServ` 1, 2 ou 3):
  `PENDENTE_REVISAO`, sem crédito automático;
- cancelado ou denegado: pode compor D100 com `COD_SIT` 02 ou 04, mas não gera
  valores de apuração nem crédito;
- complementar (`tpCTe=1`): soma os valores e usa `COD_SIT` 06;
- anulação (`tpCTe=2`): mantém lançamento interno negativo e estorna o crédito
  da escrituração referenciada quando ela já está disponível;
- substituto (`tpCTe=3`): é escriturado e marca o CT-e referenciado como
  `SUBSTITUIDO`, evitando dupla contagem.

A falta da referência obrigatória, um CFOP em fallback ou modalidade especial
marca a linha para revisão. O reprocessamento administrativo baixa novamente o
XML e faz `upsert`, sem duplicar a escrituração.

## Persistência e integridade

A tabela `documentos_fiscais_cte_escrituracao` contém uma única linha por
documento fiscal. Chaves estrangeiras, unicidade, checks de papel do tomador,
tipo de CT-e/serviço, CFOP, municípios e coerência do motivo protegem a regra
também no banco. O cabeçalho expõe `escriturado` e `escrituracao_status`.

CT-e anteriores à migration devem passar por
`POST /api/admin/fiscal/reprocessar-escrituracao` para que o XML armazenado gere
a linha dedicada e o status correto.

No rollout, aplique a migration versionada com o fluxo Drizzle do ambiente e
execute `pnpm db:seed:cfops` antes do reprocessamento. O seed é idempotente e
inclui os CFOP de transporte e suas equivalências globais.

## Relatórios e endpoints

Cliente autenticado:

- `GET /api/fiscal/cte`;
- `GET /api/fiscal/relatorios/d100`;
- `GET /api/fiscal/relatorios/d190`;
- `GET /api/fiscal/relatorios/cte/apuracao-icms`.

Staff usa os mesmos caminhos sob `/api/admin/fiscal`. A apuração geral de ICMS
soma `valor_icms_creditavel` dos fretes às entradas de mercadoria. O resumo de
livros preserva o Bloco C em `data` e devolve o transporte separadamente em
`transportes_bloco_d`.

## Leiaute SPED adotado

Em agosto de 2026, a referência vigente é o Guia Prático EFD ICMS/IPI 3.2.2,
leiaute 020, válido para 2026. O MVP expõe D100 e D190; `COD_PART` é devolvido
com o documento da transportadora para posterior mapeamento ao registro 0150.
Antes de gerar arquivo texto definitivo, o período solicitado deve selecionar
o leiaute correspondente e o resultado deve ser validado no PVA.

Referências oficiais:

- [Guia Prático EFD ICMS/IPI 3.2.2](https://sped.rfb.gov.br/item/show/8112)
- [Manuais e Guias Práticos da EFD ICMS/IPI](https://sped.rfb.gov.br/item/show/1573)
- [Tabela oficial de CFOP](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=)
