# ESLint cleanup across the fiscal API — 25 files, zero behavior change

The change clears all 145 ESLint problems (141 errors + 4 warnings across 25 files) reported in `lint-report-2026-10-11.txt`, so `pnpm lint` exits 0. The fixes split across two places: the HEAD commit `8d5e5ce` ("parseando o arquivo .csv da sefaz/ba", which bundles the bulk of the lint work plus a new test-only helper `src/fiscal/testing/drizzle-query-mock.ts`) and the uncommitted working tree (10 spec files). Every reported file was located and fixed by matching the code pattern, not the stale line numbers. Fixes are type-level only: concrete interfaces/casts replace `any`, captured `jest.fn()` references replace bare method refs for `unbound-method`, `async`-without-`await` mock factories drop `async` while keeping the same resolved/rejected value, promise rejections now use `Error` instances carrying the fields the code reads, and template/`String()` sites render real strings.

Watch for: (confirmed) the review scope is split between a commit and the working tree — the `git diff` alone shows only 10 files, but the full fix set spans 25; (confirmed) one test assertion in `fiscal-guias.service.spec.ts` changed shape (`rejects.toEqual` → capture + `toMatchObject`) as a necessary consequence of the reject-with-Error fix, and it preserves the original intent; (confirmed) the uncommitted spec files silence `no-unsafe-assignment` on jest asymmetric matchers with `as unknown`, which is compile-time-only and runtime-inert.

**Verdict**: APPROVED

## High-level view

The lint work is behavior-preserving by construction. The `no-unsafe-*` clusters (the largest being `fiscal-closing.service.spec.ts`) are resolved by typing the drizzle-style query/transaction mocks via a small, test-only `QueryChain`/`TxMock`/`InsertChain`/`UpdateChain` helper that models exactly the methods the services call, without touching any mock return value. Where a full type was impractical, extracted `.mock.calls[i][j]` reads are cast to a concrete tuple at the read site.

The `unbound-method` fixes capture each mocked method as a local `jest.fn()` and assert on that reference instead of the object member, so the assertions test the same calls. The `require-await` fixes convert `async () => ...` mock factories (that threw or returned a value) into non-async functions returning `Promise.reject(err)` / `Promise.resolve(value)`, which is the same observable behavior.

The two `prefer-promise-reject-errors` sites now reject `Object.assign(new Error(...), { code })`, deliberately preserving the `.code`/`.message` fields that `FiscalGuiasService.isUniqueViolation` and the duplicate-detection path read. The `23505` idempotent-retry test still passes untouched; the `23502` propagation test switched to `toMatchObject` because the reject is now an `Error` with extra structure, which is the correct equivalent assertion.

The source-file fixes (Group A) are the only non-test changes and are minimal: a dead `cemAliquota` binding removed, three unused imports dropped, two `base-to-string` sites narrowed with `typeof x === 'string'`, and three `SpedTypedField` interpolations wrapped in the existing `formatSpedField` formatter so the message string is unchanged. The config was not weakened and no `eslint-disable` was introduced.

<details>
<summary>Issues (3)</summary>

1. **Split review scope (informational)** — the fix set spans HEAD commit `8d5e5ce` plus uncommitted working-tree changes; `git diff` alone understates it. No action required, but note it when reconciling the diff with the report.
2. **`as unknown` on jest matchers** — the uncommitted spec files use `expect.stringContaining(...) as unknown` (and `anything`/`stringMatching`) to clear `no-unsafe-assignment`. Harmless (runtime-inert) but a matcher-typed cast would be more precise. Optional, non-blocking.
3. **`delete rest.regraAprovada` relies on an optional field** — in `st-enquadramento.spec.ts` the omit-via-delete only type-checks if `regraAprovada` is optional on the input type. Build passed per recorded evidence, so this holds; flagged only as the one spot where a type assumption is load-bearing.

</details>

<details>
<summary>Details</summary>

### Scope spans a commit and the working tree

