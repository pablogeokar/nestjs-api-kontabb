# Relatório de Varredura de Segurança — API Kontabb

- **Data:** 2026-10-11
- **Escopo:** API NestJS (`/Users/pablo/dev/kontabb/api/src`) — autenticação, controle de acesso, injeção, upload, armazenamento, módulo fiscal, cron, configuração global e dependências.
- **Tipo:** Revisão AppSec SOMENTE LEITURA (nenhum código alterado).
- **Método:** Leitura de controllers/services, análise de guards/pipes globais (`main.ts`, `app.module.ts`), busca por padrões de risco (`sql\``, `fetch(`, `timingSafeEqual`, `@UseGuards`, XML parsers) e execução de `pnpm audit --prod`.

---

## Resumo executivo

A base de código demonstra uma postura de segurança **acima da média**: HMAC verificado com `timingSafeEqual`, scrypt para senhas, validação de assinatura (magic bytes) em uploads, parametrização consistente em Drizzle, bloqueio explícito de DTD/entidades no XML fiscal e escopo por `clienteId` nas rotas fiscais. Os achados concentram-se em **validação de entrada incompleta em alguns endpoints administrativos**, **ausência de rate limiting global**, e principalmente **dependências com vulnerabilidades conhecidas**.

| Severidade | Quantidade |
|-----------|-----------|
| Crítica   | 1 |
| Alta      | 3 |
| Média     | 5 |
| Baixa     | 4 |

> Observação: a maior exposição confirmada vem de **dependências desatualizadas** (`pnpm audit --prod`: 1 crítica, 28 altas, 21 moderadas, 1 baixa = 51 no total). Vários achados do código-fonte são "defesa em profundidade" e não falhas diretamente exploráveis isoladas.

---

## Achados (ordenados por severidade)

### [CRÍTICA] 1. Dependências de produção com vulnerabilidades conhecidas (OWASP A06)

- **Arquivo:** `package.json`, `pnpm-lock.yaml`
- **Evidência (`pnpm audit --prod`):** `51 vulnerabilities found — Severity: 1 low | 21 moderate | 28 high | 1 critical`.
  - **Crítica — `proxy-addr` (`<2.0.8`)**, GHSA-jqcg-44mw-7w3h: IP spoofing via subnet IPv4-mapped IPv6. Chega via `express` (transitiva do `@nestjs/platform-express`). Como a API usa `req.ip` (ver `auth.controller.ts` ao gravar `ipAddress` da sessão) e o rate limit de login não é por IP, o impacto direto é baixo, mas spoofing de IP afeta logs/auditoria.
  - **Alta — `axios`** (múltiplas): ReDoS, prototype pollution e **SSRF via redirect quando `maxRedirects: 0` não é respeitado pelo adapter fetch**. Entra via `nfewizard-io`/`@nfewizard/*` (comunicação com a SEFAZ).
  - **Alta — `multer`** (DoS por upload malformado/oversized): usado em todos os endpoints de upload (`guias`, `upload`, `fiscal/certificado`, `fiscal/importar-xml`, `clientes/:id/logo`, `rh`).
  - **Alta — `@xmldom/xmldom`** (injeção de nome de elemento/atributo, ReDoS, consumo quadrático): entra via `nfewizard-io`/`libxmljs2` no processamento de DF-e.
  - **Alta — `nodemailer`** e **`js-yaml`**, **`http-cache-semantics`**, **`brace-expansion`**: ReDoS/DoS, em sua maioria transitivas de ferramentas de build (`node-gyp`) ou do stack de e-mail.
- **Impacto:** DoS (ReDoS/OOM), potencial SSRF (axios), prototype pollution e spoofing de IP, dependendo da cadeia explorável.
- **Recomendação:**
  1. Atualizar o stack Nest/Express para versões que tragam `proxy-addr >= 2.0.8`, `multer` corrigido e `brace-expansion >= 2.1.4`.
  2. Atualizar/pinar `@nfewizard/*` + `nfewizard-io` para versões que resolvam `axios` e `@xmldom/xmldom`; se não houver versão corrigida, aplicar `pnpm.overrides` para forçar as transitivas.
  3. Integrar `pnpm audit --prod` ao CI como gate.
