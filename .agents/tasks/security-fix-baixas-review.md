# CORS condicional por ambiente e sanitização de segmentos de chave R2

Esta mudança fecha os dois achados [BAIXA] do scan de segurança: a allowlist de CORS passa a ser montada por ambiente (origens de dev só fora de produção) e os segmentos de chave de objeto no R2 passam por um validador na origem que rejeita separadores de caminho, traversal e caracteres de controle. A abordagem é defesa em profundidade — as origens de dados já eram seguras pelos DTOs, mas a validação explícita no `StorageService` fecha a lacuna caso uma origem futura escape. Os call sites PF normalizam o CPF para dígitos antes de compor a chave, mantendo o formato idêntico para dados legítimos.

Watch for: nenhum achado bloqueante. O diff de `guias.service.ts` carrega reformatação cosmética de chaves/indentação além da única linha de comportamento (confirmed) — ruído de revisão, não um risco.

**Verdict**: APPROVED

## High-level view

A allowlist de CORS em `src/main.ts` agora deriva de um array `corsOrigins` construído a partir das origens de produção (`www.kontabb.com.br`, `kontabb.com.br`, `configuredAppUrl`) e acrescenta `http://localhost:3000` apenas quando `isProduction` é falso. A deduplicação por `new Set(...)` evita repetição quando `APP_URL` coincide com uma origem de prod. `credentials: true` permanece, não há `origin: '*'`, e a ordem dos demais middlewares está intacta.

