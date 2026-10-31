# Auditoria estática da API e do schema — 31/10/2026

## Escopo e evidência

Revisão dos dois prompts na raiz, `api/src`, `api/drizzle`, documentação da API,
contratos em `web/lib` e crons em `web/vercel.json`. Esta é uma auditoria do
código e das migrations versionadas. **Não houve conexão ou alteração no banco
de produção**, então ocupação real, FKs externas, locks e drift do banco implantado
continuam desconhecidos.

O schema atual declara **57** chamadas a `pgTable`, e o teste
`src/database/baseline-migration.spec.ts` também exige 57. O relatório antigo
`.agents/tasks/auditoria-tabelas-schema.md` diz 56, embora sua própria tabela
enumere 57 objetos. Trate a classificação antiga como hipótese a reconfirmar.

## Validação inicial, antes das edições

| Comando | Resultado | Evidência |
| --- | --- | --- |
| `pnpm build` | Não executado antes das edições; passou após as correções | compilação NestJS |
| `pnpm db:check` | Passou | consistência dos arquivos de migrations; não verifica o banco implantado |
| `pnpm exec tsc --noEmit` | Falhou | erros preexistentes em specs de auth, fiscal, importação e entrega |
| `pnpm exec eslint "{src,apps,libs,test}/**/*.ts"` | Falhou | 60 erros preexistentes, sobretudo formatação e algumas regras de tipos |
| `pnpm exec jest --runInBand` | Falhou | 125 suites passaram; 2 suites/7 testes falharam por três XMLs ausentes na raiz do workspace |

Os XMLs ausentes são `NFSe_2026000000196_2WRT-ZASA.xml`,
`NFSe_2026000000197_LY43-SBWA.xml` e
`NFSe_2026000000198_QRJX-U4AQ.xml`. Não foram inventados substitutos, pois isso
poderia ocultar regressões do parser.

## Achados e decisões

| Prioridade | Achado | Evidência | Situação |
| --- | --- | --- | --- |
| Alta | `GET /setup` criava ADMIN em desenvolvimento com dados pessoais e senha fixa; em ambiente configurado incorretamente seria exposto. | `src/health/setup.controller.ts`; seed seguro em `src/database/seeds/admin.seed.ts` | Controller removido do módulo e arquivo excluído. |
| Alta | `POST /admin/storage/reconcile` era uma chamada de limpeza mutativa que ignorava `limit`, enquanto `docs/storage-lifecycle.md` a descrevia como reconciliação somente leitura. | `src/storage/storage.controller.ts`, `src/storage/storage-cleanup.service.ts` | `limit` validado em 1–50 e aplicado ao claim; documentação e Swagger agora descrevem o efeito real. **Reconciliação de objetos ainda não existe.** |
| Alta | Dois crons mutativos usam GET porque o Vercel Cron os invoca assim. | `web/vercel.json`, `web/next.config.ts`, `src/cron/cron.controller.ts` | GET e autenticação por `CRON_SECRET` preservados. |
| Alta | Quitação de `guias` pode ficar sem evento na trilha `fiscal_pagamentos_eventos` quando há vínculo com `fiscal_apuracoes_guias`. | `GuiasService.confirmPayment`, `FiscalGuiasService.registrarEventoPagamento`, índice `uidx_fiscal_guias_guia_upload` | Sem alteração automática: exige transação única, critério de valor/data e idempotência testada. A v2 cita incorretamente `registerPayment` e `POST /admin/guias/:id/pay`; o endpoint real é `PATCH /guias/:id/pagar`. |
| Média | O envio ao Mailtrap não tinha timeout. | `src/mail/mail.service.ts` | Timeout de 10 s adicionado; falha continua retornando `false` e sendo registrada. |
| Média | `carregarAnexos` executava uma consulta por anexo. | `src/fiscal/services/simples-nacional.service.ts` | Faixas carregadas em lote, preservando ordem e formato da resposta. |
| Média | `app_rate_limits` usa `reset_at` bigint e não tem expurgo; a tabela também guarda janelas da consulta SEFAZ. | `src/database/schema.ts`, `src/common/rate-limit.service.ts`, `src/fiscal/services/sefaz-consulta-control.service.ts` | Pendente: definir margem de retenção e rotina periódica com testes. Não apagar janelas ativas. |
| Média | `findRegisteredCnpjs` executa uma query por raiz; importação CIAP faz consulta por bem; escrituração baixa XMLs sequencialmente. | `src/clientes/clientes.service.ts`, `src/fiscal/services/ciap.service.ts`, `src/fiscal/services/escrituracao-fiscal.service.ts` | Pendente de teste de equivalência. O XML fornece metadados e campos fiscais além dos itens persistidos; pular o download por existir item **não é equivalência comprovada**. |
| Média | Senha inicial `123456` aparece em fluxos ativos de colaborador e CRM. | `src/colaborador/colaborador.service.ts`, `src/crm/crm.service.ts` | Centralizar literal não resolve o risco. Revisar provisionamento, troca obrigatória e compatibilidade antes de mudar. |

## Schema e migrations

- Candidatas sem referência de produção fora do schema, na varredura estática:
  `sped_contabilistas`, `fiscal_lancamentos`, `fiscal_perfis_vigencia`.
  `ciap_competencias_apropriadas` tem uma escrita em `ciap.service.ts` e nenhum
  leitor encontrado. **Ausência de referência no código não prova ausência de
  dados ou consumidores externos**; nenhum DROP foi gerado.
- Preservar `fiscal_fechamentos`, `fiscal_pagamentos_eventos`,
  `fiscal_entregas`, `clientes.cpf` e `documentos_fiscais_itens.cod_cta_sped`:
  há leituras/escritas ou contrato fiscal/HTTP ativo. A primeira versão do prompt
  erra ao sugerir remoção de parte desses objetos.
- Colunas candidatas a investigação: `folhas_pagamento.documento_id`,
  `documentos_fiscais_itens.cod_obs_sped`,
  `regras_fiscais.apropria_credito_pis_cofins`,
  `fiscal_catalogos_versoes.data_carga`. Verificar dados preenchidos,
  dependências, exports e relatórios antes de retirar.
- `drizzle/0000_baseline_kontabb.sql` já é seguido por `0001`–`0003` no journal.
  Não reescrever o histórico aplicado: qualquer mudança futura de schema deve
  gerar migration incremental, revisada contra banco de homologação com dados.
- `pnpm db:check` não faz comparação com `information_schema` do banco vivo.
  Consultar o tracker `drizzle.__drizzle_migrations`, catalogar colunas/índices
  e executar preflight read-only antes de DDL.
- A v2 propõe `max: 20` para cada instância da API sem medir o limite de
  conexões ou quantidade de réplicas. Não foi alterado; dimensionar a partir da
  capacidade do Postgres e do modo de deploy.

## Verificação das edições desta revisão

`pnpm build`, `pnpm db:check` e os testes direcionados de storage, e-mail e
Simples passaram. A validação global continua limitada pelas falhas iniciais
listadas acima. Não houve migration, DDL ou operação no banco remoto.

O prompt consolidado em `../PROMPT_REFATORACAO_E_OTIMIZACAO_API_CONSOLIDADO.md`
é a instrução atual para continuar o trabalho. Ele substitui as orientações
conflitantes das versões anteriores sem apagar os arquivos históricos.
