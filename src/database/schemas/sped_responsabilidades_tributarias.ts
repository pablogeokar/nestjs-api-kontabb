import {
  boolean,
  check,
  date,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';

export const spedResponsabilidadesTributarias = pgTable(
  'sped_responsabilidades_tributarias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    tipo: varchar('tipo', { length: 20 }).notNull(),
    uf: varchar('uf', { length: 2 }).notNull(),
    vigenciaInicio: date('vigencia_inicio').notNull(),
    vigenciaFim: date('vigencia_fim'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_sped_responsabilidade_vigencia').on(
      table.clienteId,
      table.tipo,
      table.uf,
      table.vigenciaInicio,
    ),
    index('idx_sped_responsabilidade_cliente').on(table.clienteId),
    check(
      'chk_sped_responsabilidade_tipo',
      sql`${table.tipo} IN ('ICMS_ST', 'DIFAL_FCP')`,
    ),
    check('chk_sped_responsabilidade_uf', sql`${table.uf} ~ '^[A-Z]{2}$'`),
    check(
      'chk_sped_responsabilidade_vigencia',
      sql`${table.vigenciaFim} IS NULL OR ${table.vigenciaFim} >= ${table.vigenciaInicio}`,
    ),
  ],
);
