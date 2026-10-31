# Matriz de objetos candidatos do schema — 31/10/2026

Esta matriz complementa `relatorio-saneamento.md`. Evidência: varredura de
`api/src`, `web`, `extensao` e `backup-restore`; `pg_catalog`,
`information_schema` e contagens exatas de `kontabb-development` em transação
`READ ONLY`. Os números da tabela são **locais**. O banco configurado em
`api/.env` aponta para `localhost/kontabb-development`; nenhum banco implantado
foi consultado diretamente.

Em `web`, `extensao` e `backup-restore` não há referência textual direta aos
nove nomes de tabela abaixo. A API pode expor seus dados **indiretamente** por
serviços, como indicado na coluna de consumo. O usuário informou que não
conhece consumidores externos das três tabelas sem uso encontrado; isso não
constitui inventário de integrações do deploy. O utilitário de backup descobre
tabelas do schema `public` dinamicamente, salvo filtros `--exclude-table` ou
`--include-table`; o restore trunca as tabelas de destino antes da importação.
Um backup **local** feito pelo próprio utilitário incluiu as 57 tabelas e
13.390 registros e foi restaurado com sucesso em banco isolado. O arquivo
`backup-drive/documentos/kontabb-20261031-153521.sql.gz`, identificado pelo
usuário como backup do banco implantado, passou por gzip, restore transacional
e validação de 104 FKs em outro clone: 57 tabelas e 13.389 registros. As três
tabelas candidatas estavam vazias também nessa cópia, e
`classificacao_destinacao_aprendizado` tinha 48 linhas. A origem não é
verificável pelo cabeçalho do arquivo. Por ser data-only, ele não contém DDL
nem o tracker original de migrations. As migrations
`0000`–`0003` incluem o DDL, mas não contêm os dados de produção.

| Tabela | Leitor / writer TypeScript de produção | SQL cru de produção | Consumo pela API / export | Linhas locais | Índices locais | FK inbound | Decisão |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| `sped_contabilistas` | Nenhum encontrado | Nenhum encontrado | Nenhum endpoint/export direto encontrado | 0 | 2 | Nenhuma | Manter até inspecionar schema/tracker do alvo e consumidores externos. |
| `fiscal_lancamentos` | Nenhum; apenas comentários sobre migração futura | Nenhum encontrado | Nenhum endpoint/export direto encontrado | 0 | 4 | Nenhuma | Manter até inspecionar schema/tracker do alvo e consumidores externos. |
| `fiscal_perfis_vigencia` | Nenhum encontrado | Nenhum encontrado | Nenhum endpoint/export direto encontrado | 0 | 3 | Nenhuma | Manter até inspecionar schema/tracker do alvo e consumidores externos. |
| `ciap_competencias_apropriadas` | `INSERT` em `CiapService` | Nenhum encontrado | Marcador escrito pela apropriação CIAP; sem leitura localizada | 0 | 3 | Nenhuma | Preservar enquanto o writer existir e até definir retenção. |
| `ciap_movimentos` | Dois caminhos de `INSERT` em `CiapService` | Nenhum encontrado | Trilha patrimonial de correções, referenciada por apropriações | 0 | 4 | `ciap_apropriacoes`; autorreferência | Preservar. |
| `sped_arquivos_gerados` | `INSERT` e `UPDATE` em `EfdIcmsIpiService` | Nenhum encontrado | Histórico de geração do arquivo EFD; o TXT vai ao storage | 0 | 3 | Nenhuma | Preservar. |
| `classificacao_destinacao_aprendizado` | `INSERT`/`DELETE` em `RegrasFiscaisService` e **leitura** como `aprendizado` em `ClassificacaoDestinacaoService` | Nenhum encontrado | Influencia sugestão de destinação fiscal | 48 | 2 | Nenhuma | Preservar; classificação histórica de “somente-escrita” era falsa. |
| `fiscal_regras_versoes` | Leitura em `FiscalNormativeCatalogService`; writer não encontrado | Nenhum encontrado | Regras normativas consultadas indiretamente pelo cálculo | 0 | 3 | Nenhuma | Preservar; remover quebraria SELECT ativo. |
| `fiscal_decisoes_item` | Leitura em serviços de métricas e inventário; writer não encontrado | Nenhum encontrado | Contagens expostas no rollout fiscal | 0 | 2 | Nenhuma | Preservar; remover quebraria SELECT ativo. |

| Coluna candidata | Linhas locais / não nulas | Dependência no catálogo | Decisão |
| --- | ---: | --- | --- |
| `folhas_pagamento.documento_id` | 39 / 0 | FK para `guias` | Não remover sem checar alvo, import/export e fluxo RH. |
| `documentos_fiscais_itens.cod_obs_sped` | 8.124 / 0 | Nenhuma dependência inbound encontrada | Não remover sem homologar EFD e alvo. |
| `regras_fiscais.apropria_credito_pis_cofins` | 0 / 0 | Default, `NOT NULL` | Tabela local vazia; falta evidência do alvo. |
| `fiscal_catalogos_versoes.data_carga` | 0 / 0 | Default, `NOT NULL` | Tabela local vazia; falta evidência do alvo. |

O script `../scripts/preflight-schema-audit.sql` reproduz as contagens e
consultas ao catálogo sem alterar dados. No ambiente local, todas as nove
tabelas existem, as quatro migrations do tracker têm hashes iguais aos arquivos
SQL e os diagnósticos de pagamento histórico retornam zero. Para qualquer
remoção futura, verificar ocupação e dependências no banco alvo, inventariar
consumidores externos e ensaiar uma migration incremental com guarda de dados.
O mesmo preflight passou no clone do backup informado como implantado: 22
consultas de integridade sem violações, quatro diagnósticos de pagamento em
zero e as nove contagens candidatas iguais às locais. As quatro colunas
candidatas também tiveram zero valores não nulos. O tracker desse clone foi
**criado pelas migrations locais**; não representa o tracker original do
ambiente implantado. Nenhum `DROP` de deploy é proposto agora.

O ensaio reversível em `../scripts/dry-run-unused-tables.sql` foi executado em
clone local e no clone do backup identificado como implantado: `DROP ...
RESTRICT` passou com as três tabelas vazias e `ROLLBACK` as restaurou. No
clone local, uma linha sintética fez a guarda abortar antes do `DROP`. Esse
ensaio não integra o journal de migrations e não substitui a verificação do
schema, tracker e consumidores externos do banco implantado.
