# Implementation Plan — Fast-fail certificate-access failures in DF-e key import

Scope: two files only — the service and its spec. Do not touch `certificado.service.ts`, `nfewizard.service.ts`, or any other file. Do not change the DB-only `assertCertificadoDisponivel` preflight.

Root cause (already diagnosed): `CertificateAccessService.getDecryptedCertificate` throws `CertificateAccessError` (code `CERTIFICATE_OBJECT_NOT_FOUND`) because the encrypted certificate file can't be fetched from object storage even though the DB row is valid. The certificate is per-client, so one failure means every key in the batch will fail. Current code classifies all keys as generic `FALHA` and keeps looping, hammering SEFAZ. The fix is to detect the (possibly wrapped) `CertificateAccessError` in the per-key catch, abort the batch with a dedicated status, and give an actionable message.

Confirmed current shapes (file: `/Users/pablo/dev/kontabb/api/src/fiscal/services/importacao-chaves-fiscal.service.ts`):
- `ImportacaoChaveStatus` union ends with `| 'FALHA' | 'ABORTADO_CONSUMO_INDEVIDO';` (around lines 44–53).
- `executar(...)` declares `let consumoIndevido = false;` before the `for (const item of parsed.itens)` loop. The loop's first guard is `if (consumoIndevido) { resultados.push(this.result(item, 'ABORTADO_CONSUMO_INDEVIDO', 'Lote interrompido para respeitar o bloqueio temporário da SEFAZ.')); continue; }`.
- The per-key `catch (error: unknown)` block computes `const message = this.rootCause(error);`, sets `consumoIndevido` on a `/consumo indevido|\b656\b/` match, logs `fiscal_key_import_item_failed`, then pushes a `FALHA`/`ABORTADO_CONSUMO_INDEVIDO` result.
- `rootCause(error)` is a private helper that walks `.cause` and returns the deepest `message` string (does NOT return the error object).
- `summarize(...)` has `const count = (...statuses) => ...`; `falhas: count('FALHA', 'ABORTADO_CONSUMO_INDEVIDO'),` and `consumo_indevido: count('ABORTADO_CONSUMO_INDEVIDO') > 0,`.
- The `result(...)` helper signature is `result(item, status, mensagem, documento?, emitente?, valorTotal?)`.

Reference (file: `/Users/pablo/dev/kontabb/api/src/fiscal/services/certificado.service.ts`, do NOT modify): exports `class CertificateAccessError extends Error` with `readonly code: CertificateAccessErrorCode` and `CertificateAccessErrorCode = 'CERTIFICATE_OBJECT_NOT_FOUND' | 'CERTIFICATE_STORAGE_UNAVAILABLE' | 'CERTIFICATE_PAYLOAD_INVALID' | 'CERTIFICATE_DECRYPTION_FAILED'`. The error is constructed with `{ cause: error }`, so it may appear anywhere in a `.cause` chain.

Test command (confirmed working, 5 tests pass): `npx jest importacao-chaves-fiscal` run from `/Users/pablo/dev/kontabb/api`.

---

- [ ] 1. Import `CertificateAccessError` into the service file.
      Add `import { CertificateAccessError } from './certificado.service';` to the import block at the top of the service file (place it near the other `./`-relative service imports such as `DistribuicaoDfeService` / `NfeWizardService`). Type-only import is fine since it's used with `instanceof` — use a value import (not `import type`) because `instanceof` needs the runtime class.
      Files: /Users/pablo/dev/kontabb/api/src/fiscal/services/importacao-chaves-fiscal.service.ts
      Verify: `npx jest importacao-chaves-fiscal` from /Users/pablo/dev/kontabb/api — suite still compiles and all 5 existing tests pass.

- [ ] 2. Add the new status to the `ImportacaoChaveStatus` union.
      Append `| 'ABORTADO_CERTIFICADO_INDISPONIVEL'` after `| 'ABORTADO_CONSUMO_INDEVIDO'` in the `ImportacaoChaveStatus` union (near lines 44–53).
      Files: /Users/pablo/dev/kontabb/api/src/fiscal/services/importacao-chaves-fiscal.service.ts
      Verify: `npx jest importacao-chaves-fiscal` — compiles and 5 existing tests still pass.

- [ ] 3. Add a `findCertificateAccessError` private helper that walks the cause chain.
      Add a private method mirroring the `rootCause` walk pattern but returning the first `CertificateAccessError` found (or `null`). It must check `error instanceof CertificateAccessError` AND each `.cause` link, using a `seen` set to guard cycles (same structure as `rootCause`). Signature: `private findCertificateAccessError(error: unknown): CertificateAccessError | null`. Place it next to `rootCause` at the bottom of the class.
      Files: /Users/pablo/dev/kontabb/api/src/fiscal/services/importacao-chaves-fiscal.service.ts
      Verify: `npx jest importacao-chaves-fiscal` — compiles and 5 existing tests still pass.

- [ ] 4. Add the `certificadoIndisponivel` abort flag and its top-of-loop guard, mirroring `consumoIndevido`.
      In `executar(...)`, add `let certificadoIndisponivel = false;` directly after `let consumoIndevido = false;`. At the TOP of the `for (const item of parsed.itens)` loop, add a guard BEFORE the existing `if (consumoIndevido) { ... }` guard: `if (certificadoIndisponivel) { resultados.push(this.result(item, 'ABORTADO_CERTIFICADO_INDISPONIVEL', 'Lote interrompido: o certificado digital não pôde ser utilizado.')); continue; }`.
      Files: /Users/pablo/dev/kontabb/api/src/fiscal/services/importacao-chaves-fiscal.service.ts
      Verify: `npx jest importacao-chaves-fiscal` — compiles and 5 existing tests still pass (flag is unset, so behavior unchanged).

