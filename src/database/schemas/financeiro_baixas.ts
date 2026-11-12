import {
  boolean,
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
import { financeiroFaturas } from './financeiro_faturas';
import { user } from './user';

export const financeiroBaixas = pgTable(
  'financeiro_baixas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    faturaId: uuid('fatura_id')
      .notNull()
      .references(() => financeiroFaturas.id, { onDelete: 'cascade' }),
    valorRecebido: numeric('valor_recebido', {
      precision: 12,
      scale: 2,
    }).notNull(),
    dataPagamento: date('data_pagamento').notNull(),
    formaPagamento: varchar('forma_pagamento', { length: 20 }).notNull(),
    valorMulta: numeric('valor_multa', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    valorJuros: numeric('valor_juros', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    valorDesconto: numeric('valor_desconto', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    comprovanteKey: text('comprovante_key'),
    comprovanteNome: text('comprovante_nome'),
    observacao: text('observacao'),
    registradoPor: text('registrado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    estornado: boolean('estornado').notNull().default(false),
    estornadoEm: timestamp('estornado_em'),
    estornadoPor: text('estornado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    motivoEstorno: text('motivo_estorno'),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_fin_baixas_fatura_id').on(table.faturaId),
    index('idx_fin_baixas_data_pagamento').on(table.dataPagamento),
    index('idx_fin_baixas_estornado').on(table.estornado),
    check('chk_fin_baixas_valor_recebido', sql`${table.valorRecebido} > 0`),
    check(
      'chk_fin_baixas_acrescimos_desconto',
      sql`${table.valorMulta} >= 0 AND ${table.valorJuros} >= 0 AND ${table.valorDesconto} >= 0`,
    ),
    check(
      'chk_fin_baixas_forma_pagamento',
      sql`${table.formaPagamento} IN ('PIX', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'CARTAO', 'OUTROS')`,
    ),
    check(
      'chk_fin_baixas_estorno_coerencia',
      sql`(${table.estornado} = false AND ${table.estornadoEm} IS NULL AND ${table.estornadoPor} IS NULL) OR (${table.estornado} = true AND ${table.estornadoEm} IS NOT NULL)`,
    ),
  ],
);
