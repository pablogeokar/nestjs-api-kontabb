# Kontabb API

Backend NestJS que replica a API do projeto Next.js (web), preparado para separação futura de frontend e backend.

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

## Build

```bash
pnpm build
pnpm start:prod
```

## Endpoints

### Público
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Health check (DB) |
| GET | `/api/cron/storage-cleanup` | Cron job (requer Bearer CRON_SECRET) |

### Admin — Clientes (Staff)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/admin/clientes` | Listar clientes (paginado, busca) |
| POST | `/api/admin/clientes` | Criar cliente |
| POST | `/api/admin/clientes/batch` | Criar clientes em lote |
| PATCH | `/api/admin/clientes/:id` | Atualizar cliente |
| DELETE | `/api/admin/clientes/:id` | Excluir cliente |
| GET | `/api/admin/clientes/:id/documentos` | Documentos do cliente |

### Admin — Documentos (Staff)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/admin/documentos` | Listar documentos (paginado, filtros) |
| DELETE | `/api/admin/documentos/:id` | Excluir documento |
| POST | `/api/admin/documentos/:id/notificar` | Enviar notificação por e-mail |
| GET | `/api/admin/documentos/:id/visualizacoes` | Histórico de visualizações |

### Admin — Upload (Staff)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/admin/upload` | Upload de PDFs (FormData) |
| POST | `/api/admin/upload/validate` | Pré-validação de PDFs |

### Admin — Usuários (Admin)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/admin/usuarios` | Listar usuários do sistema |
| POST | `/api/admin/usuarios` | Criar usuário |
| PATCH | `/api/admin/usuarios/:id` | Atualizar usuário |
| DELETE | `/api/admin/usuarios/:id` | Excluir usuário |
| PATCH | `/api/admin/usuarios/:id/password` | Alterar senha |

### Admin — Storage (Admin)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/admin/storage/cleanup` | Executar limpeza de storage |
| POST | `/api/admin/storage/reconcile` | Reconciliar storage |

### Cliente
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/cliente/documentos` | Listar documentos próprios |
| PATCH | `/api/cliente/first-login` | Completar primeiro acesso |

### Documentos (Autenticado)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/documentos/:id` | Obter URL assinada do arquivo |
| PATCH | `/api/documentos/:id/pagar` | Confirmar pagamento |

## Autenticação

A API valida sessões do better-auth. Aceita:
- **Cookie**: `better-auth.session_token` ou `__Secure-better-auth.session_token`
- **Header**: `Authorization: Bearer <session_token>`

## Banco de Dados

Compartilha o mesmo banco PostgreSQL do projeto web (Drizzle ORM). Todas as tabelas são as mesmas — não requer migração adicional.

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret para sessões (use o BETTER_AUTH_SECRET do web) |
| `APP_URL` | URL do frontend (para e-mails) |
| `R2_*` | Credenciais do Cloudflare R2 |
| `CRON_SECRET` | Secret para endpoints cron |
| `MAILTRAP_*` | Configurações do Mailtrap |
