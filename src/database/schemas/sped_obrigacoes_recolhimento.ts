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

export const spedObrigacoesRecolhimento = pgTable(
  'sped_obrigacoes_recolhimento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    competencia: date('competencia').notNull(),
    tipo: varchar('tipo', { length: 20 }).notNull(),
    uf: varchar('uf', { length: 2 }),
    codigoObrigacao: text('codigo_obrigacao').notNull(),
    valor: numeric('valor', { precision: 15, scale: 2 }).notNull(),
    dataVencimento: date('data_vencimento').notNull(),
    codigoReceita: text('codigo_receita'),
    numeroProcesso: text('numero_processo'),
    indicadorProcesso: varchar('indicador_processo', { length: 1 }),
    processo: text('processo'),
    textoComplementar: text('texto_complementar'),
    mesReferencia: varchar('mes_referencia', { length: 6 }),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_sped_obrigacao_competencia')
      .on(table.clienteId, table.competencia, table.tipo, table.uf)
      .nullsNotDistinct(),
    index('idx_sped_obrigacao_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    check(
      'chk_sped_obrigacao_tipo',
      sql`${table.tipo} IN ('ICMS_PROPRIO', 'ICMS_ST', 'DIFAL_FCP')`,
    ),
    check('chk_sped_obrigacao_valor', sql`${table.valor} >= 0`),
    check(
      'chk_sped_obrigacao_uf',
      sql`${table.uf} IS NULL OR ${table.uf} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'chk_sped_obrigacao_mes_referencia',
      sql`${table.mesReferencia} IS NULL OR ${table.mesReferencia} ~ '^[0-9]{6}$'`,
    ),
  ],
);
