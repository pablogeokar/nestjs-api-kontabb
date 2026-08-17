# Recriação do banco e restore

O histórico foi consolidado em uma única migration
`drizzle/0000_baseline_kontabb.sql`, gerada de `src/database/schema.ts`. Ela é
uma baseline para banco vazio e não deve ser executada sobre o banco antigo.

O arquivo `../backup-restore/backup-kontabb.sql` contém somente dados. O schema,
constraints e índices sempre devem ser criados primeiro pelo Drizzle.

## Pré-requisitos

- PostgreSQL 15 ou superior; localmente a validação usa PostgreSQL 17.
- Backup guardado fora do diretório de deploy e com acesso restrito.
- Bucket R2 e seus objetos preservados. O backup contém `arquivo_key`, não o
  conteúdo dos PDFs e comprovantes.
- Novo banco/branch Neon vazio, com URL diferente do banco antigo.

## Procedimento

1. Crie o novo banco no Neon, sem apagar o banco anterior.
2. Aponte temporariamente `api/.env` para o banco novo.
3. Crie o schema:

```bash
cd api
pnpm db:migrate
pnpm db:check
```

4. Valide o restore de forma transacional, sem persistir alterações:

```bash
cd ../backup-restore
go run . -mode=restore -input=backup-kontabb.sql -env=../api/.env --dry-run
```

5. Se o dry-run restaurar 14 tabelas/604 registros e validar todas as FKs,
   execute o restore real:

```bash
go run . -mode=restore -input=backup-kontabb.sql -env=../api/.env
go run . -validate -env=../api/.env
```

6. Execute os diagnósticos de domínio:

```bash
cd ../api
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/preflight-migrations.sql
```

Todas as consultas devem retornar zero linhas. Confirme também que
`drizzle.__drizzle_migrations` contém exatamente uma migration.

7. Faça smoke tests de login, listagem/download de guias, pagamento,
   upload e recibos de folha. Somente depois atualize a `DATABASE_URL` do deploy.

## Rollback

Até a homologação terminar, mantenha o banco antigo intacto. Para rollback,
restaure a `DATABASE_URL` anterior e publique novamente a API. Não exclua o
banco antigo nem os objetos do R2 antes de confirmar os fluxos e a contagem dos
dados no banco novo.
