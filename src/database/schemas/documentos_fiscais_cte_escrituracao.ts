import {
  boolean,
  check,
  index,
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

export const documentosFiscaisCteEscrituracao = pgTable(
  'documentos_fiscais_cte_escrituracao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentoFiscalId: uuid('documento_fiscal_id').notNull(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    escrituravel: boolean('escrituravel').notNull(),
    motivoNaoEscrituravel: text('motivo_nao_escrituravel'),
    tomadorCnpjCpf: text('tomador_cnpj_cpf').notNull(),
    tomadorPapel: varchar('tomador_papel', { length: 20 }).notNull(),
    tipoOperacaoEscriturada: varchar('tipo_operacao_escriturada', {
      length: 10,
    })
      .notNull()
      .default('ENTRADA'),
    tpCte: varchar('tp_cte', { length: 1 }).notNull(),
    tpServ: varchar('tp_serv', { length: 1 }).notNull(),
    modal: varchar('modal', { length: 2 }).notNull(),
    cfopXml: varchar('cfop_xml', { length: 4 }).notNull(),
    cfop: varchar('cfop', { length: 4 }).notNull(),
    cfopRevisaoNecessaria: boolean('cfop_revisao_necessaria')
      .notNull()
      .default(false),
    revisaoNecessaria: boolean('revisao_necessaria').notNull().default(false),
    cstIcms: varchar('cst_icms', { length: 3 }),
    csosnIcms: varchar('csosn_icms', { length: 4 }),
    valorTotalServico: numeric('valor_total_servico', {
      precision: 15,
      scale: 2,
    }).notNull(),
    valorReceber: numeric('valor_receber', {
      precision: 15,
      scale: 2,
    }).notNull(),
    valorBcIcms: numeric('valor_bc_icms', { precision: 15, scale: 2 }),
    aliquotaIcms: numeric('aliquota_icms', { precision: 7, scale: 4 }),
    valorIcms: numeric('valor_icms', { precision: 15, scale: 2 }),
    valorIcmsCreditavel: numeric('valor_icms_creditavel', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('0'),
    valorTotalTributos: numeric('valor_total_tributos', {
      precision: 15,
      scale: 2,
    }),
    chaveCteReferenciado: text('chave_cte_referenciado'),
    codigoMunicipioOrigem: varchar('codigo_municipio_origem', { length: 7 }),
    codigoMunicipioDestino: varchar('codigo_municipio_destino', { length: 7 }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_cte_escrituracao_documento',
      columns: [table.documentoFiscalId],
      foreignColumns: [documentosFiscais.id],
    }).onDelete('cascade'),
    uniqueIndex('uidx_cte_escrituracao_documento').on(table.documentoFiscalId),
    index('idx_cte_escrituracao_cliente').on(table.clienteId),
    index('idx_cte_escrituracao_cfop').on(table.cfop),
    index('idx_cte_escrituracao_apuracao').on(
      table.clienteId,
      table.escrituravel,
      table.cfop,
    ),
    index('idx_cte_escrituracao_referencia').on(table.chaveCteReferenciado),
    check(
      'chk_cte_escrituracao_motivo',
      sql`(${table.escrituravel} = true AND ${table.motivoNaoEscrituravel} IS NULL) OR (${table.escrituravel} = false AND btrim(COALESCE(${table.motivoNaoEscrituravel}, '')) <> '')`,
    ),
    check(
      'chk_cte_escrituracao_tomador_documento',
      sql`${table.tomadorCnpjCpf} ~ '^[0-9]{11}$|^[0-9A-Z]{12}[0-9]{2}$'`,
    ),
    check(
      'chk_cte_escrituracao_tomador_papel',
      sql`${table.tomadorPapel} IN ('REMETENTE', 'EXPEDIDOR', 'RECEBEDOR', 'DESTINATARIO', 'TERCEIRO')`,
    ),
    check(
      'chk_cte_escrituracao_operacao',
      sql`${table.tipoOperacaoEscriturada} IN ('ENTRADA', 'SAIDA')`,
    ),
    check(
      'chk_cte_escrituracao_tp_cte',
      sql`${table.tpCte} IN ('0', '1', '2', '3')`,
    ),
    check(
      'chk_cte_escrituracao_tp_serv',
      sql`${table.tpServ} IN ('0', '1', '2', '3', '4')`,
    ),
    check('chk_cte_escrituracao_modal', sql`${table.modal} ~ '^[0-9]{2}$'`),
    check(
      'chk_cte_escrituracao_cfop_xml',
      sql`${table.cfopXml} ~ '^[123567][0-9]{3}$'`,
    ),
    check(
      'chk_cte_escrituracao_cfop',
      sql`${table.cfop} ~ '^[123567][0-9]{3}$'`,
    ),
    check(
      'chk_cte_escrituracao_referencia',
      sql`${table.chaveCteReferenciado} IS NULL OR ${table.chaveCteReferenciado} ~ '^[0-9A-Z]{44}$'`,
    ),
    check(
      'chk_cte_escrituracao_municipio_origem',
      sql`${table.codigoMunicipioOrigem} IS NULL OR ${table.codigoMunicipioOrigem} ~ '^[0-9]{7}$'`,
    ),
    check(
      'chk_cte_escrituracao_municipio_destino',
      sql`${table.codigoMunicipioDestino} IS NULL OR ${table.codigoMunicipioDestino} ~ '^[0-9]{7}$'`,
    ),
  ],
);
