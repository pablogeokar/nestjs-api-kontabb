# Relatório de saneamento da API e do schema — 31/10/2026

## Escopo e limite da evidência

Implementação do `PROMPT_REFATORACAO_E_OTIMIZACAO_API_CONSOLIDADO.md` em `api/`, com inspeção dos consumidores em `web/` e `extensao/`. A raiz `kontabb/` não é repositório Git. Os ensaios usaram bancos isolados no PostgreSQL local; `kontabb-development` foi consultado apenas em transações `READ ONLY`. O usuário identificou `backup-drive/documentos/kontabb-20261031-153521.sql.gz` como backup do banco implantado, e ele foi restaurado em clone isolado. Não houve conexão direta com produção, DDL no banco configurado pela API nem remoção de dados da aplicação. O arquivo é data-only e não contém o schema ou o tracker originais do ambiente implantado.

## Baseline e contratos

Antes das mudanças deste ciclo, `tsc --noEmit` falhava em specs, ESLint tinha 60 erros e Jest falhava em 7 testes de 2 suites por três XMLs NFS-e ausentes na raiz. `build` e `db:check` passavam. Foram corrigidos os tipos e a formatação localizados; os testes agora usam três XMLs reais sanitizados em `src/fiscal/services/__fixtures__/webiss/`, mantendo os casos fiscais do parser. Dados de identificação pessoal, texto livre e assinatura foram retirados das cópias; identificadores fiscais usados nas asserções foram mantidos. Os testes não dependem mais de arquivos em Downloads.

O inventário em `docs/rotas-consumidas.md` registra 216 rotas únicas a partir dos metadados NestJS. Foram verificados `GET /api/cron/storage-cleanup`, `GET /api/cron/fiscal-sync` e `PATCH /api/guias/:id/pagar`, além das chamadas da extensão e do Vercel Cron. Verbo, path, autenticação e corpo de resposta dessas rotas foram preservados. O endpoint de reconciliação de storage continua sendo alias mutativo da limpeza, conforme a documentação existente.

## Alterações implementadas

| Área | Mudança | Evidência de equivalência/segurança |
| --- | --- | --- |
| Cadastro | `findRegisteredCnpjs` consulta raízes CNPJ em lote, com `substring(cnpj, 1, 8)` e `IN`, em vez de uma query por raiz. | Teste com raízes repetidas e contagem de uma consulta; o único chamador envia raízes de dígitos. |
| CIAP | Importação busca códigos de bens existentes em lote e usa `Set` para duplicatas no mesmo arquivo. | Teste cobre bem existente e código repetido, mantendo a ordem de importação. |
| Rate limit | Expurgo diário de até 1.000 janelas vencidas há mais de 24 h, incluindo chaves SEFAZ apenas quando realmente expiradas; `SKIP LOCKED` e rechecagem no `DELETE`. A tentativa ocorre mesmo se a limpeza de storage falhar. | Teste manual em tabela temporária isolada: linha vencida há 25 h removida, linhas de 2 h e ativa preservadas. `EXPLAIN (ANALYZE, BUFFERS)` no banco local: 68 linhas, 64 elegíveis, execução da seleção em 0,065 ms; nenhum índice novo justificável nesse volume. Testes do cron cobrem autorização, resposta e falhas de ambos os jobs. |
| Pagamento | `confirmPayment` passou de CTE para transação Drizzle: atualização condicional da guia, evento fiscal quando há vínculo ativo e valor positivo do PDF, projeção do saldo, atualização do estado fiscal quando quitado e auditoria. O usuário definiu que o evento registra o valor do PDF mesmo com parcial anterior. A confirmação sem comprovante registra declaração manual; com comprovante guarda a key R2. | Testes cobrem guia sem vínculo, retry, parcial, estorno prévio, diferença de centavos, vínculo cancelado, falha de R2 e rollback/compensação após falha de auditoria. Em PostgreSQL local isolado, dois requests concorrentes geraram exatamente uma baixa, um evento novo e uma auditoria. |

O evento fiscal usa o valor decimal persistido em `guias.valor`, extraído do PDF, e `paid_at` quando informado; sem ele, usa a data corrente de Bahia. O tipo do evento é `PAGAMENTO_PARCIAL` se ainda resta saldo, ou `PAGAMENTO` se a projeção quita a obrigação. O status da obrigação fiscal só vira `PAGO` quando `projetarSaldoObrigacao` demonstra quitação. Se o vínculo tiver valor ausente ou zero, a transação falha sem registrar baixa: não existe valor confiável para fabricar um evento. Se o vínculo estiver cancelado, a guia de upload pode ser paga, sem criar evento numa obrigação congelada. O `UPDATE guias ... WHERE status <> 'PAGO'` dentro da transação serializa confirmações concorrentes da mesma guia; upload de comprovante de tentativa perdedora é compensado no R2. Outros métodos com CTE parametrizada foram mantidos, pois a conversão não traz benefício demonstrado e ampliaria o risco.

