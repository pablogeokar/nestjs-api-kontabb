# Kontabb API

Backend NestJS responsável pelos dados, regras de negócio e autenticação do
Kontabb. O frontend Next.js é uma aplicação puramente de apresentação que
delega toda autenticação e operações de dados para esta API.

## Setup

```bash
pnpm install
cp .env.example .env  # Preencha as credenciais exclusivas da API
```

## Desenvolvimento

```bash
pnpm start:dev
```

A API roda em `http://localhost:3001/api` por padrão.

## Documentação (Swagger)

Com a API em execução, acesse:

```
http://localhost:3001/api/docs
```

A documentação interativa lista todos os endpoints, parâmetros e schemas.

## Build

```bash
pnpm build
pnpm start:prod
```

## Endpoints

### Autenticação

| Método | Rota                        | Descrição                                       |
| ------ | --------------------------- | ----------------------------------------------- |
| POST   | `/api/auth/login`           | Login (email + senha) — retorna sessão e cookie |
| POST   | `/api/auth/logout`          | Logout — invalida sessão e limpa cookie         |
| GET    | `/api/auth/session`         | Obter sessão atual (validação de cookie)        |
| POST   | `/api/auth/change-password` | Alterar senha (autenticado)                     |

### Público

| Método | Rota                        | Descrição                            |
| ------ | --------------------------- | ------------------------------------ |
| GET    | `/api/health`               | Health check (DB)                    |
| GET    | `/api/cron/storage-cleanup` | Cron job (requer Bearer CRON_SECRET) |

### Admin — Painel (Staff)

| Método | Rota                   | Descrição                       |
| ------ | ---------------------- | ------------------------------- |
| GET    | `/api/admin/dashboard` | Resumo do painel administrativo |

### Admin — Clientes (Staff)

| Método | Rota                                      | Descrição                                                                  |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------- |
| GET    | `/api/admin/clientes`                     | Listar clientes (paginado, busca)                                          |
| GET    | `/api/admin/clientes/consulta-cnpj/:cnpj` | Consultar razão social, endereço e CNAEs (OpenCNPJ com fallback ReceitaWS) |
| GET    | `/api/admin/clientes/:id`                 | Obter dados de um cliente                                                  |
| POST   | `/api/admin/clientes`                     | Criar cliente                                                              |
| POST   | `/api/admin/clientes/batch`               | Criar clientes em lote                                                     |
| PATCH  | `/api/admin/clientes/:id`                 | Atualizar cliente                                                          |
| DELETE | `/api/admin/clientes/:id`                 | Excluir cliente                                                            |
| GET    | `/api/admin/clientes/:id/guias`           | Guias do cliente                                                           |

### Admin — Contadores (Staff)

| Método | Rota                                  | Descrição                                  |
| ------ | ------------------------------------- | ------------------------------------------ |
| GET    | `/api/admin/cadastros/contadores`     | Listar catálogo global (paginado, busca)   |
| GET    | `/api/admin/cadastros/contadores/:id` | Obter contador e quantidade de vínculos    |
| POST   | `/api/admin/cadastros/contadores`     | Cadastrar contador                         |
| PATCH  | `/api/admin/cadastros/contadores/:id` | Atualizar contador                         |
| DELETE | `/api/admin/cadastros/contadores/:id` | Excluir somente quando não houver vínculos |

### Admin — Guias (Staff)

| Método | Rota                                 | Descrição                        |
| ------ | ------------------------------------ | -------------------------------- |
| GET    | `/api/admin/guias`                   | Listar guias (paginado, filtros) |
| DELETE | `/api/admin/guias/:id`               | Excluir guia                     |
| POST   | `/api/admin/guias/:id/notificar`     | Enviar notificação por e-mail    |
| GET    | `/api/admin/guias/:id/visualizacoes` | Histórico de visualizações       |

### Admin — Upload (Staff)

| Método | Rota                         | Descrição                      |
| ------ | ---------------------------- | ------------------------------ |
| POST   | `/api/admin/upload`          | Upload de guias PDF (FormData) |
| POST   | `/api/admin/upload/validate` | Pré-validação de PDFs          |

