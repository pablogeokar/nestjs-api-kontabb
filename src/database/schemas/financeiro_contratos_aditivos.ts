import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { financeiroContratos } from './financeiro_contratos';
import { user } from './user';
import type { EstadoContrato } from '../../financeiro/contrato-historico';

export const financeiroContratosAditivos = pgTable(
  'financeiro_contratos_aditivos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contratoId: uuid('contrato_id').notNull(),
    numero: integer('numero').notNull(),
    tipo: varchar('tipo', { length: 20 }).notNull(),
    competenciaInicio: varchar('competencia_inicio', { length: 7 }).notNull(),
    motivo: text('motivo').notNull(),
    percentual: numeric('percentual', { precision: 9, scale: 4 }),
    dataAssinatura: date('data_assinatura').notNull(),
    localAssinatura: text('local_assinatura').notNull(),
    anterior: jsonb('anterior').$type<EstadoContrato>().notNull(),
    posterior: jsonb('posterior').$type<EstadoContrato>().notNull(),
    alteracoes: jsonb('alteracoes').$type<string[]>().notNull(),
    criadoPor: text('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'fin_aditivos_contrato_fk',
      columns: [t.contratoId],
      foreignColumns: [financeiroContratos.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fin_aditivos_autor_fk',
      columns: [t.criadoPor],
      foreignColumns: [user.id],
    }).onDelete('set null'),
    uniqueIndex('uidx_fin_aditivos_numero').on(t.contratoId, t.numero),
    index('idx_fin_aditivos_vigencia').on(t.contratoId, t.competenciaInicio),
    check('chk_fin_aditivos_numero', sql`${t.numero} > 0`),
    check(
      'chk_fin_aditivos_tipo',
      sql`${t.tipo} IN ('ALTERACAO', 'REAJUSTE_ANUAL')`,
    ),
    check(
      'chk_fin_aditivos_vigencia',
      sql`${t.competenciaInicio} ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'`,
    ),
    check('chk_fin_aditivos_motivo', sql`length(btrim(${t.motivo})) >= 3`),
    check('chk_fin_aditivos_local', sql`btrim(${t.localAssinatura}) <> ''`),
    check(
      'chk_fin_aditivos_percentual',
      sql`(${t.tipo} = 'REAJUSTE_ANUAL' AND ${t.percentual} IS NOT NULL AND ${t.percentual} > 0 AND ${t.percentual} <= 1000) OR (${t.tipo} = 'ALTERACAO' AND ${t.percentual} IS NULL)`,
    ),
  ],
);
