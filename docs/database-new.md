# Base nova (sem restore)

Para produção criada do zero. Use um banco **vazio** e confira a URL antes de
cada comando. Para restaurar um backup, use `docs/database-rebuild.md`.

```bash
cd api

# 1. Banco novo e vazio (nunca a URL do banco antigo)
export DATABASE_URL='postgres://USUARIO:SENHA@HOST/BANCO?sslmode=require'

# 2. Credenciais do ADMIN inicial (senha com ao menos 6 caracteres)
export ADMIN_SEED_EMAIL='admin@seudominio.com.br'
export ADMIN_SEED_PASSWORD='defina-uma-senha-forte'
export ADMIN_SEED_NAME='Administrador'   # opcional

# 3. Schema (aplica as migrations do journal, 0000 a 0012)
pnpm db:migrate
pnpm db:check

# 4. Dados iniciais: Simples Nacional, CFOPs,
#    tipos financeiros, regras ICMS-BA 2026 e ADMIN
pnpm db:seed:required

# 5. Limpe as credenciais do shell
unset ADMIN_SEED_PASSWORD ADMIN_SEED_EMAIL ADMIN_SEED_NAME
```

`pnpm db:seed:required` é idempotente. Reexecutá-lo regrava descrição/nome de
CFOPs e tipos financeiros; não o rode em produção depois de editar esses dados
pela aplicação. Não altera senha de ADMIN existente.

## Pendências fiscais depois do seed

- **E111 do CIAP:** nenhum código é semeado. Antes de gerar SPED com ajuste
  de CIAP, cadastre o código estadual oficial de cada UF em
  `fiscal_catalogos_versoes` (`tipo = 'E111_CIAP'`, com vigência). Sem ele, a
  geração do ajuste é bloqueada com inconsistência.
- **ICMS-BA 2026:** o catálogo entra como rascunho (`escopo_aprovado = false`,
  nenhum enquadramento confirmado, 7 em "CONFERIR"). Um responsável fiscal deve
  revisar e aprovar pela interface fiscal.

## Conferência

```bash
psql "$DATABASE_URL" -c "select count(*) from cfops" \
  -c "select count(*) from financeiro_tipos_lancamento" \
  -c "select tipo, count(*) from fiscal_catalogos_versoes group by 1" \
  -c "select email, role from \"user\""
```

Esperado: 253 CFOPs, 9 tipos financeiros, somente `DIFAL` 1 em `fiscal_catalogos_versoes`, e o ADMIN.
Depois faça login e altere a senha inicial.
