# Implementation Plan — Security Fixes [MÉDIA] 5, 6, 7, 9

Scope: implement ONLY the four MEDIUM findings below, inside the worktree
`/Users/pablo/dev/kontabb/api/.worktrees/sec-fix-medias` (branch `security/fix-medias`).
Git ops use `git -C /Users/pablo/dev/kontabb/api/.worktrees/sec-fix-medias`.

**OUT OF SCOPE (do NOT touch):** finding [MÉDIA] 8 — `src/health/setup.controller.ts` keeps the
fixed initial password `123456` by product decision (client is forced to change it on first login
via the first-login / RequirePasswordChanged flow). Do not change the password, do not randomize it,
do not touch the hardcoded PII in that file.

**Do NOT undo prior fixes already in the base:** global `ThrottlerModule`/`APP_GUARD` (app.module.ts),
class-validator DTOs in usuarios/auth, and collaborator revocation via `tokenVersion`
(`ColaboradorService.getRevocationState`/`logout`, async `requireAuth` with revocation check).

## Project facts discovered during exploration

- Stack: NestJS 11 (TypeScript) + Drizzle ORM + PostgreSQL. Package manager: **pnpm**.
- Test runner: **Jest** (`pnpm test` → `jest`; config in package.json, `rootDir: src`, `testRegex: .*\.spec\.ts$`). NOT vitest.
- Build: `pnpm build` → `nest build`. Typecheck: `pnpm exec tsc --noEmit`.
- **tsc baseline (pre-existing, NOT a regression — do not fix):** 23 errors, all in
  `src/fiscal/controllers/fiscal-apuracao.controller.spec.ts` (1) and
  `src/fiscal/services/fiscal-entregas.service.spec.ts` (22), all `TS2554 Expected N arguments`.
  2 meta-presence tests also fail at baseline. Verification bar: **no NEW tsc errors outside those two files; no NEW failing tests.**
- `helmet` is NOT in package.json — Correction D installs it with `pnpm add helmet`.
- Auth guard pattern to follow: `src/auth/auth.guard.ts` (`AuthGuard implements CanActivate`, reads
  roles via `Reflector.getAllAndOverride(ROLES_KEY, [handler, class])`, attaches `request.user`),
  `src/auth/roles.decorator.ts` (`SetMetadata`-based `@Roles`/`@StaffOnly`/`@AdminOnly`),
  `src/auth/require-password-changed.guard.ts` (`RequirePasswordChangedGuard`, runs AFTER AuthGuard,
  reads `request.user`), `src/auth/current-user.decorator.ts` (`createParamDecorator`).
- Env conditional validation: `env.validation.ts` has NO per-field NODE_ENV conditional today; the only
  cross-field/conditional logic lives inside the `validate()` function (the BETTER_AUTH_SECRET vs
  JWT_SECRET mismatch guard). Correction B adds a NODE_ENV-conditional check inside `validate()`,
  following that same function-level pattern (not a decorator).

---

## Correction C investigation findings (record so the coder does not re-discover)

Finding [MÉDIA] 7 — `auth.controller.ts` login returns `session: { token: sessionToken, expiresAt }`
in the JSON body in addition to setting the httpOnly signed cookie.

**Who consumes `session.token`:**
- **Browser (front `/Users/pablo/dev/kontabb/web`):** `web/lib/auth-client.ts` → `signIn.email()` calls
  `POST /api/auth/login` with `credentials: "include"` and reads **only `data.user`**. It never reads
  `data.session` / `data.session.token`. Session is maintained purely by the httpOnly cookie; `getSession`
  / `useSession` call `GET /api/auth/session` with the cookie. `web/lib/api*` has no Bearer/token usage.
  Confirmed by grep: the only `session.token` hits in `web/` are Next.js HMR build artifacts, not app code.
- **Server-to-server / Bearer:** `src/auth/session-token.service.ts#extractBearerToken` intentionally
  accepts the **raw DB session token** as `Authorization: Bearer <token>`, and `AuthService.validateSession`
  looks it up by `session.token`. The raw `sessionToken` returned in the login body is exactly the value a
  Bearer integration would need. The browser cookie uses a DIFFERENT, signed format (`token.hmac`), so
  removing the body token does not affect the cookie flow.
- **In-repo tests:** no `auth.controller.spec.ts` exists; grep found no spec depending on the login body
  `session.token`. No test breakage from conditioning it.

