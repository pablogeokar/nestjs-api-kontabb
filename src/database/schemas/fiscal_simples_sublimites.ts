import {
  boolean,
  check,
  integer,
  numeric,
  pgTable,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const fiscalSimplesSublimites = pgTable(
  'fiscal_simples_sublimites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uf: varchar('uf', { length: 2 }).notNull(),
    anoVigencia: integer('ano_vigencia').notNull(),
    valorSublimite: numeric('valor_sublimite', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('3600000.00'),
    ativo: boolean('ativo').notNull().default(true),
  },
  (table) => [
    unique('uq_simples_sublimite_uf_ano').on(table.uf, table.anoVigencia),
    check('chk_simples_sublimite_uf', sql`${table.uf} ~ '^[A-Z]{2}$'`),
    check(
      'chk_simples_sublimite_valor',
      sql`${table.anoVigencia} >= 2018 AND ${table.valorSublimite} > 0`,
    ),
  ],
);