### Admin — Usuários (Admin)

| Método | Rota                               | Descrição                  |
| ------ | ---------------------------------- | -------------------------- |
| GET    | `/api/admin/usuarios`              | Listar usuários do sistema |
| POST   | `/api/admin/usuarios`              | Criar usuário              |
| PATCH  | `/api/admin/usuarios/:id`          | Atualizar usuário          |
| DELETE | `/api/admin/usuarios/:id`          | Excluir usuário            |
| PATCH  | `/api/admin/usuarios/:id/password` | Alterar senha              |

### Admin — Storage (Admin)

| Método | Rota                           | Descrição                   |
| ------ | ------------------------------ | --------------------------- |
| POST   | `/api/admin/storage/cleanup`   | Executar limpeza de storage |
| POST   | `/api/admin/storage/reconcile` | Processar fila de limpeza (rota legada; não faz reconciliação R2 × banco) |

### Cliente

| Método | Rota                       | Descrição                 |
| ------ | -------------------------- | ------------------------- |
| GET    | `/api/cliente/guias`       | Listar guias próprias     |
| PATCH  | `/api/cliente/first-login` | Completar primeiro acesso |

### Guias (Autenticado)

| Método | Rota                         | Descrição                         |
| ------ | ---------------------------- | --------------------------------- |
| GET    | `/api/guias/:id`             | Obter URL assinada do arquivo     |
| GET    | `/api/guias/:id/comprovante` | Obter URL assinada do comprovante |
| PATCH  | `/api/guias/:id/pagar`       | Confirmar pagamento               |

### Fiscal — Módulo tributário

Escrituração de DF-e, motor de regras de CFOP, apuração multitributária e
geração da EFD ICMS/IPI (SPED Fiscal). Endpoints de cliente em `/api/fiscal/*`
(empresa resolvida pela sessão) e de staff em `/api/admin/fiscal/*`.

| Área | Rotas principais | Documentação |
| --- | --- | --- |
| Documentos e escrituração | `/api/fiscal/documentos*`, `/api/admin/fiscal/reprocessar-escrituracao` | [Importação de XML](docs/fiscal-xml-import.md), [sync SEFAZ](docs/fiscal-sync.md), [escrituração inteligente](docs/fiscal-escrituracao-inteligente.md) |
| CT-e | `/api/fiscal/relatorios/d100`, `d190` | [Escrituração de CT-e](docs/fiscal-cte-escrituracao.md) |
| Motor de regras e CFOP | `/api/fiscal/cfops*`, `/api/fiscal/regras*` | [Regras e catálogo](docs/fiscal-motor-de-regras-cfop.md) |
| Apuração (CIAP/DIFAL/PIS-COFINS/guias) | `/api/fiscal/apuracao/*` | [Apuração multitributária](docs/fiscal-apuracao-multitributaria.md) |
| Simples Nacional | `/api/fiscal/simples/*` | [Revisão da receita e precisão](docs/simples-revisao-receita-2026.md) |
| Entrega e conciliação | `/api/fiscal/apuracao/entregas`, `/api/admin/fiscal/apuracao/entregas` | [Operação fiscal](docs/fiscal-entrega-conciliacao-operacao.md) |
| SPED EFD ICMS/IPI | `/api/fiscal/sped/efd-icms-ipi/*` | [Guia da EFD](docs/fiscal-sped-efd-icms-ipi.md) |
| DeSTDA (Simples Nacional) | `/api/fiscal/destda/*` | [Guia da DeSTDA](docs/fiscal-destda.md) |

Documentação operacional: [recriação do banco](docs/database-rebuild.md),
[datas e fusos](docs/database-timezones.md), [ciclo de vida do R2](docs/storage-lifecycle.md),
[relatório de saneamento](docs/relatorio-saneamento.md) e
[inventário de rotas](docs/rotas-consumidas.md).

## Autenticação

