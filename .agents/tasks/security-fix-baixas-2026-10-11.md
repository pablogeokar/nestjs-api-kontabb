# Correções de Segurança — Baixas [BAIXA] 10 e [BAIXA] 11

- **Data:** 2026-10-11
- **Branch:** `security/fix-baixas`
- **Worktree:** `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-baixas`
- **Escopo:** SOMENTE os achados [BAIXA] 10 (CORS condicional) e [BAIXA] 11 (sanitização de segmentos de chave R2) do relatório `security-scan-2026-10-11.md`.

---

## Correção A — [BAIXA] 10: CORS condicional por ambiente

**Arquivo:** `src/main.ts`

**O que mudou:**
- A lista de origens do `app.enableCors` passou a ser montada condicionalmente por `NODE_ENV` (variável `isProduction` já existente no bootstrap).
- Em **produção**: apenas origens de produção — `https://www.kontabb.com.br`, `https://kontabb.com.br` e `configuredAppUrl` (`APP_URL`).
- **Fora de produção**: as mesmas origens + `http://localhost:3000` (origem de dev).
- `configuredAppUrl` continua incluído em ambos os ambientes.
- Deduplicação via `new Set(...)` para evitar origens repetidas (ex.: se `APP_URL` coincidir com uma origem de produção).
- `credentials: true` preservado. **Não** foi introduzido `origin: '*'`.
- A ordem dos middlewares (helmet → CORS → cookie-parser → request-id → ValidationPipe → filtros → Swagger gated por ambiente) foi mantida exatamente como estava; apenas a composição do array de origens mudou.

## Correção B — [BAIXA] 11: Normalização/validação de segmentos de chave R2 na origem

**Arquivo principal:** `src/storage/storage.service.ts`

**O que mudou:**
- Adicionado helper interno **`assertSafeKeySegment(value, label)`** no `StorageService`. Ele **rejeita** (lançando `Error`) segmentos que:
  - sejam vazios ou não-string;
  - contenham `/`, `\`, `..`;
  - contenham caracteres de controle (`\u0000-\u001f`, `\u007f`).
  - Segmentos legítimos são retornados **inalterados** — a validação é transparente e **não** altera o formato das chaves já em produção.
- O helper é aplicado a **todos** os segmentos derivados de dados em `documentObjectKey` (cnpj, year, month, obligationId, type), `receiptObjectKey` (cnpjCpf, receiptId, extension) e `logoObjectKey` (cnpjCpf, extension).

**Tratamento do CPF / Pessoa Física (PF):**
- Nos dois call sites que derivam `cnpjCpf` de dados de cliente — `GuiasService.confirmPayment` (`src/guias/guias.service.ts`) e `ClientesService` ao atualizar a logo (`src/clientes/clientes.service.ts`) — o ramo PF agora normaliza o CPF para dígitos (`cpf.replace(/\D/g, '')`) **antes** de virar segmento de chave.
- O CPF já é armazenado como `\d{11}` (validado no DTO por `@Matches(/^\d{11}$/)`), então a normalização é **transparente** para dados legítimos (no-op), mas torna explícito o saneamento na origem. O segmento resultante é ainda assim coberto pela validação nova do `assertSafeKeySegment`.
- O CNPJ já é restrito a `[0-9A-Z]` no DTO, portanto também passa pela validação sem alteração.

**Testes adicionados (leves):** `src/storage/storage.service.spec.ts`
- Rejeição de segmento contendo `/`.
- Rejeição de segmento contendo `..`.
- Aceitação de CNPJ válido (chave `clientes/<cnpj>/logo.png` inalterada).
- Aceitação de CPF numérico válido (chave de comprovante inalterada).

---

## Verificação (pnpm, no worktree)

| Etapa | Resultado |
|-------|-----------|
| `pnpm exec tsc --noEmit` | **22 erros** — idêntico ao baseline conhecido (todos em `fiscal-apuracao.controller.spec` e `fiscal-entregas.service.spec`). **Nenhum erro novo** fora dessas specs. |
| `pnpm build` (`nest build`) | **PASSOU** (exit 0). |
| `pnpm test` | **2048 passaram, 2 falharam.** As 2 falhas são as meta-presença pré-existentes: `fiscal/fiscal-matriz-t01-t52.spec.ts` e `fiscal/fiscal-camadas-verificacao.spec.ts`. Nenhuma falha nova. O novo `src/storage/storage.service.spec.ts` **PASSOU**. |

- Baseline antes das mudanças: 22 erros tsc + 2 falhas de meta-presença.
- Depois das mudanças: 22 erros tsc (mesmos) + 2 falhas de meta-presença (mesmas) + 4 novos testes de storage passando.
- Conclusão: **sem regressões**.

---

## Fora de escopo (confirmado pelo dono do produto — NÃO alterado)

- **[BAIXA] 12** (logo/sessão do colaborador acessível antes da troca de senha): decisão de produto. `getLogo`/`getSession` e os guards do colaborador **não** foram tocados.
- **[MÉDIA] 8** (senha fixa `123456` no setup): mantida propositalmente para forçar troca no primeiro acesso. `src/health/setup.controller.ts` e a lógica de senha **não** foram tocados.
- Nenhuma correção anterior (deps, throttler, DTOs usuarios, revogação tokenVersion, CRON_SECRET, helmet/swagger, token de login, guards do colaborador) foi desfeita.
