import {
  check,
  date,
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
import { clientes } from './clientes';
import { user } from './user';

export const spedInventarios = pgTable(
  'sped_inventarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    dataInventario: date('data_inventario').notNull(),
    motivo: varchar('motivo', { length: 2 }).notNull(),
    valorTotal: numeric('valor_total', { precision: 15, scale: 2 }).notNull(),
    status: varchar('status', { length: 12 }).notNull().default('RASCUNHO'),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_sped_inventario_cliente_data_motivo').on(
      table.clienteId,
      table.dataInventario,
      table.motivo,
    ),
    index('idx_sped_inventario_cliente_data').on(
      table.clienteId,
      table.dataInventario,
    ),
    check(
      'chk_sped_inventario_motivo',
      sql`${table.motivo} IN ('01', '02', '03', '04', '05', '06')`,
    ),
    check(
      'chk_sped_inventario_status',
      sql`${table.status} IN ('RASCUNHO', 'FECHADO')`,
    ),
    check('chk_sped_inventario_valor', sql`${table.valorTotal} >= 0`),
  ],
);