The `git diff` against HEAD shows 10 modified spec files plus the plan. That is not the whole change. The HEAD commit `8d5e5ce` already contains the majority of the lint fixes — the new `src/fiscal/testing/drizzle-query-mock.ts` helper, the `fiscal-entregas*` spec fixes (`unbound-method`, `require-await`, unused params), `certificado.service.spec.ts`, `fiscal-guias-conciliacao.integration.spec.ts`, `st-enquadramento.spec.ts`, `colaborador-revocation.spec.ts`, and all four Group A source files (`resultado-apuracao.projector.ts`, `efd-icms-ipi.builder.ts`, `st-calculador.ts`, and the three unused-import files). Verified by reading the current tree: `cemAliquota` is gone, the projector uses `typeof i.codigo === 'string' ? ...`, the builder wraps `money(...)` in `formatSpedField`, the entregas mocks dropped their `_n`/`_args`/`_projection` params, and the three unused imports are removed (only comments mention the former symbols). The commit message is unrelated to lint, which is why the bundling isn't obvious, but the fixes are present and correct.

### Typed drizzle mocks replace the `any` clusters

The `no-unsafe-*` errors (including the ~60-error `fiscal-closing.service.spec.ts` cluster and the 4 `no-unsafe-argument` warnings) stem from `const api: any`/`const tx: any` fluent-query stubs. The helper introduces `QueryChain` (`from/where/orderBy?/limit/for?`), `TxMock` (`execute/select/insert?/update?`), `InsertChain`, `UpdateChain`, and `DbMock`, each modeling only the methods the services actually invoke and keeping the row payloads as `Record<string, unknown>`. The spec now annotates `const api: QueryChain` / `const tx: TxMock` with identical return values, so the typing is the only change. The helper is test-only and compiles under `tsconfig.build.json` (which excludes `*.spec.ts`) because it has no `jest` dependency.

### Reject-with-Error preserves `isUniqueViolation`

`fiscal-guias-conciliacao.integration.spec.ts` and `fiscal-guias.service.spec.ts` reject `Object.assign(new Error(...), { code })`, keeping the `.code` (and `.message`) that the service's duplicate detection reads via `'code' in error && error.code === '23505'`. The `23505` idempotent-retry test is unchanged and still asserts the winning row is re-read. The `23502` propagation test changed from `rejects.toEqual({ code, message })` to capturing the rejection and `toMatchObject({ code, message })`:

```ts
const erro = await service.criarGuia(...).then(
  () => { throw new Error('esperava rejeição'); },
  (e: unknown) => e,
);
expect(erro).toMatchObject({ code: '23502', message: 'not-null violation' });
```

This is required because the reject is now an `Error` (with extra own/inherited structure) rather than a bare object, so a strict `toEqual` against a plain object would fail. `toMatchObject` asserts the same thing the original did: the real DB error propagates with its `code`/`message` instead of being masked as a retry. Intent preserved.

### require-await and unbound-method fixes

`require-await`: the `fakeStorage` factory went from `jest.fn(async () => { ...throw err...; return undefined; })` to `jest.fn(() => { ...return Promise.reject(err)...; return Promise.resolve(undefined); })`, and `certificado.service.spec.ts` went from `jest.fn(async (cb) => cb(tx))` to `jest.fn((cb) => Promise.resolve(cb(tx)))`. Both keep the same resolved/rejected values.

`unbound-method`: each flagged site captures the mock in a local (`const upload = jest.fn()...`, `const processJobs = ...`, `const extractFromRequest = ...`) and asserts on that reference instead of `storage.upload` / `cleanup.processJobs` / `sessionService.extractFromRequest`. Same calls asserted, matching the file's existing captured-reference style.

### Matcher casts in the uncommitted specs

`distribuicao-dfe`, `fiscal-books-projection`, `resultado-apuracao.projector`, and `sped-preflight-pva` specs clear `no-unsafe-assignment` by appending `as unknown` to `expect.stringContaining(...)` / `expect.anything()` / `expect.stringMatching(...)` inside expected-object literals. The asymmetric matcher object is still the value passed to `toEqual`/`objectContaining`, so jest's structural comparison is unaffected — the cast exists only to satisfy the type-checker. The controller specs (`fiscal-apuracao`, `sped-efd`) instead cast the extracted `.mock.calls[0]` to a concrete arg tuple (`as [ApuracaoIcmsArgs]`, `as [{ clienteId; actorUserId }]`, `as [Buffer]`), which types the subsequent member reads without changing the assertions. The jest-30 `jest.fn<Return, Args>()` two-type-param form was dropped in `mail.service.spec.ts` and `fiscal-apuracao` in favor of read-site tuple casts — a documented deviation, behavior-identical.

### Group A source files

