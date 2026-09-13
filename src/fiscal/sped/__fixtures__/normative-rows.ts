/**
 * Montadores de linhas "cru" (row DB) para as fixtures normativas de regressão
 * da Fase 0.
 *
 * IMPORTANTE (R5.1): estes helpers NÃO dependem de `makeInput`/`makeNfe`/
 * `makeItem` do builder nem do algoritmo de escrituração. Eles apenas montam
 * os `row` de banco (NF-e, item, CT-e) com valores explícitos, para que um
 * eventual erro do builder não seja replicado no oráculo que o valida.
 *
 * As fixtures declaram o INPUT (linhas cruas) e a EXPECTATIVA NORMATIVA campo a
 * campo (ver `normative-cases.ts`). O builder é o objeto sob teste; estes
 * arquivos são a referência independente.
 */
import type {
  SpedDocumentoCteBuilderData,
  SpedDocumentoNfeBuilderData,
  SpedEfdBuilderInput,
  SpedItemDocumentoBuilderData,
} from '../efd-icms-ipi.builder';

export const EMPRESA_CNPJ = '09157533000156';
export const INICIO_COMPETENCIA = new Date('2026-08-01T00:00:00.000Z');
export const FIM_COMPETENCIA = new Date('2026-08-31T00:00:00.000Z');

type DocumentoRow = SpedDocumentoNfeBuilderData['row'];
type ItemRow = SpedItemDocumentoBuilderData['row'];
type CteRow = SpedDocumentoCteBuilderData['cte'];

/**
 * Empresa industrial (indAtiv '0') por padrão, para que o Bloco E de IPI
 * (E500/E510/E520) seja emitido nas fixtures que exercitam IPI. Fixtures que
 * queiram um estabelecimento comercial ajustam `indAtiv`/classificacao.
 */
export function empresaFixture(
  overrides: Partial<SpedEfdBuilderInput['empresa']> = {},
): SpedEfdBuilderInput['empresa'] {
  return {
    razaoSocial: 'EMPRESA NORMATIVA LTDA',
    nomeFantasia: 'EMPRESA NORMATIVA',
    cnpj: EMPRESA_CNPJ,
    cpf: null,
    uf: 'SE',
    inscricaoEstadual: '271234567',
    codigoMunicipioIbge: '2800308',
    inscricaoMunicipal: null,
    suframa: null,
    cep: '49000000',
    logradouro: 'RUA FISCAL',
    numero: '100',
    complemento: null,
    bairro: 'CENTRO',
    telefone: null,
    fax: null,
    email: 'fiscal@example.com',
    perfil: 'A',
    indAtiv: '0',
    classificacaoEstabelecimentoIndustrial: '01',
    regimeTributario: 'LUCRO_REAL',
    ...overrides,
  };
}

export function contabilistaFixture(): SpedEfdBuilderInput['contabilista'] {
  return {
    nome: 'CONTADOR NORMATIVO',
    cpf: '12345678909',
    crc: 'SE12345O0',
    cnpj: null,
    cep: '49000000',
    logradouro: 'RUA CONTABIL',
    numero: '200',
    complemento: null,
    bairro: 'CENTRO',
    telefone: null,
    fax: null,
    email: 'contador@example.com',
    codigoMunicipioIbge: '2800308',
  };
}

/**
 * Envelope mínimo de input do builder. As fixtures preenchem apenas `nfe`/`cte`
 * (e `empresa` quando precisam de perfil diferente). Todo o resto é vazio para
 * isolar o cenário testado.
 */
export function inputFixture(
  overrides: Partial<SpedEfdBuilderInput> = {},
): SpedEfdBuilderInput {
  const { empresa: empresaOverride, ...rest } = overrides;
  const empresa = empresaOverride ?? empresaFixture();
  return {
    competencia: '2026-08',
    finalidade: '0',
    inicio: INICIO_COMPETENCIA,
    fim: FIM_COMPETENCIA,
    contabilista: contabilistaFixture(),
    participantes: [],
    unidades: [],
    itensCatalogo: [],
    informacoesComplementares: [],
    nfe: [],
    cte: [],
    saldos: [],
    ajustes: [],
    obrigacoes: [],
    responsabilidades: [],
    inventario: null,
    indicadores1010: {},
    inconsistencias: [],
    ...rest,
    empresa,
  };
}