Na revisão seguinte, a baixa passou a rejeitar com HTTP 400 específico uma guia de upload pendente cuja obrigação fiscal vinculada **já tem saldo quitado**. A transação é revertida e um comprovante enviado na tentativa é removido do R2. Isso evita duplicar um pagamento integral já registrado na trilha; eventos parciais prévios continuam permitidos e o novo evento mantém o valor integral do PDF. Há testes de serviço e controller para essa borda.

Preflight somente leitura no banco local encontrou **zero** guias de upload pagas e vinculadas sem evento de origem `guia-upload:<id>`, e **zero** guias fiscais `PAGO` sem qualquer evento. Isso não substitui a mesma verificação no banco implantado antes de cogitar backfill; eventos históricos não devem ser inventados a partir de status.

## Auditoria do schema

O schema possui 57 tabelas, e o journal contém `0000`–`0003`. No banco local de desenvolvimento, o tracker `drizzle.__drizzle_migrations` também tem quatro entradas. As quatro migrations foram aplicadas com sucesso no banco isolado. A baseline `0000` não foi editada.

| Objeto candidato | Uso encontrado no código | Linhas no banco local | FK inbound no banco local | Decisão |
| --- | --- | ---: | --- | --- |
| `sped_contabilistas` | Sem leitor/writer de produção localizado | 0 | Nenhuma | Preservar até inspecionar schema/tracker do alvo e consumidores externos. |
| `fiscal_lancamentos` | Sem leitor/writer; menções em comentários | 0 | Nenhuma | Preservar pelo mesmo motivo. |
| `fiscal_perfis_vigencia` | Sem leitor/writer localizado | 0 | Nenhuma | Preservar pelo mesmo motivo. |
| `ciap_competencias_apropriadas` | `INSERT` em `CiapService` | 0 | Nenhuma | Preservar enquanto writer existe; investigar retenção histórica. |
| `ciap_movimentos` | Dois caminhos de `INSERT` em `CiapService` | 0 | `ciap_apropriacoes` e autorreferência | Preservar; integra a trilha patrimonial. |
| `sped_arquivos_gerados` | `INSERT` e `UPDATE` em geração de EFD | 0 | Nenhuma | Preservar como histórico de geração. |
| `classificacao_destinacao_aprendizado` | `INSERT`/`DELETE` e **leitura ativa** via alias `aprendizado` em `ClassificacaoDestinacaoService` | **48** | Nenhuma | Preservar. O relatório histórico que a chamava somente-escrita estava incorreto. |
| `fiscal_regras_versoes` | Leitura em `FiscalNormativeCatalogService`; sem writer encontrado | 0 | Nenhuma | Preservar, pois remover quebra consulta viva. |
| `fiscal_decisoes_item` | Leituras de métricas/inventário; sem writer encontrado | 0 | Nenhuma | Preservar, pois remover quebra consulta viva. |

`fiscal_fechamentos`, `fiscal_pagamentos_eventos`, `fiscal_entregas`, `clientes.cpf` e `documentos_fiscais_itens.cod_cta_sped` têm uso real e não são candidatas a retirada. Nas colunas investigadas, `folhas_pagamento.documento_id`, `documentos_fiscais_itens.cod_obs_sped`, `regras_fiscais.apropria_credito_pis_cofins` e `fiscal_catalogos_versoes.data_carga` tinham zero valores não nulos no banco local; isso não prova que estejam vazias em produção ou fora de integrações. Nenhuma migration de remoção foi gerada ou aplicada.

### Continuação da fase 4: preflight e dependências

O `scripts/preflight-migrations.sql` antigo falhava na primeira consulta às guias porque usava a tabela removida `documentos`. Também classificava CNPJ alfanumérico legítimo como inválido, omitira `SUSPENSO` em `guias.email_status`, rejeitava NFS-e válida e tratava folhas de tipos diferentes na mesma competência como duplicatas. O script agora usa os nomes e checks atuais, limita a unicidade mensal a `FOLHA_MENSAL` e abre transação `READ ONLY`. Executado no PostgreSQL local com `ON_ERROR_STOP=1`: **22 consultas, nenhuma linha de violação, sem escrita**. A matriz completa por objeto, incluindo uso, SQL cru, índices, consumo externo e backup, está em `docs/schema-candidates-matrix.md`.

