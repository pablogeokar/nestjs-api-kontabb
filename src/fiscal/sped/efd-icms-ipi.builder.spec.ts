import {
  buildSpedFile,
  serializeSpedRecord,
  type SpedRecord,
  validateSpedFile,
} from './core';
import {
  buildEfdIcmsIpiRecords,
  type SpedDocumentoCteBuilderData,
  type SpedDocumentoNfeBuilderData,
  type SpedEfdBuilderInput,
  type SpedItemDocumentoBuilderData,
} from './efd-icms-ipi.builder';

type DocumentoRow = SpedDocumentoNfeBuilderData['row'];
type ItemRow = SpedItemDocumentoBuilderData['row'];
type CteRow = SpedDocumentoCteBuilderData['cte'];
type SaldoRow = SpedEfdBuilderInput['saldos'][number];
type AjusteRow = SpedEfdBuilderInput['ajustes'][number];
type ObrigacaoRow = SpedEfdBuilderInput['obrigacoes'][number];
type InventarioRow = NonNullable<SpedEfdBuilderInput['inventario']>['row'];
type InventarioItemRow = NonNullable<
  SpedEfdBuilderInput['inventario']
>['itens'][number]['row'];

type InputOverrides = Omit<
  Partial<SpedEfdBuilderInput>,
  'empresa' | 'contabilista'
> & {
  empresa?: Partial<SpedEfdBuilderInput['empresa']>;
  contabilista?: Partial<SpedEfdBuilderInput['contabilista']>;
};

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

function makeSaldo(overrides: Partial<SaldoRow> = {}): SaldoRow {
  return {
    tipo: 'ICMS_PROPRIO',
    uf: null,
    saldoCredorAnterior: '0.00',
    ...overrides,
  } as unknown as SaldoRow;
}

function makeAjuste(overrides: Partial<AjusteRow> = {}): AjusteRow {
  return {
    registro: 'E111',
    codigoAjuste: 'SE000001',
    descricao: 'AJUSTE DE TESTE',
    valor: '10.00',
    indicador: 'ESTORNO_DEBITO',
    uf: null,
    numeroDocumento: null,
    ...overrides,
  } as unknown as AjusteRow;
}

