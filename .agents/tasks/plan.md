# Implementation Plan — Correção das 3 vulnerabilidades ALTAS (Kontabb API)

Worktree (todos os caminhos são absolutos dentro dele): `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas`

Relatório de origem: `/Users/pablo/dev/kontabb/api/.agents/tasks/security-scan-2026-10-11.md` — achados `[ALTA] 2`, `[ALTA] 3`, `[ALTA] 4`.

## Baseline (medido, NÃO é regressão desta tarefa)

- `pnpm exec tsc --noEmit` reporta **exatamente 22 erros pré-existentes**, todos em specs fiscais:
  - `src/fiscal/controllers/fiscal-apuracao.controller.spec.ts` → 1 erro (TS2554 em 31,22).
  - `src/fiscal/services/fiscal-entregas.service.spec.ts` → 21 erros (TS2554).
- Além disso, 2 testes "meta-presence" falham no `pnpm test` (aceitável).
- **Critério de aceite transversal:** nenhum erro `tsc` NOVO fora dessa lista; nenhuma falha de teste NOVA além das 2 já conhecidas. Build (`pnpm build`) deve passar.
- O worktree não tem `node_modules` próprio; a resolução cai em `/Users/pablo/dev/kontabb/api/node_modules` (workspace pnpm). Rodar os comandos a partir do worktree funciona (`pnpm exec`/`pnpm build`/`pnpm test` resolvem corretamente).

## Decisões de design (resumo + razão)

- **FIX 1 — throttler:** `@nestjs/throttler` instalado é **v6.5.0**. A API é a de v5+: `ThrottlerModuleOptions` é um **array de throttlers nomeados** `{ name, ttl, limit }` e **`ttl` é em milissegundos** (confirmado no `.d.ts` e no `throttler.service.js`; existe helper `seconds()` exportado). Vou usar `ThrottlerModule.forRoot([{ name: 'default', ttl: seconds(60), limit: 100 }])` + `APP_GUARD` global `ThrottlerGuard`. Não há convenção de env para esses limites no projeto, então uso baseline fixo 60s/100req.
- **FIX 1 — ordem de guards:** `ThrottlerGuard` registrado como `APP_GUARD` roda como guard global ANTES dos guards de controller (`AuthGuard` continua declarado por controller via `@UseGuards`). São independentes: o throttler só conta requisições por IP, não lê a sessão; não interfere no `AuthGuard` nem no `RateLimitService` por identidade (que roda dentro dos handlers). Mantém-se tudo complementar.
- **FIX 1 — proxy/`req.ip`:** o tracker padrão do `ThrottlerGuard` usa `req.ip`. Como `trust proxy` não está configurado no Express, atrás de proxy o `req.ip` pode ser o IP do proxy. Mantemos o default de IP e deixamos NOTA no código/plano (ver item 3) — ajustar `trust proxy` é decisão de infra fora do escopo e com risco próprio (o report classifica `proxy-addr`/spoofing como item de dependências, já tratado em outra tarefa).
- **FIX 3 — abordagem (a) `tokenVersion`:** o schema NÃO possui tabela de sessão de colaborador (só existe `session` do fluxo principal, ligada a `user`). Portanto a opção (b) não é trivial. Adoto **(a) tokenVersion por funcionário**: coluna `token_version integer NOT NULL DEFAULT 0` em `funcionarios_rh`, embutida no payload do token; `verifyToken` continua síncrono (assinatura + exp) e a checagem de revogação é feita no controller via consulta ao banco (compara versão do token com a do banco e também exige `ativo = true`). Incremento da versão em: troca de senha e logout. Mínima superfície, uma migração puramente aditiva.

---

## FIX 1 — Rate limiting global ([ALTA] 2)

