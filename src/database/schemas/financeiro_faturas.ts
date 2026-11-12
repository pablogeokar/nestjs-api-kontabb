import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { user } from './user';

export const financeiroFaturas = pgTable(
  'financeiro_faturas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numero: varchar('numero', { length: 40 }).notNull(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    competencia: varchar('competencia', { length: 7 }).notNull(),
    dataEmissao: date('data_emissao').notNull(),
    dataVencimento: date('data_vencimento').notNull(),
    valorBruto: numeric('valor_bruto', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    valorDescontos: numeric('valor_descontos', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    valorAcrescimos: numeric('valor_acrescimos', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    valorLiquido: numeric('valor_liquido', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    valorPago: numeric('valor_pago', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    status: varchar('status', { length: 20 }).notNull().default('PENDENTE'),
    pixCopiaECola: text('pix_copia_e_cola'),
    linhaDigitavel: text('linha_digitavel'),
    observacoes: text('observacoes'),
    criadoPor: text('criado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_fin_faturas_numero').on(table.numero),
    uniqueIndex('uidx_fin_faturas_cliente_competencia')
      .on(table.clienteId, table.competencia)
      .where(sql`${table.status} <> 'CANCELADA'`),
    index('idx_fin_faturas_cliente_id').on(table.clienteId),
    index('idx_fin_faturas_competencia').on(table.competencia),
    index('idx_fin_faturas_status').on(table.status),
    index('idx_fin_faturas_vencimento').on(table.dataVencimento),
    check(
      'chk_fin_faturas_competencia',
      sql`${table.competencia} ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'`,
    ),
    check(
      'chk_fin_faturas_status',
      sql`${table.status} IN ('PENDENTE', 'PARCIALMENTE_PAGA', 'PAGA', 'VENCIDA', 'CANCELADA')`,
    ),
    check(
      'chk_fin_faturas_valores',
      sql`${table.valorBruto} >= 0 AND ${table.valorDescontos} >= 0 AND ${table.valorAcrescimos} >= 0 AND ${table.valorLiquido} >= 0 AND ${table.valorPago} >= 0`,
    ),
  ],
);
