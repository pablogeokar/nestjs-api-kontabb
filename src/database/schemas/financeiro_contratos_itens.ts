import {
  boolean,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { financeiroContratos } from './financeiro_contratos';
import { financeiroTiposLancamento } from './financeiro_tipos_lancamento';

/**
 * Lançamentos fixos do contrato: entram automaticamente em toda fatura
 * mensal do cliente (ex.: desconto comercial recorrente), dentro da vigência.
 */
export const financeiroContratosItens = pgTable(
  'financeiro_contratos_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contratoId: uuid('contrato_id').notNull(),
    tipoLancamentoId: uuid('tipo_lancamento_id').notNull(),
    descricao: text('descricao').notNull(),
    valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
    competenciaInicio: varchar('competencia_inicio', { length: 7 }),
    competenciaFim: varchar('competencia_fim', { length: 7 }),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fin_contr_itens_contrato_id_fk',
      columns: [table.contratoId],
      foreignColumns: [financeiroContratos.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fin_contr_itens_tipo_id_fk',
      columns: [table.tipoLancamentoId],
      foreignColumns: [financeiroTiposLancamento.id],
    }).onDelete('restrict'),
    index('idx_fin_contr_itens_contrato').on(table.contratoId),
    check('chk_fin_contr_itens_valor', sql`${table.valor} > 0`),
    check(
      'chk_fin_contr_itens_descricao',
      sql`btrim(${table.descricao}) <> ''`,
    ),
    check(
      'chk_fin_contr_itens_inicio',
      sql`${table.competenciaInicio} IS NULL OR ${table.competenciaInicio} ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'`,
    ),
    check(
      'chk_fin_contr_itens_fim',
      sql`${table.competenciaFim} IS NULL OR ${table.competenciaFim} ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'`,
    ),
  ],
);
