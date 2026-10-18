# Implementation Plan — Adiantamento do 13º Salário (RH upload + painel do colaborador)

Goal: teach the RH upload module to recognize a THIRD document type, `ADIANTAMENTO_13`
(13th-salary advance payroll), exactly as it already handles `FOLHA_MENSAL` and `FERIAS`,
and make the collaborator (colaborador) API expose each recibo's `tipo` (plus férias-specific
fields) so the panel can distinguish the three types.

Design decisions (made here, grounded in the code I read):

- **Reuse the monthly parser, don't duplicate it.** The 13º-advance layout is structurally
  identical to `FOLHA DE PAGAMENTO`; the only difference is the title marker
  (`FOLHA DE ADIANTAMENTO DE 13º` vs `FOLHA DE PAGAMENTO`). So in `pdf-extraction-rh.ts` I
  parameterize the document marker: extract the current body of `extractDadosFolhaPagamento`
  into a private `extractDadosFolhaComMarcador(text, marcador)` that takes the marker string,
  and keep `extractDadosFolhaPagamento` as a thin wrapper passing `'FOLHA DE PAGAMENTO'`. The
  page-header-stripping regex is generalized to accept either marker. This keeps monthly
  behavior byte-for-byte identical (same wrapper, same marker) while the new
  `extractDadosAdiantamento13` wrapper passes `'FOLHA DE ADIANTAMENTO DE 13º'`. Rationale:
  avoids copy-paste drift between two near-identical ~250-line parsers.
- **Detector kept separate and strict.** Add `isAdiantamento13(text)` returning
  `text.includes('FOLHA DE ADIANTAMENTO DE 13º')`. Because the 13º text does NOT contain
  `FOLHA DE PAGAMENTO`, the monthly `extractDadosFolhaPagamento` validator naturally rejects
  it and there is no accidental overlap. `isReciboFerias` already excludes docs containing
  `FOLHA DE PAGAMENTO` but NOT the 13º marker — verify férias detection still returns false
  for 13º text (it does: 13º text has no `RECIBO DE FÉRIAS`/`NOTIFICAÇÃO DE FÉRIAS`).
- **Routing order** in `processFile()`: check `isReciboFerias` first (unchanged), then
  `isAdiantamento13`, then fall back to `processFolhaFile`. 13º check must come before the
  monthly fallback.
- **Discriminator value `ADIANTAMENTO_13`** used consistently in DB, controller union,
  service, and audit payloads.
- **Unique index stays FOLHA_MENSAL-only.** Keep `uidx_folhas_cliente_competencia` scoped to
  `FOLHA_MENSAL` so a monthly folha and a 13º advance for the same competência can coexist;
  enforce 13º duplicate prevention in `checkDuplicateAdiantamento13` at the service layer
  (mirror of `checkDuplicateFolha`, filtered to `tipo = 'ADIANTAMENTO_13'`).
- **Email (dedicated, REQUIRED)**: add a NEW `sendAdiantamento13NotificationEmail` method plus
  a `buildAdiantamento13Html` template in `mail.service.ts`, modeled on
  `sendFolhaPagamentoNotificationEmail`/`buildFolhaPagamentoHtml` (13º advance is multi-employee
  like monthly payroll). Subject references "Adiantamento do 13º Salário" and the competência
  (e.g. `Adiantamento do 13º Salário disponível · Competência ${competencia}`); body shows total
  de funcionários and total líquido; keep the same footer/branding
  ("Kontabb · Contabilidade Borges"), the "Nunca enviamos documentos em anexo por e-mail" notice,
  and the portal link used by the existing templates. Wire it into `processAdiantamento13File`
  fire-and-forget, skipping suspended clients, exactly like the monthly/férias paths. Leave the
  existing `sendFeriasNotificationEmail` intact (férias notification is already done).