- **needs verification:** a explorabilidade real do `axios`/`@xmldom` depende de como `nfewizard-io` os invoca (entrada controlada pelo atacante vs. apenas respostas da SEFAZ). Recomenda-se validar a superfície antes de classificar como explorável em produção.

---

### [ALTA] 2. Ausência de rate limiting global / proteção de DoS na maioria dos endpoints (OWASP A04/A05)

- **Arquivos:** `src/app.module.ts`, `src/main.ts`, `package.json`
- **Evidência:** `@nestjs/throttler` consta como dependência em `package.json`, porém **não há `ThrottlerModule`, `APP_GUARD` nem `@Throttle` em nenhum lugar do código** (busca por `Throttler|APP_GUARD|@Throttle` → "No matches found"). O rate limiting existe apenas pontualmente, via `RateLimitService` (tabela `app_rate_limits`), em: login, forgot/reset/change-password, first-login, consulta-cnpj, URLs de guia e importação de XML.
- **Impacto:** Endpoints autenticados caros ficam sem throttling — em especial os relatórios/apurações do módulo fiscal (`fiscal/relatorios/*`, `fiscal/apuracao`, SPED EFD) que executam agregações pesadas no Postgres, e os endpoints de listagem administrativa. Um usuário autenticado pode causar degradação/DoS. Também não há limite por IP para requisições anônimas que atingem `health`, `setup`, `colaborador/auth/*`.
- **Recomendação:** Registrar `ThrottlerModule.forRoot` com `APP_GUARD` global como baseline por IP, e manter o `RateLimitService` para limites por identidade nos endpoints sensíveis. Considerar limites específicos nos relatórios fiscais.

---

### [ALTA] 3. Endpoints administrativos sem DTO com class-validator — validação efetivamente ausente (OWASP A03/A04 — mass assignment / integridade de role)

- **Arquivo:** `src/usuarios/usuarios.controller.ts` (linhas ~98-260), `src/usuarios/usuarios.service.ts` (`createSystemUser`, `updateSystemUser`, `changePassword`)
- **Evidência:** os handlers recebem o corpo como **tipo TypeScript inline**, não como classe DTO:
  ```ts
  async create(
    @Body() body: { name: string; email: string; password: string; role?: string },
    ...
  ) { const { name, email, password, role = 'COLABORADOR' } = body; ... }

  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; role?: string },
    ...
  ) { ... usuariosService.updateSystemUser({ userId: id, role: body.role }); }
  ```
  No service, `role` é interpolado direto na query (parametrizado, mas sem whitelist):
  ```ts
  INSERT INTO "user" (... role ...) VALUES (..., ${input.role}, ...)
  // e
  UPDATE "user" SET role = COALESCE(${input.role ?? null}::text, role) ...
  ```
- **Causa raiz:** o `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`) só atua sobre **classes com metadados do class-validator**. Para um `@Body()` tipado apenas por `interface`/`type`, não há metadado em runtime → o pipe não valida nem remove campos. O schema `@ApiBody` com `enum: ['ADMIN','COLABORADOR']` é apenas documentação Swagger, **não** é imposto.
- **Impacto:** um ADMIN autenticado pode gravar um `role` arbitrário (ex.: valor fora de `ADMIN`/`COLABORADOR`, ou `CLIENTE`), corrompendo o modelo de papéis e o `AuthGuard`/`@Roles`. Sem limite mínimo de senha no `changePassword` administrativo. Mesmo sendo área admin, viola integridade e defesa em profundidade.
- **Comparação (boa prática já aplicada):** `clientes/clientes.dto.ts` é usado como classe DTO (`CreateClientDto`, `UpdateClientDto`), e os controllers fiscais usam DTOs (`QueryDocumentosFiscaisDto` etc.) — nesses casos o `ValidationPipe` funciona.
- **Recomendação:** Converter os corpos de `usuarios` (e revisar `auth` login/change-password) para classes DTO com `@IsString`, `@IsEmail`, `@IsEnum`/`@IsIn(['ADMIN','COLABORADOR'])`, `@MinLength` na senha. Validar `role` no service também (defesa em profundidade).

