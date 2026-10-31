# Matriz de objetos candidatos do schema — 31/10/2026

Esta matriz complementa `relatorio-saneamento.md`. Evidência: varredura de
`api/src`, `web`, `extensao` e `backup-restore`; `pg_catalog`,
`information_schema` e contagens exatas de `kontabb-development` em transação
`READ ONLY`. Os números são **locais**. O banco configurado em `api/.env` aponta
para `localhost/kontabb-development`; nenhum banco implantado foi consultado.

Em `web`, `extensao` e `backup-restore` não há referência textual direta aos
nove nomes de tabela abaixo. A API pode expor seus dados **indiretamente** por
serviços, como indicado na coluna de consumo. O utilitário de backup descobre
tabelas do schema `public` dinamicamente, salvo filtros `--exclude-table` ou
`--include-table`; o restore trunca as tabelas de destino antes da importação.
Sem o inventário do arquivo de backup real, não há prova de cobertura ou
restaurabilidade de cada tabela. As migrations `0000`–`0003` incluem o DDL,
mas não contêm os dados de produção.

| Tabela | Leitor / writer TypeScript de produção | SQL cru de produção | Consumo pela API / export | Linhas locais | Índices locais | FK inbound | Decisão |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| `sped_contabilistas` | Nenhum encontrado | Nenhum encontrado | Nenhum endpoint/export direto encontrado | 0 | 2 | Nenhuma | Candidata apenas após auditoria do alvo e backup. |
| `fiscal_lancamentos` | Nenhum; apenas comentários sobre migração futura | Nenhum encontrado | Nenhum endpoint/export direto encontrado | 0 | 4 | Nenhuma | Candidata apenas após auditoria do alvo e backup. |
| `fiscal_perfis_vigencia` | Nenhum encontrado | Nenhum encontrado | Nenhum endpoint/export direto encontrado | 0 | 3 | Nenhuma | Candidata apenas após auditoria do alvo e backup. |
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
consumidores externos, conferir backup/restore real e ensaiar uma migration
incremental em clone com dados representativos. Nenhum `DROP` é proposto agora.
