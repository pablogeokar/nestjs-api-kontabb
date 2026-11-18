import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const fiscalSimplesBeneficios = pgTable(
  'fiscal_simples_beneficios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: varchar('codigo', { length: 80 }).notNull(),
    versao: integer('versao').notNull().default(1),
    atual: boolean('atual').notNull().default(true),
    ativo: boolean('ativo').notNull().default(true),
    uf: varchar('uf', { length: 2 }).notNull(),
    descricao: text('descricao').notNull(),
    tipo: varchar('tipo', { length: 10 }).notNull(),
    atividades: text('atividades').array().notNull(),
    criterioReceita: varchar('criterio_receita', { length: 20 }).notNull(),
    receitaDe: numeric('receita_de', { precision: 15, scale: 2 })
      .notNull()
      .default('0.00'),
    receitaAte: numeric('receita_ate', { precision: 15, scale: 2 }).notNull(),
    percentualReducao: numeric('percentual_reducao', {
      precision: 5,
      scale: 4,
    }).notNull(),
    somenteMe: boolean('somente_me').notNull().default(false),
    vigenciaInicio: date('vigencia_inicio').notNull(),
    vigenciaFim: date('vigencia_fim').notNull(),
    fundamentoLegal: text('fundamento_legal').notNull(),
    fonteUrl: text('fonte_url').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_simples_beneficio_versao').on(table.codigo, table.versao),
    uniqueIndex('uidx_simples_beneficio_atual')
      .on(table.codigo)
      .where(sql`${table.atual} = true`),
    index('idx_simples_beneficio_uf_vigencia').on(
      table.uf,
      table.vigenciaInicio,
      table.vigenciaFim,
    ),
    check(
      'chk_simples_beneficio_uf',
      sql`${table.uf} IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')`,
    ),
    check(
      'chk_simples_beneficio_codigo',
      sql`${table.codigo} ~ '^[A-Z0-9_]{3,80}$' AND ${table.versao} >= 1`,
    ),
    check(
      'chk_simples_beneficio_tipo',
      sql`${table.tipo} IN ('ISENCAO','REDUCAO') AND ${table.percentualReducao} > 0 AND ${table.percentualReducao} <= 1 AND (${table.tipo} <> 'ISENCAO' OR ${table.percentualReducao} = 1)`,
    ),
    check(
      'chk_simples_beneficio_atividades',
      sql`cardinality(${table.atividades}) > 0 AND array_position(${table.atividades}, NULL) IS NULL AND ${table.atividades} <@ ARRAY['ANEXO_I','ANEXO_II']::text[]`,
    ),
    check(
      'chk_simples_beneficio_criterio',
      sql`${table.criterioReceita} IN ('RBT12_FAIXA','RBT12_REAL','RBA_ATUAL','RBA_ANTERIOR')`,
    ),
    check(
      'chk_simples_beneficio_receita',
      sql`${table.receitaDe} >= 0 AND ${table.receitaAte} >= ${table.receitaDe}`,
    ),
    check(
      'chk_simples_beneficio_vigencia',
      sql`${table.vigenciaFim} >= ${table.vigenciaInicio} AND extract(day FROM ${table.vigenciaInicio}) = 1 AND extract(day FROM ${table.vigenciaFim}) = 1 AND ${table.vigenciaInicio} >= '2018-01-01'::date`,
    ),
    check(
      'chk_simples_beneficio_fundamento',
      sql`length(btrim(${table.descricao})) >= 3 AND length(btrim(${table.fundamentoLegal})) >= 3 AND ${table.fonteUrl} ~ '^https://[^[:space:]]+$'`,
    ),
  ],
);
