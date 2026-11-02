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
import { ciapAtivoPermanente } from './ciap_ativo_permanente';
import { clientes } from './clientes';
import { documentosFiscais } from './documentos_fiscais';
import { documentosFiscaisItens } from './documentos_fiscais_itens';

// Razão de fatos patrimoniais do CIAP (Fase 2 / F06). É o histórico auditável
// dos eventos que afetam o bem: aquisição, imobilização, baixa, transferência e
// correção/estorno. Diferente de `ciap_apropriacoes` (que grava a razão mensal
// de crédito), esta tabela registra os FATOS que originam ou alteram o controle,
// com datas e documentos. Migração aditiva: não altera as tabelas existentes.
//
// R1.6: a correção retroativa gera um movimento de `correcao` (estorno/
//   substituição) auditável, nunca uma sobrescrita silenciosa. O vínculo com o
//   movimento substituído é guardado em `movimentoAnteriorId`.
// R1.7: o histórico separa saldo passível de controle (aquisicao/imobilizacao),
//   e o cancelamento residual (baixa/transferencia/correcao), classificado por
//   `tipo` e refletido em `valorIcmsPassivel`.

export const ciapMovimentos = pgTable(
  'ciap_movimentos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    bemId: uuid('bem_id')
      .notNull()
      .references(() => ciapAtivoPermanente.id, { onDelete: 'cascade' }),

    // Tipo do fato patrimonial. Restringido por check `chk_ciap_mov_tipo`.
    tipo: varchar('tipo', { length: 20 }).notNull(),

    // Data do fato (não a data de registro). Dirige elegibilidade/calendário.
    dataMovimento: date('data_movimento').notNull(),

    // Documento fiscal de origem/suporte do fato, quando houver.
    documentoFiscalId: uuid('documento_fiscal_id').references(
      () => documentosFiscais.id,
      { onDelete: 'set null' },
    ),
    documentoFiscalItemId: uuid('documento_fiscal_item_id'),

    // Valor de ICMS passível de controle afetado pelo fato (base da razão).
    // Positivo em aquisicao/imobilizacao, pode ser negativo em baixa/correcao.
    valorIcmsPassivel: numeric('valor_icms_passivel', {
      precision: 15,
      scale: 2,
    }).notNull(),

    // R1.6 — auditoria da correção retroativa: aponta para o movimento que este
    // estorna/substitui. NULL para fatos originais.
    movimentoAnteriorId: uuid('movimento_anterior_id'),

    // Motivo de baixa (SPED 01/02/03) quando `tipo = 'baixa'`.
    motivoBaixa: varchar('motivo_baixa', { length: 2 }),

    observacao: text('observacao'),

    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_ciap_movimento_item',
      columns: [table.documentoFiscalItemId],
      foreignColumns: [documentosFiscaisItens.id],
    }).onDelete('set null'),
    index('idx_ciap_mov_cliente').on(table.clienteId),
    index('idx_ciap_mov_bem').on(table.bemId),
    index('idx_ciap_mov_bem_data').on(table.bemId, table.dataMovimento),
    foreignKey({
      columns: [table.movimentoAnteriorId],
      foreignColumns: [table.id],
      name: 'ciap_movimentos_movimento_anterior_id_fk',
    }).onDelete('set null'),
    check(
      'chk_ciap_mov_tipo',
      sql`${table.tipo} IN ('aquisicao', 'imobilizacao', 'baixa', 'transferencia', 'correcao')`,
    ),
    check(
      'chk_ciap_mov_motivo_baixa',
      sql`${table.motivoBaixa} IS NULL OR ${table.motivoBaixa} IN ('01', '02', '03')`,
    ),
    // R1.6: um movimento só referencia outro quando é correção/estorno.
    check(
      'chk_ciap_mov_correcao',
      sql`${table.movimentoAnteriorId} IS NULL OR ${table.tipo} = 'correcao'`,
    ),
  ],
);