function makeObrigacao(overrides: Partial<ObrigacaoRow>): ObrigacaoRow {
  return {
    tipo: 'ICMS_PROPRIO',
    uf: null,
    codigoObrigacao: '000',
    valor: '0.00',
    dataVencimento: '2026-09-10',
    codigoReceita: '1000',
    numeroProcesso: null,
    indicadorProcesso: null,
    processo: null,
    textoComplementar: null,
    mesReferencia: '082026',
    ...overrides,
  } as unknown as ObrigacaoRow;
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

function regs(records: readonly SpedRecord[], block: string): string[] {
  return records
    .filter((record) => record.reg.startsWith(block))
    .map((record) => record.reg);
}

describe('buildEfdIcmsIpiRecords', () => {
  it('gera E100/E110 zerados e todos os shells no arquivo minimo sem movimento', () => {
    const result = buildEfdIcmsIpiRecords(makeInput());
    const file = buildSpedFile({ records: result.records });

    expect(lineFor(result.records, 'E100')).toBe('|E100|01082026|31082026|');
    expect(lineFor(result.records, 'E110')).toBe(
      '|E110|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
    );
    expect(file.lines).toEqual(
      expect.arrayContaining([
        '|B001|1|',
        '|C001|1|',
        '|D001|1|',
        '|E001|0|',
        '|G001|1|',
        '|H001|1|',
        '|K001|1|',
      ]),
    );
    expect(file.blockCounts).toMatchObject({ '0': 5, E: 4, '1': 3 });
    expect(file.totalLines).toBe(55);
    expect(file.lines.at(-2)).toBe(`|9990|${file.blockCounts['9']}|`);
    expect(file.lines.at(-1)).toBe('|9999|55|');
    expect(
      validateSpedFile(file.bytes, { strictFieldCounts: true }),
    ).toMatchObject({ valid: true, issues: [] });
  });

  it('mantem C170 e C190 subordinados ao respectivo C100', () => {
    const primeiro = makeNfe(
      { id: 'nfe-1', numeroDocumento: '101', chaveAcesso: '1'.repeat(44) },
      [
        makeItem({ numeroItem: 1, valorBrutoProduto: '60.00' }, 'ITEM-A'),
        makeItem({ numeroItem: 2, valorBrutoProduto: '40.00' }, 'ITEM-B'),
      ],
    );
    const segundo = makeNfe(
      { id: 'nfe-2', numeroDocumento: '102', chaveAcesso: '2'.repeat(44) },
      [makeItem({ numeroItem: 1, valorBrutoProduto: '80.00' }, 'ITEM-C')],
    );
    const result = buildEfdIcmsIpiRecords(
      makeInput({ nfe: [primeiro, segundo] }),
    );
    const blocoC = result.records.filter((record) =>
      record.reg.startsWith('C'),
    );

    expect(blocoC.map((record) => record.reg)).toEqual([
      'C100',
      'C170',
      'C170',
      'C190',
      'C100',
      'C170',
      'C190',
    ]);
    expect(fieldsOf(serializeSpedRecord(blocoC[1]))).toHaveLength(37);
    expect(fieldsOf(serializeSpedRecord(blocoC[1])).slice(0, 6)).toEqual([
      '1',
      'ITEM-A',
      '',
      '1,0000',
      'UN',
      '60,00',
    ]);
    expect(fieldsOf(serializeSpedRecord(blocoC[3]))[3]).toBe('100,00');
    expect(fieldsOf(serializeSpedRecord(blocoC[6]))[3]).toBe('80,00');
  });

  it('nao informa reducao de base no C190 apenas por a operacao ser isenta', () => {
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        nfe: [
          makeNfe({}, [
            makeItem({
              cstIcms: '40',
              valorBcIcms: '0.00',
              valorIcms: '0.00',
              percentualReducaoBcIcms: null,
            }),
          ]),
        ],
      }),
    );

    expect(fieldsOf(lineFor(result.records, 'C190'))[8]).toBe('0,00');
  });

  it.each([
    {
      caso: 'NFC-e',
      empresa: {},
      documento: { modelo: '65', tipoDocumento: 'NFCE' },
    },
    {
      caso: 'perfil C',
      empresa: { perfil: 'C' as const },
      documento: {},
    },
    {
      caso: 'emissao propria',
      empresa: {},
      documento: { emitenteCnpjCpf: EMPRESA_CNPJ },
    },
  ])('nao gera C170 para $caso, mas conserva C100/C190', (cenario) => {
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        empresa: cenario.empresa,
        nfe: [makeNfe(cenario.documento)],
      }),
    );

    expect(regs(result.records, 'C')).toEqual(['C100', 'C190']);
  });

  it('gera D100/D190 com os campos fiscais e contagens do CT-e', () => {
    const result = buildEfdIcmsIpiRecords(makeInput({ cte: [makeCte()] }));
    const file = buildSpedFile({ records: result.records });
    const d100 = fieldsOf(lineFor(result.records, 'D100'));
    const d190 = fieldsOf(lineFor(result.records, 'D190'));

    expect(regs(result.records, 'D')).toEqual(['D100', 'D190']);
    expect(d100).toHaveLength(24);
    expect(d100.slice(0, 11)).toEqual([
      '0',
      '1',
      'TRANSPORTADORA-1',
      '57',
      '00',
      '1',
      '',
      '200',
      '22222222222222222222222222222222222222222222',
      '05082026',
      '06082026',
    ]);
    expect(d100.slice(16, 20)).toEqual(['150,00', '100,00', '12,00', '50,00']);
    expect(d190).toEqual([
      '000',
      '1353',
      '12,00',
      '150,00',
      '100,00',
      '12,00',
      '0',
      '',
    ]);
    expect(file.lines).toContain('|D001|0|');
    expect(file.lines).toContain('|D990|4|');
  });

  it('mantem os tributos documentais do CT-e complementar sem apropriar credito indevido', () => {
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        cte: [
          makeCte(
            { codSituacaoSped: '06' },
            { tpCte: '1', valorIcmsCreditavel: '0.00' },
          ),
        ],
      }),
    );
    const d100 = fieldsOf(lineFor(result.records, 'D100'));
    const d190 = fieldsOf(lineFor(result.records, 'D190'));
    const e110 = fieldsOf(lineFor(result.records, 'E110'));

    expect(d100[4]).toBe('06');
    expect(d100[9]).toBe('05082026');
    expect(d100[13]).toBe('150,00');
    expect(d100[17]).toBe('100,00');
    expect(d100[18]).toBe('12,00');
    expect(d190[4]).toBe('100,00');
    expect(d190[5]).toBe('12,00');
    expect(e110[4]).toBe('0,00');
  });

  it('leva o credito do CT-e uma unica vez para o ICMS proprio', () => {
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        cte: [
          makeCte({}, { valorIcmsCreditavel: '12.00' }),
          makeCte(
            {
              id: 'cte-documento-2',
              numeroDocumento: '201',
              chaveAcesso: '3'.repeat(44),
            },
            { id: 'cte-2', valorIcmsCreditavel: '8.00' },
          ),
        ],
      }),
    );
    const e110 = fieldsOf(lineFor(result.records, 'E110'));

    expect(result.apuracao.icmsProprio.creditos).toBe('20.00');
    expect(e110[4]).toBe('20,00');
    expect(e110[12]).toBe('20,00');
    expect(
      result.records.filter((record) => record.reg === 'D190'),
    ).toHaveLength(2);
  });

  it('nao apropria automaticamente credito de entrada com CST ambiguo', () => {
    const inconsistencias: SpedEfdBuilderInput['inconsistencias'] = [];
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        inconsistencias,
        nfe: [makeNfe({}, [makeItem({ cstIcms: '90', valorIcms: '18.00' })])],
      }),
    );

    expect(result.apuracao.icmsProprio.creditos).toBe('0.00');
    expect(inconsistencias).toContainEqual(
      expect.objectContaining({
        codigo: 'ICMS_CREDITO_EXIGE_REVISAO',
        severidade: 'ERRO',
        documentoId: 'documento-1',
      }),
    );
  });

  it('nao credita ICMS em compra de uso/consumo (1556) mesmo com CST 00', () => {
    const inconsistencias: SpedEfdBuilderInput['inconsistencias'] = [];
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        inconsistencias,
        nfe: [
          makeNfe({}, [
            makeItem({ cfop: '1556', cstIcms: '00', valorIcms: '18.00' }),
          ]),
        ],
      }),
    );

    // Vedação legal (LC 87/96 art. 33, I): sem crédito e sem falso positivo.
    expect(result.apuracao.icmsProprio.creditos).toBe('0.00');
    expect(inconsistencias).not.toContainEqual(
      expect.objectContaining({ codigo: 'ICMS_CREDITO_EXIGE_REVISAO' }),
    );
  });

  it('nao credita ICMS em aquisicao como substituido (1403) mesmo com CST 00', () => {
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        nfe: [
          makeNfe({}, [
            makeItem({ cfop: '1403', cstIcms: '00', valorIcms: '10.00' }),
          ]),
        ],
      }),
    );

    expect(result.apuracao.icmsProprio.creditos).toBe('0.00');
  });

  it('mantem o E110 integralmente zerado para optante do Simples obrigado a EFD', () => {
    const saida = makeNfe(
      {
        tipoOperacaoEscriturada: 'SAIDA',
        emitenteCnpjCpf: EMPRESA_CNPJ,
      },
      [makeItem({ valorIcms: '18.00', cfop: '5102' })],
    );
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        empresa: { regimeTributario: 'SIMPLES_NACIONAL' },
        nfe: [saida],
        cte: [makeCte()],
      }),
    );

    expect(fieldsOf(lineFor(result.records, 'E110'))).toEqual(
      Array<string>(14).fill('0,00'),
    );
    expect(result.apuracao.icmsProprio).toMatchObject({
      debitos: '0.00',
      creditos: '0.00',
      saldoApurado: '0.00',
      icmsRecolher: '0.00',
      saldoCredorTransportar: '0.00',
    });
  });

  it('ignora ajustes E111 no E110 zerado do Simples Nacional', () => {
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        empresa: { regimeTributario: 'SIMPLES_NACIONAL' },
        ajustes: [makeAjuste({ indicador: 'DEBITO' })],
      }),
    );

    expect(fieldsOf(lineFor(result.records, 'E110'))).toEqual(
      Array<string>(14).fill('0,00'),
    );
    expect(result.records.some((record) => record.reg === 'E111')).toBe(false);
  });

  it('gera 0002 e a apuracao E500/E510/E520 para estabelecimento industrial', () => {
    const saida = makeNfe(
      {
        tipoOperacaoEscriturada: 'SAIDA',
        emitenteCnpjCpf: EMPRESA_CNPJ,
      },
      [
        makeItem({
          cfop: '5101',
          cstIpi: '50',
          valorBcIpi: '100.00',
          aliquotaIpi: '5.00',
          valorIpi: '5.00',
        }),
      ],
    );
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        empresa: {
          indAtiv: '0',
          classificacaoEstabelecimentoIndustrial: '2099',
        },
        nfe: [saida],
      }),
    );

    expect(lineFor(result.records, '0002')).toBe('|0002|2099|');
    expect(lineFor(result.records, 'E500')).toBe('|E500|0|01082026|31082026|');
    expect(lineFor(result.records, 'E510')).toBe(
      '|E510|5101|50|105,00|100,00|5,00|',
    );
    expect(lineFor(result.records, 'E520')).toBe(
      '|E520|0,00|5,00|0,00|0,00|0,00|0,00|5,00|',
    );
    expect(result.apuracao.ipi).toEqual({
      debitos: '5.00',
      creditos: '0.00',
      saldoCredorAnterior: '0.00',
      recolher: '5.00',
      saldoCredorTransportar: '0.00',
    });
  });

  it('nao apropria credito de IPI de entrada com CST invalido/ambiguo', () => {
    const inconsistencias: SpedEfdBuilderInput['inconsistencias'] = [];
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        empresa: {
          indAtiv: '0',
          classificacaoEstabelecimentoIndustrial: '2099',
        },
        inconsistencias,
        nfe: [
          makeNfe({}, [
            makeItem({
              // CST 98 não pertence à faixa válida de entrada (00-49): ambíguo.
              cstIpi: '98',
              valorBcIpi: '100.00',
              aliquotaIpi: '5.00',
              valorIpi: '5.00',
            }),
          ]),
        ],
      }),
    );

    expect(result.apuracao.ipi?.creditos).toBe('0.00');
    expect(inconsistencias).toContainEqual(
      expect.objectContaining({
        codigo: 'IPI_CREDITO_EXIGE_REVISAO',
        severidade: 'ERRO',
      }),
    );
  });

  it('nao gera falso positivo de IPI para CSTs de entrada e saida validos', () => {
    const inconsistencias: SpedEfdBuilderInput['inconsistencias'] = [];
    const entrada = makeNfe({ id: 'ent-1', chaveAcesso: '4'.repeat(44) }, [
      // CST 49 (outras entradas) é válido e não credita: sem erro.
      makeItem({ cstIpi: '49', valorBcIpi: '100.00', valorIpi: '5.00' }),
    ]);
    const saida = makeNfe(
      {
        id: 'sai-1',
        chaveAcesso: '5'.repeat(44),
        tipoOperacaoEscriturada: 'SAIDA',
        emitenteCnpjCpf: EMPRESA_CNPJ,
      },
      [
        // CST 51 (alíquota zero) é válido e não debita: sem erro.
        makeItem({
          cfop: '5101',
          cstIpi: '51',
          valorBcIpi: '100.00',
          valorIpi: '3.00',
        }),
      ],
    );
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        empresa: {
          indAtiv: '0',
          classificacaoEstabelecimentoIndustrial: '2099',
        },
        inconsistencias,
        nfe: [entrada, saida],
      }),
    );

    expect(result.apuracao.ipi?.creditos).toBe('0.00');
    expect(result.apuracao.ipi?.debitos).toBe('0.00');
    expect(inconsistencias).not.toContainEqual(
      expect.objectContaining({ codigo: 'IPI_CREDITO_EXIGE_REVISAO' }),
    );
    expect(inconsistencias).not.toContainEqual(
      expect.objectContaining({ codigo: 'IPI_DEBITO_EXIGE_REVISAO' }),
    );
  });

  it('gera E200/E210/E250 para responsabilidade de ICMS-ST por UF', () => {
    const saida = makeNfe(
      {
        tipoOperacaoEscriturada: 'SAIDA',
        emitenteCnpjCpf: EMPRESA_CNPJ,
      },
      [makeItem({ cfop: '6404', valorIcmsSt: '12.34' })],
      'DEST-SE',
      'SE',
    );
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        nfe: [saida],
        responsabilidades: [{ tipo: 'ICMS_ST', uf: 'SE' }],
        obrigacoes: [
          makeObrigacao({
            tipo: 'ICMS_ST',
            uf: 'SE',
            codigoObrigacao: '002',
            valor: '12.34',
          }),
        ],
      }),
    );
    const e210 = fieldsOf(lineFor(result.records, 'E210'));

    expect(lineFor(result.records, 'E200')).toBe('|E200|SE|01082026|31082026|');
    expect(e210).toHaveLength(14);
    expect(e210[0]).toBe('1');
    expect(e210[6]).toBe('12,34');
    expect(e210[11]).toBe('12,34');
    expect(lineFor(result.records, 'E250')).toBe(
      '|E250|002|12,34|10092026|1000|||||082026|',
    );
    expect(result.apuracao.icmsStPorUf).toEqual([
      {
        uf: 'SE',
        debitos: '12.34',
        saldoCredorAnterior: '0.00',
        recolher: '12.34',
        saldoCredorTransportar: '0.00',
        debitosEspeciais: '0.00',
      },
    ]);
    expect(
      validateSpedFile(buildSpedFile({ records: result.records }).bytes, {
        strictFieldCounts: true,
      }).valid,
    ).toBe(true);
  });

  it('incorpora ajuste E220 de debito ao saldo e ao recolhimento do ICMS-ST', () => {
    const saida = makeNfe(
      {
        tipoOperacaoEscriturada: 'SAIDA',
        emitenteCnpjCpf: EMPRESA_CNPJ,
      },
      [makeItem({ cfop: '6404', valorIcmsSt: '12.34' })],
      'DEST-SE',
      'SE',
    );
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        nfe: [saida],
        ajustes: [
          makeAjuste({
            registro: 'E220',
            codigoAjuste: 'SE100001',
            descricao: 'FCP-ST A RECOLHER',
            valor: '2.00',
            indicador: 'DEBITO',
            uf: 'SE',
          }),
        ],
        obrigacoes: [
          makeObrigacao({
            tipo: 'ICMS_ST',
            uf: 'SE',
            codigoObrigacao: '002',
            valor: '14.34',
          }),
        ],
      }),
    );
    const e210 = fieldsOf(lineFor(result.records, 'E210'));

    expect(e210[8]).toBe('2,00');
    expect(e210[9]).toBe('14,34');
    expect(e210[11]).toBe('14,34');
    expect(lineFor(result.records, 'E220')).toBe(
      '|E220|SE100001|FCP-ST A RECOLHER|2,00|',
    );
    expect(lineFor(result.records, 'E250')).toContain('|14,34|');
    expect(
      validateSpedFile(buildSpedFile({ records: result.records }).bytes, {
        strictFieldCounts: true,
      }).valid,
    ).toBe(true);
  });

  it('gera E300/E310/E316 para DIFAL e FCP por UF', () => {
    const saida = makeNfe(
      {
        tipoOperacaoEscriturada: 'SAIDA',
        emitenteCnpjCpf: EMPRESA_CNPJ,
      },
      [
        makeItem({
          cfop: '6108',
          valorFcpUfDest: '2.00',
          valorIcmsUfDest: '20.00',
          valorIcmsUfRemetente: '0.00',
        }),
      ],
      'DEST-MG',
      'MG',
    );
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        nfe: [saida],
        responsabilidades: [{ tipo: 'DIFAL_FCP', uf: 'MG' }],
        obrigacoes: [
          makeObrigacao({
            tipo: 'DIFAL_FCP',
            uf: 'MG',
            codigoObrigacao: '003',
            valor: '22.00',
          }),
        ],
      }),
    );

    expect(lineFor(result.records, 'C101')).toBe('|C101|2,00|20,00|0,00|');
    expect(lineFor(result.records, 'E300')).toBe('|E300|MG|01082026|31082026|');
    expect(lineFor(result.records, 'E310')).toBe(
      '|E310|1|0,00|20,00|0,00|0,00|0,00|20,00|0,00|20,00|0,00|0,00|0,00|2,00|0,00|0,00|0,00|2,00|0,00|2,00|0,00|0,00|',
    );
    expect(lineFor(result.records, 'E316')).toBe(
      '|E316|003|22,00|10092026|1000|||||082026|',
    );
    expect(result.apuracao.difalFcpPorUf).toEqual([
      {
        uf: 'MG',
        difal: '20.00',
        fcp: '2.00',
        recolher: '22.00',
        debitosEspeciais: '0.00',
      },
    ]);
    expect(
      validateSpedFile(buildSpedFile({ records: result.records }).bytes, {
        strictFieldCounts: true,
      }).valid,
    ).toBe(true);
  });

  it('incorpora ajustes E311 separando DIFAL e FCP pelo codigo estadual', () => {
    const saida = makeNfe(
      {
        tipoOperacaoEscriturada: 'SAIDA',
        emitenteCnpjCpf: EMPRESA_CNPJ,
      },
      [
        makeItem({
          cfop: '6108',
          valorFcpUfDest: '2.00',
          valorIcmsUfDest: '20.00',
        }),
      ],
      'DEST-MG',
      'MG',
    );
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        nfe: [saida],
        ajustes: [
          makeAjuste({
            registro: 'E311',
            codigoAjuste: 'MG220001',
            descricao: 'DEDUCAO DO DIFAL',
            valor: '5.00',
            indicador: 'DEDUCAO',
            uf: 'MG',
          }),
          makeAjuste({
            registro: 'E311',
            codigoAjuste: 'MG330001',
            descricao: 'CREDITO DO FCP',
            valor: '1.00',
            indicador: 'CREDITO',
            uf: 'MG',
          }),
        ],
        obrigacoes: [
          makeObrigacao({
            tipo: 'DIFAL_FCP',
            uf: 'MG',
            codigoObrigacao: '003',
            valor: '16.00',
          }),
        ],
      }),
    );
    const e310 = fieldsOf(lineFor(result.records, 'E310'));

    expect(e310[7]).toBe('5,00');
    expect(e310[8]).toBe('15,00');
    expect(e310[15]).toBe('1,00');
    expect(e310[16]).toBe('1,00');
    expect(e310[18]).toBe('1,00');
    expect(lineFor(result.records, 'E311', 0)).toBe(
      '|E311|MG220001|DEDUCAO DO DIFAL|5,00|',
    );
    expect(lineFor(result.records, 'E311', 1)).toBe(
      '|E311|MG330001|CREDITO DO FCP|1,00|',
    );
    expect(lineFor(result.records, 'E316')).toContain('|16,00|');
    expect(result.apuracao.difalFcpPorUf).toEqual([
      {
        uf: 'MG',
        difal: '20.00',
        fcp: '2.00',
        recolher: '16.00',
        debitosEspeciais: '0.00',
      },
    ]);
    expect(
      validateSpedFile(buildSpedFile({ records: result.records }).bytes, {
        strictFieldCounts: true,
      }).valid,
    ).toBe(true);
  });

  it('gera H005/H010, seus campos e a contagem integral do bloco H', () => {
    const inventario = {
      row: {
        dataInventario: '2026-12-31',
        valorTotal: '250.00',
        motivo: '01',
      } as unknown as InventarioRow,
      itens: [
        {
          codigoItem: 'ITEM-ESTOQUE',
          participanteCodigo: 'PART-TERCEIRO',
          row: {
            unidade: 'UN',
            quantidade: '10.0000',
            valorUnitario: '25.0000000000',
            valorItem: '250.00',
            indicadorPropriedade: '1',
            textoComplementar: 'EM PODER DE TERCEIRO',
            codigoConta: '1.1.3.01',
            valorItemIr: '240.00',
          } as unknown as InventarioItemRow,
        },
      ],
    };
    const result = buildEfdIcmsIpiRecords(makeInput({ inventario }));
    const file = buildSpedFile({ records: result.records });

    expect(lineFor(result.records, 'H005')).toBe('|H005|31122026|250,00|01|');
    expect(lineFor(result.records, 'H010')).toBe(
      '|H010|ITEM-ESTOQUE|UN|10,000|25,000000|250,00|1|PART-TERCEIRO|EM PODER DE TERCEIRO|1.1.3.01|240,00|',
    );
    expect(file.lines).toContain('|H001|0|');
    expect(file.lines).toContain('|H990|4|');
    expect(file.recordCounts.H005).toBe(1);
    expect(file.recordCounts.H010).toBe(1);
    expect(validateSpedFile(file.text, { strictFieldCounts: true }).valid).toBe(
      true,
    );
  });

  it('leva a natureza 5 somente aos campos de debito especial', () => {
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        ajustes: [
          makeAjuste({
            codigoAjuste: 'SE050001',
            indicador: 'DEBITO_ESPECIAL',
            valor: '3.00',
          }),
          makeAjuste({
            registro: 'E220',
            codigoAjuste: 'BA150001',
            indicador: 'DEBITO_ESPECIAL',
            valor: '4.00',
            uf: 'BA',
          }),
          makeAjuste({
            registro: 'E311',
            codigoAjuste: 'MG250001',
            indicador: 'DEBITO_ESPECIAL',
            valor: '5.00',
            uf: 'MG',
          }),
          makeAjuste({
            registro: 'E311',
            codigoAjuste: 'MG350001',
            indicador: 'DEBITO_ESPECIAL',
            valor: '6.00',
            uf: 'MG',
          }),
        ],
      }),
    );
    const e110 = fieldsOf(lineFor(result.records, 'E110'));
    const e210 = fieldsOf(lineFor(result.records, 'E210'));
    const e310 = fieldsOf(lineFor(result.records, 'E310'));

    expect(e110[11]).toBe('0,00');
    expect(e110[13]).toBe('3,00');
    expect(e210[11]).toBe('0,00');
    expect(e210[13]).toBe('4,00');
    expect(e310[8]).toBe('0,00');
    expect(e310[10]).toBe('5,00');
    expect(e310[18]).toBe('0,00');
    expect(e310[20]).toBe('6,00');
    expect(result.apuracao.icmsProprio.debitosEspeciais).toBe('3.00');
    expect(result.apuracao.icmsStPorUf[0].debitosEspeciais).toBe('4.00');
    expect(result.apuracao.difalFcpPorUf[0].debitosEspeciais).toBe('11.00');
    expect(
      validateSpedFile(buildSpedFile({ records: result.records }).bytes, {
        strictFieldCounts: true,
      }).valid,
    ).toBe(true);
  });

  it('considera cada estorno de debito uma unica vez no saldo do E110', () => {
    const saida = makeNfe(
      {
        tipoOperacaoEscriturada: 'SAIDA',
        emitenteCnpjCpf: EMPRESA_CNPJ,
      },
      [makeItem({ cfop: '5102', valorIcms: '100.00' })],
    );
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        nfe: [saida],
        ajustes: [makeAjuste()],
        saldos: [makeSaldo()],
      }),
    );
    const e110 = fieldsOf(lineFor(result.records, 'E110'));

    expect(e110[0]).toBe('100,00');
    expect(e110[7]).toBe('10,00');
    expect(e110[9]).toBe('90,00');
    expect(e110[11]).toBe('90,00');
    expect(result.apuracao.icmsProprio.saldoApurado).toBe('90.00');
  });

  it('gera 0220 subordinado ao 0200 quando o item tem conversao de unidade', () => {
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        itensCatalogo: [
          {
            codigo: 'ITEM-1',
            codigoExterno: 'P1',
            descricao: 'Produto',
            codigoBarras: null,
            unidade: 'CX',
            tipoItem: '00',
            tipoItemInferido: false,
            ncm: '12345678',
            exIpi: null,
            codigoGenero: '12',
            codigoServico: null,
            aliquotaIcms: null,
            cest: null,
            participanteOrigemCodigo: null,
            conversoesUnidade: [
              {
                unidadeConversao: 'UN',
                fatorConversao: '12.000000',
                codigoBarrasConversao: null,
              },
            ],
          },
        ],
      }),
    );
    const bloco0 = regs(result.records, '0');
    // O 0220 deve vir imediatamente após o 0200 do item.
    const idx0200 = bloco0.indexOf('0200');
    expect(bloco0[idx0200 + 1]).toBe('0220');
    expect(lineFor(result.records, '0220')).toBe('|0220|UN|12,000000||');
  });

  it('gera C113 subordinado ao C100 para documento com referencia', () => {
    const nfe = makeNfe({ id: 'dev-1', chaveAcesso: '7'.repeat(44) }, [
      makeItem({ cfop: '1202' }),
    ]);
    nfe.referencias = [
      {
        indicadorTipo: '1',
        chaveOuNumero: '9'.repeat(44),
        participanteCodigo: 'PART-1',
        codigoModelo: '55',
      },
    ];
    const result = buildEfdIcmsIpiRecords(makeInput({ nfe: [nfe] }));
    const blocoC = regs(result.records, 'C');
    // C113 deve aparecer logo após o C100 e antes do C190.
    expect(blocoC[0]).toBe('C100');
    expect(blocoC[1]).toBe('C113');
    const c113 = fieldsOf(lineFor(result.records, 'C113'));
    // IND_OPER(0 entrada) | IND_EMIT(1 terceiros) | COD_PART | ... | CHV
    expect(c113[0]).toBe('0');
    expect(c113[1]).toBe('1');
    expect(c113[2]).toBe('PART-1');
    expect(c113[8]).toBe('9'.repeat(44));
  });

  it('gera Bloco G (G110/G125) a partir dos dados do CIAP', () => {
    const result = buildEfdIcmsIpiRecords(
      makeInput({
        ciap: {
          saldoInicial: '4800.00',
          somaParcelas: '100.00',
          valorTotalCredito: '100.00',
          indicadorPeriodo: '0',
          saidasTributadas: '10000.00',
          saidasTotais: '10000.00',
          bens: [
            {
              codigoIndividualizacao: 'BEM-1',
              identificacaoBem: 'Maquina',
              tipoMovimentacao: 'SI',
              valorIcmsOperacao: '4800.00',
              valorIcmsFrete: '0.00',
              valorIcmsDifal: '0.00',
              numeroParcela: 1,
              valorParcelaIcms: '100.00',
              valorParcelaFrete: '0.00',
              valorParcelaDifal: '0.00',
            },
          ],
        },
      }),
    );
    const blocoG = regs(result.records, 'G');
    expect(blocoG).toEqual(['G110', 'G125']);
    const g110 = fieldsOf(lineFor(result.records, 'G110'));
    expect(g110[7]).toBe('100,00'); // valor total do crédito
    const file = buildSpedFile({ records: result.records });
    expect(
      validateSpedFile(file.bytes, { strictFieldCounts: true }),
    ).toMatchObject({ valid: true });
  });
});
