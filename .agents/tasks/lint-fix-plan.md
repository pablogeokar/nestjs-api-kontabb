# Lint Fix Plan — `pnpm lint` must exit 0 (zero errors, zero warnings)

Scope: NestJS API package at `/Users/pablo/dev/kontabb/api`. `pnpm lint` runs
`eslint "{src,apps,libs,test}/**/*.ts" --fix`. `--fix` already ran, so the 145
remaining problems (141 errors + 4 warnings across 25 files) are NOT
auto-fixable and must be fixed by hand.

## ESLint config facts (confirmed from `eslint.config.mjs`)

- Extends `eslint.configs.recommended` + `tseslint.configs.recommendedTypeChecked`
  (type-aware via `projectService: true`) + `eslint-plugin-prettier/recommended`.
- `@typescript-eslint/no-explicit-any` is **OFF** — a bare `any` is allowed by
  that rule, but the type-aware `no-unsafe-*` rules still fire whenever an `any`
  value flows into an assignment/return/call/member-access/argument. So "cast to
  any" does NOT silence `no-unsafe-*`; you must give a concrete type or `unknown`
  then narrow.
- `no-floating-promises` = warn, `no-unsafe-argument` = warn (these produce the 4
  warnings). All other `no-unsafe-*`, `no-unused-vars`, `unbound-method`,
  `no-base-to-string`, `restrict-template-expressions`, `require-await`,
  `prefer-promise-reject-errors` are errors.
- `prettier/prettier` = error with `endOfLine: "auto"`. Keep edits
  prettier-clean (the final `--fix` run will reformat, but don't introduce
  changes that fight prettier).

### CONFIRMED: `_`-prefix is NOT ignored by no-unused-vars

The config sets **no** `argsIgnorePattern` / `varsIgnorePattern` /
`ignoreRestSiblings`, so `@typescript-eslint/no-unused-vars` uses its defaults.
Empirical proof from the report: `_n`, `_args`, `_projection`, `_omit`,
`_table` all ERROR despite the underscore prefix. **Do NOT fix unused vars by
renaming to `_name`** — it will still error. Remove the binding instead (see
per-rule strategy below). Do not add an `argsIgnorePattern` to the config
(constraint: do not weaken rules).

### IMPORTANT: report line numbers have drifted

The report (`lint-report-2026-10-11.txt`) line:col numbers no longer match
current file contents in several files (the earlier `--fix` reflowed code).
Treat the report as the authoritative **list of files + rules + counts**, but
**re-run `pnpm lint` to get fresh line numbers** before editing, and locate each
occurrence by the surrounding code pattern, not the stale line number.

## Fix strategies by rule (apply consistently; never change runtime behavior)

- **no-unused-vars** — remove the unused import/variable/param. For unused
  trailing arrow params in mock factories, delete the param list down to `()`.
  For destructure-to-omit (`const { x: _omit, ...rest } = obj`), rebuild `rest`
  without the key instead of naming the omitted binding (see st-enquadramento).
- **no-unsafe-\*** (assignment/return/call/member-access) — give the mock/
  variable a concrete type. Prefer, in order: a small explicit `interface`/`type`
  for drizzle-style query chains; `jest.Mock<Return, Args>` typing so
  `.mock.calls[i][j]` is typed; a localized `as ConcreteType` cast on the
  extracted value; or `as unknown` then narrow. A bare `any` is NOT acceptable.
- **no-unsafe-argument** (the 4 warnings, all in fiscal-closing.service.spec.ts)
  — resolved automatically once the `tx` mock is typed (see that file).
- **unbound-method** — assert on a captured `jest.fn()` reference (keep the mock
  fn in a typed local and reference it directly) or wrap in an arrow
  `() => obj.method()`. Do not change what is asserted.
- **no-base-to-string** — ensure the interpolated/`String()`'d value is actually
  a string before stringifying (narrow `unknown` with `typeof === 'string'`, or
  render typed fields via a real formatter). Never let an object hit default
  `[object Object]`.
