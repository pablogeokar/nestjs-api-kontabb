import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { documentosFiscais } from './documentos_fiscais';
import { documentosFiscaisItens } from './documentos_fiscais_itens';

// CIAP — Controle de crédito do ICMS do ativo permanente (Bloco G / 1-48 avos)

export const ciapAtivoPermanente = pgTable(
  'ciap_ativo_permanente',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    documentoFiscalId: uuid('documento_fiscal_id'),
    documentoFiscalItemId: uuid('documento_fiscal_item_id'),

    codigoBem: varchar('codigo_bem', { length: 60 }).notNull(),
    identificacaoBem: text('identificacao_bem').notNull(),

    // Fase 2 / R2.1 — Identidade patrimonial POR AQUISIÇÃO (não por SKU).
    //
    // O `codigoBem` acima é derivado do SKU (`codigoProduto`) e, pelo unique
    // `uidx_ciap_cliente_codigo_bem`, funde duas compras do mesmo SKU num único
    // bem. `chaveAquisicao` passa a ser a identidade estável de UMA aquisição:
    // `${documentoFiscalId}:${documentoFiscalItemId}` quando o bem veio de um
    // item escriturado, ou o próprio `id` (UUID) para cadastros manuais sem
    // item. Duas aquisições do mesmo SKU têm chaves distintas e, portanto, duas
    // identidades patrimoniais distintas (R2.1).
    //
    // Coluna ADITIVA e anulável: o backfill assistido a popula sem destruir o
    // `codigoBem` legado; o unique parcial abaixo só vale para linhas já
    // migradas (chave não nula), de modo que a migração não quebra fichas
    // antigas ainda não saneadas.
    chaveAquisicao: varchar('chave_aquisicao', { length: 120 }),

    // Procedência da identidade atual do bem, para auditoria do saneamento:
    //  - 'aquisicao'                 → identidade reconstruída a partir de um
    //                                   documento/item escriturado (comprovada);
    //  - 'reconstruido_nao_comprovado' → ficha legada sem lastro em item
    //                                   escriturado; chave = próprio UUID (o
    //                                   backfill NÃO inventa documento/competência);
    //  - 'sku_legado'                → ainda não migrada (estado inicial pós-DDL).
    // Restringido por `chk_ciap_origem_identidade`.
    origemIdentidade: varchar('origem_identidade', { length: 30 })
      .notNull()
      .default('sku_legado'),

    // R2.1 — fichas cuja identidade por SKU encobre MAIS DE UMA aquisição
    // escriturada ficam marcadas para saneamento assistido (rollout, Fase 5/13):
    // o backfill não decide sozinho a qual aquisição a ficha legada pertence.
    saneamentoPendente: boolean('saneamento_pendente').notNull().default(false),

    dataEntrada: date('data_entrada').notNull(),
    valorIcmsTotal: numeric('valor_icms_total', {
      precision: 15,
      scale: 2,
    }).notNull(),
    valorIcmsFrete: numeric('valor_icms_frete', {
      precision: 15,
      scale: 2,
    }).default('0'),
    valorIcmsDifal: numeric('valor_icms_difal', {
      precision: 15,
      scale: 2,
    }).default('0'),
    quantidadeParcelas: integer('quantidade_parcelas').notNull().default(48),
    parcelasApropriadas: integer('parcelas_apropriadas').notNull().default(0),
    saldoCredorRestante: numeric('saldo_credor_restante', {
      precision: 15,
      scale: 2,
    }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('ATIVO'),
    dataBaixa: date('data_baixa'),
    motivoBaixa: varchar('motivo_baixa', { length: 2 }),

    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_ciap_ativo_documento',
      columns: [table.documentoFiscalId],
      foreignColumns: [documentosFiscais.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_ciap_ativo_item',
      columns: [table.documentoFiscalItemId],
      foreignColumns: [documentosFiscaisItens.id],
    }).onDelete('set null'),
    index('idx_ciap_cliente').on(table.clienteId),
    index('idx_ciap_status').on(table.status),
    uniqueIndex('uidx_ciap_cliente_codigo_bem').on(
      table.clienteId,
      table.codigoBem,
    ),
    // R2.1 — identidade POR AQUISIÇÃO: no máximo uma ficha por
    // (cliente, chaveAquisicao). Unique PARCIAL (apenas chave não nula) para
    // conviver, de forma aditiva, com fichas legadas ainda não migradas (chave
    // nula) e com o unique legado por SKU, que permanece durante a transição.
    uniqueIndex('uidx_ciap_cliente_chave_aquisicao')
      .on(table.clienteId, table.chaveAquisicao)
      .where(sql`${table.chaveAquisicao} IS NOT NULL`),
    check(
      'chk_ciap_status',
      sql`${table.status} IN ('ATIVO', 'BAIXADO', 'CONCLUIDO')`,
    ),
    check(
      'chk_ciap_origem_identidade',
      sql`${table.origemIdentidade} IN ('sku_legado', 'aquisicao', 'reconstruido_nao_comprovado')`,
    ),
    check(
      'chk_ciap_parcelas',
      sql`${table.quantidadeParcelas} > 0 AND ${table.parcelasApropriadas} >= 0 AND ${table.parcelasApropriadas} <= ${table.quantidadeParcelas}`,
    ),
    check(
      'chk_ciap_motivo_baixa',
      sql`${table.motivoBaixa} IS NULL OR ${table.motivoBaixa} IN ('01', '02', '03')`,
    ),
  ],
);
