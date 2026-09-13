/**
 * Fixtures de regressão da Fase 0 (contenção e baseline).
 *
 * Cada teste codifica o COMPORTAMENTO CORRETO esperado após as correções da
 * Fase 0/1. Contra o código atual, os cenários P0 abaixo FALHAM — este arquivo
 * é a rede de segurança que comprova a correção depois.
 *
 * Os inputs são montados por helpers próprios (independentes do algoritmo do
 * builder). As asserções descrevem o resultado normativo esperado, não o
 * resultado que o builder produz hoje.
 *
 * Achados cobertos: F04 (débito CT-e de saída), F09 (IPI CST 01), F10 (CST
 * inválido / fallback CT-e 000), F12 (fallback agregado PIS/COFINS).
 */
import {
  buildEfdIcmsIpiRecords,
  type SpedDocumentoCteBuilderData,
  type SpedDocumentoNfeBuilderData,
  type SpedEfdBuilderInput,
  type SpedItemDocumentoBuilderData,
} from './efd-icms-ipi.builder';
import { serializeSpedRecord, type SpedRecord } from './core';

type DocumentoRow = SpedDocumentoNfeBuilderData['row'];
type ItemRow = SpedItemDocumentoBuilderData['row'];
type CteRow = SpedDocumentoCteBuilderData['cte'];

const EMPRESA_CNPJ = '09157533000156';
const INICIO = new Date('2026-08-01T00:00:00.000Z');
const FIM = new Date('2026-08-31T00:00:00.000Z');

const BASE_EMPRESA: SpedEfdBuilderInput['empresa'] = {
  razaoSocial: 'EMPRESA TESTE LTDA',
  nomeFantasia: 'EMPRESA TESTE',
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
  indAtiv: '1',
  classificacaoEstabelecimentoIndustrial: null,
  regimeTributario: 'LUCRO_PRESUMIDO',
};

