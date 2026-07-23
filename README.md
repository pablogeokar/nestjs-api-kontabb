# Kontabb API

Backend NestJS responsável pelos dados, regras de negócio e autenticação do
Kontabb. O frontend Next.js é uma aplicação puramente de apresentação que
delega toda autenticação e operações de dados para esta API.

## Setup

```bash
pnpm install
cp .env.example .env  # Preencha com as mesmas variáveis do projeto web
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

| Método | Rota                                 | Descrição                         |
| ------ | ------------------------------------ | --------------------------------- |
| GET    | `/api/admin/clientes`                | Listar clientes (paginado, busca) |
| GET    | `/api/admin/clientes/:id`            | Obter dados de um cliente         |
| POST   | `/api/admin/clientes`                | Criar cliente                     |
| POST   | `/api/admin/clientes/batch`          | Criar clientes em lote            |
| PATCH  | `/api/admin/clientes/:id`            | Atualizar cliente                 |
| DELETE | `/api/admin/clientes/:id`            | Excluir cliente                   |
| GET    | `/api/admin/clientes/:id/documentos` | Documentos do cliente             |

### Admin — Documentos (Staff)

| Método | Rota                                      | Descrição                             |
| ------ | ----------------------------------------- | ------------------------------------- |
| GET    | `/api/admin/documentos`                   | Listar documentos (paginado, filtros) |
| DELETE | `/api/admin/documentos/:id`               | Excluir documento                     |
| POST   | `/api/admin/documentos/:id/notificar`     | Enviar notificação por e-mail         |
| GET    | `/api/admin/documentos/:id/visualizacoes` | Histórico de visualizações            |

### Admin — Upload (Staff)

| Método | Rota                         | Descrição                 |
| ------ | ---------------------------- | ------------------------- |
| POST   | `/api/admin/upload`          | Upload de PDFs (FormData) |
| POST   | `/api/admin/upload/validate` | Pré-validação de PDFs     |

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
| POST   | `/api/admin/storage/reconcile` | Reconciliar storage         |

### Cliente

| Método | Rota                       | Descrição                  |
| ------ | -------------------------- | -------------------------- |
| GET    | `/api/cliente/documentos`  | Listar documentos próprios |
| PATCH  | `/api/cliente/first-login` | Completar primeiro acesso  |

### Documentos (Autenticado)

| Método | Rota                              | Descrição                         |
| ------ | --------------------------------- | --------------------------------- |
| GET    | `/api/documentos/:id`             | Obter URL assinada do arquivo     |
| GET    | `/api/documentos/:id/comprovante` | Obter URL assinada do comprovante |
| PATCH  | `/api/documentos/:id/pagar`       | Confirmar pagamento               |

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

Compartilha o mesmo banco PostgreSQL do projeto web (Drizzle ORM). Todas as tabelas são as mesmas — não requer migração adicional.

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
pnpm build
```

Os testes unitários cobrem assinatura do cookie, nomes normal/seguro, Bearer,
sessões inválidas, matriz de papéis e autorização do comprovante.
