# Verification — Fast-fail certificate-access failures in DF-e key import

Scope: `src/fiscal/services/importacao-chaves-fiscal.service.ts` and its spec. The DB-only
`assertCertificadoDisponivel` preflight was left unchanged; `certificado.service.ts` and
`nfewizard.service.ts` were not modified by this task.

## Commands run (from `/Users/pablo/dev/kontabb/api`)

### 1. Type-check / build
```
npm run build
```
Result: PASS (exit 0, `nest build` completed with no type errors).

### 2. Targeted test suite
```
npx jest src/fiscal/services/importacao-chaves-fiscal.service.spec.ts
```
Result: PASS — 1 suite, 6 tests passed (5 pre-existing + 1 new).

Tests:
- classifica documento já importado sem consultar a SEFAZ
- trata cStat 137 como documento não localizado
- interrompe as chaves restantes ao receber consumo indevido
- interrompe o lote quando o certificado não pode ser lido do armazenamento (NEW)
- salva o resumo sem enviar Ciência quando a opção não foi autorizada
- marca na prévia chaves novas, resumidas e não suportadas

### 3. Lint (plan step 8)
```
npx eslint src/fiscal/services/importacao-chaves-fiscal.service.ts src/fiscal/services/importacao-chaves-fiscal.service.spec.ts
```
Result: PASS (exit 0, no errors) after `--fix` applied prettier formatting to the edited regions.

## New test assertions
With `consultarPorChave` rejecting `new CertificateAccessError('CERTIFICATE_OBJECT_NOT_FOUND', ...)`
over a batch of 2 keys:
- `result.itens[0].status === 'ABORTADO_CERTIFICADO_INDISPONIVEL'`
- `result.itens[1].status === 'ABORTADO_CERTIFICADO_INDISPONIVEL'` (not `FALHA`)
- `consultarPorChave` called exactly once (fast-fail, no retries)
- `result.resumo.certificado_indisponivel === true`
