import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './user';

export const financeiroContratoPreferencias = pgTable(
  'financeiro_contrato_preferencias',
  {
    usuarioId: text('usuario_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    localAssinatura: text('local_assinatura').notNull().default(''),
    diaVencimento: integer('dia_vencimento').notNull().default(10),
    diaFechamento: integer('dia_fechamento').notNull().default(25),
    avisoPrevioDias: integer('aviso_previo_dias').notNull().default(30),
    gera13o: boolean('gera_13o').notNull().default(false),
    mes13o: integer('mes_13o').notNull().default(12),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    check(
      'chk_fin_contrato_pref_venc',
      sql`${table.diaVencimento} BETWEEN 1 AND 31`,
    ),
    check(
      'chk_fin_contrato_pref_fech',
      sql`${table.diaFechamento} BETWEEN 1 AND 31`,
    ),
    check(
      'chk_fin_contrato_pref_aviso',
      sql`${table.avisoPrevioDias} BETWEEN 0 AND 365`,
    ),
    check('chk_fin_contrato_pref_mes13', sql`${table.mes13o} BETWEEN 1 AND 12`),
    check(
      'chk_fin_contrato_pref_local',
      sql`char_length(${table.localAssinatura}) <= 120`,
    ),
  ],
);
