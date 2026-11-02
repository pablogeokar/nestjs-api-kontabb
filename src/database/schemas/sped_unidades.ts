import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';

export const spedUnidades = pgTable(
  'sped_unidades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    codigo: varchar('codigo', { length: 6 }).notNull(),
    descricao: text('descricao').notNull(),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_sped_unidade_codigo').on(table.clienteId, table.codigo),
    index('idx_sped_unidade_cliente').on(table.clienteId),
    check('chk_sped_unidade_codigo', sql`btrim(${table.codigo}) <> ''`),
  ],
);
