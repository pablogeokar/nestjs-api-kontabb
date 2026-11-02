import {
  check,
  index,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { documentosFiscaisItens } from './documentos_fiscais_itens';

// Uma confirmação por item: retries não aumentam artificialmente a confiança.

export const classificacaoDestinacaoAprendizado = pgTable(
  'classificacao_destinacao_aprendizado',
  {
    itemId: uuid('item_id').primaryKey(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    fornecedor: text('fornecedor').notNull(),
    codigoProduto: text('codigo_produto').notNull(),
    ncm: varchar('ncm', { length: 8 }).notNull(),
    destinacao: varchar('destinacao', { length: 20 }).notNull(),
    ultimaConfirmacaoEm: timestamp('ultima_confirmacao_em', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_classif_destinacao_item',
      columns: [table.itemId],
      foreignColumns: [documentosFiscaisItens.id],
    }).onDelete('cascade'),
    index('idx_aprendizado_contexto').on(
      table.clienteId,
      table.fornecedor,
      table.codigoProduto,
      table.ncm,
    ),
    check(
      'chk_aprendizado_destinacao',
      sql`${table.destinacao} IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')`,
    ),
    check('chk_aprendizado_ncm', sql`${table.ncm} ~ '^[0-9]{8}$'`),
  ],
);