A API é responsável por todo o fluxo de autenticação:

- **Login:** `POST /api/auth/login` autentica com email + senha, cria sessão no
  banco e retorna cookie assinado HMAC-SHA256.
- **Browser:** cookie `better-auth.session_token` ou
  `__Secure-better-auth.session_token` (produção). O token é verificado via HMAC
  com `BETTER_AUTH_SECRET` e em seguida consultado no banco.
- **Integrações controladas:** `Authorization: Bearer <session_token_bruto>`.
- **Logout:** `POST /api/auth/logout` invalida a sessão e limpa os cookies.
- **Sessão:** `GET /api/auth/session` retorna dados do usuário autenticado.

Cookie ausente/inválido retorna `401`. Sessão válida sem papel ou acesso ao
recurso retorna `403`.

Senhas são hasheadas com scrypt (N=16384, r=16, p=1, dkLen=64) no formato
`salt:derivedKey`, compatível com o formato original do better-auth.

Erros públicos usam o contrato
`{ "code": string, "message": string, "requestId": string }`; detalhes internos
de PostgreSQL, R2 e Mailtrap não são retornados.

## Banco de Dados

A API é a fonte absoluta de verdade para persistência. O frontend `../web` não
possui driver, ORM, schema, migrations, seeds ou credenciais de banco.

- tabelas: `src/database/schemas/<nome_sql>.ts` (um arquivo por tabela);
- importações da API: `src/database/schema.ts` (reexporta todas as tabelas);
- migrations versionadas: `drizzle/`;
- configuração de migration: `drizzle.config.ts`;
- preflight e backfill operacionais: `scripts/`.

Ao criar uma tabela, adicione seu arquivo em `src/database/schemas/` e seu
`export *` em `src/database/schema.ts`. O `drizzle-kit` lê todos os arquivos da
pasta pelo padrão `schemas/*.ts`; depois de alterar uma definição, execute
`pnpm db:generate` e revise o SQL e o snapshot gerados antes de aplicar a
migration. Esse comando valida os arquivos e exports, gera a migration e
verifica o histórico com `drizzle-kit check`.

Novos ambientes começam pela baseline `drizzle/0000_mute_dark_beast.sql`,
registrada em `drizzle/meta/_journal.json`, seguida de
`0001_clientes_perfis_fiscais_trigger.sql` (função e trigger do histórico de
perfis fiscais). A baseline cria diretamente as 66 tabelas
atuais e só pode ser aplicada a um banco vazio. O procedimento de recriação,
restore e validação está em `docs/database-rebuild.md`. Backups históricos com
as três tabelas removidas precisam do helper `backup-restore` v1.2 e da opção
explícita documentada no procedimento.

Para desenvolvimento local, suba o PostgreSQL e aplique as migrations:

```bash
docker compose up -d
pnpm db:migrate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/preflight-migrations.sql
pnpm db:check
```

### Demonstrativo de faturamento verificável

A migration `drizzle/0007_cynical_kang.sql` cria
`contadores_certificados` e `relatorios_faturamento`. Aplique-a antes de
publicar a API e o frontend. O contador precisa ter CPF cadastrado para receber
um certificado e-CPF A1 (.pfx/.p12). Somente `ADMIN` pode consultar o status e
enviar/substituir ou remover o arquivo em
`GET/POST/DELETE /admin/cadastros/contadores/:id/certificado`. O arquivo é criptografado
com `CERTIFICATE_ENCRYPTION_KEY` antes de ir ao R2 privado; a senha também fica
criptografada. Mantenha essa chave configurada e estável em todos os ambientes
que precisem assinar documentos. Certificados A3 em token não são suportados por
upload.