- [ ] 1. Registrar o ThrottlerModule global em `app.module.ts`.
      Importar `ThrottlerModule` e `ThrottlerGuard` (e `seconds`) de `@nestjs/throttler` e `APP_GUARD` de `@nestjs/core`. Adicionar `ThrottlerModule.forRoot([{ name: 'default', ttl: seconds(60), limit: 100 }])` ao array `imports`, e adicionar `{ provide: APP_GUARD, useClass: ThrottlerGuard }` a um array `providers` do `@Module` (criar o campo `providers`, hoje inexistente). Não alterar os demais módulos nem a ordem de `imports` existente.
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/app.module.ts`
      Verify: `pnpm exec tsc --noEmit` — contagem de erros permanece 22 (lista inalterada). `pnpm build` passa.

- [ ] 2. Confirmar o ValidationPipe/CORS em `main.ts` e deixar o IP default do throttler.
      Nenhuma mudança obrigatória em `main.ts` para o throttler (o `APP_GUARD` basta). Confirmar apenas que o `ValidationPipe` global já tem `whitelist: true` e `forbidNonWhitelisted: true` (tem — necessário para o FIX 2). NÃO adicionar `app.set('trust proxy', ...)` nesta tarefa.
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/main.ts` (apenas leitura/confirmação; sem edição)
      Verify: `pnpm build` passa; inspeção confirma `whitelist`/`forbidNonWhitelisted` presentes.

- [ ] 3. (Opcional, só se trivial) `@Throttle` mais estrito em relatórios/apurações fiscais pesados.
      Se e somente se for trivial e sem risco, aplicar `@Throttle({ default: { ttl: seconds(60), limit: 20 } })` nos controllers de `fiscal/relatorios/*` e `fiscal/apuracao/*` (SPED EFD). Caso contrário, PULAR e deixar comentário/nota de que o baseline global já cobre. Adicionar comentário curto no `app.module.ts` registrando a limitação de `req.ip` atrás de proxy (ver decisão acima).
      Files: controllers em `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/fiscal/controllers/` (apenas se trivial)
      Verify: `pnpm build` passa; `pnpm exec tsc --noEmit` mantém 22 erros.

## FIX 2 — DTOs com class-validator no módulo usuarios (+ revisão auth) ([ALTA] 3)

- [ ] 4. Criar o arquivo de DTOs do módulo usuarios.
      Criar `CreateUsuarioDto`, `UpdateUsuarioDto` e `ChangePasswordDto` seguindo o padrão de `clientes/clientes.dto.ts` (decorators `@ApiProperty`/`@ApiPropertyOptional` + class-validator). Regras: `name` `@IsString` `@Length(1,160)`; `email` `@IsEmail`; `password` `@IsString` `@MinLength(6)` (alinhado à política existente — auth usa mínimo 6); `role` opcional com `@IsIn(['ADMIN','COLABORADOR'])` e default `'COLABORADOR'`. `UpdateUsuarioDto`: `name?`/`role?` todos `@IsOptional`, `role` com `@IsIn(['ADMIN','COLABORADOR'])`. `ChangePasswordDto`: `password` `@IsString` `@MinLength(6)`. Exportar um `const ROLES_SISTEMA = ['ADMIN','COLABORADOR'] as const` reutilizável pelo service (item 6).
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/usuarios/usuarios.dto.ts` (novo)
      Verify: `pnpm exec tsc --noEmit` — 22 erros (inalterado); arquivo compila.

- [ ] 5. Trocar as assinaturas dos handlers de `usuarios.controller.ts` para usar os DTOs.
      Em `create` usar `@Body() body: CreateUsuarioDto`; em `update` usar `@Body() body: UpdateUsuarioDto`; em `changePassword` usar `@Body() body: ChangePasswordDto`. Substituir os `@ApiBody({ schema: ... })` por `@ApiBody({ type: CreateUsuarioDto })` etc. (coerência Swagger). Manter a lógica dos handlers (trim/lowercase de email, checagem de email duplicado, bloqueio de auto-edição/auto-exclusão) exatamente como está. O `ValidationPipe` global (whitelist/forbidNonWhitelisted) passa a validar e descartar campos não previstos automaticamente.
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/usuarios/usuarios.controller.ts`
      Verify: `pnpm build` passa; `pnpm exec tsc --noEmit` mantém 22 erros.