Project facts (verified): build = `npm run build` (nest build); tests = `npm test` (jest,
`rootDir: src`, `testRegex: .*\.spec\.ts$`); run a single spec with
`npx jest src/rh/<file>.spec.ts`. Migrations are hand-written SQL in `drizzle/` numbered
sequentially; latest is `0031_unique_electro.sql`, so the new one is `0032`. `drizzle-kit`
state lives in `drizzle/meta/_journal.json` + `NNNN_snapshot.json`; the check constraint is
represented in the snapshot's `checkConstraints` block as
`"chk_folhas_tipo": { "name": ..., "value": "\"folhas_pagamento\".\"tipo\" IN ('FOLHA_MENSAL', 'FERIAS')" }`.

---

- [ ] 1. Add 13º detection + extraction by parameterizing the monthly parser.
      In `src/common/pdf-extraction-rh.ts`: refactor `extractDadosFolhaPagamento` so its body
      becomes a private `extractDadosFolhaComMarcador(text, marcador)`; make
      `extractDadosFolhaPagamento` call it with `'FOLHA DE PAGAMENTO'`. Generalize the
      `pageHeaderPattern` and the `FOLHA DE PAGAMENTO`-anchored literals to use the passed
      marker. Export `isAdiantamento13(text)` and `extractDadosAdiantamento13(text)` (wrapper
      passing `'FOLHA DE ADIANTAMENTO DE 13º'`). Do not change any returned field for monthly.
      Files: src/common/pdf-extraction-rh.ts
      Verify: `npx jest src/rh/rh-extraction.spec.ts` — existing monthly specs still pass
      unchanged; then step 2's new spec covers the 13º path.

- [ ] 2. Add the 13º extraction spec.
      Create `src/rh/rh-adiantamento13-extraction.spec.ts` following the embedded-string-fixture
      convention of `rh-extraction.spec.ts`. Build the fixture from the real extracted text of
      `13 SAL.pdf` (CNPJ 13.744.722/0001-00, 4 funcionários, ALDENORA VITORIA DE CARVALHO
      líquido 862,03, Total FGTS 307,77). Assert: `isAdiantamento13` returns true for the 13º
      fixture and false for a `FOLHA DE PAGAMENTO` string and a `RECIBO DE FÉRIAS` string;
      `extractDadosAdiantamento13` returns CNPJ `13.744.722/0001-00`, 4 funcionários, and the
      ALDENORA employee with líquido 862,03. Optionally assert the 12-employee
      07.754.759/0001-09 fixture. To capture fixture text, use a throwaway Node script calling
      unpdf `extractText(uint8, { mergePages: true })` on the two PDFs, paste the output as
      string literals, then DELETE the script.
      Files: src/rh/rh-adiantamento13-extraction.spec.ts
      Verify: `npx jest src/rh/rh-adiantamento13-extraction.spec.ts` — all new assertions pass.

- [ ] 3. Route 13º uploads in the controller.
      In `src/rh/rh-upload.controller.ts`: extend `RhFileResult.tipo` union to
      `'FOLHA_MENSAL' | 'FERIAS' | 'ADIANTAMENTO_13'`; import `isAdiantamento13` /
      `extractDadosAdiantamento13`; in `processFile()` add a branch after the `isReciboFerias`
      check: `if (isAdiantamento13(text)) return this.processAdiantamento13File(...)`. Add
      `processAdiantamento13File` modeled on `processFolhaFile` (multi-employee): parse, find
      client by CNPJ, call `checkDuplicateAdiantamento13`, upload to R2 with key
      `rh/<cnpj>/<year>/<month>/adiantamento13-<uuid>.pdf`, call
      `processarAdiantamento13`, cleanup R2 on failure, send email via the NEW
      `sendAdiantamento13NotificationEmail` (skip suspended clients, fire-and-forget), return
      `tipo: 'ADIANTAMENTO_13'`.
      Files: src/rh/rh-upload.controller.ts
      Verify: `npm run build` compiles with no type errors (union + new method typecheck).

- [ ] 3b. Add the dedicated 13º-advance mail method.
      In `src/mail/mail.service.ts` add `sendAdiantamento13NotificationEmail({ to, clientName,
  competencia, totalFuncionarios, totalLiquido })` and a private `buildAdiantamento13Html`,
      both modeled on `sendFolhaPagamentoNotificationEmail`/`buildFolhaPagamentoHtml`. Subject
      `Adiantamento do 13º Salário disponível · Competência ${competencia}`; body shows total de
      funcionários and total líquido; reuse the shared layout, branding footer, no-attachment
      notice, and portal link. Leave `sendFeriasNotificationEmail` untouched.
      Files: src/mail/mail.service.ts
      Verify: `npm run build` compiles clean.

