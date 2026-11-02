import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
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
import { documentosFiscais } from './documentos_fiscais';

export const documentosFiscaisItens = pgTable(
  'documentos_fiscais_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentoFiscalId: uuid('documento_fiscal_id').notNull(),
    clienteId: uuid('cliente_id').notNull(),
    numeroItem: integer('numero_item').notNull(),
    codigoProduto: text('codigo_produto').notNull(),
    codigoEan: text('codigo_ean'),
    descricao: text('descricao').notNull(),
    ncm: varchar('ncm', { length: 8 }),
    nve: text('nve'),
    cest: varchar('cest', { length: 7 }),
    indEscala: varchar('ind_escala', { length: 1 }),
    cnpjFabricante: varchar('cnpj_fabricante', { length: 14 }),
    codigoBeneficioFiscal: text('codigo_beneficio_fiscal'),
    cfopXml: varchar('cfop_xml', { length: 4 }),
    cfop: varchar('cfop', { length: 4 }).notNull(),
    tipoOperacaoEscriturada: varchar('tipo_operacao_escriturada', {
      length: 10,
    })
      .notNull()
      .default('ENTRADA'),
    cfopRevisaoNecessaria: boolean('cfop_revisao_necessaria')
      .notNull()
      .default(false),
    // Destinação econômica atribuída pelo usuário (override manual) que
    // realimenta o motor de regras para re-resolver o CFOP escriturado.
    destinacaoMercadoria: varchar('destinacao_mercadoria', { length: 20 }),
    destinacaoInferida: varchar('destinacao_inferida', { length: 20 }),
    destinacaoOrigem: varchar('destinacao_origem', { length: 20 }),
    destinacaoConfianca: numeric('destinacao_confianca', {
      precision: 4,
      scale: 3,
    }),
    destinacaoJustificativa: text('destinacao_justificativa'),
    cfopManual: boolean('cfop_manual').notNull().default(false),
    cfopOrigemResolucao: varchar('cfop_origem_resolucao', { length: 30 }),
    cfopMotivoResolucao: text('cfop_motivo_resolucao'),

    unidadeComercial: varchar('unidade_comercial', { length: 10 }).notNull(),
    quantidadeComercial: numeric('quantidade_comercial', {
      precision: 15,
      scale: 4,
    }).notNull(),
    valorUnitarioComercial: numeric('valor_unitario_comercial', {
      precision: 21,
      scale: 10,
    }).notNull(),
    valorBrutoProduto: numeric('valor_bruto_produto', {
      precision: 15,
      scale: 2,
    }).notNull(),
    codigoEanTributavel: text('codigo_ean_tributavel'),
    unidadeTributavel: varchar('unidade_tributavel', { length: 10 }),
    quantidadeTributavel: numeric('quantidade_tributavel', {
      precision: 15,
      scale: 4,
    }),
    valorUnitarioTributavel: numeric('valor_unitario_tributavel', {
      precision: 21,
      scale: 10,
    }),
    valorFrete: numeric('valor_frete', { precision: 15, scale: 2 }),
    valorSeguro: numeric('valor_seguro', { precision: 15, scale: 2 }),
    valorDesconto: numeric('valor_desconto', { precision: 15, scale: 2 }),
    valorOutrasDespesas: numeric('valor_outras_despesas', {
      precision: 15,
      scale: 2,
    }),
    indTotal: varchar('ind_total', { length: 1 }).notNull(),
    numeroPedidoCompra: text('numero_pedido_compra'),
    itemPedidoCompra: text('item_pedido_compra'),
    informacoesAdicionais: text('informacoes_adicionais'),
    codObsSped: varchar('cod_obs_sped', { length: 6 }),
    codCtaSped: text('cod_cta_sped'),

    origemMercadoria: varchar('origem_mercadoria', { length: 1 }),
    cstIcms: varchar('cst_icms', { length: 3 }),
    csosnIcms: varchar('csosn_icms', { length: 4 }),
    modalidadeBcIcms: varchar('modalidade_bc_icms', { length: 1 }),
    percentualReducaoBcIcms: numeric('percentual_reducao_bc_icms', {
      precision: 7,
      scale: 4,
    }),
    valorBcIcms: numeric('valor_bc_icms', { precision: 15, scale: 2 }),
    aliquotaIcms: numeric('aliquota_icms', { precision: 7, scale: 4 }),
    valorIcms: numeric('valor_icms', { precision: 15, scale: 2 }),
    modalidadeBcIcmsSt: varchar('modalidade_bc_icms_st', { length: 1 }),
    percentualMvaSt: numeric('percentual_mva_st', {
      precision: 7,
      scale: 4,
    }),
    percentualReducaoBcIcmsSt: numeric('percentual_reducao_bc_icms_st', {
      precision: 7,
      scale: 4,
    }),
    valorBcIcmsSt: numeric('valor_bc_icms_st', { precision: 15, scale: 2 }),
    aliquotaIcmsSt: numeric('aliquota_icms_st', {
      precision: 7,
      scale: 4,
    }),
    valorIcmsSt: numeric('valor_icms_st', { precision: 15, scale: 2 }),
    valorBcFcp: numeric('valor_bc_fcp', { precision: 15, scale: 2 }),
    aliquotaFcp: numeric('aliquota_fcp', { precision: 7, scale: 4 }),
    valorFcp: numeric('valor_fcp', { precision: 15, scale: 2 }),
    valorBcFcpSt: numeric('valor_bc_fcp_st', { precision: 15, scale: 2 }),
    aliquotaFcpSt: numeric('aliquota_fcp_st', { precision: 7, scale: 4 }),
    valorFcpSt: numeric('valor_fcp_st', { precision: 15, scale: 2 }),
    motivoDesoneracaoIcms: varchar('motivo_desoneracao_icms', { length: 2 }),
    valorIcmsDesonerado: numeric('valor_icms_desonerado', {
      precision: 15,
      scale: 2,
    }),
    percentualDiferimento: numeric('percentual_diferimento', {
      precision: 7,
      scale: 4,
    }),
    valorIcmsDiferido: numeric('valor_icms_diferido', {
      precision: 15,
      scale: 2,
    }),
    valorIcmsOperacao: numeric('valor_icms_operacao', {
      precision: 15,
      scale: 2,
    }),
    aliquotaCreditoSn: numeric('aliquota_credito_sn', {
      precision: 7,
      scale: 4,
    }),
    valorCreditoIcmsSn: numeric('valor_credito_icms_sn', {
      precision: 15,
      scale: 2,
    }),
    valorBcIcmsStRetido: numeric('valor_bc_icms_st_retido', {
      precision: 15,
      scale: 2,
    }),
    aliquotaIcmsStRetido: numeric('aliquota_icms_st_retido', {
      precision: 7,
      scale: 4,
    }),
    valorIcmsStRetido: numeric('valor_icms_st_retido', {
      precision: 15,
      scale: 2,
    }),

    valorBcIcmsUfDest: numeric('valor_bc_icms_uf_dest', {
      precision: 15,
      scale: 2,
    }),
    valorBcFcpUfDest: numeric('valor_bc_fcp_uf_dest', {
      precision: 15,
      scale: 2,
    }),
    percentualFcpUfDest: numeric('percentual_fcp_uf_dest', {
      precision: 7,
      scale: 4,
    }),
    aliquotaIcmsUfDest: numeric('aliquota_icms_uf_dest', {
      precision: 7,
      scale: 4,
    }),
    aliquotaIcmsInterestadual: numeric('aliquota_icms_interestadual', {
      precision: 7,
      scale: 4,
    }),
    percentualProvisorioPartilha: numeric('percentual_provisorio_partilha', {
      precision: 7,
      scale: 4,
    }),
    valorFcpUfDest: numeric('valor_fcp_uf_dest', {
      precision: 15,
      scale: 2,
    }),
    valorIcmsUfDest: numeric('valor_icms_uf_dest', {
      precision: 15,
      scale: 2,
    }),
    valorIcmsUfRemetente: numeric('valor_icms_uf_remetente', {
      precision: 15,
      scale: 2,
    }),

    cstIpi: varchar('cst_ipi', { length: 2 }),
    classeEnquadramentoIpi: varchar('classe_enquadramento_ipi', { length: 5 }),
    codigoEnquadramentoIpi: varchar('codigo_enquadramento_ipi', { length: 3 }),
    cnpjProdutorIpi: varchar('cnpj_produtor_ipi', { length: 14 }),
    valorBcIpi: numeric('valor_bc_ipi', { precision: 15, scale: 2 }),
    aliquotaIpi: numeric('aliquota_ipi', { precision: 7, scale: 4 }),
    quantidadeUnidadeIpi: numeric('quantidade_unidade_ipi', {
      precision: 15,
      scale: 4,
    }),
    valorUnidadeIpi: numeric('valor_unidade_ipi', {
      precision: 15,
      scale: 4,
    }),
    valorIpi: numeric('valor_ipi', { precision: 15, scale: 2 }),

    cstPis: varchar('cst_pis', { length: 2 }),
    valorBcPis: numeric('valor_bc_pis', { precision: 15, scale: 2 }),
    aliquotaPisPercentual: numeric('aliquota_pis_percentual', {
      precision: 7,
      scale: 4,
    }),
    quantidadeBcPis: numeric('quantidade_bc_pis', {
      precision: 15,
      scale: 4,
    }),
    aliquotaPisReais: numeric('aliquota_pis_reais', {
      precision: 15,
      scale: 4,
    }),
    valorPis: numeric('valor_pis', { precision: 15, scale: 2 }),
    valorBcPisSt: numeric('valor_bc_pis_st', { precision: 15, scale: 2 }),
    aliquotaPisStPercentual: numeric('aliquota_pis_st_percentual', {
      precision: 7,
      scale: 4,
    }),
    valorPisSt: numeric('valor_pis_st', { precision: 15, scale: 2 }),

    cstCofins: varchar('cst_cofins', { length: 2 }),
    valorBcCofins: numeric('valor_bc_cofins', { precision: 15, scale: 2 }),
    aliquotaCofinsPercentual: numeric('aliquota_cofins_percentual', {
      precision: 7,
      scale: 4,
    }),
    quantidadeBcCofins: numeric('quantidade_bc_cofins', {
      precision: 15,
      scale: 4,
    }),
    aliquotaCofinsReais: numeric('aliquota_cofins_reais', {
      precision: 15,
      scale: 4,
    }),
    valorCofins: numeric('valor_cofins', { precision: 15, scale: 2 }),
    valorBcCofinsSt: numeric('valor_bc_cofins_st', {
      precision: 15,
      scale: 2,
    }),
    aliquotaCofinsStPercentual: numeric('aliquota_cofins_st_percentual', {
      precision: 7,
      scale: 4,
    }),
    valorCofinsSt: numeric('valor_cofins_st', {
      precision: 15,
      scale: 2,
    }),

    valorBcIi: numeric('valor_bc_ii', { precision: 15, scale: 2 }),
    valorDespesaAduaneira: numeric('valor_despesa_aduaneira', {
      precision: 15,
      scale: 2,
    }),
    valorImpostoImportacao: numeric('valor_imposto_importacao', {
      precision: 15,
      scale: 2,
    }),
    valorIof: numeric('valor_iof', { precision: 15, scale: 2 }),
    valorTributosAproximados: numeric('valor_tributos_aproximados', {
      precision: 15,
      scale: 2,
    }),
    valorBcIss: numeric('valor_bc_iss', { precision: 15, scale: 2 }),
    aliquotaIss: numeric('aliquota_iss', { precision: 7, scale: 4 }),
    valorIss: numeric('valor_iss', { precision: 15, scale: 2 }),
    issRetido: boolean('iss_retido').notNull().default(false),
    itemListaServico: varchar('item_lista_servico', { length: 10 }),
    cnae: varchar('cnae', { length: 7 }),
    codigoTributacaoMunicipio: varchar('codigo_tributacao_municipio', {
      length: 20,
    }),
    exigibilidadeIss: varchar('exigibilidade_iss', { length: 1 }),
    municipioIncidencia: varchar('municipio_incidencia', { length: 7 }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_df_itens_documento_fiscal',
      columns: [table.documentoFiscalId],
      foreignColumns: [documentosFiscais.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_df_itens_cliente',
      columns: [table.clienteId],
      foreignColumns: [clientes.id],
    }).onDelete('cascade'),
    uniqueIndex('uidx_item_doc_num').on(
      table.documentoFiscalId,
      table.numeroItem,
    ),
    index('idx_item_cliente_id').on(table.clienteId),
    index('idx_item_cfop').on(table.cfop),
    index('idx_item_cfop_xml').on(table.cfopXml),
    index('idx_item_operacao_escriturada').on(table.tipoOperacaoEscriturada),
    index('idx_item_cst_icms').on(table.cstIcms),
    index('idx_item_csosn_icms').on(table.csosnIcms),
    index('idx_item_cst_pis').on(table.cstPis),
    index('idx_item_cst_cofins').on(table.cstCofins),
    index('idx_item_ncm').on(table.ncm),
    index('idx_item_servico_lc116').on(table.itemListaServico),
    index('idx_item_cnae').on(table.cnae),
    check(
      'chk_item_destinacao_inferida',
      sql`${table.destinacaoInferida} IS NULL OR ${table.destinacaoInferida} IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')`,
    ),
    check(
      'chk_item_destinacao_confianca',
      sql`${table.destinacaoConfianca} IS NULL OR ${table.destinacaoConfianca} BETWEEN 0 AND 1`,
    ),
    check(
      'chk_item_destinacao_origem',
      sql`${table.destinacaoOrigem} IS NULL OR ${table.destinacaoOrigem} IN ('MANUAL', 'HISTORICO', 'NCM_PERFIL', 'HEURISTICA', 'INDETERMINADO')`,
    ),
    check('chk_item_numero', sql`${table.numeroItem} BETWEEN 1 AND 990`),
    check(
      'chk_item_ind_escala',
      sql`${table.indEscala} IS NULL OR ${table.indEscala} IN ('S', 'N')`,
    ),
    check('chk_item_ind_total', sql`${table.indTotal} IN ('0', '1')`),
    check(
      'chk_item_origem',
      sql`${table.origemMercadoria} IS NULL OR ${table.origemMercadoria} ~ '^[0-8]$'`,
    ),
    check('chk_item_cfop', sql`${table.cfop} ~ '^[1-7][0-9]{3}$'`),
    check(
      'chk_item_cfop_xml',
      sql`${table.cfopXml} IS NULL OR ${table.cfopXml} ~ '^[1-7][0-9]{3}$'`,
    ),
    check(
      'chk_item_operacao_escriturada',
      sql`${table.tipoOperacaoEscriturada} IN ('ENTRADA', 'SAIDA')`,
    ),
    check(
      'chk_item_destinacao',
      sql`${table.destinacaoMercadoria} IS NULL OR ${table.destinacaoMercadoria} IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')`,
    ),
    check(
      'chk_item_cnae',
      sql`${table.cnae} IS NULL OR ${table.cnae} ~ '^[0-9]{7}$'`,
    ),
    check(
      'chk_item_municipio_incidencia',
      sql`${table.municipioIncidencia} IS NULL OR ${table.municipioIncidencia} ~ '^[0-9]{7}$'`,
    ),
  ],
);