---

### [ALTA] 4. Sessão do colaborador é stateless e não revogável (OWASP A07)

- **Arquivo:** `src/colaborador/colaborador-session.service.ts`, `src/colaborador/colaborador.controller.ts`
- **Evidência:** o token é `base64url(JSON).HMAC` com `exp` embutido e TTL de 8h; `logout` apenas limpa o cookie (`clearCookie`). Não há tabela de sessão nem verificação de revogação em `verifyToken` (diferente do fluxo principal, que consulta a tabela `session` em `AuthService.validateSession`).
  ```ts
  // Verifica assinatura (timing-safe, OK) e exp, mas nada no servidor:
  if (payload.exp < Date.now()) return null;
  return payload;
  ```
- **Impacto:** um token de colaborador vazado permanece válido por até 8h sem possibilidade de invalidação (logout no servidor, troca de senha ou desligamento do funcionário não revogam tokens já emitidos). O payload (nome, cargo, CNPJ, razão social) é legível por qualquer um que obtenha o token, pois é apenas base64 (não cifrado) — mitigado por cookie `httpOnly`.
- **Recomendação:** adotar sessão persistida/consultável (como no fluxo principal) ou uma denylist/`tokenVersion` por funcionário incrementada em troca de senha/desligamento; reduzir o TTL e/ou implementar refresh curto.

---

### [MÉDIA] 5. Rotas de colaborador sem guard declarativo — autorização só por chamada manual (OWASP A01)

- **Arquivo:** `src/colaborador/colaborador.controller.ts`
- **Evidência:** o `@Controller('colaborador')` **não** aplica `@UseGuards`. Cada handler protegido chama manualmente `this.requireAuth(req)` e `this.requirePasswordChanged(payload)`. As rotas de leitura de recibos escopam por `payload.funcionarioId` (ex.: `getReciboDetalhe(payload.funcionarioId, id)`), o que previne IDOR — desde que o service filtre por `funcionarioId`.
- **Impacto:** o padrão funciona hoje, mas é frágil: um novo endpoint adicionado sem a chamada manual a `requireAuth` fica público por omissão (ao contrário dos módulos com guard de classe). Risco de regressão de controle de acesso.
- **Recomendação:** criar um `ColaboradorAuthGuard` e aplicá-lo no nível do controller, deixando públicos apenas `login`/`logout`/`session` via metadado explícito.
- **needs verification:** confirmar que `ColaboradorService.getReciboDetalhe/getReciboPdf/listRecibos` sempre filtram por `funcionarioId` no `WHERE` (lido parcialmente; o controller passa o id corretamente, mas o filtro final no SQL não foi integralmente inspecionado).

---

### [MÉDIA] 6. CRON_SECRET opcional — rotinas podem ficar sem autenticação por configuração (OWASP A05/A07)

- **Arquivo:** `src/cron/cron.controller.ts`, `src/config/env.validation.ts`
- **Evidência:** `CRON_SECRET` é `@IsOptional()`. Quando ausente, os endpoints retornam `CRON_NOT_CONFIGURED` em vez de executar — ou seja, **falham de forma segura** (não executam sem segredo). A comparação em si é correta e timing-safe:
  ```ts
  const received = Buffer.from(authHeader);
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
  ```
- **Impacto:** não há bypass direto, mas a opcionalidade permite subir produção sem o segredo, deixando `cron/storage-cleanup` e `cron/fiscal-sync` inoperantes silenciosamente (disponibilidade). Não há rate limit nesses endpoints (enumeração do segredo é inviável por timing-safe + alto espaço de chave, mas o endpoint fica exposto).
- **Recomendação:** tornar `CRON_SECRET` obrigatório em produção (validação condicional por `NODE_ENV`), com comprimento mínimo (ex.: `@MinLength(32)`), e logar/alertar quando `CRON_NOT_CONFIGURED`.

