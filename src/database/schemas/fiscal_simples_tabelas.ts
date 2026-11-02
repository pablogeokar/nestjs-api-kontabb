import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Simples Nacional — tabelas normativas e memória mensal do DAS.
// ─────────────────────────────────────────────────────────────────────────────

export const fiscalSimplesTabelas = pgTable(
  'fiscal_simples_tabelas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versao: varchar('versao', { length: 30 }).notNull(),
    descricao: text('descricao').notNull(),
    vigenciaInicio: date('vigencia_inicio').notNull(),
    vigenciaFim: date('vigencia_fim'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_simples_tabelas_versao').on(table.versao),
    index('idx_simples_tabelas_vigencia').on(
      table.vigenciaInicio,
      table.vigenciaFim,
    ),
    check(
      'chk_simples_tabelas_vigencia',
      sql`${table.vigenciaFim} IS NULL OR ${table.vigenciaFim} >= ${table.vigenciaInicio}`,
    ),
  ],
);