- [ ] 6. Defesa em profundidade: validar `role` no service antes de INSERT/UPDATE.
      Em `createSystemUser` e `updateSystemUser` de `usuarios.service.ts`, antes de montar o SQL, validar `input.role` contra a whitelist `ROLES_SISTEMA` (importada do dto). Em `create`, se `role` inválido → lançar/retornar erro (`return { ok: false, code: 'INVALID_ROLE' }` e o controller converte em `BadRequestException`); em `update`, só validar quando `role` vier definido (ignora quando `undefined`, preservando o `COALESCE`). Não alterar as queries parametrizadas em si.
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/usuarios/usuarios.service.ts`, e ajuste do mapeamento de erro em `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/usuarios/usuarios.controller.ts`
      Verify: `pnpm build` passa; `pnpm exec tsc --noEmit` mantém 22 erros.

- [ ] 7. Revisar `auth` (login/change-password) aplicando DTO sem mudar a lógica de autenticação.
      Criar `LoginDto` (`email` `@IsEmail`/`@IsString`; `password` `@IsString`) e `ChangePasswordDto` (`currentPassword` `@IsString`; `newPassword` `@IsString` `@MinLength(6)`) e, se trivial, `ForgotPasswordDto`/`ResetPasswordDto`. Trocar os `@Body()` inline de `login` e `change-password` por esses DTOs e `@ApiBody({ type: ... })`. MANTER toda a lógica de autenticação, normalização (`trim().toLowerCase()`), rate limit por identidade e verificações de senha inalteradas. Atenção: o login aceita `identificador@kontabb.local` para CLIENTE — portanto `@IsEmail` é adequado (continua um email). Se algum formato não-email for aceito, usar `@IsString` em vez de `@IsEmail` no `email` do login para não quebrar clientes.
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/auth/auth.dto.ts` (novo), `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/auth/auth.controller.ts`
      Verify: `pnpm build` passa; `pnpm exec tsc --noEmit` mantém 22 erros. Rodar `pnpm test -- auth` e confirmar que `auth.guard.spec.ts`/`session-token.spec.ts` continuam passando.

## FIX 3 — Sessão de colaborador revogável via tokenVersion ([ALTA] 4)

- [ ] 8. Adicionar a coluna `token_version` ao schema `funcionarios_rh`.
      Em `database/schema.ts`, na definição de `funcionariosRh`, adicionar `tokenVersion: integer('token_version').notNull().default(0)` (garantir que `integer` já está importado de `drizzle-orm/pg-core`; se não, adicionar ao import). Mudança puramente aditiva.
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/database/schema.ts`
      Verify: `pnpm exec tsc --noEmit` mantém 22 erros.

- [ ] 9. Gerar a migração Drizzle `0027` (não rodar contra banco).
      Rodar `pnpm db:generate` a partir do worktree para gerar `drizzle/0027_*.sql` + atualização de `drizzle/meta/_journal.json` e snapshot. A migração deve conter apenas `ALTER TABLE "funcionarios_rh" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL`. NÃO editar o baseline `0000_base_inicial.sql` nem migrações existentes; NÃO rodar `db:migrate`. Se `db:generate` exigir `DATABASE_URL`, usar uma URL dummy só para geração (drizzle-kit generate não conecta ao banco) ou o padrão já usado pelo projeto.
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/drizzle/0027_*.sql` (gerado), `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/drizzle/meta/*` (gerado)
      Verify: inspecionar o `.sql` gerado — contém só o `ADD COLUMN` aditivo e nenhuma alteração em outras tabelas. `pnpm build` passa.