---

### [MÉDIA] 7. Login retorna o token de sessão em texto no corpo da resposta (OWASP A07 — exposição / superfície XSS)

- **Arquivo:** `src/auth/auth.controller.ts` (`login`)
- **Evidência:**
  ```ts
  return { user: {...}, session: { token: sessionToken, expiresAt: ... } };
  ```
  O cookie é `httpOnly`, mas o mesmo token bruto também é devolvido no JSON (por design, para o fluxo `Authorization: Bearer`).
- **Impacto:** se o front-end persistir esse token (localStorage/estado), qualquer XSS no `../web` passa a conseguir exfiltrar um token de sessão válido — anulando a proteção `httpOnly` do cookie. É uma decisão de arquitetura (Bearer suportado), portanto classificada como média e dependente do uso no cliente.
- **Recomendação:** se o navegador usa cookie, não expor o token no corpo para sessões de browser; restringir o retorno do token aos consumidores que realmente usam Bearer (ex.: integrações server-to-server). Garantir que o front não armazene o token em local acessível a scripts.
- **needs verification:** como o `../web` consome `session.token` (fora do escopo deste scan, que é a API).

---

### [MÉDIA] 8. `setup` cria ADMIN com senha fixa fraca (`123456`) (OWASP A07)

- **Arquivo:** `src/health/setup.controller.ts`
- **Evidência:** `const hashedPassword = await this.authService.hashPassword('123456');` cria o ADMIN inicial `pablogeokar@gmail.com`. A rota é protegida por `NODE_ENV !== 'development'` (403 fora de dev) e por já existir ADMIN (409).
- **Impacto:** limitado a ambientes de desenvolvimento. Mas e-mail real + senha previsível criam risco se um ambiente de "desenvolvimento" for exposto, ou se a flag de ambiente for mal configurada. PII (e-mail/nome reais) hardcoded no código.
- **Recomendação:** gerar senha aleatória e exibi-la uma única vez, ou exigir a senha via variável de ambiente; remover PII hardcoded; garantir que a rota não seja compilada/registrada em builds de produção.

---

### [MÉDIA] 9. Falta de segurança de cabeçalhos HTTP (helmet ausente) (OWASP A05)

- **Arquivo:** `src/main.ts`
- **Evidência:** não há `helmet()` nem configuração de cabeçalhos (`Content-Security-Policy`, `X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`, etc.). O `main.ts` configura CORS, cookie-parser, `ValidationPipe` e Swagger, mas nenhum middleware de headers.
- **Impacto:** respostas da API sem headers de hardening. Para uma API JSON o impacto é menor que para HTML, mas endpoints que retornam binário (DANFE PDF em `getDanfe`, que faz `res.end(buffer)` com `Content-Disposition: inline`) se beneficiam de `X-Content-Type-Options: nosniff` para evitar MIME sniffing.
- **Recomendação:** adicionar `helmet` com, no mínimo, `nosniff`, `frameguard` e HSTS em produção. O Swagger (`api/docs`) deve ser desabilitado ou protegido em produção.
- **needs verification:** se o Swagger `api/docs` fica público em produção (atualmente registrado incondicionalmente em `bootstrap()`), ele expõe todo o contrato da API — recomenda-se restringir por ambiente.

---

### [BAIXA] 10. CORS correto, porém a lista inclui `http://localhost:3000` incondicionalmente

- **Arquivo:** `src/main.ts`
- **Evidência:**
  ```ts
  app.enableCors({
    origin: ['http://localhost:3000', 'https://www.kontabb.com.br',
             'https://kontabb.com.br', configuredAppUrl],
    credentials: true,
  });
  ```
