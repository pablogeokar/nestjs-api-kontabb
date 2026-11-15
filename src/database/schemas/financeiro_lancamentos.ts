import {
  check,
  date,
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
import { clientes } from './clientes';
import { financeiroTiposLancamento } from './financeiro_tipos_lancamento';
import { financeiroFaturas } from './financeiro_faturas';
import { financeiroContratosItens } from './financeiro_contratos_itens';
import { user } from './user';

export const financeiroLancamentos = pgTable(
  'financeiro_lancamentos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    tipoLancamentoId: uuid('tipo_lancamento_id').notNull(),
    contratoItemId: uuid('contrato_item_id'),
    faturaId: uuid('fatura_id').references(() => financeiroFaturas.id, {
      onDelete: 'set null',
    }),
    competencia: varchar('competencia', { length: 7 }).notNull(),
    descricao: text('descricao').notNull(),
    natureza: varchar('natureza', { length: 10 }).notNull().default('DEBITO'),
    valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
    dataLancamento: date('data_lancamento').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PENDENTE'),
    criadoPor: text('criado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    // Nome explícito: o nome gerado automaticamente excederia 63 bytes.
    foreignKey({
      name: 'fin_lanc_tipo_lancamento_id_fk',
      columns: [table.tipoLancamentoId],
      foreignColumns: [financeiroTiposLancamento.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fin_lanc_contrato_item_id_fk',
      columns: [table.contratoItemId],
      foreignColumns: [financeiroContratosItens.id],
    }).onDelete('set null'),
    index('idx_fin_lanc_cliente_id').on(table.clienteId),
    index('idx_fin_lanc_fatura_id').on(table.faturaId),
    index('idx_fin_lanc_competencia').on(table.competencia),
    index('idx_fin_lanc_status').on(table.status),
    check(
      'chk_fin_lanc_competencia',
      sql`${table.competencia} ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'`,
    ),
    check(
      'chk_fin_lanc_natureza',
      sql`${table.natureza} IN ('DEBITO', 'CREDITO')`,
    ),
    check('chk_fin_lanc_valor', sql`${table.valor} > 0`),
    check(
      'chk_fin_lanc_status',
      sql`${table.status} IN ('PENDENTE', 'FATURADO', 'CANCELADO')`,
    ),
    check('chk_fin_lanc_descricao', sql`btrim(${table.descricao}) <> ''`),
  ],
);