O novo `scripts/preflight-schema-audit.sql` reúne contagens, índices, FKs inbound, dependências de colunas, tracker de migrations e quatro diagnósticos de pagamento, com `BEGIN READ ONLY` e timeout de 15 s. Executou com sucesso no banco local. Seus quatro hashes do tracker coincidiram com SHA-256 dos arquivos `drizzle/0000`–`0003` locais. O script é um preflight para clone/ambiente alvo, não uma autorização para DROP.

| Coluna candidata | Total de linhas no banco local | Valores não nulos | Dependência de catálogo |
| --- | ---: | ---: | --- |
| `folhas_pagamento.documento_id` | 39 | 0 | FK para `guias` |
| `documentos_fiscais_itens.cod_obs_sped` | 8.124 | 0 | Nenhuma dependência inbound localizada no catálogo |
| `regras_fiscais.apropria_credito_pis_cofins` | 0 | 0 | Default |
| `fiscal_catalogos_versoes.data_carga` | 0 | 0 | Default |

As nove tabelas candidatas estão presentes no banco local e têm 26 índices ao todo. `ciap_movimentos` recebe duas FKs inbound (de `ciap_apropriacoes` e dela própria). Nenhuma referência direta aos nove nomes de tabela foi localizada em `web/`, `extensao/` ou `backup-restore/`; este último descobre tabelas dinamicamente, permite exclusões por flag e faz `TRUNCATE` antes do restore. O backup identificado pelo usuário foi posteriormente localizado em `backup-drive/documentos/` e ensaiado como descrito abaixo. O usuário informou que não conhece consumidores externos das três tabelas sem uso encontrado; integrações fora do workspace não foram inspecionadas.

Os diagnósticos locais de pagamentos retornaram zero para guia de upload paga sem evento de origem, guia fiscal `PAGO` com saldo aberto, guia de upload pendente com obrigação fiscal já quitada e origem de upload duplicada. A mesma verificação no banco implantado ainda é necessária antes de qualquer correção histórica. `docs/database-rebuild.md` e `README.md` foram alinhados ao journal atual e o runbook passou a usar uma variável dedicada para o banco novo, preservando o `.env` da API em operação.

### Ensaio local de migration, com autorização para descartar o banco de testes

O usuário autorizou apagar `kontabb-development`. Para manter uma referência intacta, foi criado `kontabb_schema_trial_20261031` por `pg_dump`/`pg_restore` do banco local (28 MB; 57 tabelas; 48 linhas de aprendizado). Ambos os preflights passaram no clone. O ensaio em `scripts/dry-run-unused-tables.sql` verificou que `sped_contabilistas`, `fiscal_lancamentos` e `fiscal_perfis_vigencia` estavam vazias, executou `DROP TABLE ... RESTRICT` dentro de uma transação e confirmou o retorno das três tabelas após `ROLLBACK`.

Uma linha sintética foi então inserida em `sped_contabilistas` **somente no clone**. O mesmo ensaio abortou com erro antes de qualquer `DROP`, como exigido pela guarda de dados. A linha de teste foi removida do clone, e clone e dump temporário foram descartados. O `kontabb-development` original segue com 57 tabelas e 48 linhas de aprendizado. O arquivo de ensaio não faz parte do journal Drizzle e **não é migration de deploy**. Naquele momento ainda não havia inventário do backup informado como implantado; o preflight do schema/tracker do alvo e a revisão de consumidores externos seguem pendentes. Por isso não foi versionado um `0004` destrutivo.

O utilitário `backup-restore` também foi ensaiado com dados locais: backup de **57 tabelas e 13.390 registros**; `dry-run` de restore em banco vazio recém-migrado validou **104 FKs** e reverteu sem persistir linhas; restore real no banco isolado trouxe as 57 tabelas/13.390 registros; os dois preflights passaram (22 consultas de integridade sem violações), o ensaio `DROP ... RESTRICT` voltou a passar com `ROLLBACK` e o `AppModule` iniciou e fechou usando o banco restaurado. O banco de restore e o backup temporário foram descartados. Isso comprova o fluxo com dados **locais**, não a cobertura de um backup do ambiente implantado.

### Ensaio do backup identificado como implantado

