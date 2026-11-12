import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const financeiroTiposLancamento = pgTable(
  'financeiro_tipos_lancamento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: varchar('codigo', { length: 50 }).notNull(),
    nome: varchar('nome', { length: 150 }).notNull(),
    descricao: text('descricao'),
    natureza: varchar('natureza', { length: 10 }).notNull().default('DEBITO'),
    valorPadrao: numeric('valor_padrao', { precision: 12, scale: 2 }),
    permiteAvulso: boolean('permite_avulso').notNull().default(true),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_fin_tipos_codigo').on(table.codigo),
    index('idx_fin_tipos_ativo').on(table.ativo),
    check(
      'chk_fin_tipos_natureza',
      sql`${table.natureza} IN ('DEBITO', 'CREDITO')`,
    ),
    check(
      'chk_fin_tipos_valor_padrao',
      sql`${table.valorPadrao} IS NULL OR ${table.valorPadrao} >= 0`,
    ),
  ],
);
