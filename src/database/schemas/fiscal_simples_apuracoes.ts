import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { fiscalApuracoesGuias } from './fiscal_apuracoes_guias';
import { fiscalFechamentos } from './fiscal_fechamentos';
import { fiscalSimplesTabelas } from './fiscal_simples_tabelas';

export const fiscalSimplesApuracoes = pgTable(
  'fiscal_simples_apuracoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    tabelaId: uuid('tabela_id')
      .notNull()
      .references(() => fiscalSimplesTabelas.id, { onDelete: 'restrict' }),
    competencia: date('competencia').notNull(),
    versao: integer('versao').notNull().default(1),
    corrente: boolean('corrente').notNull().default(false),
    rbt12: numeric('rbt12', { precision: 15, scale: 2 }).notNull(),
    rbt12Proporcional: boolean('rbt12_proporcional').notNull().default(false),
    receitaBrutaMes: numeric('receita_bruta_mes', {
      precision: 15,
      scale: 2,
    }).notNull(),
    folhaSalarios12m: numeric('folha_salarios_12m', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('0.00'),
    fatorR: numeric('fator_r', { precision: 7, scale: 4 }),
    valorTotalDas: numeric('valor_total_das', {
      precision: 15,
      scale: 2,
    }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('RASCUNHO'),
    fechamentoId: uuid('fechamento_id').references(() => fiscalFechamentos.id, {
      onDelete: 'set null',
    }),
    guiaId: uuid('guia_id').references(() => fiscalApuracoesGuias.id, {
      onDelete: 'set null',
    }),
    origens: jsonb('origens')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    memoriaCalculo: jsonb('memoria_calculo')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_simples_apuracao_versao').on(
      table.clienteId,
      table.competencia,
      table.versao,
    ),
    uniqueIndex('uidx_simples_apuracao_corrente')
      .on(table.clienteId, table.competencia)
      .where(sql`${table.corrente} = true`),
    index('idx_simples_apuracao_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    check('chk_simples_apuracao_versao', sql`${table.versao} >= 1`),
    check(
      'chk_simples_apuracao_competencia',
      sql`date_part('day', ${table.competencia}) = 1`,
    ),
    check(
      'chk_simples_status',
      sql`${table.status} IN ('RASCUNHO', 'FECHADO', 'RETIFICADO')`,
    ),
    check(
      'chk_simples_apuracao_corrente_fechada',
      sql`${table.corrente} = false OR ${table.status} = 'FECHADO'`,
    ),
    check(
      'chk_simples_apuracao_valores',
      sql`${table.rbt12} >= 0 AND ${table.receitaBrutaMes} >= 0 AND ${table.folhaSalarios12m} >= 0 AND ${table.valorTotalDas} >= 0`,
    ),
    check(
      'chk_simples_apuracao_fator_r',
      sql`${table.fatorR} IS NULL OR (${table.fatorR} >= 0 AND ${table.fatorR} <= 9.9999)`,
    ),
  ],
);
