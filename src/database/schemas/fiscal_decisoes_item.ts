import {
  check,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { documentosFiscaisItens } from './documentos_fiscais_itens';

// Decisão de crédito por item — embrião de `fiscal_decisoes_item` (F05 / R3.2,
// R3.4). Persiste, POR ITEM, a decisão produzida pela função pura
// `decidirCreditoIcms` (fiscal/services/decisao-credito.ts): o crédito
// efetivamente admitido, a decisão, o motivo e a versão da regra aplicada.
//
// ADITIVA E NÃO-DESTRUTIVA: o valor original destacado no XML permanece
// intocado em `documentos_fiscais_itens.valor_icms`. `valor_credito_admitido`
// é armazenado SEPARADAMENTE aqui e NUNCA sobrescreve o original (R3.2).
//
// Versionamento (R3.4): a chave é (item_id + regra_versao_id), de modo que uma
// nova versão de decisão gera uma nova linha em vez de sobrescrever a anterior.
// `regra_versao_id` usa a sentinela `'SEM_REGRA'` quando não há regra
// versionada aplicável (evita NULL na PK composta, permitindo unicidade).

export const fiscalDecisoesItem = pgTable(
  'fiscal_decisoes_item',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => documentosFiscaisItens.id, { onDelete: 'cascade' }),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    // Versão da regra aplicada; sentinela quando não há regra versionada.
    // Compõe a PK para que novas versões coexistam (R3.4) sem sobrescrever.
    regraVersaoId: text('regra_versao_id').notNull().default('SEM_REGRA'),
    // Crédito de ICMS efetivamente admitido pela decisão. Mantido SEPARADO do
    // `valor_icms` original do XML (R3.2). 0 para VEDADO/EXIGE_REVISAO.
    valorCreditoAdmitido: numeric('valor_credito_admitido', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('0'),
    decisao: varchar('decisao', { length: 20 }).notNull(),
    motivo: varchar('motivo', { length: 40 }).notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'fiscal_decisoes_item_pk',
      columns: [table.itemId, table.regraVersaoId],
    }),
    index('idx_fiscal_decisoes_item_cliente').on(table.clienteId),
    check(
      'chk_fiscal_decisao',
      sql`${table.decisao} IN ('ADMITIDO', 'VEDADO', 'EXIGE_REVISAO')`,
    ),
    check(
      'chk_fiscal_decisao_motivo',
      sql`${table.motivo} IN ('SEM_VALOR_DESTACADO', 'CST_AUTORIZA_CREDITO', 'CSOSN_PERMITE_CREDITO', 'CFOP_VEDA_CREDITO', 'REGRA_VEDA_CREDITO', 'CST_NAO_AUTORIZADO')`,
    ),
    check(
      'chk_fiscal_decisao_credito_nao_negativo',
      sql`${table.valorCreditoAdmitido} >= 0`,
    ),
  ],
);