export function documentoNfeRow(
  overrides: Partial<DocumentoRow> = {},
): DocumentoRow {
  return {
    id: 'nfe-doc-normativa',
    clienteId: 'cliente-normativo',
    chaveAcesso: '3'.repeat(44),
    nsu: 1,
    tipoDocumento: 'NFE',
    modelo: '55',
    serie: '1',
    numeroDocumento: '900',
    emitenteCnpjCpf: '12345678000199',
    emitenteRazaoSocial: 'FORNECEDOR NORMATIVO',
    destinatarioCnpjCpf: EMPRESA_CNPJ,
    destinatarioRazaoSocial: 'EMPRESA NORMATIVA LTDA',
    dataEmissao: new Date('2026-08-05T12:00:00.000Z'),
    dataEntradaSaida: new Date('2026-08-06T12:00:00.000Z'),
    valorTotal: '1000.00',
    valorTotalDeclaradoXml: '1000.00',
    totaisDeclaradosXml: {
      vNF: '1000.00',
      vProd: '1000.00',
      vDesc: '0.00',
      vFrete: '0.00',
      vSeg: '0.00',
      vOutro: '0.00',
      vBC: '1000.00',
      vICMS: '180.00',
      vBCST: '0.00',
      vST: '0.00',
      vIPI: '0.00',
      vPIS: '0.00',
      vCOFINS: '0.00',
    },
    quantidadeItensDeclaradaXml: 1,
    integridadeConferida: true,
    integridadeStatus: 'OK',
    integridadeDetalhes: null,
    codSituacaoSped: '00',
    modalidadeFrete: '9',
    informacoesComplementares: null,
    emitenteDados: null,
    destinatarioDados: null,
    situacao: 'AUTORIZADA',
    manifestacaoStatus: 'CONFIRMADA',
    tipoOperacaoEscriturada: 'ENTRADA',
    tpNfXml: '0',
    escriturado: true,
    escrituracaoStatus: 'ESCRITURADO',
    xmlKey: 'nfe/documento.xml',
    danfeKey: null,
    criadoEm: new Date('2026-08-05T12:00:00.000Z'),
    atualizadoEm: new Date('2026-08-05T12:00:00.000Z'),
    ...overrides,
  } as unknown as DocumentoRow;
}

export function itemRow(
  overrides: Partial<ItemRow> = {},
  codigoItem = 'ITEM-NORMATIVO',
): SpedItemDocumentoBuilderData {
  return {
    codigoItem,
    codigoUnidade: 'UN',
    row: {
      numeroItem: 1,
      informacoesAdicionais: null,
      quantidadeComercial: '1.0000',
      valorBrutoProduto: '1000.00',
      valorDesconto: '0.00',
      valorFrete: '0.00',
      valorSeguro: '0.00',
      valorOutrasDespesas: '0.00',
      valorFcpSt: '0.00',
      origemMercadoria: '0',
      cstIcms: '00',
      csosnIcms: null,
      cfop: '1101',
      valorBcIcms: '1000.00',
      aliquotaIcms: '18.00',
      valorIcms: '180.00',
      valorBcIcmsSt: '0.00',
      aliquotaIcmsSt: '0.00',
      valorIcmsSt: '0.00',
      valorCreditoIcmsSn: null,
      valorFcpUfDest: '0.00',
      valorIcmsUfDest: '0.00',
      valorIcmsUfRemetente: '0.00',
      cstIpi: null,
      codigoEnquadramentoIpi: null,
      valorBcIpi: null,
      aliquotaIpi: null,
      valorIpi: '0.00',
      cstPis: '01',
      valorBcPis: '1000.00',
      aliquotaPisPercentual: '1.65',
      quantidadeBcPis: null,
      aliquotaPisReais: null,
      valorPis: '16.50',
      valorPisSt: '0.00',
      cstCofins: '01',
      valorBcCofins: '1000.00',
      aliquotaCofinsPercentual: '7.60',
      quantidadeBcCofins: null,
      aliquotaCofinsReais: null,
      valorCofins: '76.00',
      valorCofinsSt: '0.00',
      codCtaSped: null,
      ...overrides,
    } as unknown as ItemRow,
  };
}

export function nfeFixture(
  rowOverrides: Partial<DocumentoRow> = {},
  itens: SpedItemDocumentoBuilderData[] = [itemRow()],
): SpedDocumentoNfeBuilderData {
  return {
    row: documentoNfeRow(rowOverrides),
    participanteCodigo: 'PART-1',
    participanteUf: 'BA',
    itens,
    codigoInformacaoComplementar: null,
  };
}

export function cteFixture(
  documentoOverrides: Partial<DocumentoRow> = {},
  cteOverrides: Partial<CteRow> = {},
): SpedDocumentoCteBuilderData {
  return {
    row: documentoNfeRow({
      id: 'cte-doc-normativa',
      chaveAcesso: '4'.repeat(44),
      tipoDocumento: 'CTE',
      modelo: '57',
      numeroDocumento: '910',
      valorTotal: '150.00',
      valorTotalDeclaradoXml: '150.00',
      totaisDeclaradosXml: null,
      ...documentoOverrides,
    }),
    participanteCodigo: 'TRANSPORTADORA-1',
    participanteUf: 'BA',
    cte: {
      id: 'cte-normativo',
      documentoFiscalId: 'cte-doc-normativa',
      clienteId: 'cliente-normativo',
      escrituravel: true,
      motivoNaoEscrituravel: null,
      tomadorCnpjCpf: EMPRESA_CNPJ,
      tomadorPapel: 'DESTINATARIO',
      tipoOperacaoEscriturada: 'ENTRADA',
      tpCte: '0',
      tpServ: '0',
      modal: '01',
      cfopXml: '1353',
      cfop: '1353',
      cfopRevisaoNecessaria: false,
      revisaoNecessaria: false,
      cstIcms: '000',
      csosnIcms: null,
      valorTotalServico: '150.00',
      valorReceber: '150.00',
      valorBcIcms: '100.00',
      aliquotaIcms: '12.00',
      valorIcms: '12.00',
      valorIcmsCreditavel: '12.00',
      valorTotalTributos: null,
      chaveCteReferenciado: null,
      codigoMunicipioOrigem: '2927408',
      codigoMunicipioDestino: '2800308',
      criadoEm: new Date('2026-08-05T12:00:00.000Z'),
      atualizadoEm: new Date('2026-08-05T12:00:00.000Z'),
      ...cteOverrides,
    } as unknown as CteRow,
  };
}
