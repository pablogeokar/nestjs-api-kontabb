# Correção — Dependências de produção com vulnerabilidades conhecidas (CRÍTICA)

- **Data:** 2026-10-11
- **Escopo:** API NestJS — `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (worktree `.worktrees/sec-fix-deps`, branch `security/fix-vuln-deps`).
- **Origem:** finding `[CRÍTICA] 1. Dependências de produção com vulnerabilidades conhecidas` de `security-scan-2026-10-11.md`.
- **Gerenciador:** pnpm v11.8.0.

---

## Resultado — `pnpm audit --prod` (antes x depois)

| Severidade | Antes | Depois |
|-----------|-------|--------|
| Crítica   | 1     | 0      |
| Alta      | 28    | 1      |
| Moderada  | 21    | 0      |
| Baixa     | 1     | 0      |
| **Total** | **51** | **1** |

- **Antes:** `51 vulnerabilities found — Severity: 1 low | 21 moderate | 28 high | 1 critical`
- **Depois:** `1 vulnerabilities found — Severity: 1 high`

A única vulnerabilidade remanescente (`node-forge`) **não tem correção publicada** no upstream (ver seção "O que permanece").

---

## O que mudou

### 1. Atualização de dependência DIRETA

| Pacote | Antes | Depois | Tipo | Motivo |
|--------|-------|--------|------|--------|
| `multer` | `^2.2.0` (resolvia 2.2.0) | `^2.4.0` (resolve 2.4.0) | minor dentro do major 2 | corrige GHSA-qvfw-j98x-7q72 (bypass de limite de tamanho via race no fileFilter async). O app usa multer apenas via `FileInterceptor`/`FilesInterceptor` do `@nestjs/platform-express`; nenhuma mudança de código necessária. |

### 2. `pnpm.overrides` para TRANSITIVAS (em `pnpm-workspace.yaml`)

> **Observação importante sobre o pnpm v10+/v11:** o bloco `pnpm.overrides` dentro de `package.json` **não é mais lido** (o pnpm emite `[WARN] The "pnpm" field in package.json is no longer read`). Por isso os overrides foram colocados em `pnpm-workspace.yaml`, que é o novo local válido.

Cada override usa um seletor de faixa vulnerável (`pkg@<versao`) para forçar a menor versão corrigida, preservando compatibilidade (sem saltar major quando desnecessário):

| Pacote | Override aplicado | Chega via | Severidade original | Advisory(s) |
|--------|-------------------|-----------|---------------------|-------------|
| `proxy-addr` | `<2.0.8` → `^2.0.8` | `@nestjs/platform-express` > `express` | **crítica** | GHSA-jqcg-44mw-7w3h (IP spoofing). `express@5.2.1` fixa `proxy-addr@^2.0.7`; o override força 2.0.8 (patch, API compatível). |
| `multer` | `<2.3.0` → `^2.4.0` | `@nestjs/platform-express` (pin `2.2.0`) | alta | além do dep direto, o platform-express fixava `multer: "2.2.0"` exato; o override garante 2.4.0 em TODOS os caminhos. |
| `axios` | `<1.20.0` → `^1.20.0` | `@nfewizard/*` / `nfewizard-io` / `soap` (SEFAZ) | alta | ReDoS, prototype pollution, SSRF, header injection. `nfewizard-io` pede `axios@^1.15.0`; 1.20.0 satisfaz `^1.15.0`. Árvore de produção passou a usar **uma única versão (1.20.0)**. |
| `@xmldom/xmldom` | `<0.8.15` → `^0.8.15` | `@nfewizard/shared` > `soap` > `xml-crypto` | alta | injeção de nome de elemento/atributo, ReDoS. Mantido na **linha 0.8** (0.8.13 → 0.8.15, patch) e **não** elevado a 0.9.x, para não alterar o comportamento de parsing/assinatura XML do fluxo SEFAZ. |
| `nodemailer` | `<10.0.9` → `^10.0.9` | `nfewizard-io` | alta/moderada | ver nota de risco abaixo. |
| `js-yaml` | `<5.4.1` → `^5.4.1` | `@nestjs/swagger` | alta | GHSA-pm4m-ph32-ghv5 e GHSA-r3ph-w7gj-g6xm. A 2ª advisory é vulnerável até `<=5.4.0`, por isso o alvo é `>=5.4.1` (não bastaria o `>=5.2.2` da 1ª). Mantido no major 5. |
| `qs` | `>=6.14.2 <6.15.4` → `^6.15.4` | `express` > `body-parser` | moderada | patch dentro do 6.x. |
| `ip-address` | `<10.5.1` → `^10.5.1` | `libxmljs2` > `node-gyp` > `socks` | moderada | patch. |
| `brace-expansion` | `>=2.0.0 <2.1.3` → `^2.1.3` | `libxmljs2` > `node-gyp` > ... > `minimatch` | alta | DoS/OOM. Seletor restrito à linha 2.x (que estava em 2.1.2) para não mexer na 1.x legada. |
| `http-cache-semantics` | `<4.2.1` → `^4.2.1` | `libxmljs2` > `node-gyp` > `make-fetch-happen` | alta | ReDoS. patch. |

### Nota de risco — `nodemailer` (bump de major)

- `nfewizard-io@1.1.2` declara `nodemailer@^8.0.5` (instalado 8.0.11). Todas as advisories exigiam, no fim, `nodemailer >= 10.0.9` (as mais recentes: GHSA-6vj9-mwq6-2f5v, GHSA-8vvx-rff5-p5rq, GHSA-g57g-f23g-4646, GHSA-v53p-9fqp-m79j, GHSA-prgh-xp8r-p3m5). Um primeiro override para `^9.0.1` ainda deixava advisories moderadas/altas abertas, então foi necessário `^10.0.9` (instalado 10.1.0) — **salto de dois majors (8 → 10)** sobre o constraint do `nfewizard-io`.
- **Avaliação de segurança do salto:** o `nodemailer` é usado **apenas transitivamente** por `nfewizard-io` (nenhum `import`/`require` de `nodemailer` em `src/`). A superfície de uso é o envio de e-mail interno do `nfewizard-io`; a API Kontabb não chama a API do nodemailer diretamente. A compilação e a suíte de testes passaram com a 10.x (ver evidências). Como não há uso direto no código da API e os testes não regrediram, o risco de quebra foi considerado baixo e o override foi aplicado em vez de deixá-lo pendente. Caso o fluxo de e-mail do nfewizard-io apresente comportamento inesperado em produção, reverter este override específico para `^9.0.1` (que ainda resolve a advisory crítica/alta original) é a alternativa que preserva melhor o comportamento.

---

## O que permanece (e por quê)

| Pacote | Severidade | Advisory | Motivo de permanecer |
|--------|-----------|----------|----------------------|
| `node-forge` | alta | GHSA-86w9-cpqp-85rv (`<=1.4.0`, patched `>=1.4.1`) | **Não há correção publicada no npm.** O `dist-tags.latest` do `node-forge` é **1.4.0** — a versão `1.4.1` indicada como "patched" na advisory **não existe no registro**. Chega por `@nfewizard/shared` (cadeia SEFAZ) e também é dep direta (`^1.4.0`, usada em `fiscal/services/certificado.service.ts` para ler PFX/P12). Não é possível forçar via override uma versão inexistente. **Pendente de upstream** — reavaliar quando `node-forge >= 1.4.1` for publicado; aplicar override imediatamente nesse momento. |

Observações:
- As "altas" originais eram majoritariamente **múltiplas advisories do mesmo pacote** (axios: 12, @xmldom/xmldom: 10, nodemailer: 8, multer: 5, brace-expansion: 5), por isso a contagem caiu de 28 para 1 com poucos overrides.
- Versões vulneráveis antigas que ainda aparecem no store do pnpm (ex.: `axios@1.19.0`) **não estão na árvore de produção** — `pnpm audit --prod` confirma 0 ocorrências delas; `pnpm why axios --prod` mostra apenas `axios@1.20.0`.

---

## Ajustes de código

**Nenhum.** O `git status` do worktree mostra apenas `package.json`, `pnpm-lock.yaml` e `pnpm-workspace.yaml` modificados. Nenhum arquivo de `src/` ou de teste foi alterado. As atualizações não exigiram adaptação de API (multer continua no major 2; axios/js-yaml/qs/@xmldom permaneceram no mesmo major; nodemailer não é importado diretamente).

---

## Evidências de verificação (comandos exatos e resultados)

Todos executados em `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-deps`.

### `pnpm install` (regenerou o lockfile)
```
$ pnpm install
...
dependencies:
- multer 2.2.0
+ multer 2.4.0
Packages: +9 -16
Done
$ pnpm install --frozen-lockfile   # confirma lockfile em sincronia
Done in 647ms using pnpm v11.8.0
```

### `pnpm exec tsc --noEmit` (type check)
```
$ pnpm exec tsc --noEmit
# 22 erros TS — TODOS em arquivos *.spec.ts:
#   src/fiscal/controllers/fiscal-apuracao.controller.spec.ts (1)
#   src/fiscal/services/fiscal-entregas.service.spec.ts (21)
```
- **Esses 22 erros são PRÉ-EXISTENTES** (presentes no baseline, antes de qualquer alteração de dependência) e estão **somente em arquivos de teste** (`*.spec.ts`), não em `src/`. A comparação baseline x pós-mudança (`comm -13`) resultou em **zero** linhas novas: nenhum erro de tipo foi introduzido pela atualização.

### `pnpm build` (nest build)
```
$ pnpm build
$ nest build
# saída compilada em dist/src/ (tsconfig.build.json exclui **/*spec.ts),
# dist/src/main.js gerado. Exit 0, sem erros.
```
- O build **passou**. O `nest build` exclui `*spec.ts`, logo os erros pré-existentes de teste não o afetam.

### `pnpm test` (jest)
```
$ pnpm test
Test Suites: 2 failed, 118 passed, 120 total
Tests:       2 failed, 2030 passed, 2032 total
```
- **2 falhas, NÃO são regressão.** As suítes `fiscal/fiscal-matriz-t01-t52.spec.ts` e `fiscal/fiscal-camadas-verificacao.spec.ts` são meta-testes de governança que verificam a **presença no filesystem** do arquivo `tests/e2e/fiscal-classificacao.spec.ts` (que não existe no repositório). A asserção `expect(ausentes).toEqual([])` falha porque esse arquivo está listado como ausente. Nada disso depende de versões de dependências.
- **Prova de pré-existência:** com `git stash` das 3 modificações (voltando ao baseline) e rodando só essas 2 suítes, elas **falham exatamente igual** (`2 failed, 62 passed`). Restaurado com `git stash pop`.

### `pnpm audit --prod` (antes x depois) — já tabulado acima
```
# antes:  {"low":1,"moderate":21,"high":28,"critical":1}  -> 51 total
# depois: {"low":0,"moderate":0,"high":1,"critical":0}     -> 1 total (node-forge, sem fix upstream)
```

---

## Critérios de sucesso

- [x] CRÍTICA (`proxy-addr`) resolvida.
- [x] Todas as 28 altas resolvidas, **exceto** `node-forge` (sem correção publicada — documentado).
- [x] Todas as 21 moderadas e a 1 baixa resolvidas.
- [x] `tsc --noEmit`: sem erros novos (22 erros pré-existentes só em `*.spec.ts`).
- [x] `pnpm build`: passou.
- [x] `pnpm test`: 2030/2032 passam; as 2 falhas são meta-testes de presença de arquivo, pré-existentes e comprovadamente NÃO regressão.
- [x] `pnpm install --frozen-lockfile`: lockfile em sincronia.

## Recomendação de acompanhamento
- Integrar `pnpm audit --prod` como gate de CI (recomendação original do scan), tolerando apenas o `node-forge` enquanto não houver fix upstream.
- Monitorar o lançamento de `node-forge >= 1.4.1` para aplicar override e zerar o audit.