- **restrict-template-expressions** — same root cause as the builder's
  `no-base-to-string`: extract the string value from the `SpedTypedField` before
  interpolating.
- **require-await** — remove `async` from the mock factory/arrow that has no
  `await` (keep it returning the same resolved value, e.g.
  `jest.fn().mockResolvedValue(x)` or `() => Promise.resolve(x)`).
- **prefer-promise-reject-errors** — reject with an `Error` instance, preserving
  any extra fields the code under test reads (e.g. `.code`) via `Object.assign`.
- **eslint-disable** — LAST RESORT only, per-line, with a one-line justification.
  Do not blanket-disable and do not touch `eslint.config.mjs`.

## Shared helper worth introducing

Several spec files build drizzle-style fluent query mocks typed as `any`, which
is the source of most `no-unsafe-*` errors (notably fiscal-closing.service.spec).
Introduce ONE small typed helper and reuse it where the same chain shape repeats:

- Add `src/fiscal/testing/drizzle-query-mock.ts` (new file) exporting a minimal
  typed interface for the chainable query builder, e.g.:
  - `interface QueryChain<T> { from(): QueryChain<T>; where(): QueryChain<T>; orderBy(): QueryChain<T>; limit(): Promise<T[]>; }`
  - plus a typed `TxMock` shape (`select`, `insert().values().returning()`,
    `execute`) matching how the services call it.
  Keep it test-only and narrowly typed to the methods actually used; this is a
  type-only convenience, it must not change any mock's runtime return values.
- Only extract the helper if it genuinely de-duplicates. If a file's chain shape
  is unique, define a local `interface` in that file instead. Do not force a
  one-size helper that distorts a mock.

---

## Per-file plan (grouped)

### GROUP A — Real source files (4 files, non-test; highest care)

- [ ] 1. `src/fiscal/services/resultado-apuracao.projector.ts` — no-base-to-string ×2.
      In `projetarInconsistencias`, `i` is `Record<string, unknown>` so
      `String(i.codigo ?? '')` and `String(i.mensagem ?? '')` stringify `unknown`
      (could be an object). Replace each with a string-narrowed read that keeps
      current behavior for the string case and yields `''` otherwise, e.g.
      `codigo: typeof i.codigo === 'string' ? i.codigo : ''` and the same for
      `mensagem`. (Matches the existing `typeof i.campo === 'string' ? ...`
      idiom already used two lines below.)
      Files: src/fiscal/services/resultado-apuracao.projector.ts

- [ ] 2. `src/fiscal/sped/efd-icms-ipi.builder.ts` — no-base-to-string ×3 +
      restrict-template-expressions ×3 (same 3 sites). `money(x)` returns a
      `SpedTypedField` object; it is interpolated into the human-readable
      `mensagem` of a `CTE_SAIDA_D190_E110_DIVERGENTE` inconsistência. Render the
      field to its string form before interpolation using the existing formatter
      `formatSpedField` from `./core/sped-formatters` (or `./core`), i.e.
      `${formatSpedField(money(conciliacao.totalD190))}` for all three
      (`totalD190`, `totalE110`, `totalLivroSaidas`). This keeps the same fiscal
      decimal formatting the field would serialize to — message value unchanged.
      Add the import if not already present.
      Files: src/fiscal/sped/efd-icms-ipi.builder.ts

- [ ] 3. `src/fiscal/services/st-calculador.ts` — no-unused-vars (`cemAliquota`).
      `const cemAliquota = 100n * 10n ** BigInt(ESCALA_ALIQUOTA)` is assigned and
      never read anywhere in the file (confirmed by grep). Delete the line.
      Files: src/fiscal/services/st-calculador.ts