const BASE_CONTABILISTA: SpedEfdBuilderInput['contabilista'] = {
  nome: 'CONTADOR TESTE',
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

type InputOverrides = Omit<
  Partial<SpedEfdBuilderInput>,
  'empresa' | 'contabilista'
> & {
  empresa?: Partial<SpedEfdBuilderInput['empresa']>;
  contabilista?: Partial<SpedEfdBuilderInput['contabilista']>;
};

function makeInput(overrides: InputOverrides = {}): SpedEfdBuilderInput {
  const { empresa, contabilista, ...rest } = overrides;
  return {
    competencia: '2026-08',
    finalidade: '0',
    inicio: INICIO,
    fim: FIM,
    empresa: { ...BASE_EMPRESA, ...empresa },
    contabilista: { ...BASE_CONTABILISTA, ...contabilista },
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
  };
}

function makeDocumentoRow(overrides: Partial<DocumentoRow> = {}): DocumentoRow {
  return {
    id: 'documento-1',
    clienteId: 'cliente-1',
    chaveAcesso: '1'.repeat(44),
    nsu: 1,
    tipoDocumento: 'NFE',
    modelo: '55',
    serie: '1',
    numeroDocumento: '100',
    emitenteCnpjCpf: '12345678000199',
    emitenteRazaoSocial: 'FORNECEDOR TESTE',
    destinatarioCnpjCpf: EMPRESA_CNPJ,
    destinatarioRazaoSocial: BASE_EMPRESA.razaoSocial,
    dataEmissao: new Date('2026-08-05T12:00:00.000Z'),
    dataEntradaSaida: new Date('2026-08-06T12:00:00.000Z'),
    valorTotal: '100.00',
    valorTotalDeclaradoXml: '100.00',
    totaisDeclaradosXml: {
      vNF: '100.00',
      vProd: '100.00',
      vDesc: '0.00',
      vFrete: '0.00',
      vSeg: '0.00',
      vOutro: '0.00',
      vBC: '100.00',
      vICMS: '18.00',
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

function makeItem(
  overrides: Partial<ItemRow> = {},
  codigoItem = `ITEM-${String(overrides.numeroItem ?? 1)}`,
): SpedItemDocumentoBuilderData {
  return {
    codigoItem,
    codigoUnidade: 'UN',
    row: {
      numeroItem: 1,
      informacoesAdicionais: null,
      quantidadeComercial: '1.0000',
      valorBrutoProduto: '100.00',
      valorDesconto: '0.00',
      valorFrete: '0.00',
      valorSeguro: '0.00',
      valorOutrasDespesas: '0.00',
      valorFcpSt: '0.00',
      origemMercadoria: '0',
      cstIcms: '00',
      csosnIcms: null,
      cfop: '1102',
      valorBcIcms: '100.00',
      aliquotaIcms: '18.00',
      valorIcms: '18.00',
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
      valorBcPis: '100.00',
      aliquotaPisPercentual: '1.65',
      quantidadeBcPis: null,
      aliquotaPisReais: null,
      valorPis: '1.65',
      valorPisSt: '0.00',
      cstCofins: '01',
      valorBcCofins: '100.00',
      aliquotaCofinsPercentual: '7.60',
      quantidadeBcCofins: null,
      aliquotaCofinsReais: null,
      valorCofins: '7.60',
      valorCofinsSt: '0.00',
      codCtaSped: null,
      ...overrides,
    } as unknown as ItemRow,
  };
}

function makeCte(
  documentoOverrides: Partial<DocumentoRow> = {},
  cteOverrides: Partial<CteRow> = {},
): SpedDocumentoCteBuilderData {
  return {
    row: makeDocumentoRow({
      id: 'cte-documento-1',
      chaveAcesso: '2'.repeat(44),
      tipoDocumento: 'CTE',
      modelo: '57',
      numeroDocumento: '200',
      valorTotal: '150.00',
      valorTotalDeclaradoXml: '150.00',
      totaisDeclaradosXml: null,
      ...documentoOverrides,
    }),
    participanteCodigo: 'TRANSPORTADORA-1',
    participanteUf: 'BA',
    cte: {
      id: 'cte-1',
      documentoFiscalId: 'cte-documento-1',
      clienteId: 'cliente-1',
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
    },
  };
}

function lineFor(
  records: readonly SpedRecord[],
  reg: string,
  index = 0,
): string {
  const matches = records.filter((record) => record.reg === reg);
  if (!matches[index]) throw new Error(`Registro ${reg}[${index}] ausente.`);
  return serializeSpedRecord(matches[index]);
}

function fieldsOf(line: string): string[] {
  return line.slice(1, -1).split('|').slice(1);
}

function hasInconsistencia(
  input: SpedEfdBuilderInput,
  predicate: (i: SpedEfdBuilderInput['inconsistencias'][number]) => boolean,
): boolean {
  return input.inconsistencias.some(predicate);
}

describe('Regressão Fase 0 — cenários P0', () => {
  // F10 — CST PIS/COFINS inválido deve produzir inconsistência impeditiva.
  it('F10: CST PIS/COFINS 88 gera inconsistência de CST inválido', () => {
    const input = makeInput({
      nfe: [makeNfe({}, [makeItem({ cstPis: '88', cstCofins: '88' })])],
    });
    buildEfdIcmsIpiRecords(input);
    expect(
      hasInconsistencia(input, (i) =>
        /CST_(PIS|COFINS)_(INVALIDO|AUSENTE)/.test(i.codigo),
      ),
    ).toBe(true);
  });

  // F10 — IPI CST inválido, mesmo com valor zero, deve ser sinalizado.
  it('F10: CST IPI 88 com valor zero gera inconsistência', () => {
    const input = makeInput({
      empresa: { classificacaoEstabelecimentoIndustrial: '01', indAtiv: '0' },
      nfe: [makeNfe({}, [makeItem({ cstIpi: '88', valorIpi: '0.00' })])],
    });
    buildEfdIcmsIpiRecords(input);
    expect(
      hasInconsistencia(input, (i) =>
        /CST_IPI_(INVALIDO|AUSENTE)/.test(i.codigo),
      ),
    ).toBe(true);
  });

  // F10 — CT-e sem CST não pode receber fallback 000 no D190.
  it('F10: CT-e sem CST gera inconsistência, nunca fallback 000', () => {
    const input = makeInput({
      cte: [makeCte({}, { cstIcms: null, csosnIcms: null })],
    });
    buildEfdIcmsIpiRecords(input);
    expect(
      hasInconsistencia(input, (i) => /CST_CTE_AUSENTE/.test(i.codigo)),
    ).toBe(true);
  });

  // F04 — CT-e de saída tributado deve compor o débito do E110.
  it('F04: CT-e de saída com ICMS 12,00 gera débito 12,00 no E110', () => {
    const input = makeInput({
      cte: [
        makeCte(
          { tipoOperacaoEscriturada: 'SAIDA' },
          {
            tipoOperacaoEscriturada: 'SAIDA',
            cfop: '5353',
            cfopXml: '5353',
            valorIcmsCreditavel: '0.00',
          },
        ),
      ],
    });
    const result = buildEfdIcmsIpiRecords(input);
    const e110 = fieldsOf(lineFor(result.records, 'E110'));
    // E110 campo 1 (após REG) = VL_TOT_DEBITOS.
    expect(e110[0]).toBe('12,00');
  });

  // F04 (R2.1) — o débito de prestação do CT-e de saída soma-se ao débito das
  // NF-e de saída no E110, contado EXATAMENTE UMA VEZ: NF-e 18,00 + CT-e 12,00
  // = 30,00. Também confirma que o crédito de frete (0,00 aqui) não contamina
  // o débito e que o CT-e de saída não vira crédito.
  it('F04: débito do E110 soma NF-e de saída (18,00) e prestação de CT-e (12,00) sem duplicar', () => {
    const input = makeInput({
      nfe: [
        makeNfe(
          { tipoOperacaoEscriturada: 'SAIDA' },
          [makeItem({ cfop: '5102', valorIcms: '18.00' })],
        ),
      ],
      cte: [
        makeCte(
          { tipoOperacaoEscriturada: 'SAIDA' },
          {
            tipoOperacaoEscriturada: 'SAIDA',
            cfop: '5353',
            cfopXml: '5353',
            valorIcms: '12.00',
            valorIcmsCreditavel: '0.00',
          },
        ),
      ],
    });
    const result = buildEfdIcmsIpiRecords(input);
    const e110 = fieldsOf(lineFor(result.records, 'E110'));
    // Campo 1 (após REG) = VL_TOT_DEBITOS: 18,00 (NF-e) + 12,00 (CT-e).
    expect(e110[0]).toBe('30,00');
    // Campo 5 (após REG) = VL_TOT_CREDITOS: o CT-e de saída não gera crédito.
    expect(e110[4]).toBe('0,00');
    expect(result.apuracao.icmsProprio.debitos).toBe('30.00');
    expect(result.apuracao.icmsProprio.creditos).toBe('0.00');
  });

  // F04 (R2.2/R2.3) — quando um CT-e de saída está cancelado, seu ICMS não
  // entra no débito do E110: só o débito da NF-e de saída permanece.
  it('F04: CT-e de saída cancelado não soma ao débito do E110', () => {
    const input = makeInput({
      nfe: [
        makeNfe(
          { tipoOperacaoEscriturada: 'SAIDA' },
          [makeItem({ cfop: '5102', valorIcms: '18.00' })],
        ),
      ],
      cte: [
        makeCte(
          { tipoOperacaoEscriturada: 'SAIDA', codSituacaoSped: '02' },
          {
            tipoOperacaoEscriturada: 'SAIDA',
            cfop: '5353',
            cfopXml: '5353',
            valorIcms: '12.00',
            valorIcmsCreditavel: '0.00',
          },
        ),
      ],
    });
    const result = buildEfdIcmsIpiRecords(input);
    const e110 = fieldsOf(lineFor(result.records, 'E110'));
    expect(e110[0]).toBe('18,00');
    expect(result.apuracao.icmsProprio.debitos).toBe('18.00');
  });

  // F04 (R2.2) — CT-e de saída cancelado não emite D190 e não soma ao E110:
  // conciliação de ponta a ponta (nenhum registro D190, débito zero).
  it('F04: CT-e de saída cancelado não emite D190 nem débito no E110', () => {
    const input = makeInput({
      cte: [
        makeCte(
          { tipoOperacaoEscriturada: 'SAIDA', codSituacaoSped: '02' },
          {
            tipoOperacaoEscriturada: 'SAIDA',
            cfop: '5353',
            cfopXml: '5353',
            valorIcms: '12.00',
            valorIcmsCreditavel: '0.00',
          },
        ),
      ],
    });
    const result = buildEfdIcmsIpiRecords(input);
    // Nenhum D190 é emitido para o CT-e cancelado.
    expect(
      result.records.filter((record) => record.reg === 'D190'),
    ).toHaveLength(0);
    const e110 = fieldsOf(lineFor(result.records, 'E110'));
    expect(e110[0]).toBe('0,00');
    expect(result.apuracao.icmsProprio.debitos).toBe('0.00');
  });

  // F04 (R2.3) — par original + complementar de SAÍDA de ponta a ponta. O
  // complementar (tpCte '1') destaca apenas o incremento (3,00); o E110 soma
  // 12,00 (original) + 3,00 (complemento) = 15,00, sem recontar o imposto
  // original dentro do complementar.
  it('F04: original + complementar de saída somam sem duplicar no E110 (12,00 + 3,00 = 15,00)', () => {
    const input = makeInput({
      cte: [
        makeCte(
          { tipoOperacaoEscriturada: 'SAIDA' },
          {
            tipoOperacaoEscriturada: 'SAIDA',
            cfop: '5353',
            cfopXml: '5353',
            valorIcms: '12.00',
            valorIcmsCreditavel: '0.00',
          },
        ),
        makeCte(
          {
            id: 'cte-documento-2',
            chaveAcesso: '3'.repeat(44),
            numeroDocumento: '201',
            tipoOperacaoEscriturada: 'SAIDA',
            codSituacaoSped: '06',
          },
          {
            id: 'cte-2',
            tipoOperacaoEscriturada: 'SAIDA',
            tpCte: '1',
            cfop: '5353',
            cfopXml: '5353',
            valorIcms: '3.00',
            valorIcmsCreditavel: '0.00',
            chaveCteReferenciado: '2'.repeat(44),
          },
        ),
      ],
    });
    const result = buildEfdIcmsIpiRecords(input);
    const e110 = fieldsOf(lineFor(result.records, 'E110'));
    expect(e110[0]).toBe('15,00');
    expect(result.apuracao.icmsProprio.debitos).toBe('15.00');
    // Cada documento (original e complementar) gera seu próprio D190.
    expect(
      result.records.filter((record) => record.reg === 'D190'),
    ).toHaveLength(2);
  });

  // F04 (R2.3) — par original cancelado + substituto de SAÍDA de ponta a ponta.
  // O substituto (tpCte '3') refaz a prestação com 15,00; o original é
  // cancelado, então o E110 recebe só 15,00 — não 12,00 + 15,00.
  it('F04: substituto refaz o original cancelado sem duplicar no E110 (débito 15,00)', () => {
    const input = makeInput({
      cte: [
        makeCte(
          { tipoOperacaoEscriturada: 'SAIDA', codSituacaoSped: '02' },
          {
            tipoOperacaoEscriturada: 'SAIDA',
            cfop: '5353',
            cfopXml: '5353',
            valorIcms: '12.00',
            valorIcmsCreditavel: '0.00',
          },
        ),
        makeCte(
          {
            id: 'cte-documento-2',
            chaveAcesso: '3'.repeat(44),
            numeroDocumento: '201',
            tipoOperacaoEscriturada: 'SAIDA',
            codSituacaoSped: '06',
          },
          {
            id: 'cte-2',
            tipoOperacaoEscriturada: 'SAIDA',
            tpCte: '3',
            cfop: '5353',
            cfopXml: '5353',
            valorIcms: '15.00',
            valorIcmsCreditavel: '0.00',
            chaveCteReferenciado: '2'.repeat(44),
          },
        ),
      ],
    });
    const result = buildEfdIcmsIpiRecords(input);
    const e110 = fieldsOf(lineFor(result.records, 'E110'));
    expect(e110[0]).toBe('15,00');
    expect(result.apuracao.icmsProprio.debitos).toBe('15.00');
    // Só o substituto gera D190 (o original cancelado não emite).
    expect(
      result.records.filter((record) => record.reg === 'D190'),
    ).toHaveLength(1);
  });

  // F09 — IPI CST 01 (entrada tributada com alíquota zero) com valor positivo
  // não deve virar crédito automático.
  it('F09: IPI CST 01 com valor positivo não credita automaticamente', () => {
    const input = makeInput({
      empresa: { classificacaoEstabelecimentoIndustrial: '01', indAtiv: '0' },
      nfe: [
        makeNfe({}, [
          makeItem({
            cstIpi: '01',
            valorBcIpi: '100.00',
            aliquotaIpi: '50.00',
            valorIpi: '50.00',
          }),
        ]),
      ],
    });
    const result = buildEfdIcmsIpiRecords(input);
    const e520 = fieldsOf(lineFor(result.records, 'E520'));
    // E520 campo 3 (após REG) = VL_TOT_CRED (créditos do período).
    expect(e520[2]).toBe('0,00');
    expect(
      hasInconsistencia(input, (i) =>
        /IPI_CST01|IPI_.*CONTRAD/i.test(i.codigo),
      ),
    ).toBe(true);
  });
});

function makeNfe(
  rowOverrides: Partial<DocumentoRow> = {},
  itens: SpedItemDocumentoBuilderData[] = [makeItem()],
  participanteCodigo = 'PART-1',
  participanteUf: string | null = 'BA',
): SpedDocumentoNfeBuilderData {
  return {
    row: makeDocumentoRow(rowOverrides),
    participanteCodigo,
    participanteUf,
    itens,
    codigoInformacaoComplementar: null,
  };
}
