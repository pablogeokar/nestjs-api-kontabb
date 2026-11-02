import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { fiscalSimplesAnexos } from './fiscal_simples_anexos';

export const fiscalSimplesFaixas = pgTable(
  'fiscal_simples_faixas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    anexoId: uuid('anexo_id')
      .notNull()
      .references(() => fiscalSimplesAnexos.id, { onDelete: 'cascade' }),
    faixa: integer('faixa').notNull(),
    rbt12De: numeric('rbt12_de', { precision: 15, scale: 2 }).notNull(),
    rbt12Ate: numeric('rbt12_ate', { precision: 15, scale: 2 }).notNull(),
    aliquotaNominal: numeric('aliquota_nominal', {
      precision: 7,
      scale: 4,
    }).notNull(),
    parcelaDeduzir: numeric('parcela_deduzir', {
      precision: 15,
      scale: 2,
    }).notNull(),
    percentualIrpj: numeric('percentual_irpj', { precision: 7, scale: 4 })
      .notNull()
      .default('0'),
    percentualCsll: numeric('percentual_csll', { precision: 7, scale: 4 })
      .notNull()
      .default('0'),
    percentualCofins: numeric('percentual_cofins', {
      precision: 7,
      scale: 4,
    })
      .notNull()
      .default('0'),
    percentualPis: numeric('percentual_pis', { precision: 7, scale: 4 })
      .notNull()
      .default('0'),
    percentualCpp: numeric('percentual_cpp', { precision: 7, scale: 4 })
      .notNull()
      .default('0'),
    percentualIpi: numeric('percentual_ipi', { precision: 7, scale: 4 })
      .notNull()
      .default('0'),
    percentualIcms: numeric('percentual_icms', { precision: 7, scale: 4 })
      .notNull()
      .default('0'),
    percentualIss: numeric('percentual_iss', { precision: 7, scale: 4 })
      .notNull()
      .default('0'),
  },
  (table) => [
    unique('uq_simples_faixa_anexo').on(table.anexoId, table.faixa),
    index('idx_simples_faixas_anexo_rbt12').on(
      table.anexoId,
      table.rbt12De,
      table.rbt12Ate,
    ),
    check('chk_simples_faixa_num', sql`${table.faixa} BETWEEN 1 AND 6`),
    check(
      'chk_simples_faixa_limites',
      sql`${table.rbt12De} >= 0 AND ${table.rbt12Ate} >= ${table.rbt12De}`,
    ),
    check(
      'chk_simples_faixa_valores',
      sql`${table.aliquotaNominal} >= 0 AND ${table.parcelaDeduzir} >= 0`,
    ),
    check(
      'chk_simples_faixa_partilha',
      sql`${table.percentualIrpj} + ${table.percentualCsll} + ${table.percentualCofins} + ${table.percentualPis} + ${table.percentualCpp} + ${table.percentualIpi} + ${table.percentualIcms} + ${table.percentualIss} = 1.0000`,
    ),
  ],
);
