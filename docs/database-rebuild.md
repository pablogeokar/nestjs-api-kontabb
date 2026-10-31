# Recriação do banco e restore

O histórico foi consolidado em uma única migration
`drizzle/0000_baseline_kontabb.sql`, gerada de `src/database/schema.ts`. Ela é
uma baseline para banco vazio e não deve ser executada sobre o banco antigo.

O backup data-only contém somente dados. O schema, constraints e índices sempre
devem ser criados primeiro pelo Drizzle. Confirme quais tabelas o backup inclui:
o utilitário aceita `--exclude-table`, e o restore faz `TRUNCATE` nas tabelas
do schema de destino antes de importar. Uma tabela ausente no backup ficará
vazia após o restore.

O inverso exige cuidado: se um backup antigo contém `COPY` de uma tabela que
foi removida do schema novo, o restore padrão aborta e faz rollback.
O backup de 31/10/2026 contém 57 tabelas, inclusive três candidatas vazias;
um ensaio em clone com essas três removidas falhou em `fiscal_perfis_vigencia`
(`42P01`). O helper `backup-restore` v1.2 acrescenta a opção explícita
`-skip-missing-empty-tables`: no clone com 54 tabelas, restaurou as 54 tabelas
restantes e os 13.389 registros, validando 98 FKs. Se houver qualquer linha no
`COPY` de tabela ausente, aborta e reverte tudo. O Backup Drive também expõe
essa lista opcional, mas precisa embarcar o helper v1.2. As três tabelas
**continuam no schema atual**; nenhuma migration `0004` foi gerada ou aplicada.
Antes de retirá-las, distribua o helper atualizado e repita o ensaio com os
backups antigos, sem executar DDL no banco implantado.

## Pré-requisitos

- PostgreSQL 15 ou superior; localmente a validação usa PostgreSQL 17.
- Backup guardado fora do diretório de deploy e com acesso restrito.
- Bucket R2 e seus objetos preservados. O backup contém `arquivo_key`, não o
  conteúdo dos PDFs e comprovantes.
- Novo banco/branch Neon vazio, com URL diferente do banco antigo.

## Procedimento

1. Crie o novo banco no Neon, sem apagar o banco anterior. Configure a variável
   `KONTABB_NEW_DATABASE_URL` com a URL **desse banco novo**, fora do `.env` da
   API em execução. Confirme host e nome do banco antes dos comandos seguintes.
2. Mantenha a URL do banco antigo intacta para rollback.
3. Crie o schema:

```bash
cd api
DATABASE_URL="$KONTABB_NEW_DATABASE_URL" pnpm db:migrate
pnpm db:check
```

4. Valide o restore de forma transacional, sem persistir alterações:

```bash
cd ../backup-restore
DATABASE_URL="$KONTABB_NEW_DATABASE_URL" go run . -mode=restore -input=backup-kontabb.sql -database-url-from-env --dry-run
```

5. Se o dry-run reproduzir a contagem do backup usado e validar todas as FKs,
   execute o restore real no **mesmo banco novo**:

```bash
DATABASE_URL="$KONTABB_NEW_DATABASE_URL" go run . -mode=restore -input=backup-kontabb.sql -database-url-from-env
DATABASE_URL="$KONTABB_NEW_DATABASE_URL" go run . -validate -database-url-from-env
```

6. Como o restore limpa as tabelas antes de inserir os dados, execute agora os
   catálogos que não fazem parte do backup:

```bash
cd ../api
DATABASE_URL="$KONTABB_NEW_DATABASE_URL" pnpm db:seed:required
```

Confira o conteúdo do backup escolhido. Se ele já incluir usuários ADMIN e
CFOPs, não execute `db:seed:admin` nem `db:seed:cfops` como parte do restore.

7. Execute os diagnósticos de domínio:

```bash
cd ../api
psql "$KONTABB_NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/preflight-migrations.sql
```

Todas as consultas devem retornar zero linhas. Confirme também que o tracker
`drizzle.__drizzle_migrations` corresponde a todas as entradas de
`drizzle/meta/_journal.json` (quatro, `0000`–`0003`, nesta revisão).

8. Faça smoke tests de login, listagem/download de guias, pagamento,
   upload e recibos de folha. Somente depois atualize a `DATABASE_URL` do deploy.

## Rollback

Até a homologação terminar, mantenha o banco antigo intacto. Para rollback,
restaure a `DATABASE_URL` anterior e publique novamente a API. Não exclua o
banco antigo nem os objetos do R2 antes de confirmar os fluxos e a contagem dos
dados no banco novo.

## Descompasso do tracker de migrações

Em bancos que sofreram falhas parciais de `drizzle-kit migrate`, o tracker
`drizzle.__drizzle_migrations` pode registrar uma migration como aplicada sem
que o DDL correspondente tenha executado. O sintoma é a API retornando
`relation "X" does not exist` ou `column "Y" does not exist` para objetos que já
constam no `schema.ts` e nas migrations.

Diagnóstico rápido: comparar `information_schema.tables`/`columns` com o schema
e conferir a contagem em `drizzle.__drizzle_migrations`. Um `db:migrate` novo
não corrige, pois o tracker considera tudo aplicado.

Correção sem recriar o banco: aplicar o DDL faltante de forma **idempotente e
aditiva** numa transação, espelhando exatamente as migrations afetadas
(`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT
EXISTS`, `ADD CONSTRAINT` guardado por `pg_constraint`). Rodar os backfills com
`ON CONFLICT DO NOTHING`. Depois, validar que as queries de leitura afetadas
voltam a funcionar.

Correção definitiva: recriar o banco vazio e rodar `db:migrate` do zero, para
que tracker e schema nasçam alinhados (procedimento acima). Enquanto o tracker
permanecer furado, toda migration nova exigirá o reparo idempotente manual.