- [ ] 10. Embutir `tokenVersion` no payload do token do colaborador.
      Em `colaborador-session.service.ts`, adicionar `tokenVersion: number` à interface `ColaboradorTokenPayload`. O `createToken` já recebe `Omit<..., 'exp'>`, então quem chama passa `tokenVersion`. `verifyToken` permanece síncrono (assinatura + exp); NÃO fazer DB aqui. Tokens antigos sem `tokenVersion` ficarão com `undefined` → tratar no item 12 como versão divergente (rejeitar).
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/colaborador/colaborador-session.service.ts`
      Verify: `pnpm exec tsc --noEmit` — pode acusar erros nos pontos que criam token sem `tokenVersion`; esses são resolvidos nos itens 11-12 (deixar o worktree compilável só ao fim do FIX 3; concluir 10→12 juntos antes de verificar).

- [ ] 11. Fornecer a versão atual (e `ativo`) a partir do service e incrementá-la nas revogações.
      Em `colaborador.service.ts`:
      (a) `authenticate` deve passar a selecionar e retornar `tokenVersion` e já seleciona `ativo`; incluir `tokenVersion` no objeto `ColaboradorSession` e na interface.
      (b) Adicionar método `getRevocationState(funcionarioId)` que retorna `{ ativo: boolean; tokenVersion: number } | null` consultando `funcionariosRh`.
      (c) Em `changePassword`, no `.set({...})`, incrementar a versão: `tokenVersion: sql\`${funcionariosRh.tokenVersion} + 1\`` (import `sql` já existe).
      (d) Adicionar método `logout(funcionarioId)` que faz `UPDATE funcionarios_rh SET token_version = token_version + 1` para o funcionário (revoga tokens emitidos).
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/colaborador/colaborador.service.ts`
      Verify: parte do FIX 3; verificar junto com o item 12.

- [ ] 12. Checar revogação no controller e tornar `requireAuth` assíncrono.
      Em `colaborador.controller.ts`:
      - `login`: passar `tokenVersion: session.tokenVersion` ao `createToken`.
      - `trocarSenha`: após `changePassword` (que incrementou a versão), buscar a nova versão via `getRevocationState` e emitir o novo token com a versão atualizada (senão o próprio usuário se autorrevoga). Manter `primeiroAcesso: false`.
      - `logout`: tornar o handler assíncrono, extrair o payload do request (se houver), chamar `colaboradorService.logout(payload.funcionarioId)` e então `clearCookie`. Se não houver payload válido, apenas limpar cookie.
      - Converter o helper privado `requireAuth` em `async requireAuth(req): Promise<ColaboradorTokenPayload>`: após `extractFromRequest`, chamar `getRevocationState(payload.funcionarioId)`; se `null`, ou `ativo === false`, ou `estado.tokenVersion !== payload.tokenVersion` → `UnauthorizedException`. Atualizar todos os call sites para `await this.requireAuth(req)` (`trocarSenha`, `getPerfil`, `listRecibos`, `getRecibo`, `getReciboPdf`).
      - `getSession` e `getLogo` chamam `extractFromRequest` direto: após obter o payload, fazer a mesma checagem de revogação (`getRevocationState`); em `getSession` retornar `{ user: null }` quando revogado, em `getLogo` lançar `UnauthorizedException`. Tornar `getSession` assíncrono.
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/colaborador/colaborador.controller.ts`
      Verify: `pnpm build` passa; `pnpm exec tsc --noEmit` volta a 22 erros (nenhum novo). Fim do FIX 3 — worktree compilável.

## Verificação final (rodar no worktree)

- [ ] 13. Verificação integrada de toda a tarefa.
      Rodar em sequência a partir de `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas`:
      1. `pnpm exec tsc --noEmit` → **exatamente os mesmos 22 erros** pré-existentes (fiscal specs). Qualquer erro fora dessa lista é regressão desta tarefa e deve ser corrigido.
      2. `pnpm build` → sucesso.
      3. `pnpm test` → as 2 falhas meta-presence pré-existentes são aceitáveis; QUALQUER falha nova deve ser investigada/corrigida. Prestar atenção a `src/auth/auth.guard.spec.ts` e `src/auth/session-token.spec.ts` (podem depender de formatos de corpo/sessão).
      Files: — (apenas execução)
      Verify: os três comandos acima com os resultados descritos.

## Testes leves recomendados (não planejar suíte extensa)

- [ ] 14. (Recomendado, leve) Dois testes unitários pequenos cobrindo os novos caminhos de segurança.
      (a) DTO rejeita `role` fora de `['ADMIN','COLABORADOR']` (validar `CreateUsuarioDto`/`UpdateUsuarioDto` via `validate()` do class-validator). (b) Revogação por versão: `requireAuth`/`getRevocationState` rejeita token cuja `tokenVersion` difere da do banco (teste do service/controller com `DatabaseService` mockado, no padrão dos specs existentes). Não adicionar além disso.
      Files: `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/usuarios/usuarios.dto.spec.ts` (novo), `/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-altas/src/colaborador/colaborador-revocation.spec.ts` (novo)
      Verify: `pnpm test` — os novos specs passam; total de falhas continua sendo apenas as 2 meta-presence pré-existentes.

## Notas / lacunas assumidas

- Não existe hoje endpoint que inative (`ativo=false`) ou desligue funcionário fora do fluxo de colaborador; a checagem `ativo` em `requireAuth` já bloqueia tokens de inativos no servidor. Qualquer rota futura de desligamento deve também incrementar `token_version` (deixar comentário no service).
- Política mínima de senha = 6 caracteres (consistente em auth e colaborador); DTOs usam `@MinLength(6)`. Não é escopo endurecer a política.
- `trust proxy`/`req.ip` atrás de proxy: mantido o default; ajuste é de infra e fora do escopo (apenas NOTA no código).
- Redução de TTL/refresh do token de colaborador: NÃO implementado (bônus opcional); deixado como nota.