O usuário apontou `backup-drive/documentos/kontabb-20261031-153521.sql.gz` e confirmou que foi gerado a partir do banco implantado. O arquivo passou por `gzip -t` (SHA-256 `f6af225420db1d6eb2f09e7a2d873e1721a0bcad601c90053ee2ba5274c79035`); seu manifesto declara **57 tabelas e 13.389 registros**. A origem foi informada pelo usuário, pois o cabeçalho do arquivo não registra o host nem o banco fonte. O diretório `backup-drive/documentos/` está ignorado pelo Git.

Em `kontabb_backup_trial_20261031`, banco isolado criado vazio, foram aplicadas as migrations locais `0000`–`0003`. O restore `--dry-run` do arquivo validou **104 FKs** e reverteu; o restore transacional real importou as 57 tabelas/13.389 registros. `scripts/preflight-migrations.sql` executou **22 consultas sem linhas de violação**. `scripts/preflight-schema-audit.sql` confirmou nove tabelas candidatas presentes, três tabelas sem uso encontrado com **zero linhas e nenhuma FK inbound**, `classificacao_destinacao_aprendizado` com **48 linhas**, quatro colunas candidatas sem valores não nulos e os quatro diagnósticos de pagamento com **zero ocorrências**. O ensaio `DROP TABLE ... RESTRICT` com `ROLLBACK` passou, restaurando as três tabelas. O `AppModule` iniciou e encerrou com esse clone. Nenhuma alteração foi aplicada ao banco implantado.

As contagens do backup coincidiram com as do banco local de testes em 56 das 57 tabelas; apenas `session` tinha 42 no arquivo e 43 no teste. Isso não permite comprovar a origem do arquivo. Como o backup contém **somente dados**, o tracker de quatro migrations observado no clone foi criado neste ensaio; não prova que o tracker, o DDL, as views, triggers ou as dependências do banco implantado sejam iguais. O usuário ofereceu acesso total a `localhost/kontabb-development`, mas essa é a base de testes; `DATABASE_URL` não está definida no processo e `api/.env` aponta a essa base local. Antes de uma migration destrutiva, ainda faltam preflight somente leitura do schema/tracker **no banco alvo** e revisão dos consumidores externos. O clone do backup foi descartado ao encerrar a auditoria; `kontabb-development` permaneceu intacto.

### Fase 5: organização

Foram revisados os módulos `cliente`, `clientes`, `upload`, `guias`, `health`, `cadastros/contadores` e `rh` contra o inventário de 216 rotas. Os controllers já delimitam escopos de acesso distintos, e seus módulos declaram imports/exports explícitos; há dezenas de referências cruzadas que uma movimentação de arquivos exigiria atualizar. Não foi encontrada falha de DI, rota ou Swagger que um move corrigisse. A fase 5 foi encerrada **sem mover arquivos**, conforme o caráter condicional do prompt. Nenhum cálculo ou artefato fiscal foi alterado nesta continuação.

## Decisões preservadas por risco

- A escrituração fiscal continua baixando e interpretando XML, pois `EscrituracaoFiscalService.reprocessar` usa campos que não têm equivalência demonstrada com os itens persistidos. Sem comparação de EFD por bytes e de contadores de erro em amostra real, reduzir downloads poderia alterar resultado fiscal.
- Pool de conexões, cache e índices não foram modificados sem medição de carga e plano de invalidação. O `EXPLAIN` local de rate limit não justifica índice adicional neste volume.
- Não houve divisão de `schema.ts`, move de módulos nem mudança da senha inicial fixa. Essas alterações exigem migração de comportamento e testes de provisionamento/compatibilidade próprios.
- Antes de qualquer DDL futuro: executar no banco alvo consultas somente leitura de contagem, valores não nulos, FKs, índices, views/triggers e `drizzle.__drizzle_migrations`; verificar SQL externo, exports, restore e consumidores; preparar migration incremental com guarda de dados e ensaiá-la em clone. O backup representativo cobre dados, mas não esses metadados originais.

## Validação final

| Gate | Resultado |
| --- | --- |
| `pnpm exec tsc --noEmit` | Passou. |
| `pnpm exec eslint "{src,apps,libs,test}/**/*.ts"` | Passou, sem `--fix`. |
| `pnpm exec jest --runInBand --silent` | 130 suites, 2.137 testes passaram. |
| `pnpm build` | Passou. |
| `pnpm db:check` | Passou. |
| `git diff --check` | Passou. |

Nenhuma migration nova foi criada ou aplicada fora dos bancos isolados de ensaio. Mudanças destrutivas de schema continuam adiadas até o preflight read-only do schema/tracker no banco implantado e a revisão de consumidores externos. O backup informado como implantado já foi validado em clone com dados.
