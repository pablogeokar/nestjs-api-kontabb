import {
  check,
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
import { spedInventarios } from './sped_inventarios';
import { spedItens } from './sped_itens';
import { spedParticipantes } from './sped_participantes';

export const spedInventarioItens = pgTable(
  'sped_inventario_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inventarioId: uuid('inventario_id')
      .notNull()
      .references(() => spedInventarios.id, { onDelete: 'cascade' }),
    spedItemId: uuid('sped_item_id')
      .notNull()
      .references(() => spedItens.id, { onDelete: 'restrict' }),
    unidade: varchar('unidade', { length: 6 }).notNull(),
    quantidade: numeric('quantidade', { precision: 15, scale: 3 }).notNull(),
    valorUnitario: numeric('valor_unitario', {
      precision: 21,
      scale: 6,
    }).notNull(),
    valorItem: numeric('valor_item', { precision: 15, scale: 2 }).notNull(),
    indicadorPropriedade: varchar('indicador_propriedade', { length: 1 })
      .notNull()
      .default('0'),
    participanteId: uuid('participante_id').references(
      () => spedParticipantes.id,
      { onDelete: 'restrict' },
    ),
    textoComplementar: text('texto_complementar'),
    codigoConta: text('codigo_conta'),
    valorItemIr: numeric('valor_item_ir', { precision: 15, scale: 2 }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_sped_inventario_item_participante')
      .on(
        table.inventarioId,
        table.spedItemId,
        table.indicadorPropriedade,
        table.participanteId,
      )
      .nullsNotDistinct(),
    index('idx_sped_inventario_item_inventario').on(table.inventarioId),
    check('chk_sped_inventario_item_qtd', sql`${table.quantidade} >= 0`),
    check(
      'chk_sped_inventario_item_valor_unitario',
      sql`${table.valorUnitario} >= 0`,
    ),
    check('chk_sped_inventario_item_valor', sql`${table.valorItem} >= 0`),
    check(
      'chk_sped_inventario_item_calculo',
      sql`${table.valorItem} = round(${table.quantidade} * ${table.valorUnitario}, 2)`,
    ),
    check(
      'chk_sped_inventario_item_unidade',
      sql`${table.unidade} ~ '^[0-9A-Z]{1,6}$'`,
    ),
    check(
      'chk_sped_inventario_item_ind_prop',
      sql`${table.indicadorPropriedade} IN ('0', '1', '2')`,
    ),
    check(
      'chk_sped_inventario_item_participante',
      sql`(${table.indicadorPropriedade} = '0' AND ${table.participanteId} IS NULL) OR (${table.indicadorPropriedade} IN ('1', '2') AND ${table.participanteId} IS NOT NULL)`,
    ),
    check(
      'chk_sped_inventario_item_valor_ir',
      sql`${table.valorItemIr} IS NULL OR ${table.valorItemIr} >= 0`,
    ),
  ],
);
