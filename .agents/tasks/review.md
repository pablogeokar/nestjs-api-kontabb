# Fast-fail DF-e key import on certificate-access errors

The DF-e key importer used to classify every per-key failure as a generic `FALHA` and keep looping over the whole batch. When the root cause is the client's own certificate being unreadable from object storage (DB row valid, storage fetch failing), that means every one of the 16 keys fails identically while still hammering SEFAZ one request at a time — exactly the symptom in the user's logs (`CERTIFICATE_OBJECT_NOT_FOUND`, 16/16 falhas). This change detects a `CertificateAccessError` in the per-key catch (directly or wrapped in the `.cause` chain), aborts the batch with a dedicated `ABORTADO_CERTIFICADO_INDISPONIVEL` status and an actionable message chosen by error code, and surfaces a `certificado_indisponivel` flag in the summary. The DB-only preflight is untouched; this handles the case the preflight can't see (storage-layer failures).

Watch for: nothing blocking. Message selection correctly covers all four `CertificateAccessErrorCode` values, the fast-fail prevents retries, and scope is clean (confirmed). One minor observation on the summary semantics below (possible), not a defect.

**Verdict**: APPROVED

## High-level view

The fix lives entirely in `ImportacaoChavesFiscalService.executar`. A new `certificadoIndisponivel` flag is set the first time the per-key catch sees a certificate-access error; a top-of-loop guard mirroring the existing `consumoIndevido` guard then short-circuits every remaining key, so SEFAZ is consulted at most once per batch when the certificate is the problem. This is the right failure mode: a per-client certificate failure is deterministic across all keys, so retrying is pointless.

Detection walks the error's `.cause` chain with a cycle guard and returns the first `CertificateAccessError`, matching the pattern of the existing `rootCause` helper. This handles both a directly-thrown error and one wrapped by an intermediate layer (e.g. nfewizard).

The user-facing message is split by code group: `CERTIFICATE_OBJECT_NOT_FOUND` / `CERTIFICATE_STORAGE_UNAVAILABLE` point at a storage/config problem, while `CERTIFICATE_PAYLOAD_INVALID` / `CERTIFICATE_DECRYPTION_FAILED` point at a corrupted file or changed password. Both messages are actionable and in Portuguese as specified.

The summary counts the new status inside `falhas` (so totals still reconcile) and exposes a boolean `certificado_indisponivel` for the UI to distinguish this abort from an ordinary partial failure. Scope is tight: only the service, its spec, and the task verification note are in the commit — `certificado.service.ts` and `nfewizard.service.ts` are not.

<details>
<summary>Issues (1)</summary>

1. **Summary bucket semantics (non-blocking)** — the aborted-certificate keys count toward `falhas`, same as the existing `ABORTADO_CONSUMO_INDEVIDO`. This matches the established convention and the task requirement (point 4), so no change is needed; noted only so the UI treats `certificado_indisponivel` as the signal to show a distinct message rather than inferring from `falhas` alone.

</details>

<details>
<summary>Details</summary>

### Verification against the six required points

Each requirement was checked against commit `094a482` (`feat: fast-fail DF-e key import on certificate-access errors`), the only commit implementing this task. All six hold (confirmed):

1. **New status in the union** — `ABORTADO_CERTIFICADO_INDISPONIVEL` is added to the `ImportacaoChaveStatus` union, appended after `ABORTADO_CONSUMO_INDEVIDO`.

2. **Per-key catch detection + fast-fail** — the catch calls `findCertificateAccessError(error)` first, before the `rootCause`/consumo-indevido path. On a hit it sets `certificadoIndisponivel = true`, selects the message by `certError.code`, logs `fiscal_key_import_item_failed` with `result: 'CERTIFICATE_UNAVAILABLE'`, pushes the item as `ABORTADO_CERTIFICADO_INDISPONIVEL`, and `continue`s — so it never falls through to the generic `FALHA` branch and never retries. The `.cause` chain is handled by `findCertificateAccessError`, which walks `current.cause` with a `seen` set and returns on the first `instanceof CertificateAccessError`, catching both the direct throw and a wrapped one.

   Message strings match the task exactly:
   - `CERTIFICATE_OBJECT_NOT_FOUND` / `CERTIFICATE_STORAGE_UNAVAILABLE` → *"O certificado está cadastrado, mas o arquivo não pôde ser lido do armazenamento. Verifique a configuração de storage ou contate o suporte."*
   - else (`CERTIFICATE_PAYLOAD_INVALID` / `CERTIFICATE_DECRYPTION_FAILED`) → *"O arquivo do certificado está corrompido ou a senha foi alterada. Reenvie o certificado digital A1."*

   The `else` correctly covers the remaining two codes. The `CertificateAccessErrorCode` union in `certificado.service.ts` has exactly these four members, so there is no fifth code that could slip through into the wrong message bucket.

3. **Top-of-loop guard** — placed immediately above the `consumoIndevido` guard, structurally identical (push + `continue`), using the message *"Lote interrompido: o certificado digital não pôde ser utilizado."* verbatim.

4. **Summary** — `summarize` adds `ABORTADO_CERTIFICADO_INDISPONIVEL` to the `count(...)` arguments feeding `falhas`, and exposes `certificado_indisponivel: count('ABORTADO_CERTIFICADO_INDISPONIVEL') > 0`.

5. **Scope** — the commit touches only `importacao-chaves-fiscal.service.ts`, `importacao-chaves-fiscal.service.spec.ts`, and `.agents/tasks/verification.md`. `certificado.service.ts` and `nfewizard.service.ts` are not in the commit (verified via `git show --name-only`). `assertCertificadoDisponivel` is unchanged — it is not part of the diff hunks and remains the DB-only preflight.

6. **Spec coverage** — the new test `interrompe o lote quando o certificado não pode ser lido do armazenamento` rejects `consultarPorChave` with `new CertificateAccessError('CERTIFICATE_OBJECT_NOT_FOUND', ...)` over a 2-key batch and asserts both items are `ABORTADO_CERTIFICADO_INDISPONIVEL` (`itens.map(status)` equals a two-element array of the status), that `consultarPorChave` was called exactly once, and that `resumo.certificado_indisponivel` is `true`. The DB mock returns a valid client and cert row so the preflight passes and the failure originates purely from the SEFAZ consult, matching the real-world storage-failure scenario.

### Build and test evidence

Per the task instructions I did not re-run the build or jest. The recorded evidence in `.agents/tasks/verification.md` and the commit message is consistent and specific:

- `npm run build` → PASS (nest build, no type errors)
- `npx jest src/fiscal/services/importacao-chaves-fiscal.service.spec.ts` → 6/6 PASS (5 pre-existing + 1 new, test name listed)
- `npx eslint` on both edited files → PASS

The evidence names the exact command, the suite, the test count, and the new test, leaving no articulable doubt that would warrant a spot-check.

### Design note: fail-closed, flag never reset

The abort flag is set on the first certificate error and never reset, so the batch fails closed for the remaining keys — the correct choice for a deterministic per-client failure where continuing only produces identical failures and extra SEFAZ load.

</details>

<details>
<summary>File map</summary>

- `src/fiscal/services/importacao-chaves-fiscal.service.ts` — new union member, `certificadoIndisponivel` flag + top-of-loop guard, certificate detection in the per-key catch, `summarize` bucket + flag, `findCertificateAccessError` helper.
- `src/fiscal/services/importacao-chaves-fiscal.service.spec.ts` — import of `CertificateAccessError` and the new fast-fail test.
- `.agents/tasks/verification.md` — recorded build/test/lint results.

Full diff: `git show 094a482`.

</details>