- [ ] 4. Unused imports in two SPED source files + one RH controller
      (same change pattern: remove an unused named import).
      - `src/fiscal/sped/st-cenario-habilitado.ts`: remove `SpedTypedField` from
        `import type { SpedRecord, SpedTypedField } from './core';` →
        `import type { SpedRecord } from './core';`.
      - `src/fiscal/sped/st-registros-filhos.ts`: remove `integerField` from the
        `import { ... } from './core';` block (keep `createSpedRecord`,
        `dateField`, `decimalField`, `type SpedRecord`).
      - `src/rh/rh-upload.controller.ts`: remove `type DadosFerias` from the
        `import { extractDadosFerias, isReciboFerias, type DadosFerias } from
        '../common/pdf-extraction-ferias';` block.
      Files: src/fiscal/sped/st-cenario-habilitado.ts,
      src/fiscal/sped/st-registros-filhos.ts, src/rh/rh-upload.controller.ts

Verify Group A: `pnpm build` compiles (type-aware; use a long timeout, ≥10 min).

### GROUP B — Unused-vars in spec files (6 files)

- [ ] 5. Mock-factory unused params in the drizzle `select` mocks (same pattern
      in two files). `_n`, `_args`, `_projection` are unused trailing arrow
      params; underscore does NOT exempt them. Delete the param lists:
      `limit: (_n: number) => ...` → `limit: () => ...`;
      `orderBy: (..._args: unknown[]) => ...` → `orderBy: () => ...`;
      `select: (_projection?: unknown) => ...` → `select: () => ...` and
      `returning: (_projection?: unknown) => ...` → `returning: () => ...`.
      Keep every body/return value identical.
      - `src/fiscal/services/fiscal-entregas-storage.service.spec.ts` (4 sites:
        `_n`, `_args`, two `_projection`).
      - `src/fiscal/services/fiscal-entregas.integration.spec.ts` (same 4 sites).
      - `src/fiscal/services/fiscal-entregas.service.spec.ts` (`_n`, `_args`,
        `_projection`, and two `_table` params on `from`/select callbacks —
        delete those param lists too; confirm each `_table` is unused before
        removing, since one branch may use `table`).
      Files: src/fiscal/services/fiscal-entregas-storage.service.spec.ts,
      src/fiscal/services/fiscal-entregas.integration.spec.ts,
      src/fiscal/services/fiscal-entregas.service.spec.ts

- [ ] 6. `src/fiscal/services/st-calculador.spec.ts` — remove unused import
      `StEnquadramentoStatus` from `import type { StEnquadramentoStatus } from
      './st-enquadramento';` (delete the whole import line if it has no other
      names).
      Files: src/fiscal/services/st-calculador.spec.ts

- [ ] 7. `src/fiscal/services/st-enquadramento.spec.ts` — destructure-to-omit
      `_omit`. Current: `const { regraAprovada: _omit, ...rest } = input();`.
      `ignoreRestSiblings` is off, so the named binding errors. Rebuild `rest`
      without the `regraAprovada` key WITHOUT naming an unused var, preserving
      the test intent (regraAprovada ABSENT → default false → PENDENCIA). Use:
      `const rest = { ...input() }; delete (rest as { regraAprovada?: unknown }).regraAprovada;`
      Confirm the resulting `rest` passed to `enquadrarSt(rest)` still omits the
      key (not sets it to undefined) so the default-false path is exercised. If
      `enquadrarSt`'s input type requires the key, instead construct the object
      explicitly with the remaining fields.
      Files: src/fiscal/services/st-enquadramento.spec.ts

Verify Group B: `pnpm lint` shows 0 no-unused-vars errors remaining (fresh run);
no new type errors introduced (covered by final `pnpm build`).

### GROUP C — unbound-method in spec files (3 files)