**Conclusion / lowest-risk recommendation (safe to implement — do NOT pause):**
Condition the body token so it is returned ONLY for an explicit Bearer-intent caller, never for a browser
login that just received the httpOnly cookie. Concretely: a browser login is detectable because the
response sets the session cookie and the browser does not need the token; a server-to-server integration
signals Bearer intent via an explicit request header. Implement as:
  - Treat the caller as Bearer-intent when the request arrived with an `Authorization` header already,
    OR sends an explicit opt-in header `X-Auth-Response-Token: 1` (or `?tokenInBody=1` — pick one and
    document it in the handler comment). Default (browser) response omits `session.token` and returns only
    `session: { expiresAt }` (keep `expiresAt` — it is not a secret and may be used for UX).
  - Keep the httpOnly cookie behavior unchanged in all cases.
This preserves the legitimate Bearer flow (an integration can still obtain the raw token by opting in)
while removing the XSS-exfiltratable token from the default browser response. Because the only known
browser consumer ignores `session.token` and no in-repo Bearer consumer reads the login body today, this
is safe. If, during implementation, the coder discovers a real browser/integration consumer that reads
`session.token` from the default response (contradicting these findings), PAUSE and ask via
`send_message` (warning) before changing the shape.

---

## Ordered implementation items

- [ ] 1. (Correction B — [MÉDIA] 6) Make `CRON_SECRET` required in production.
      Edit `src/config/env.validation.ts`: keep the `@IsOptional()` decorator on `CRON_SECRET` (dev stays
      optional), and add a NODE_ENV-conditional check inside the existing `validate()` function (same place
      as the BETTER_AUTH_SECRET/JWT_SECRET guard): when `NODE_ENV === 'production'`, require `CRON_SECRET`
      to be present and `>= 32` chars; throw a clear Error otherwise. Optionally, in
      `src/cron/cron.controller.ts`, keep the existing `CRON_NOT_CONFIGURED` fail-safe but add a
      `this.logger.warn('cron_not_configured', ...)` when `secret` is missing (do NOT change the
      timing-safe comparison). Files: `src/config/env.validation.ts`, `src/cron/cron.controller.ts`.
      Verify: `pnpm exec tsc --noEmit` adds no new errors; `pnpm test src/config` (or run jest for any env
      validation spec) passes; manually confirm `validate({ NODE_ENV: 'production', ... , CRON_SECRET: undefined })`
      throws and dev config without CRON_SECRET still validates.

- [ ] 2. (Correction D — [MÉDIA] 9) Add helmet + condition Swagger by environment in `src/main.ts`.
      Install helmet: `pnpm add helmet` (production dependency). In `src/main.ts`, add
      `app.use(helmet({ ... }))` EARLY (before/around cookie-parser, preserving the existing order:
      CORS → helmet → cookie-parser → request-id → ValidationPipe → filters). Configure at minimum
      `xContentTypeOptions` (nosniff), `frameguard` (deny), and HSTS in production
      (`hsts: isProduction ? {...} : false`). Because the API serves DANFE PDF binaries inline (getDanfe,
      `Content-Disposition: inline`) and is consumed cross-origin by the front, set
      `contentSecurityPolicy: false` (or a permissive CSP) and `crossOriginResourcePolicy: false` so helmet
      does not break CORS or the PDF download. Wrap the `SwaggerModule.setup('api/docs', ...)` block in
      `if (process.env.NODE_ENV !== 'production') { ... }` (read NODE_ENV via `configService` consistently).
      Preserve all existing middleware/order and the global `api` prefix. Files: `src/main.ts`, `package.json`,
      `pnpm-lock.yaml`.
      Verify: `pnpm exec tsc --noEmit` adds no new errors; `pnpm build` succeeds; `pnpm audit --prod`
      (record output — helmet must not introduce a new critical/high); start the app in dev and confirm
      `/api/docs` is reachable in dev and that responses carry `X-Content-Type-Options: nosniff`.

