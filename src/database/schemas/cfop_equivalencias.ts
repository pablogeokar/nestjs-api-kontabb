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
import { cfops } from './cfops';
import { clientes } from './clientes';

export const cfopEquivalencias = pgTable(
  'cfop_equivalencias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id').references(() => clientes.id, {
      onDelete: 'cascade',
    }),
    cfopOrigem: varchar('cfop_origem', { length: 4 })
      .notNull()
      .references(() => cfops.codigo, { onDelete: 'cascade' }),
    cfopDestino: varchar('cfop_destino', { length: 4 })
      .notNull()
      .references(() => cfops.codigo, { onDelete: 'cascade' }),
    tipoOperacao: varchar('tipo_operacao', { length: 20 })
      .notNull()
      .default('SAIDA_PARA_ENTRADA'),
    descricao: text('descricao'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    unique('uidx_cfop_eq_cliente_origem')
      .on(table.clienteId, table.cfopOrigem)
      .nullsNotDistinct(),
    index('idx_cfop_eq_origem').on(table.cfopOrigem),
    index('idx_cfop_eq_cliente').on(table.clienteId),
    check(
      'chk_cfop_eq_tipo',
      sql`${table.tipoOperacao} IN ('SAIDA_PARA_ENTRADA', 'ENTRADA_PARA_SAIDA')`,
    ),
    check(
      'chk_cfop_eq_destino_diferente',
      sql`${table.cfopOrigem} <> ${table.cfopDestino}`,
    ),
  ],
);
