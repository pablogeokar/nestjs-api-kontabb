import {
  bigint,
  boolean,
  check,
  date,
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
import { clientes } from './clientes';

export const documentosFiscais = pgTable(
  'documentos_fiscais',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    chaveAcesso: text('chave_acesso').notNull(),
    nsu: bigint('nsu', { mode: 'number' }).notNull(),
    tipoDocumento: text('tipo_documento').notNull(),
    modelo: text('modelo').notNull(),
    serie: text('serie'),
    numeroDocumento: text('numero_documento').notNull(),
    emitenteCnpjCpf: text('emitente_cnpj_cpf').notNull(),
    emitenteRazaoSocial: text('emitente_razao_social'),
    destinatarioCnpjCpf: text('destinatario_cnpj_cpf').notNull(),
    destinatarioRazaoSocial: text('destinatario_razao_social'),
    dataEmissao: timestamp('data_emissao').notNull(),
    dataEmissaoFiscal: date('data_emissao_fiscal'),
    dataEntradaSaida: timestamp('data_entrada_saida'),
    dataEntradaSaidaFiscal: date('data_entrada_saida_fiscal'),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull(),
    valorTotalDeclaradoXml: numeric('valor_total_declarado_xml', {
      precision: 15,
      scale: 2,
    }),
    totaisDeclaradosXml: jsonb('totais_declarados_xml').$type<
      Record<string, string | null>
    >(),
    quantidadeItensDeclaradaXml: integer('quantidade_itens_declarada_xml'),
    integridadeConferida: boolean('integridade_conferida')
      .notNull()
      .default(false),
    integridadeStatus: varchar('integridade_status', { length: 20 })
      .notNull()
      .default('NAO_CONFERIDA'),
    integridadeDetalhes: jsonb('integridade_detalhes').$type<
      Record<string, unknown>
    >(),
    codSituacaoSped: varchar('cod_situacao_sped', { length: 2 }),
    modalidadeFrete: varchar('modalidade_frete', { length: 1 }),
    informacoesComplementares: text('informacoes_complementares'),
    emitenteDados: jsonb('emitente_dados').$type<Record<string, unknown>>(),
    destinatarioDados:
      jsonb('destinatario_dados').$type<Record<string, unknown>>(),
    codigoVerificacao: varchar('codigo_verificacao', { length: 32 }),
    competenciaDeclarada: date('competencia_declarada'),
    municipioIncidencia: varchar('municipio_incidencia', { length: 7 }),
    regimeEspecialTributacao: varchar('regime_especial_tributacao', {
      length: 10,
    }),
    optanteSimplesNacionalXml: boolean('optante_simples_nacional_xml'),
    nfseDados: jsonb('nfse_dados').$type<Record<string, unknown>>(),
    // Documentos referenciados (grupo <NFref>) para o registro C113 da EFD.
    documentosReferenciados: jsonb('documentos_referenciados').$type<
      Array<{ tipo: string; chaveAcesso: string | null }>
    >(),
    situacao: text('situacao').notNull().default('AUTORIZADA'),
    manifestacaoStatus: text('manifestacao_status')
      .notNull()
      .default('SEM_MANIFESTACAO'),
    tipoOperacaoEscriturada: varchar('tipo_operacao_escriturada', {
      length: 10,
    })
      .notNull()
      .default('ENTRADA'),
    tpNfXml: varchar('tp_nf_xml', { length: 1 }),
    escriturado: boolean('escriturado').notNull().default(false),
    escrituracaoStatus: varchar('escrituracao_status', { length: 24 })
      .notNull()
      .default('NAO_ESCRITURAVEL'),
    xmlKey: text('xml_key').notNull(),
    danfeKey: text('danfe_key'),
    ultimaTentativaXmlEm: timestamp('ultima_tentativa_xml_em', {
      withTimezone: true,
    }),
    proximaTentativaXmlEm: timestamp('proxima_tentativa_xml_em', {
      withTimezone: true,
    }),
    tentativasXml: integer('tentativas_xml').notNull().default(0),
    ultimaTentativaCienciaEm: timestamp('ultima_tentativa_ciencia_em', {
      withTimezone: true,
    }),
    proximaTentativaCienciaEm: timestamp('proxima_tentativa_ciencia_em', {
      withTimezone: true,
    }),
    tentativasCiencia: integer('tentativas_ciencia').notNull().default(0),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_docs_fiscais_cliente_chave').on(
      table.clienteId,
      table.chaveAcesso,
    ),
    index('idx_docs_fiscais_cliente_id').on(table.clienteId),
    index('idx_docs_fiscais_tipo').on(table.tipoDocumento),
    index('idx_docs_fiscais_data_emissao').on(table.dataEmissao),
    index('idx_docs_fiscais_cliente_competencia').on(
      table.clienteId,
      table.dataEmissaoFiscal,
      table.id,
    ),
    index('idx_docs_fiscais_cliente_competencia_nfse').on(
      table.clienteId,
      table.competenciaDeclarada,
      table.id,
    ),
    index('idx_docs_fiscais_nsu').on(table.nsu),
    index('idx_docs_fiscais_destinatario').on(table.destinatarioCnpjCpf),
    index('idx_docs_fiscais_emitente').on(table.emitenteCnpjCpf),
    check(
      'chk_docs_fiscais_chave',
      sql`((${table.tipoDocumento} IN ('NFE', 'CTE', 'NFCE') AND length(${table.chaveAcesso}) = 44) OR (${table.tipoDocumento} = 'NFSE' AND length(${table.chaveAcesso}) BETWEEN 14 AND 50))`,
    ),
    check(
      'chk_docs_fiscais_tipo',
      sql`${table.tipoDocumento} IN ('NFE', 'CTE', 'NFCE', 'NFSE')`,
    ),
    check(
      'chk_docs_fiscais_modelo',
      sql`${table.modelo} IN ('55', '57', '65', 'NFSE')`,
    ),
    check(
      'chk_docs_fiscais_tipo_modelo',
      sql`(${table.tipoDocumento} = 'NFE' AND ${table.modelo} = '55') OR (${table.tipoDocumento} = 'CTE' AND ${table.modelo} = '57') OR (${table.tipoDocumento} = 'NFCE' AND ${table.modelo} = '65') OR (${table.tipoDocumento} = 'NFSE' AND ${table.modelo} = 'NFSE')`,
    ),
    check(
      'chk_docs_fiscais_situacao',
      sql`${table.situacao} IN ('AUTORIZADA', 'CANCELADA', 'DENEGADA', 'RESUMIDA')`,
    ),
    check(
      'chk_docs_fiscais_manifestacao',
      sql`${table.manifestacaoStatus} IN ('SEM_MANIFESTACAO', 'CIENCIA', 'CONFIRMADA', 'DESCONHECIDA', 'NAO_REALIZADA')`,
    ),
    check(
      'chk_docs_fiscais_operacao_escriturada',
      sql`${table.tipoOperacaoEscriturada} IN ('ENTRADA', 'SAIDA')`,
    ),
    check(
      'chk_docs_fiscais_tp_nf_xml',
      sql`${table.tpNfXml} IS NULL OR ${table.tpNfXml} IN ('0', '1')`,
    ),
    check(
      'chk_docs_fiscais_escrituracao_status',
      sql`${table.escrituracaoStatus} IN ('ESCRITURADO', 'NAO_ESCRITURAVEL', 'PENDENTE_REVISAO')`,
    ),
    check(
      'chk_docs_fiscais_escrituracao_coerencia',
      sql`(${table.escriturado} = false AND ${table.escrituracaoStatus} = 'NAO_ESCRITURAVEL') OR (${table.escriturado} = true AND ${table.escrituracaoStatus} IN ('ESCRITURADO', 'PENDENTE_REVISAO'))`,
    ),
    check('chk_docs_fiscais_valor', sql`${table.valorTotal} >= 0`),
    check(
      'chk_docs_fiscais_valor_declarado',
      sql`${table.valorTotalDeclaradoXml} IS NULL OR ${table.valorTotalDeclaradoXml} >= 0`,
    ),
    check(
      'chk_docs_fiscais_quantidade_itens_declarada',
      sql`${table.quantidadeItensDeclaradaXml} IS NULL OR ${table.quantidadeItensDeclaradaXml} >= 0`,
    ),
    check(
      'chk_docs_fiscais_integridade_status',
      sql`${table.integridadeStatus} IN ('NAO_CONFERIDA', 'OK', 'DIVERGENTE')`,
    ),
    check(
      'chk_docs_fiscais_integridade_coerencia',
      sql`(${table.integridadeConferida} = false AND ${table.integridadeStatus} = 'NAO_CONFERIDA') OR (${table.integridadeConferida} = true AND ${table.integridadeStatus} IN ('OK', 'DIVERGENTE'))`,
    ),
    check(
      'chk_docs_fiscais_cod_situacao_sped',
      sql`${table.codSituacaoSped} IS NULL OR ${table.codSituacaoSped} ~ '^[0-9]{2}$'`,
    ),
    check(
      'chk_docs_fiscais_modalidade_frete',
      sql`${table.modalidadeFrete} IS NULL OR ${table.modalidadeFrete} ~ '^[0-9]$'`,
    ),
    check(
      'chk_docs_fiscais_municipio_incidencia',
      sql`${table.municipioIncidencia} IS NULL OR ${table.municipioIncidencia} ~ '^[0-9]{7}$'`,
    ),
    check('chk_docs_fiscais_xml_key', sql`btrim(${table.xmlKey}) <> ''`),
  ],
);