O cliente emite pelo `POST /cliente/fiscal/faturamento` com
`{"inicio":"AAAA-MM","fim":"AAAA-MM"}`. O `GET` da mesma rota lista as últimas
30 emissões; `GET /cliente/fiscal/faturamento/:codigo/pdf` entrega a cópia ao
cliente autenticado. A emissão consulta NF-e/NFC-e autorizadas de saída, apenas
itens com CFOP de receita, e NFS-e autorizadas emitidas pela empresa. A NFS-e
usa a competência declarada quando disponível; demais documentos usam a data
fiscal de emissão. Não depende do fechamento da competência. Cada emissão salva
os valores por mês, um número sequencial, um código aleatório e o hash SHA-256
do PDF original. Períodos sem notas importadas aparecem com zero; o relatório
explica que retrata apenas os documentos disponíveis no instante da emissão.

Se o contador vinculado tem A1 válido, a API assina o PDF com assinatura
criptográfica destacada `ETSI.CAdES.detached`. Sem certificado, o PDF é emitido
com indicação explícita de ausência de assinatura. Se o certificado configurado
falhar durante a assinatura, a emissão falha sem publicar um PDF incorretamente
marcado como assinado. A validade da cadeia ICP-Brasil e eventual revogação devem
ser conferidas em um validador de assinaturas; o código da KONTABB confere a
existência e a cópia arquivada, não substitui essa validação.

A landing page usa `POST /public/faturamento/verificar` e
`POST /public/faturamento/documento`, ambos com `{"codigo":"KTB-..."}`. Os
endpoints públicos não exigem sessão, têm limite de tentativas, respondem com
`Cache-Control: no-store` e não colocam o código na URL. Publique a API antes do
frontend para evitar que a página de verificação aponte para rotas ausentes.

### Preferências de novos contratos

Usuários da equipe podem consultar e salvar seus próprios padrões em
`GET /admin/financeiro/contratos/preferencias` e
`PUT /admin/financeiro/contratos/preferencias`. O `PUT` recebe cidade/UF da
assinatura, dias de vencimento e fechamento, aviso prévio e configuração da
cobrança do 13º. Os valores ficam em `financeiro_contrato_preferencias`, criada
pela migration `0005_heavy_donald_blake.sql`. Aplique essa migration na API
antes de publicar o formulário que consulta o endpoint. Contratos já salvos
mantêm seus valores próprios.

### Regime de apuração do Simples Nacional

`clientes.regime_competencia` está incluída na nova baseline, com default
`true` para novos cadastros.

Nas apurações até dezembro de 2026, `false` usa a data de emissão da NFS-e como
referência operacional da base mensal, conforme a configuração adotada neste
sistema; `true` usa a competência declarada. RBT12 e fator R continuam usando
receitas por competência em ambos os casos. A partir de janeiro de 2027, o
motor usa competência para a base mensal mesmo quando a flag histórica é
`false`. A data de emissão não comprova recebimento efetivo; conferir essa
limitação antes de transmitir valores ao PGDAS-D.

Para iniciar uma instalação sem restore de dados, defina
`ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` (mínimo de 6 caracteres) e,
opcionalmente, `ADMIN_SEED_NAME` no ambiente. Então execute:

```bash
pnpm db:seed:admin
```

O comando é idempotente: não substitui a senha nem altera o papel de um usuário
já existente. Em uma restauração do backup atual, não o execute, pois o backup
já contém os administradores.

## Variáveis de Ambiente

| Variável             | Descrição                                         |
| -------------------- | ------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string                      |
| `BETTER_AUTH_SECRET` | Segredo para assinatura HMAC de cookies de sessão |
| `APP_URL`            | URL do frontend (para e-mails)                    |
| `R2_*`               | Credenciais do Cloudflare R2                      |
| `CRON_SECRET`        | Secret para endpoints cron                        |
| `MAILTRAP_*`         | Configurações do Mailtrap                         |

`JWT_SECRET` é aceito apenas como fallback temporário para ambientes antigos.
Configure `BETTER_AUTH_SECRET`; se as duas variáveis existirem, elas precisam
ter o mesmo valor.

## Validação

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm db:check
pnpm build
```

Os testes unitários cobrem assinatura do cookie, nomes normal/seguro, Bearer,
sessões inválidas, matriz de papéis e autorização do comprovante de guia.