- [ ] 8. Fix all `unbound-method` sites by asserting on a captured typed
      `jest.fn()` reference (or wrapping the passed method in an arrow). Do not
      change the assertions' meaning.
      - `src/colaborador/colaborador-revocation.spec.ts` (1 site):
        `expect(sessionService.extractFromRequest).not.toHaveBeenCalled();` fails
        because `sessionService` is cast `as unknown as ColaboradorSessionService`
        (real method type). Capture the mock when building the guard — keep a
        local `const extractFromRequest = jest.fn().mockReturnValue(opts.payload);`
        use it in the `sessionService` object literal, return it from
        `buildGuard`, and assert `expect(extractFromRequest).not.toHaveBeenCalled();`.
      - `src/fiscal/services/fiscal-entregas-storage.service.spec.ts` (6 sites):
        same approach — the spied/mocked methods are referenced bare in
        `expect(...)`. Capture each as a typed `jest.fn()`/`jest.spyOn` result in
        a local and assert on that, or wrap `expect(() => obj.method()).…` only
        where a call-through is intended. Prefer the captured-reference form to
        match the existing `cleanup.processJobs` style already in the file.
      - `src/fiscal/services/fiscal-entregas.integration.spec.ts` (3 sites): same.
      Files: src/colaborador/colaborador-revocation.spec.ts,
      src/fiscal/services/fiscal-entregas-storage.service.spec.ts,
      src/fiscal/services/fiscal-entregas.integration.spec.ts

### GROUP D — require-await in spec files (2 sites, 2 files)

- [ ] 9. Remove `async` from mock arrows that contain no `await`, keeping the
      same resolved value.
      - `src/fiscal/services/certificado.service.spec.ts` (~line 92): the async
        arrow with no await ALSO carries no-unsafe-call + no-unsafe-return at the
        same spot — fix together: drop `async`, and type the returned mock value
        concretely (or `Promise.resolve(<typed>)`) so the return is not `any`.
        Confirm the mock still resolves to the same shape the caller expects.
      - `src/fiscal/services/fiscal-entregas.integration.spec.ts` (~line 360):
        drop `async` from the no-await arrow; if it must stay thenable, return
        `Promise.resolve(value)` with the same value.
      Files: src/fiscal/services/certificado.service.spec.ts,
      src/fiscal/services/fiscal-entregas.integration.spec.ts

### GROUP E — prefer-promise-reject-errors in spec files (2 files)

- [ ] 10. Reject with an `Error` instance, preserving the `.code` field that the
      service's duplicate-detection reads. Confirmed: `fiscal-guias.service.ts`
      `isUniqueViolation` checks `'code' in error && (error as {code?}).code ===
      '23505'`, so the Error MUST still carry `code`.
      - `src/fiscal/services/fiscal-guias.service.spec.ts`: in
        `createIdempotencyDb`, `Promise.reject(opts.insertErro)` where
        `insertErro?: unknown` and callers pass `{ code: '23505' }` /
        `{ code: '23502', message: '...' }`. Change the factory to reject an
        Error carrying those fields:
        `Promise.reject(Object.assign(new Error('db error'), opts.insertErro))`
        and keep `insertErro?: { code?: string; message?: string }` (or similar
        concrete type) so the `.code`/`.message` the service reads survive. If a
        caller's `message` should be the Error message, use
        `Object.assign(new Error(opts.insertErro.message ?? 'db error'), opts.insertErro)`.
      - `src/fiscal/services/fiscal-guias-conciliacao.integration.spec.ts`:
        `return Promise.reject({ code: '23505' });` →
        `return Promise.reject(Object.assign(new Error('unique_violation'), { code: '23505' }));`
      Files: src/fiscal/services/fiscal-guias.service.spec.ts,
      src/fiscal/services/fiscal-guias-conciliacao.integration.spec.ts

### GROUP F — no-base-to-string in spec files (2 files)

