import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { fiscalSimplesTabelas } from './fiscal_simples_tabelas';

export const fiscalSimplesAnexos = pgTable(
  'fiscal_simples_anexos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tabelaId: uuid('tabela_id')
      .notNull()
      .references(() => fiscalSimplesTabelas.id, { onDelete: 'cascade' }),
    anexo: varchar('anexo', { length: 20 }).notNull(),
    descricao: text('descricao').notNull(),
    tipoAtividade: varchar('tipo_atividade', { length: 30 }).notNull(),
    permiteFatorR: boolean('permite_fator_r').notNull().default(false),
    recolheCppNoDas: boolean('recolhe_cpp_no_das').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_simples_anexos_tabela_anexo').on(table.tabelaId, table.anexo),
    index('idx_simples_anexos_tabela').on(table.tabelaId),
    check(
      'chk_simples_anexos_anexo',
      sql`${table.anexo} IN ('ANEXO_I', 'ANEXO_II', 'ANEXO_III', 'ANEXO_IV', 'ANEXO_V')`,
    ),
    check(
      'chk_simples_anexos_atividade',
      sql`${table.tipoAtividade} IN ('COMERCIO', 'INDUSTRIA', 'SERVICOS', 'LOCACAO')`,
    ),
  ],
);