- [ ] 3. (Correction C — [MÉDIA] 7) Condition the login body `session.token` to Bearer-intent callers.
      In `src/auth/auth.controller.ts#login`, keep setting the httpOnly cookie unchanged. Replace the
      unconditional `session: { token: sessionToken, expiresAt }` with: always return
      `session: { expiresAt: expiresAt.toISOString() }`, and include `token: sessionToken` ONLY when the
      caller signals Bearer intent (request already carries an `Authorization` header OR an explicit opt-in
      header such as `X-Auth-Response-Token: 1`). Add a short comment citing finding [MÉDIA] 7 and the
      decision. Do NOT change `auth.service.ts` session creation. Files: `src/auth/auth.controller.ts`.
      Verify: `pnpm exec tsc --noEmit` adds no new errors; `pnpm test src/auth` passes (existing
      session-token/auth-guard specs unaffected); manual check: a plain browser-style login (no Authorization
      header, no opt-in header) returns `user` + `session.expiresAt` WITHOUT `session.token`, and the cookie
      is still set; a request with the opt-in header still returns `session.token`.

- [ ] 4. (Correction A — [MÉDIA] 5) Replace manual auth calls in colaborador with declarative guards.
      Create `src/colaborador/colaborador-auth.guard.ts` — a `ColaboradorAuthGuard implements CanActivate`
      that encapsulates today's `requireAuth` logic: extract payload via
      `ColaboradorSessionService.extractFromRequest`, then verify revocation via
      `ColaboradorService.getRevocationState` (null / `!ativo` / `tokenVersion` mismatch → 401), and attach
      the payload to the request (e.g. `request.colaborador = payload`). PRESERVE this revocation check
      (FEAT-003). Create `src/colaborador/colaborador-public.decorator.ts`
      (`@ColaboradorPublic()` via `SetMetadata`, read by the guard through `Reflector` to skip auth —
      analogous to the AuthGuard/@Roles pattern) and a `@RequirePasswordChanged()` metadata/guard aligned
      with the main module's `RequirePasswordChangedGuard` (block when `payload.primeiroAcesso`), plus a
      `@Colaborador()` param decorator (createParamDecorator) returning `request.colaborador`. Apply
      `@UseGuards(ColaboradorAuthGuard, ColaboradorRequirePasswordChangedGuard)` at `@Controller('colaborador')`
      level. Mark `auth/login`, `auth/logout`, `auth/session` as `@ColaboradorPublic()`. Keep `logo` and
      `getSession` reachable WITHOUT the password-changed requirement (finding [BAIXA] 12 is out of scope —
      preserve current behavior: they require auth but NOT password-changed); the password-changed guard must
      only block the handlers that block today (`perfil`, `recibos*`). Note `logout`/`session` currently use
      `extractFromRequest` directly and tolerate a missing/invalid token (returning `{success:true}` /
      `{user:null}`): keep them public so that behavior is preserved. Remove the now-redundant private
      `requireAuth`/`requirePasswordChanged` methods and the manual calls from handlers, replacing
      `const payload = await this.requireAuth(req)` with the `@Colaborador()` param (or `request.colaborador`).
      Register the new guards/providers in `src/colaborador/colaborador.module.ts` (and ensure
      `ColaboradorService` is injectable into the guard — it already is in the module).
      **Update the existing spec** `src/colaborador/colaborador-revocation.spec.ts`: it currently builds the
      controller with 5 args and calls `controller.getPerfil(req)` expecting the controller to enforce
      revocation. After the migration the controller no longer enforces auth itself, so rewrite that spec to
      exercise `ColaboradorAuthGuard.canActivate` (and the password-changed guard) with the same scenarios
      (version mismatch, inactive, missing employee, happy path, getSession-revoked) rather than the
      controller methods. Files: `src/colaborador/colaborador-auth.guard.ts` (new),
      `src/colaborador/colaborador-public.decorator.ts` (new),
      `src/colaborador/colaborador-require-password-changed.guard.ts` (new),
      `src/colaborador/colaborador.decorator.ts` (new, `@Colaborador()` param),
      `src/colaborador/colaborador.controller.ts`, `src/colaborador/colaborador.module.ts`,
      `src/colaborador/colaborador-revocation.spec.ts`.
      Verify: `pnpm exec tsc --noEmit` adds no new errors; `pnpm test src/colaborador` passes (rewritten
      guard spec green); manual reasoning check that every previously-protected handler is still protected
      by the class-level guard and the three public endpoints remain public.

- [ ] 5. Final full verification across all corrections.
      Files: none (verification only).
      Verify: `pnpm exec tsc --noEmit` → only the 23 known baseline errors in the two fiscal spec files, no
      new ones; `pnpm build` succeeds; `pnpm test` → no NEW failing tests beyond the 2 known baseline
      meta-presence failures; `pnpm audit --prod` recorded (helmet introduced no new high/critical).
      Commit on branch `security/fix-medias` (do not push).