- [ ] 5. Detect the certificate error inside the per-key `catch` block and fast-fail.
      In the `catch (error: unknown)` block, FIRST (before computing `message`/the consumo-indevido logic) call `const certError = this.findCertificateAccessError(error);`. If `certError` is non-null: set `certificadoIndisponivel = true;`, choose the message by `certError.code` — `CERTIFICATE_OBJECT_NOT_FOUND` and `CERTIFICATE_STORAGE_UNAVAILABLE` → 'O certificado está cadastrado, mas o arquivo não pôde ser lido do armazenamento. Verifique a configuração de storage ou contate o suporte.'; `CERTIFICATE_PAYLOAD_INVALID` and `CERTIFICATE_DECRYPTION_FAILED` → 'O arquivo do certificado está corrompido ou a senha foi alterada. Reenvie o certificado digital A1.' — optionally log via `this.logger.error('fiscal_key_import_item_failed', error, { ... result: 'CERTIFICATE_UNAVAILABLE' })` to preserve observability, then `resultados.push(this.result(item, 'ABORTADO_CERTIFICADO_INDISPONIVEL', <message>));` and `continue;`. The existing `consumoIndevido`/`FALHA` push stays as the fall-through for all other errors (a `CertificateAccessError` message never matches the consumo-indevido regex, so ordering is safe).
      Files: /Users/pablo/dev/kontabb/api/src/fiscal/services/importacao-chaves-fiscal.service.ts
      Verify: `npx jest importacao-chaves-fiscal` — compiles and 5 existing tests still pass (no cert error in those paths).

- [ ] 6. Update `summarize(...)` to count the new status in `falhas` and add the summary flag.
      Change `falhas: count('FALHA', 'ABORTADO_CONSUMO_INDEVIDO'),` to `falhas: count('FALHA', 'ABORTADO_CONSUMO_INDEVIDO', 'ABORTADO_CERTIFICADO_INDISPONIVEL'),`. Add `certificado_indisponivel: count('ABORTADO_CERTIFICADO_INDISPONIVEL') > 0,` immediately after the existing `consumo_indevido:` line.
      Files: /Users/pablo/dev/kontabb/api/src/fiscal/services/importacao-chaves-fiscal.service.ts
      Verify: `npx jest importacao-chaves-fiscal` — compiles and 5 existing tests still pass.

- [ ] 7. Add a unit test for the certificate fast-fail path, mirroring the consumo-indevido test.
      In the spec file, add `import { CertificateAccessError } from './certificado.service';` at the top. Add a new `it(...)` after the "interrompe as chaves restantes ao receber consumo indevido" test. Build two keys via `buildAccessKey('55', '000000001')` and `buildAccessKey('55', '000000002')`. Set up `databaseWithResponses([[cliente], [{ id: 'cert-1', validadeFim: futureDate() }], []])` (cliente row, valid cert row for the DB preflight, empty existing-docs row). Create the nfeWizard mock so `consultarPorChave` REJECTS: build it manually like `{ consultarPorChave: jest.fn().mockRejectedValue(new CertificateAccessError('CERTIFICATE_OBJECT_NOT_FOUND', 'arquivo não encontrado')), enviarManifestacao: jest.fn() }` (the `nfeWizardMock()` helper only supports resolved values, so construct the rejecting mock inline — cast with `as unknown as ...` if TS complains, matching the `makeService` cast style). Run `service.executar({ clienteId: cliente.id, chaves: [first, second], actorUserId, requestId: 'req-cert' })`. Assert: (a) `result.itens[0].status === 'ABORTADO_CERTIFICADO_INDISPONIVEL'`; (b) `result.itens[1].status === 'ABORTADO_CERTIFICADO_INDISPONIVEL'` (via `result.itens.map((i) => i.status)` equals both aborted) — not `FALHA`; (c) `nfeWizard.consultarPorChave` was called exactly once (`toHaveBeenCalledTimes(1)`), proving fast-fail with no pointless retries; optionally assert `result.resumo.certificado_indisponivel === true`.
      Files: /Users/pablo/dev/kontabb/api/src/fiscal/services/importacao-chaves-fiscal.service.spec.ts
      Verify: `npx jest importacao-chaves-fiscal` from /Users/pablo/dev/kontabb/api — the new test plus all 5 existing tests pass (6 total).

- [ ] 8. Final full verification.
      Run the service's lint and the targeted test suite to confirm no regressions and style compliance.
      Files: (none — verification only)
      Verify: `npx jest importacao-chaves-fiscal` passes all tests, and `npx eslint src/fiscal/services/importacao-chaves-fiscal.service.ts src/fiscal/services/importacao-chaves-fiscal.service.spec.ts` reports no errors.

## Notes / assumptions
- Keep all status strings and user messages in Portuguese exactly as specified.
- The `rootCause` helper returns a string, so step 3 adds a separate helper that returns the error object; do not try to reuse `rootCause` for the `instanceof` detection.
- Place the new catch-block cert check BEFORE the existing `consumoIndevido` regex logic so a wrapped `CertificateAccessError` is never misclassified; a cert error cannot match the `/consumo indevido|\b656\b/` regex, so no existing path changes.
- Logging in step 5 is optional but recommended to preserve the existing `fiscal_key_import_item_failed` observability; if added, use a distinct `result` value so it's distinguishable from generic failures.