- [ ] 4. Persist 13º advances in the service.
      In `src/rh/rh.service.ts`: add `processarAdiantamento13` modeled exactly on
      `processarFolhaPagamento` (same single-SQL-CTE atomic insert, same employee-count
      consistency check) but inserting `tipo = 'ADIANTAMENTO_13'` and audit action
      `'ADIANTAMENTO_13_UPLOADADO'` (entidade_tipo `'FOLHA_PAGAMENTO'`). Add
      `checkDuplicateAdiantamento13(clienteId, competencia)` mirroring `checkDuplicateFolha`
      filtered to `tipo = 'ADIANTAMENTO_13'`.
      Files: src/rh/rh.service.ts
      Verify: `npm run build` compiles clean.

- [ ] 5. Schema + migration for the new tipo value.
      In `src/database/schema.ts`: change the `chk_folhas_tipo` check to
      `IN ('FOLHA_MENSAL', 'FERIAS', 'ADIANTAMENTO_13')`. Leave
      `uidx_folhas_cliente_competencia` scoped to `FOLHA_MENSAL` (unchanged). Hand-write
      `drizzle/0032_<name>.sql` that drops and recreates `chk_folhas_tipo` with the new allowed
      set, matching the SQL style of `0010_adicionar_ferias_rh.sql`
      (`ALTER TABLE ... DROP CONSTRAINT ...; --> statement-breakpoint; ALTER TABLE ... ADD
CONSTRAINT "chk_folhas_tipo" CHECK (...)`). Add `drizzle/meta/0032_snapshot.json` (copy of
      0031 with a fresh `id`, `prevId` = 0031's `id`, and the updated `chk_folhas_tipo.value`)
      and append the matching entry to `drizzle/meta/_journal.json` (idx 32, tag
      `0032_<name>`). Prefer running `npm run db:generate` to produce these consistently; if
      hand-editing, match the exact JSON shape of the existing snapshot/journal.
      Files: src/database/schema.ts, drizzle/0032_*.sql, drizzle/meta/0032_snapshot.json,
      drizzle/meta/_journal.json
      Verify: `npm run db:check` reports the drizzle state consistent (no pending drift) and
      `npm run build` compiles.

- [ ] 6. Expose `tipo` (and férias fields) in the collaborator panel.
      In `src/colaborador/colaborador.service.ts`: in `listRecibos`, `getReciboDetalhe`, and
      `getReciboPdf`, add `folhasPagamento.tipo` to the selected columns and return it in each
      recibo DTO; also select+return `diasFerias`, `periodoAquisitivoInicio`,
      `periodoAquisitivoFim` where meaningful (detalhe/pdf). Keep response shape backward-
      compatible (add fields only). No controller changes needed (`colaborador.controller.ts`
      passes DTOs through), but confirm.
      Files: src/colaborador/colaborador.service.ts
      Verify: `npm run build` compiles; `npm test` green overall.

- [ ] 7. Full build + full test suite.
      Run the whole project build and test suite to confirm no regressions in monthly/férias
      behavior and that the new 13º spec passes.
      Files: (none)
      Verify: `npm run build` succeeds and `npm test` passes with all RH/colaborador specs green.

Open assumptions / gaps:

- The 13º `Ref.: (...)` period header is assumed identical to monthly (task says the DD/MM/YYYY
  range comes from the header exactly like monthly). If the real extracted text differs, the
  period regex in the parameterized parser may need a small generalization — the step-2 fixture
  built from the real PDF will surface this; adjust the regex, not the monthly wrapper's result.
- Email: a dedicated `sendAdiantamento13NotificationEmail` + `buildAdiantamento13Html` is now
  REQUIRED (user requirement update), modeled on the monthly-payroll mail method; no longer a
  reuse of `sendFolhaPagamentoNotificationEmail`. The existing `sendFeriasNotificationEmail`
  stays intact (férias notification already done).