`efd-icms-ipi.builder.ts` wraps the three `money(conciliacao.total*)` interpolations in the already-imported `formatSpedField`, resolving both `no-base-to-string` and `restrict-template-expressions` while keeping the same decimal string in the human-readable `mensagem`. `resultado-apuracao.projector.ts` narrows `i.codigo`/`i.mensagem` with `typeof === 'string' ? ... : ''`, matching the existing `i.campo` idiom and preserving the empty-string fallback. `st-calculador.ts` deletes the never-read `cemAliquota`. The three unused named imports are removed. These are the only runtime-source edits and none alter behavior.

### Test coverage / evidence

The plan records the first-iteration verification: `pnpm lint` → exit 0, zero errors/zero warnings; `pnpm build` (`nest build`) → exit 0; `pnpm test` across all touched suites → 628 passed, 29 suites, 0 failed, explicitly including the fiscal-guias duplicate-violation suites that exercise the Error-with-`code` path. Spot-reading the code confirms every one of the 25 reported files no longer contains its reported pattern, which is consistent with a clean lint run. Per instructions, the slow type-aware suites were not re-run; the recorded evidence is present and credible, so no re-run was warranted.

Not independently verified: the exact exit codes (trusted from the recorded evidence, not re-executed) and that `delete rest.regraAprovada` type-checks (inferred from the reported build pass).

</details>

<details>
<summary>File map</summary>

Committed in `8d5e5ce` (lint-related):
- `src/fiscal/testing/drizzle-query-mock.ts` — new test-only typed mock helper (`QueryChain`/`TxMock`/`InsertChain`/`UpdateChain`/`DbMock`).
- `src/fiscal/services/fiscal-entregas{,-storage}.service.spec.ts`, `fiscal-entregas.integration.spec.ts` — unused mock params removed, `unbound-method` via captured refs, `require-await` via `Promise.reject/resolve`.
- `src/fiscal/services/certificado.service.spec.ts` — drop `async` from `transaction` mock.
- `src/fiscal/services/fiscal-guias-conciliacao.integration.spec.ts`, `fiscal-guias.service.spec.ts` — reject with `Error` carrying `code`/`message`.
- `src/fiscal/services/st-enquadramento.spec.ts` — omit via `delete` instead of `_omit` binding.
- `src/colaborador/colaborador-revocation.spec.ts` — captured `extractFromRequest` mock.
- `src/fiscal/services/resultado-apuracao.projector.ts`, `src/fiscal/sped/efd-icms-ipi.builder.ts`, `src/fiscal/services/st-calculador.ts`, `src/fiscal/sped/st-cenario-habilitado.ts`, `src/fiscal/sped/st-registros-filhos.ts`, `src/rh/rh-upload.controller.ts` — Group A source fixes.
- `src/fiscal/services/fiscal-normative-catalog.service.spec.ts`, `st-calculador.spec.ts` — predicate type guard / unused import.

Uncommitted (working tree):
- `src/fiscal/controllers/fiscal-apuracao.controller.spec.ts` — tuple casts on `.mock.calls`, `Reflect.getMetadata` cast to `unknown`.
- `src/fiscal/services/distribuicao-dfe.service.spec.ts`, `fiscal-books-projection.spec.ts`, `resultado-apuracao.projector.spec.ts`, `src/fiscal/sped/sped-preflight-pva.spec.ts` — `as unknown` on jest matchers.
- `src/fiscal/services/fiscal-closing.service.spec.ts` — `any` → `QueryChain`/`TxMock`.
- `src/fiscal/services/fiscal-guias.service.spec.ts` — `toEqual` → capture + `toMatchObject`.
- `src/fiscal/sped/efd-icms-ipi.bloco-g.cenarios-movimentacao.spec.ts` — explicit `ReadonlyArray<{...}>` typing of `describe.each` fixtures.
- `src/fiscal/sped/sped-efd.controller.spec.ts` — tuple casts on `.mock.calls`.
- `src/mail/mail.service.spec.ts` — drop jest-30-incompatible `jest.fn<...>()` generics, tuple cast, `request.body as string`.
- `.agents/tasks/lint-fix-plan.md` — recorded verification results.

Full diff: `git -C /Users/pablo/dev/kontabb/api diff` (working tree) and `git -C /Users/pablo/dev/kontabb/api show 8d5e5ce` (committed).

</details>
