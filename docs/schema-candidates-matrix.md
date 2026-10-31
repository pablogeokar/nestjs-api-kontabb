# Matriz de objetos candidatos do schema — 31/10/2026

Esta matriz complementa `relatorio-saneamento.md`. Evidência: varredura de
`api/src`, `web`, `extensao` e `backup-restore`; `pg_catalog`,
`information_schema` e contagens exatas de `kontabb-development` e do Neon
implantado, sempre em transações `READ ONLY`. O banco configurado em
`api/.env` aponta para `localhost/kontabb-development`; o alvo foi consultado
em conexão separada, sem escrita, conforme a restrição do usuário.

Em `web`, `extensao` e `backup-restore` não há referência textual direta aos
nove nomes de tabela abaixo. A API pode expor seus dados **indiretamente** por
serviços, como indicado na coluna de consumo. O usuário informou que não
conhece consumidores externos das três tabelas sem uso encontrado e confirmou
que não há uso planejado nem exigência de retenção. Isso não constitui
inventário de integrações do deploy. O utilitário de backup descobre
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
nem o tracker original de migrations. A consulta direta ao alvo confirmou 57
tabelas e o tracker `0000`–`0003` com hashes iguais aos arquivos SQL locais.

| Tabela | Leitor / writer TypeScript de produção | SQL cru de produção | Consumo pela API / export | Linhas local / alvo | Índices no alvo | FK inbound no alvo | Decisão |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| `sped_contabilistas` | Nenhum encontrado | Nenhum encontrado | Nenhum endpoint/export direto encontrado | 0 / 0 | 2 | Nenhuma | Preservar para restore dos backups atuais. |
| `fiscal_lancamentos` | Nenhum; comentários históricos de migração futura | Nenhum encontrado | Nenhum endpoint/export direto encontrado | 0 / 0 | 4 | Nenhuma | Preservar para restore dos backups atuais. |
| `fiscal_perfis_vigencia` | Nenhum encontrado; comentário histórico de design | Nenhum encontrado | Nenhum endpoint/export direto encontrado | 0 / 0 | 3 | Nenhuma | Preservar para restore dos backups atuais. |
| `ciap_competencias_apropriadas` | `INSERT` em `CiapService` | Nenhum encontrado | Marcador escrito pela apropriação CIAP; sem leitura localizada | 0 / 0 | 3 | Nenhuma | Preservar enquanto o writer existir e até definir retenção. |
| `ciap_movimentos` | Dois caminhos de `INSERT` em `CiapService` | Nenhum encontrado | Trilha patrimonial de correções, referenciada por apropriações | 0 / 0 | 4 | `ciap_apropriacoes`; autorreferência | Preservar. |
| `sped_arquivos_gerados` | `INSERT` e `UPDATE` em `EfdIcmsIpiService` | Nenhum encontrado | Histórico de geração do arquivo EFD; o TXT vai ao storage | 0 / 0 | 3 | Nenhuma | Preservar. |
| `classificacao_destinacao_aprendizado` | `INSERT`/`DELETE` em `RegrasFiscaisService` e **leitura** como `aprendizado` em `ClassificacaoDestinacaoService` | Nenhum encontrado | Influencia sugestão de destinação fiscal | 48 / 48 | 2 | Nenhuma | Preservar; classificação histórica de “somente-escrita” era falsa. |
| `fiscal_regras_versoes` | Leitura em `FiscalNormativeCatalogService`; writer não encontrado | Nenhum encontrado | Regras normativas consultadas indiretamente pelo cálculo | 0 / 0 | 3 | Nenhuma | Preservar; remover quebraria SELECT ativo. |
| `fiscal_decisoes_item` | Leitura em serviços de métricas e inventário; writer não encontrado | Nenhum encontrado | Contagens expostas no rollout fiscal | 0 / 0 | 2 | Nenhuma | Preservar; remover quebraria SELECT ativo. |

| Coluna candidata | Linhas local / alvo; não nulas no alvo | Dependência no catálogo do alvo | Decisão |
| --- | ---: | --- | --- |
| `folhas_pagamento.documento_id` | 39 / 39; 0 | FK para `guias` | Preservar até revisar import/export e fluxo RH. |
| `documentos_fiscais_itens.cod_obs_sped` | 8.124 / 8.124; 0 | Nenhuma dependência inbound encontrada | Preservar até homologar EFD e consumidores. |
| `regras_fiscais.apropria_credito_pis_cofins` | 0 / 0; 0 | Default e `NOT NULL` | Preservar; falta decisão sobre uso futuro. |
| `fiscal_catalogos_versoes.data_carga` | 0 / 0; 0 | Default e `NOT NULL` | Preservar; falta decisão sobre uso futuro. |

O script `../scripts/preflight-schema-audit.sql` reproduz as contagens e
consultas ao catálogo sem alterar dados. Passou no clone do backup e no banco
implantado. No alvo, `SHOW transaction_read_only` retornou `on`; o tracker
original tem os quatro hashes das migrations locais, os quatro diagnósticos
históricos de pagamento retornaram zero e `preflight-migrations.sql` produziu
22 conjuntos de **zero linhas de violação**. Consultas adicionais ao catálogo
não encontraram views nem triggers nas três tabelas candidatas. A ausência de
consumidores SQL externos não é demonstrável apenas pelo catálogo. Nenhum
`DROP` de deploy é proposto agora.

O ensaio reversível em `../scripts/dry-run-unused-tables.sql` foi executado em
clone local e no clone do backup identificado como implantado: `DROP ...
RESTRICT` passou com as três tabelas vazias e `ROLLBACK` as restaurou. O script
agora obtém `ACCESS EXCLUSIVE` antes de conferir o vazio, impedindo inserção
entre a guarda e o `DROP`; foi revalidado no clone do backup. Uma linha
sintética no clone fez a guarda abortar e deixou as três tabelas intactas.

Um segundo ensaio criou o schema com 57 tabelas, removeu essas três **somente
no clone** e tentou restaurar o backup atual com `--dry-run`. O utilitário
falhou no primeiro `COPY` para uma tabela ausente
(`fiscal_perfis_vigencia`, SQLSTATE `42P01`) e reverteu a transação; o clone
continuou com 54 tabelas e zero linhas em `clientes`. Logo, uma migration de
remoção quebraria o procedimento com o helper antigo.

O código do helper v1.2 passou a aceitar uma lista **explícita** de tabelas
ausentes, com verificação do bloco `COPY` vazio; o Backup Drive expõe essa
opção. Em novo clone de 54 tabelas, `dry-run` e restore real do mesmo arquivo
passaram: 54 tabelas/13.389 registros, três blocos vazios ignorados, 98 FKs e
boot do `AppModule`. Um bloco sintético com linha foi rejeitado e o rollback
preservou os dados restaurados; sem a opção, o erro antigo permaneceu. O
Os binários locais macOS e Windows foram recompilados; o app macOS com helper v1.2
universal arm64/x86_64 foi compilado e validado localmente. O script de release
Windows foi preparado, mas requer build e teste em host Windows. O pacote Mac
segue ad hoc e sem notarização. O usuário pediu para pular a etapa de
distribuição/homologação; por isso nenhuma migration `0004` foi gerada. A
retirada das tabelas permanece suspensa, inclusive pela revisão de consumidores
externos ainda pendente.