- [ ] 11. Narrow to string before stringifying.
      - `src/fiscal/services/fiscal-normative-catalog.service.spec.ts` (~line 79):
        `String(rendered.params.find((p) => typeof p === 'string' && /…/.test(p)) ?? '')`
        — `.find` returns `unknown`. Make the predicate a type guard
        `(p): p is string => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p)`
        so `.find` returns `string | undefined`; then `?? ''` is a string and
        `String(...)` can be dropped (or kept, now safe). Behavior identical.
      - `src/mail/mail.service.spec.ts` (~line 72): `JSON.parse(String(request.body))`
        where `request.body` is `BodyInit | null`. In this test the body is a
        JSON string; cast narrowly: `JSON.parse(request.body as string)`. Also
        fix the paired no-unsafe-member-access at ~line 71
        (`fetchMock.mock.calls[0]?.[1]`) by typing `fetchMock` (e.g.
        `const fetchMock = ... as jest.Mock<Promise<Response>, [string, RequestInit]>`
        or cast the extracted element to `RequestInit`, which the next line
        already does with `as RequestInit`). Ensure the parsed `payload` typing
        is unchanged.
      Files: src/fiscal/services/fiscal-normative-catalog.service.spec.ts,
      src/mail/mail.service.spec.ts

### GROUP G — no-unsafe-* clusters in spec files (typing mocks)

