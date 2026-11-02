import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  foreignKey,
  pgTable,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { fiscalSimplesApuracoes } from './fiscal_simples_apuracoes';

export const fiscalSimplesApuracaoItens = pgTable(
  'fiscal_simples_apuracao_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    apuracaoId: uuid('apuracao_id').notNull(),
    anexo: varchar('anexo', { length: 20 }).notNull(),
    faixaEnquadrada: integer('faixa_enquadrada').notNull(),
    aliquotaNominal: numeric('aliquota_nominal', {
      precision: 7,
      scale: 4,
    }).notNull(),
    parcelaDeduzir: numeric('parcela_deduzir', {
      precision: 15,
      scale: 2,
    }).notNull(),
    aliquotaEfetiva: numeric('aliquota_efetiva', {
      precision: 7,
      scale: 4,
    }).notNull(),
    receitaBrutaAtividade: numeric('receita_bruta_atividade', {
      precision: 15,
      scale: 2,
    }).notNull(),
    segregacao: varchar('segregacao', { length: 40 })
      .notNull()
      .default('TRIBUTACAO_INTEGRAL'),
    aliquotaEfetivaAposDeducoes: numeric('aliquota_efetiva_apos_deducoes', {
      precision: 7,
      scale: 4,
    }).notNull(),
    valorDevido: numeric('valor_devido', {
      precision: 15,
      scale: 2,
    }).notNull(),
    tributosPartilhados: jsonb('tributos_partilhados')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    foreignKey({
      name: 'fk_simples_apuracao_item',
      columns: [table.apuracaoId],
      foreignColumns: [fiscalSimplesApuracoes.id],
    }).onDelete('cascade'),
    index('idx_simples_apuracao_itens_apuracao').on(table.apuracaoId),
    check(
      'chk_simples_apuracao_item_anexo',
      sql`${table.anexo} IN ('ANEXO_I', 'ANEXO_II', 'ANEXO_III', 'ANEXO_IV', 'ANEXO_V')`,
    ),
    check(
      'chk_simples_apuracao_item_faixa',
      sql`${table.faixaEnquadrada} BETWEEN 1 AND 6`,
    ),
    check(
      'chk_simples_apuracao_item_segregacao',
      sql`${table.segregacao} IN ('TRIBUTACAO_INTEGRAL', 'ICMS_ST', 'ICMS_ISENTO', 'ISS_RETIDO', 'PIS_COFINS_MONOFASICO')`,
    ),
    check(
      'chk_simples_apuracao_item_valores',
      sql`${table.aliquotaNominal} >= 0 AND ${table.parcelaDeduzir} >= 0 AND ${table.aliquotaEfetiva} >= 0 AND ${table.receitaBrutaAtividade} >= 0 AND ${table.aliquotaEfetivaAposDeducoes} >= 0 AND ${table.valorDevido} >= 0`,
    ),
  ],
);