- **Impacto:** a lista é explícita (não há `origin: *` com `credentials: true`, o que seria crítico — e **não** é o caso aqui, ponto positivo). Porém `http://localhost:3000` permanece permitido mesmo em produção, ampliando levemente a superfície (um atacante que controle a resolução de `localhost` no navegador da vítima, cenário raro).
- **Recomendação:** montar a lista de origens condicionalmente por `NODE_ENV`, incluindo `localhost` apenas em desenvolvimento.

---

### [BAIXA] 11. Construção de chaves R2 a partir de CNPJ/CPF — risco de path traversal mitigado, mas não defendido na origem

- **Arquivo:** `src/storage/storage.service.ts` (`documentObjectKey`, `receiptObjectKey`, `logoObjectKey`)
- **Evidência:** as chaves são compostas por `clientes/${cnpj}/...`. Nos fluxos auditados, `cnpj`/`cnpjCpf` vêm do registro do cliente no banco e `isValidCnpj` restringe a `[0-9A-Z]`; `period`/`type`/`obligationId` são UUID/valores controlados. Não há concatenação de nome de arquivo bruto do usuário na chave (o nome original é apenas armazenado via `sanitizeFileName`, não usado como chave).
- **Impacto:** path traversal (`../`) na chave R2 é improvável porque os componentes não aceitam `/` ou `.` arbitrários. É uma observação de defesa em profundidade.
- **Recomendação:** validar/normalizar explicitamente todos os segmentos de chave (rejeitar `/`, `..`) dentro de `StorageService`, para não depender de validações a montante.
- **needs verification:** confirmar que `cpf`/`tipoPessoa='PF'` em `confirmPayment` sempre produz um valor numérico saneado antes de virar segmento de chave.

---

### [BAIXA] 12. Logo/CNPJ do colaborador acessível por sessão com `primeiroAcesso` ainda pendente

- **Arquivo:** `src/colaborador/colaborador.controller.ts` (`getLogo`, `getSession`)
- **Evidência:** `getLogo` e `getSession` chamam apenas `requireAuth`/`extractFromRequest`, sem `requirePasswordChanged`. Já os endpoints de dados (perfil/recibos) exigem senha trocada.
- **Impacto:** mínimo — expõe apenas a URL assinada da logo da empresa e metadados da própria sessão antes da troca de senha provisória. Não há vazamento de dados de terceiros.
- **Recomendação:** decisão de produto; se a logo não deve aparecer antes da troca de senha, aplicar `requirePasswordChanged` também nesses endpoints.

---

## Boas práticas já aplicadas (contexto positivo)

Vários controles estão corretamente implementados e devem ser preservados:

1. **Comparações timing-safe:** validação do cookie HMAC (`session-token.ts`), verificação de senha scrypt (`auth.service.ts`), token do colaborador (`colaborador-session.service.ts`) e `CRON_SECRET` (`cron.controller.ts`) usam todos `crypto.timingSafeEqual` com checagem de comprimento prévia.
2. **Hashing de senha robusto:** scrypt com `N=16384, r=16, p=1` e `normalize('NFKC')`; suporte a bcrypt legado apenas para compatibilidade.
3. **Validação de upload por magic bytes:** `file-validation.ts` compara a assinatura real do arquivo (`hasValidFileSignature`) contra o MIME declarado, com limites de tamanho por endpoint (10MB guias/comprovantes, 2MB logo, 10MB/arquivo e máx. 20 arquivos no XML fiscal) e `sanitizeFileName` para o nome.
4. **Proteção XXE no XML fiscal manual:** `dfe-document.parser.ts` rejeita explicitamente `<!DOCTYPE`/`<!ENTITY` e impõe `MAX_XML_LENGTH` (10MB) antes de validar com `fast-xml-parser` (que não resolve entidades externas por padrão).
5. **Parametrização consistente no Drizzle:** todas as queries `sql\`\`` usam interpolação de parâmetros (`${valor}` vira bind param), inclusive em `ILIKE '%' + input + '%'` e listas `IN` via `sql.join`. Não foi encontrada concatenação de strings crua em SQL.
6. **SSRF mitigada em consulta-cnpj:** `isValidCnpj` é chamado antes de `cnpjLookupService.lookup`; o CNPJ é normalizado para `[0-9A-Z]` e as URLs dos provedores são fixas (allowlist de 2 hosts), com `AbortSignal.timeout(8s)`.
7. **Escopo por `clienteId`/`funcionarioId` nas rotas fiscais e de colaborador:** `getXmlDownloadUrl`, `getDanfePdf`, `getDocumentoParaManifestacao` e as listagens filtram por `cliente.id` resolvido da sessão (via `getClientForUser`), prevenindo IDOR entre empresas. A rota `guias/:id` usa `getAccessibleGuia`, que confirma a posse pelo `userId` do cliente.
8. **Guards e papéis bem distribuídos:** rotas `admin/*` usam `@UseGuards(AuthGuard)` + `@StaffOnly()`/`@AdminOnly()` no nível de classe; `cliente/*` e `fiscal/*` usam `AuthGuard` (+ `RequirePasswordChangedGuard` onde aplicável). `ParseUUIDPipe` valida IDs de rota.
9. **Filtro de exceções não vaza internals:** `http-exception.filter.ts` retorna código genérico `INTERNAL_SERVER_ERROR` para erros não-HTTP e normaliza mensagens; o `AppLogger.error` registra apenas `errorCode` (name/code), não a stack nem o payload do erro — evita vazar detalhes de Postgres/R2/Mailtrap nas respostas.
10. **Segredos não logados:** o token do Mailtrap é usado só no header `Authorization` do `fetch`; nenhuma rota retorna hash de senha (as queries de auth selecionam `password` apenas internamente para verificação).
11. **Validação de ambiente forte:** `env.validation.ts` exige `BETTER_AUTH_SECRET`/`CERTIFICATE_ENCRYPTION_KEY` com `@MinLength(32)`, rejeita o valor de exemplo e **impede divergência** entre `BETTER_AUTH_SECRET` e o legado `JWT_SECRET` (evita fallback silencioso para segredo diferente).
12. **Cookies seguros:** sessão com `httpOnly`, `secure` em produção, `sameSite: 'lax'`, nome `__Secure-` em produção. `forgot-password` não revela existência de e-mail (resposta constante) e tem rate limit dedicado.

---

## Recomendações priorizadas (plano de correção)

1. **(Crítica/Alta)** Atualizar dependências vulneráveis e adicionar `pnpm.overrides` para as transitivas (`axios`, `@xmldom/xmldom`, `multer`, `proxy-addr`, `brace-expansion`); colocar `pnpm audit --prod` como gate de CI.
2. **(Alta)** Registrar `ThrottlerModule` global por IP, especialmente para os relatórios/apurações fiscais.
3. **(Alta)** Converter os corpos do módulo `usuarios` (e revisar `auth`) para classes DTO com `@IsEnum`/`@IsIn` em `role` e `@MinLength` em senha; validar `role` também no service.
4. **(Alta/Média)** Tornar a sessão do colaborador revogável (persistência ou `tokenVersion`).
5. **(Média)** Tornar `CRON_SECRET` obrigatório em produção; adicionar `helmet`; proteger/desabilitar o Swagger em produção; criar `ColaboradorAuthGuard` de classe.
6. **(Média/Baixa)** Revisar exposição do token no corpo do login para sessões de navegador; condicionar `localhost` no CORS por ambiente; endurecer a construção de chaves R2.

---

### Notas de método e limitações

- Scan baseado em **leitura estática** do código em `/Users/pablo/dev/kontabb/api/src` e em `pnpm audit --prod`. Não houve execução dinâmica, fuzzing nem testes de penetração.
- Itens marcados como **needs verification** não puderam ser 100% confirmados apenas por leitura (p.ex. filtros SQL finais em alguns services, consumo do token no front `../web`, explorabilidade real das CVEs transitivas).
- Conteúdo das advisories de dependências foi resumido/parafraseado a partir da saída do `pnpm audit`; consultar os links GHSA citados para o texto integral.
