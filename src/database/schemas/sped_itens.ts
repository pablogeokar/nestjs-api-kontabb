import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { spedParticipantes } from './sped_participantes';
import { spedUnidades } from './sped_unidades';

export const spedItens = pgTable(
  'sped_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    participanteOrigemId: uuid('participante_origem_id').references(
      () => spedParticipantes.id,
      { onDelete: 'restrict' },
    ),
    codigo: varchar('codigo', { length: 60 }).notNull(),
    codigoExterno: text('codigo_externo').notNull(),
    descricao: text('descricao').notNull(),
    codigoBarras: text('codigo_barras'),
    unidadeId: uuid('unidade_id')
      .notNull()
      .references(() => spedUnidades.id, { onDelete: 'restrict' }),
    tipoItem: varchar('tipo_item', { length: 2 }).notNull().default('00'),
    tipoItemInferido: boolean('tipo_item_inferido').notNull().default(true),
    ncm: varchar('ncm', { length: 8 }),
    exIpi: varchar('ex_ipi', { length: 3 }),
    codigoGenero: varchar('codigo_genero', { length: 2 }),
    codigoServico: text('codigo_servico'),
    aliquotaIcms: numeric('aliquota_icms', { precision: 7, scale: 4 }),
    cest: varchar('cest', { length: 7 }),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_sped_item_codigo').on(table.clienteId, table.codigo),
    unique('uq_sped_item_origem_externo')
      .on(table.clienteId, table.participanteOrigemId, table.codigoExterno)
      .nullsNotDistinct(),
    index('idx_sped_item_cliente').on(table.clienteId),
    check('chk_sped_item_tipo', sql`${table.tipoItem} ~ '^[0-9]{2}$'`),
    check(
      'chk_sped_item_ncm',
      sql`${table.ncm} IS NULL OR ${table.ncm} ~ '^[0-9]{8}$'`,
    ),
    check(
      'chk_sped_item_cest',
      sql`${table.cest} IS NULL OR ${table.cest} ~ '^[0-9]{7}$'`,
    ),
  ],
);
