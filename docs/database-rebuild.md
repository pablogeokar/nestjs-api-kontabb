# Recriação do banco e restore

Este é o procedimento operacional de recuperação. A página administrativa do
frontend ainda mostra apenas um aviso; ela não inicia restore PostgreSQL.
Use o Backup Drive ou o helper `backup-restore` em um banco de destino
separado e autorizado.

O histórico começa em `drizzle/0000_baseline_kontabb.sql`, que cria o schema
histórico de 57 tabelas em banco vazio. As migrations `0001`–`0004` vêm depois;
a `0004` retira três tabelas vazias e deixa o schema atual com 54. Não edite a
baseline nem a execute isoladamente sobre um banco existente.

O backup data-only contém somente dados. O schema, constraints e índices sempre
devem ser criados primeiro pelo Drizzle. Confirme quais tabelas o backup inclui:
o utilitário aceita `--exclude-table`, e o restore faz `TRUNCATE` nas tabelas
do schema de destino antes de importar. Uma tabela ausente no backup ficará
vazia após o restore.

O inverso exige cuidado: se um backup antigo contém `COPY` de uma tabela que
foi removida do schema novo, o restore padrão aborta e faz rollback.
O backup de 31/10/2026 contém 57 tabelas, inclusive três tabelas vazias;
um ensaio em clone com essas três removidas falhou em `fiscal_perfis_vigencia`
(`42P01`). O helper `backup-restore` v1.2 acrescenta a opção explícita
`-skip-missing-empty-tables`: no clone com 54 tabelas, restaurou as 54 tabelas
restantes e os 13.389 registros, validando 98 FKs. Se houver qualquer linha no
`COPY` de tabela ausente, aborta e reverte tudo. O Backup Drive também expõe
essa lista opcional, mas precisa embarcar o helper v1.2. A `0004` já está no
journal e foi ensaiada em clone; o banco local de testes está em `0004`.
Em 01/11/2026, o usuário informou que **ele próprio aplicou a `0004` no banco
implantado e validou o backup/restore**. O agente não verificou o estado
posterior desse banco nem executou escrita nele. A plataforma e a assinatura
do pacote usado não foram informadas.

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
3. Crie o schema. O comando aplica `0000`–`0004` no banco novo, inclusive os
   drops guardados da `0004`; confira antes que a URL aponta para o banco
   **novo e descartável**. `db:check` valida o journal local, não o banco.

```bash
cd api
DATABASE_URL="$KONTABB_NEW_DATABASE_URL" pnpm db:migrate
pnpm db:check
```

4. Para um backup **anterior à `0004`** que ainda contém blocos `COPY` das
   três tabelas retiradas, valide o restore de forma transacional, sem
   persistir alterações. A opção só ignora blocos comprovadamente vazios.
   Se o backup já foi feito com o schema de 54 tabelas, omita
   `-skip-missing-empty-tables` nos passos 4 e 5.

```bash
cd ../backup-restore
DATABASE_URL="$KONTABB_NEW_DATABASE_URL" go run . \
  -database-url-from-env -mode=restore -input=backup-kontabb.sql.gz \
  -skip-missing-empty-tables sped_contabilistas,fiscal_lancamentos,fiscal_perfis_vigencia \
  -dry-run
```

5. Se o dry-run reproduzir a contagem do backup usado e validar todas as FKs,
   execute o restore real no **mesmo banco novo**:

```bash
DATABASE_URL="$KONTABB_NEW_DATABASE_URL" go run . \
  -database-url-from-env -mode=restore -input=backup-kontabb.sql.gz \
  -skip-missing-empty-tables sped_contabilistas,fiscal_lancamentos,fiscal_perfis_vigencia
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
psql "$KONTABB_NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/preflight-schema-audit.sql
```

As 22 consultas de violações do **primeiro** script devem retornar zero linhas.
O segundo script é um inventário: confira que o tracker
`drizzle.__drizzle_migrations` corresponde a todas as entradas de
`drizzle/meta/_journal.json` (cinco, `0000`–`0004`, nesta revisão). Ele mostra
as três tabelas retiradas como ausentes, com contagem `NULL`, e as tabelas
existentes vazias com contagem zero. Seus quatro diagnósticos de pagamentos
devem retornar zero. Os dois scripts abrem transações `READ ONLY`.

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
