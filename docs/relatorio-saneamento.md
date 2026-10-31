# Relatório de saneamento da API e do schema — 31/10/2026

## Escopo e limite da evidência

Implementação do `PROMPT_REFATORACAO_E_OTIMIZACAO_API_CONSOLIDADO.md` em `api/`, com inspeção dos consumidores em `web/` e `extensao/`. A raiz `kontabb/` não é repositório Git. O banco `kontabb_audit_20261031` foi criado no PostgreSQL local exclusivamente para migrar e testar, e removido após a validação; o banco local `kontabb-development` foi consultado apenas em transações `READ ONLY`. Não houve conexão com produção, DDL no banco configurado pela API nem remoção de dados da aplicação. Os números locais não demonstram ocupação ou compatibilidade do banco implantado.

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
| `sped_contabilistas` | Sem leitor/writer de produção localizado | 0 | Nenhuma | Preservar até preflight no alvo e verificação de integrações/backups. |
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

As nove tabelas candidatas estão presentes no banco local e têm 26 índices ao todo. `ciap_movimentos` recebe duas FKs inbound (de `ciap_apropriacoes` e dela própria). Nenhuma referência direta aos nove nomes de tabela foi localizada em `web/`, `extensao/` ou `backup-restore/`; este último descobre tabelas dinamicamente, permite exclusões por flag e faz `TRUNCATE` antes do restore. Logo, ausência de referência textual não demonstra que um backup real inclua os dados. Nenhum arquivo de backup representativo foi localizado no projeto ou em `Downloads`; artefatos externos e integrações fora do workspace não foram inspecionados.

Os diagnósticos locais de pagamentos retornaram zero para guia de upload paga sem evento de origem, guia fiscal `PAGO` com saldo aberto, guia de upload pendente com obrigação fiscal já quitada e origem de upload duplicada. A mesma verificação no banco implantado ainda é necessária antes de qualquer correção histórica. `docs/database-rebuild.md` e `README.md` foram alinhados ao journal atual e o runbook passou a usar uma variável dedicada para o banco novo, preservando o `.env` da API em operação.

### Fase 5: organização

Foram revisados os módulos `cliente`, `clientes`, `upload`, `guias`, `health`, `cadastros/contadores` e `rh` contra o inventário de 216 rotas. Os controllers já delimitam escopos de acesso distintos, e seus módulos declaram imports/exports explícitos; há dezenas de referências cruzadas que uma movimentação de arquivos exigiria atualizar. Não foi encontrada falha de DI, rota ou Swagger que um move corrigisse. A fase 5 foi encerrada **sem mover arquivos**, conforme o caráter condicional do prompt. Nenhum cálculo ou artefato fiscal foi alterado nesta continuação.

## Decisões preservadas por risco

- A escrituração fiscal continua baixando e interpretando XML, pois `EscrituracaoFiscalService.reprocessar` usa campos que não têm equivalência demonstrada com os itens persistidos. Sem comparação de EFD por bytes e de contadores de erro em amostra real, reduzir downloads poderia alterar resultado fiscal.
- Pool de conexões, cache e índices não foram modificados sem medição de carga e plano de invalidação. O `EXPLAIN` local de rate limit não justifica índice adicional neste volume.
- Não houve divisão de `schema.ts`, move de módulos nem mudança da senha inicial fixa. Essas alterações exigem migração de comportamento e testes de provisionamento/compatibilidade próprios.
- Antes de qualquer DDL futuro: executar no banco alvo consultas somente leitura de contagem, valores não nulos, FKs, índices e `drizzle.__drizzle_migrations`; verificar SQL externo, exports, restore e consumidores; preparar migration incremental e ensaiar em clone com dados representativos. O banco local consultado não satisfaz esse gate.

## Validação final

| Gate | Resultado |
| --- | --- |
| `pnpm exec tsc --noEmit` | Passou. |
| `pnpm exec eslint "{src,apps,libs,test}/**/*.ts"` | Passou, sem `--fix`. |
| `pnpm exec jest --runInBand --silent` | 130 suites, 2.137 testes passaram. |
| `pnpm build` | Passou. |
| `pnpm db:check` | Passou. |
| `git diff --check` | Passou. |

Nenhuma migration nova foi necessária ou aplicada fora do banco isolado. As mudanças de schema continuam bloqueadas pela falta de preflight no banco implantado e de clone com dados representativos.