- [ ] 12. `src/fiscal/services/fiscal-closing.service.spec.ts` — the LARGEST
      cluster (~60 no-unsafe-* errors + the 4 no-unsafe-argument warnings). Root
      cause: `const api: any = {...}` and `const tx: any = {...}` in `makeTx`
      (and similar helpers). Replace `any` with concrete types:
      - Type the chainable query builder with an explicit interface (reuse the
        shared `QueryChain<T>` helper from the new
        `src/fiscal/testing/drizzle-query-mock.ts`, or a local interface if the
        shape differs). `limit()` returns `Promise<Row[]>`.
      - Type `tx` as an object exposing exactly `execute`, `select`, `insert`
        (`insert().values().returning()`), matching the real transaction surface
        the service uses; this removes the `.transaction` member-access errors,
        the destructuring-of-any errors, the unsafe returns, AND the 4
        no-unsafe-argument warnings (the `tx` passed into the service callback is
        then typed, not `any`). Keep all mock return values and queued rows
        identical. Where the service is invoked with `tx`, keep the existing
        `as never`/typed cast style used elsewhere in the file if a full type is
        impractical, but prefer the typed `tx`.
      - Multiple similar `makeTx`/chain helpers exist in this file (sites around
        the report's 450–840 and 1108–1120 ranges); apply the same typed-chain
        treatment to each. Re-run lint to enumerate; fix until this file is clean.
      Files: src/fiscal/services/fiscal-closing.service.spec.ts
      (+ src/fiscal/testing/drizzle-query-mock.ts if the shared helper is used)

- [ ] 13. Controller spec mocks returning `any` — type the mock so
      `.mock.calls[i][j]` and member access are typed. Same pattern in two files.
      - `src/fiscal/controllers/fiscal-apuracao.controller.spec.ts`: the `Deps`
        type uses `getApuracaoIcms: jest.Mock` (return `any`). Either (a) type the
        jest.Mock with its real signature so `deps.fiscalItensService
        .getApuracaoIcms.mock.calls[0][0]` is typed, e.g.
        `getApuracaoIcms: jest.Mock<Promise<ApuracaoIcmsResult>, [GetApuracaoIcmsArgs]>`
        (import/define the arg type with `clienteId: string; dataInicio: Date;
        dataFim: Date`), or (b) cast the extracted `call` locally:
        `const call = deps.fiscalItensService.getApuracaoIcms.mock.calls[0][0] as
        { clienteId: string; dataInicio: Date; dataFim: Date };`. Apply to all
        sites (the `.calls[0][0]`, `[primeira]`/`[segunda]` destructures). Keep
        assertions identical.
      - `src/fiscal/sped/sped-efd.controller.spec.ts`: same approach for the
        `.mock.calls[0][0]` reads with `.clienteId`, `.actorUserId`,
        `.competencia` member accesses — type the mock signature or cast the
        extracted call object to a concrete interface.
      Files: src/fiscal/controllers/fiscal-apuracao.controller.spec.ts,
      src/fiscal/sped/sped-efd.controller.spec.ts

- [ ] 14. Single/small no-unsafe-assignment sites — give the specific variable a
      concrete type or typed cast at the flagged line (locate via fresh lint).
      - `src/fiscal/services/distribuicao-dfe.service.spec.ts` (1 site)
      - `src/fiscal/services/fiscal-books-projection.spec.ts` (1 site)
      - `src/fiscal/services/resultado-apuracao.projector.spec.ts` (1 site)
      - `src/fiscal/sped/sped-preflight-pva.spec.ts` (1 site)
      For each: identify what `any` value is assigned, and type the LHS (or cast
      the RHS to the real type / `unknown`-then-narrow). Prefer the domain type
      already imported in the file. No behavior change.
      Files: src/fiscal/services/distribuicao-dfe.service.spec.ts,
      src/fiscal/services/fiscal-books-projection.spec.ts,
      src/fiscal/services/resultado-apuracao.projector.spec.ts,
      src/fiscal/sped/sped-preflight-pva.spec.ts

- [ ] 15. `src/fiscal/sped/efd-icms-ipi.bloco-g.cenarios-movimentacao.spec.ts` —
      no-unsafe-assignment ×3 + no-unsafe-member-access (computed `[indice]`).
      The `comNome`/`campos` mapping reads values of `any` type. Type the fixture
      row and the `campos` array (e.g. the record field value type is
      `string`/`SpedFieldValue`), and type `indice` so the computed access
      `campos[indice]` is not on `any`. Give `camposDaLinha` / `BLOCO_G_LEIAUTES`
      results their real types if currently inferred as `any`. Keep the
      `.toEqual` assertions identical.
      Files: src/fiscal/sped/efd-icms-ipi.bloco-g.cenarios-movimentacao.spec.ts

---

## Final verification (run in order; all type-aware and SLOW — use long timeouts, ≥10 min each)

1. `pnpm lint` — MUST exit 0 with `✖ 0 problems`. (Re-run after each group to
   track remaining counts; the final run must show zero errors AND zero
   warnings.)
   Expected: no `✖ N problems` summary line, exit code 0.
2. `pnpm build` — `nest build` must succeed (confirms no type regressions from
   the new typings/casts in the non-test source files especially Group A).
   Expected: build completes, exit code 0.
3. `pnpm test` — run jest for the changed spec files to confirm behavior is
   unchanged. Prefer scoping to touched files to stay within time, e.g.
   `pnpm test -- fiscal-closing.service fiscal-guias fiscal-entregas
   fiscal-apuracao.controller sped-efd.controller mail.service
   fiscal-normative-catalog resultado-apuracao st-enquadramento st-calculador
   certificado.service distribuicao-dfe fiscal-books-projection
   sped-preflight-pva efd-icms-ipi.bloco-g colaborador-revocation`
   (jest `testPathPattern` matches substrings). All referenced suites must pass.
   Expected: all tests green; the duplicate-violation tests in
   fiscal-guias(.service/-conciliacao) still pass (confirms the Error-with-code
   change preserved `isUniqueViolation` detection).

## Notes / assumptions

- Report line numbers are stale (code reflowed by the earlier `--fix`); the
  coder MUST re-run `pnpm lint` for fresh locations and match by code pattern.
- `pnpm` is the package manager (lint/build/test invoked as `pnpm <script>`).
- No repo steering files (`.kiro/steering`) or API-level `AGENTS.md` exist; the
  only `AGENTS.md` files are in `web/` and `node_modules` and are out of scope.
- Prefer the shared `drizzle-query-mock.ts` helper only where it de-duplicates
  real repetition (fiscal-closing, and any other file with the identical chain);
  otherwise use local interfaces. Do not over-engineer.
- `eslint-disable` only as a documented per-line last resort; do not modify
  `eslint.config.mjs`.
