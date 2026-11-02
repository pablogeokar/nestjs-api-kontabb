import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { user } from './user';

export const spedSaldosApuracao = pgTable(
  'sped_saldos_apuracao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    competencia: date('competencia').notNull(),
    tipo: varchar('tipo', { length: 20 }).notNull(),
    uf: varchar('uf', { length: 2 }),
    saldoCredorAnterior: numeric('saldo_credor_anterior', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('0'),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_sped_saldo_competencia')
      .on(table.clienteId, table.competencia, table.tipo, table.uf)
      .nullsNotDistinct(),
    index('idx_sped_saldo_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    check(
      'chk_sped_saldo_tipo',
      sql`${table.tipo} IN ('ICMS_PROPRIO', 'ICMS_ST', 'IPI')`,
    ),
    check(
      'chk_sped_saldo_uf',
      sql`${table.uf} IS NULL OR ${table.uf} ~ '^[A-Z]{2}$'`,
    ),
    check('chk_sped_saldo_valor', sql`${table.saldoCredorAnterior} >= 0`),
  ],
);
