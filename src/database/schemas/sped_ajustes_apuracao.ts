import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { user } from './user';

export const spedAjustesApuracao = pgTable(
  'sped_ajustes_apuracao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    competencia: date('competencia').notNull(),
    registro: varchar('registro', { length: 4 }).notNull(),
    codigoAjuste: text('codigo_ajuste').notNull(),
    descricao: text('descricao'),
    valor: numeric('valor', { precision: 15, scale: 2 }).notNull(),
    indicador: varchar('indicador', { length: 24 }).notNull(),
    uf: varchar('uf', { length: 2 }),
    numeroDocumento: text('numero_documento'),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_sped_ajuste_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    check(
      'chk_sped_ajuste_registro',
      sql`${table.registro} IN ('E111', 'E220', 'E311', 'E530')`,
    ),
    check(
      'chk_sped_ajuste_indicador',
      sql`${table.indicador} IN ('DEBITO', 'CREDITO', 'ESTORNO_DEBITO', 'ESTORNO_CREDITO', 'DEDUCAO', 'DEBITO_ESPECIAL')`,
    ),
    check('chk_sped_ajuste_valor', sql`${table.valor} >= 0`),
    check(
      'chk_sped_ajuste_uf',
      sql`${table.uf} IS NULL OR ${table.uf} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'chk_sped_ajuste_coerencia',
      sql`(
        (${table.registro} = 'E111' AND ${table.uf} IS NULL AND ${table.codigoAjuste} ~ '^[A-Z]{2}0[0-5][A-Z0-9]{4}$')
        OR (${table.registro} = 'E220' AND ${table.uf} IS NOT NULL AND ${table.codigoAjuste} ~ ('^' || ${table.uf} || '1[0-5][A-Z0-9]{4}$'))
        OR (${table.registro} = 'E311' AND ${table.uf} IS NOT NULL AND ${table.codigoAjuste} ~ ('^' || ${table.uf} || '[23][0-5][A-Z0-9]{4}$'))
        OR (${table.registro} = 'E530' AND ${table.uf} IS NULL AND ${table.codigoAjuste} ~ '^[A-Z0-9]{1,3}$' AND ${table.indicador} IN ('DEBITO', 'CREDITO'))
      )`,
    ),
    check(
      'chk_sped_ajuste_natureza_indicador',
      sql`${table.registro} = 'E530' OR CASE substring(${table.codigoAjuste} FROM 4 FOR 1)
        WHEN '0' THEN ${table.indicador} = 'DEBITO'
        WHEN '1' THEN ${table.indicador} = 'ESTORNO_CREDITO'
        WHEN '2' THEN ${table.indicador} = 'CREDITO'
        WHEN '3' THEN ${table.indicador} = 'ESTORNO_DEBITO'
        WHEN '4' THEN ${table.indicador} = 'DEDUCAO'
        WHEN '5' THEN ${table.indicador} = 'DEBITO_ESPECIAL'
        ELSE false
      END`,
    ),
  ],
);