A sanitização de chaves R2 centraliza num helper `assertSafeKeySegment(value, label)` que lança erro para segmentos vazios/não-string, com `/`, `\`, `..` ou caracteres de controle, e devolve o valor inalterado caso contrário. Ele é aplicado a todos os segmentos derivados de dados em `documentObjectKey`, `receiptObjectKey` e `logoObjectKey`. O formato das chaves válidas é preservado byte a byte, confirmado pelos testes de aceitação.

O ramo PF em `GuiasService.confirmPayment` e `ClientesService` (atualização de logo) normaliza o CPF via `.replace(/\D/g, '')` antes de virar segmento. Como o CPF é validado no DTO como `\d{11}` e o CNPJ como `[0-9A-Z]{12}[0-9]{2}`, a normalização é no-op para dados legítimos e o segmento ainda passa pelo validador.

O escopo foi respeitado: `setup.controller.ts` / senha `123456`, `getLogo`/`getSession`/guards do colaborador ([BAIXA] 12, [MÉDIA] 8) não aparecem no diff, e nenhuma correção anterior foi desfeita.

<details>
<summary>Issues (1)</summary>

1. **Ruído de reformatação em guias.service.ts** (não bloqueante) — o diff mistura a única linha de comportamento (normalização de CPF) com reindentação de literais e `{}`→`{ }` em handlers de catch vazios. Cosmético; opcionalmente isolar em commit à parte no futuro.

</details>

<details>
<summary>Details</summary>

### Correção A — CORS condicional por ambiente ([BAIXA] 10)

Verifiquei `src/main.ts` diretamente (confirmed). O array `corsOrigins` começa com as três origens de produção e o spread `...(isProduction ? [] : ['http://localhost:3000'])` injeta a origem de dev somente fora de produção. Em produção o resultado é exatamente `{www.kontabb.com.br, kontabb.com.br, configuredAppUrl}`; fora de produção acrescenta `localhost:3000`. `configuredAppUrl` (`APP_URL`, obtido via `getOrThrow`) continua presente nos dois ambientes. O `new Set(...)` remove duplicatas caso `APP_URL` coincida com uma origem de prod. `credentials: true` preservado e não há `origin: '*'`. A sequência helmet → CORS → cookie-parser → request-id → ValidationPipe → filtros → Swagger (gated por ambiente) está inalterada — o `enableCors` permanece antes do `helmet`, como no baseline.

### Correção B — sanitização de segmentos de chave R2 ([BAIXA] 11)

Li `src/storage/storage.service.ts` inteiro (confirmed). `assertSafeKeySegment` rejeita valor vazio/não-string e qualquer segmento contendo `/`, `\`, `..` ou caractere de controle (`\u0000-\u001f`, `\u007f`), devolvendo o valor intocado caso contrário. Está aplicado a todos os segmentos derivados de dados:

- `documentObjectKey`: `cnpj`, `period.year`, `period.month` (com guarda `?? ''` após o split, que converte um `period` malformado em segmento vazio → rejeitado), `obligationId`, `type`.
- `receiptObjectKey`: `cnpjCpf`, `receiptId`, `extension`.
- `logoObjectKey`: `cnpjCpf`, `extension`.

Os prefixos literais (`clientes/`, `/comprovantes/`, `logo.`) e a estrutura da chave são idênticos ao baseline, então chaves já existentes em produção continuam resolvendo para a mesma string. Os testes `storage.service.spec.ts` confirmam o formato preservado para CNPJ (`clientes/12345678000190/logo.png`) e CPF numérico (`clientes/12345678901/comprovantes/<uuid>.pdf`), e a rejeição de `/` e `..`.

### Call sites PF ([BAIXA] 11, fluxo CPF)

`GuiasService.confirmPayment` (linha ~589) e `ClientesService` na atualização de logo (linha ~743) agora fazem `cpf.replace(/\D/g, '')` no ramo PF antes de passar `cnpjCpf` ao `StorageService`. Confirmei nos DTOs (`clientes.dto.ts`) que o CPF é `@Matches(/^\d{11}$/)` e o CNPJ `@Matches(/^[0-9A-Z]{12}[0-9]{2}$/)`, logo a normalização é transparente (no-op) para dados válidos e o segmento resultante é numérico, passando pelo validador sem alterar a chave. O ramo PJ (`cnpj`) não é normalizado no call site, mas o DTO já garante `[0-9A-Z]` e o validador cobre o restante — consistente com a premissa da correção.

### Escopo e regressões

`git diff --name-only` lista apenas `main.ts`, `storage.service.ts`, `storage.service.spec.ts`, `guias.service.ts`, `clientes.service.ts` e o doc de task. Grep por `setup.controller`, `getLogo`, `getSession`, `colaborador`, `guard` no conjunto de arquivos alterados retorna vazio — [BAIXA] 12 e [MÉDIA] 8 (senha `123456`) intocados, conforme decisão do dono do produto. Nenhuma correção anterior foi desfeita no diff.

### Evidência de verificação (não re-executada)

Conforme instrução, não re-rodei `pnpm build`/`test`/`tsc`. O doc `security-fix-baixas-2026-10-11.md` registra: `tsc --noEmit` com 22 erros idênticos ao baseline (todos em specs fiscais pré-existentes, nenhum novo); `pnpm build` exit 0; `pnpm test` com 2048 passando e as 2 falhas de meta-presença pré-existentes, com o novo spec de storage passando. Baseline e pós-mudança coincidem — sem regressões relatadas. A evidência está presente e é consistente com o diff, então aceito-a sem spot-check adicional.

</details>

<details>
<summary>File map</summary>

- `src/main.ts` — allowlist de CORS montada por ambiente, dedupe via Set.
- `src/storage/storage.service.ts` — helper `assertSafeKeySegment` aplicado em `documentObjectKey`/`receiptObjectKey`/`logoObjectKey`.
- `src/storage/storage.service.spec.ts` — novo spec: rejeição de `/` e `..`, aceitação de CNPJ/CPF sem alterar formato.
- `src/guias/guias.service.ts` — normalização de CPF no ramo PF de `confirmPayment` (+ reformatação cosmética).
- `src/clientes/clientes.service.ts` — normalização de CPF no ramo PF da atualização de logo.
- `.agents/tasks/security-fix-baixas-2026-10-11.md` — doc de task com evidência de verificação.

Diff completo: `git -C /Users/pablo/dev/kontabb/api/.worktrees/sec-fix-baixas diff 64c8b02...security/fix-baixas`

</details>
