/**
 * Fixtures normativas INDEPENDENTES do builder para os CENÁRIOS DE MOVIMENTAÇÃO
 * do Bloco G (R4.3, tarefa 5.3). Complementa a tarefa 5.1
 * (`efd-icms-ipi.bloco-g.fixtures-normativas.spec.ts`), que cobre G110/G125/0300
 * no cenário de saldo inicial. Aqui o foco são os cenários de MOVIMENTAÇÃO e de
 * VALOR exigidos por R4.3:
 *
 *   1. Saldo inicial (TIPO_MOV "SI") — já coberto na 5.1, reafirmado aqui de
 *      forma explícita (sem G130/G140, campos 05..10 preenchidos).
 *   2. Imobilização (TIPO_MOV "IM") — movimentação com origem em documento
 *      fiscal; por R3.4 (tarefa 4.5) exige G130 (documento) e G140 (item). O
 *      input traz os dados de origem para que G130/G140 sejam emitidos, e o
 *      oráculo os descreve campo a campo.
 *   3. Baixa (TIPO_MOV "BA") — movimentação de saída em que os campos de valor
 *      de ICMS (05..10) NÃO são informados, conforme o leiaute oficial
 *      (G125_LAYOUT: "Nos tipos de saída (BA, AT, PE, OT) os campos 05..10 não
 *      devem ser informados").
 *   4. Frete (VL_IMOB_ICMS_FRT, campo 07), DIFAL (VL_IMOB_ICMS_DIF, campo 08) e
 *      ICMS-ST (VL_IMOB_ICMS_ST, campo 06) preenchidos com valores distintos e
 *      não nulos, provando que cada um cai na posição oficial correta do G125.
 *
 * COMO EM 5.1: o oráculo (as linhas pipe-delimitadas esperadas) é escrito À MÃO
 * a partir do leiaute oficial reproduzido em `core/bloco-g-leiaute.ts`, NUNCA
 * gerado por `buildEfdIcmsIpiRecords`. O teste alimenta o builder com um input
 * CIAP conhecido por cenário, serializa a saída e exige igualdade exata contra o
 * oráculo (R4.3/R4.1). Se o builder trocar duas posições, omitir um campo ou
 * calcular um derivado errado, a comparação falha — mesmo que o builder seja
 * internamente autoconsistente.
 */
import {
  buildEfdIcmsIpiRecords,
  type SpedCiapBemBuilderData,
  type SpedCiapBuilderData,
  type SpedEfdBuilderInput,
} from './efd-icms-ipi.builder';
import {
  BLOCO_G_LEIAUTES,
  serializeSpedRecord,
  type SpedRecord,
} from './core';

// Período de apuração do input conhecido. DT_INI/DT_FIN do G110 derivam de
// `inicio`/`fim` (ddmmaaaa). O builder usa `inicio` também como DT_MOV do G125
// para todos os tipos (até o leiaute por tipo de movimentação ser completado),
// então DT_MOV = 01082026 em SI, IM, BA e no cenário de valores. Agosto/2026.
const INICIO = new Date('2026-08-01T00:00:00.000Z');
const FIM = new Date('2026-08-31T00:00:00.000Z');
const DT_PERIODO = '01082026';

const BASE_EMPRESA: SpedEfdBuilderInput['empresa'] = {
  razaoSocial: 'EMPRESA TESTE LTDA',
  nomeFantasia: 'EMPRESA TESTE',
  cnpj: '12345678000199',
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

function makeInput(ciap: SpedCiapBuilderData): SpedEfdBuilderInput {
  return {
    competencia: '2026-08',
    finalidade: '0',
    inicio: INICIO,
    fim: FIM,
    empresa: BASE_EMPRESA,
    contabilista: BASE_CONTABILISTA,
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
    ciap,
    // O Bloco G só é serializado com o leiaute homologado; sem isso o builder
    // bloqueia a geração (contenção da Fase 0) e não emite G110/G125/0300.
    blocoGLeiauteHomologado: true,
  };
}

/** Monta a linha SPED esperada: |REG|c02|c03|...|  (pipe inicial e final). */
function montarLinha(reg: string, campos: readonly string[]): string {
  return ['', reg, ...campos, ''].join('|');
}

/** Campos (após REG) da n-ésima ocorrência de um registro no arquivo gerado. */
function camposDaLinha(
  records: readonly SpedRecord[],
  reg: string,
  ocorrencia: number,
): string[] {
  const alvo = records.filter((record) => record.reg === reg)[ocorrencia];
  if (!alvo) {
    throw new Error(`Registro ${reg}[${ocorrencia}] ausente no arquivo gerado.`);
  }
  // |REG|c0|c1|...| ⇒ remove os vazios de borda e o próprio REG.
  return serializeSpedRecord(alvo).split('|').slice(2, -1);
}

/** Serializa a n-ésima ocorrência de um registro. */
function linhaSerializada(
  records: readonly SpedRecord[],
  reg: string,
  ocorrencia: number,
): string {
  const alvo = records.filter((record) => record.reg === reg)[ocorrencia];
  if (!alvo) {
    throw new Error(`Registro ${reg}[${ocorrencia}] ausente no arquivo gerado.`);
  }
  return serializeSpedRecord(alvo);
}

/**
 * Base de um bem conhecido (0300/0305 estáveis entre cenários). Cada cenário
 * sobrescreve o que lhe interessa (TIPO_MOV e os valores de ICMS do G125).
 */
function bemBase(
  overrides: Partial<SpedCiapBemBuilderData>,
): SpedCiapBemBuilderData {
  return {
    codigoIndividualizacao: 'BEM-0001',
    identificacaoBem: 'TORNO CNC MODELO X',
    identificacaoMercadoria: '1',
    codigoBemPrincipal: null,
    codigoContaContabil: '1210101',
    numeroTotalParcelas: 48,
    centroCusto: 'CC-PRODUCAO',
    funcaoBem: 'USINAGEM DE PECAS',
    vidaUtilMeses: 120,
    tipoMovimentacao: 'SI',
    valorIcmsOperacao: '4800.00',
    valorIcmsSt: '0.00',
    valorIcmsFrete: '0.00',
    valorIcmsDifal: '0.00',
    numeroParcela: 1,
    valorParcelaPassivel: '100.00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cenário 1 — Saldo inicial (TIPO_MOV "SI")
// ---------------------------------------------------------------------------
// Reafirma explicitamente o cenário coberto pela 5.1. Movimentação de abertura,
// sem documento de origem (não emite G130/G140). Campos 05..10 preenchidos.
//
//   02 COD_IND_BEM     = BEM-0001
//   03 DT_MOV          = 01082026   (SI => DT_INI do G110)
//   04 TIPO_MOV        = SI
//   05 VL_IMOB_ICMS_OP = 4800,00
//   06 VL_IMOB_ICMS_ST = 0,00
//   07 VL_IMOB_ICMS_FRT= 0,00
//   08 VL_IMOB_ICMS_DIF= 0,00
//   09 NUM_PARC        = 1
//   10 VL_PARC_PASS    = 100,00
describe('5.3 cenário saldo inicial (TIPO_MOV "SI") — oráculo externo (R4.3)', () => {
  const ciap: SpedCiapBuilderData = {
    saldoInicial: '4800.00',
    somaParcelas: '100.00',
    saidasTributadas: '800.00',
    saidasTotais: '1000.00',
    somaIcmsOutrosCreditos: '0.00',
    bens: [bemBase({ tipoMovimentacao: 'SI' })],
  };
  const { records } = buildEfdIcmsIpiRecords(makeInput(ciap));

  const G125_SI = [
    'BEM-0001',
    DT_PERIODO,
    'SI',
    '4800,00',
    '0,00',
    '0,00',
    '0,00',
    '1',
    '100,00',
  ] as const;

  it('G125 "SI" reproduz a linha normativa escrita à mão', () => {
    expect(linhaSerializada(records, 'G125', 0)).toBe(
      montarLinha('G125', G125_SI),
    );
  });

  it('tem a contagem oficial de campos do G125 após REG', () => {
    expect(camposDaLinha(records, 'G125', 0).length).toBe(
      BLOCO_G_LEIAUTES.G125.fieldCountAfterReg,
    );
  });

  it('não emite G130/G140 (saldo inicial não tem documento de origem)', () => {
    expect(records.some((r) => r.reg === 'G130')).toBe(false);
    expect(records.some((r) => r.reg === 'G140')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cenário 2 — Imobilização (TIPO_MOV "IM") com origem em documento fiscal
// ---------------------------------------------------------------------------
// Por R3.4 (tarefa 4.5), "IM" exige os filhos G130 (documento) e G140 (item):
// sem a origem o builder bloqueia a geração. O input traz um documento de
// origem completo e o oráculo descreve G125, G130 e G140 campo a campo.
//
// G125 "IM":
//   02 COD_IND_BEM     = BEM-0002
//   03 DT_MOV          = 01082026   (builder usa DT_INI do G110 como DT_MOV)
//   04 TIPO_MOV        = IM
//   05 VL_IMOB_ICMS_OP = 1200,00
//   06 VL_IMOB_ICMS_ST = 0,00
//   07 VL_IMOB_ICMS_FRT= 0,00
//   08 VL_IMOB_ICMS_DIF= 0,00
//   09 NUM_PARC        = 1
//   10 VL_PARC_PASS    = 25,00
//
// G130 (IND_EMIT = '1', emissão por terceiros ⇒ COD_PART presente):
//   02 IND_EMIT     = 1
//   03 COD_PART     = FORN-100
//   04 COD_MOD      = 55
//   05 SERIE        = 1
//   06 NUM_DOC      = 998877
//   07 CHV_NFE_CTE  = 35260811111111111111550010009988771000000017
//
// G140 (item do documento de origem):
//   02 NUM_ITEM = 1
//   03 COD_ITEM = SKU-TORNO
describe('5.3 cenário imobilização (TIPO_MOV "IM") com G130/G140 — oráculo externo (R4.3)', () => {
  const CHAVE =
    '35260811111111111111550010009988771000000017';
  const ciap: SpedCiapBuilderData = {
    saldoInicial: '0.00',
    somaParcelas: '25.00',
    saidasTributadas: '800.00',
    saidasTotais: '1000.00',
    somaIcmsOutrosCreditos: '0.00',
    bens: [
      bemBase({
        codigoIndividualizacao: 'BEM-0002',
        identificacaoBem: 'PRENSA HIDRAULICA',
        tipoMovimentacao: 'IM',
        valorIcmsOperacao: '1200.00',
        numeroParcela: 1,
        valorParcelaPassivel: '25.00',
        documentosOrigem: [
          {
            indicadorEmitente: '1',
            codigoParticipante: 'FORN-100',
            codigoModelo: '55',
            serie: '1',
            numeroDocumento: 998877,
            chaveEletronica: CHAVE,
            itens: [{ numeroItem: '1', codigoItem: 'SKU-TORNO' }],
          },
        ],
      }),
    ],
  };
  const { records } = buildEfdIcmsIpiRecords(makeInput(ciap));

  const G125_IM = [
    'BEM-0002',
    DT_PERIODO,
    'IM',
    '1200,00',
    '0,00',
    '0,00',
    '0,00',
    '1',
    '25,00',
  ] as const;

  const G130_IM = ['1', 'FORN-100', '55', '1', '998877', CHAVE] as const;
  const G140_IM = ['1', 'SKU-TORNO'] as const;

  it('G125 "IM" reproduz a linha normativa escrita à mão', () => {
    expect(linhaSerializada(records, 'G125', 0)).toBe(
      montarLinha('G125', G125_IM),
    );
    expect(camposDaLinha(records, 'G125', 0).length).toBe(
      BLOCO_G_LEIAUTES.G125.fieldCountAfterReg,
    );
  });

  it('emite G130 e reproduz a linha normativa (documento de origem)', () => {
    expect(records.filter((r) => r.reg === 'G130')).toHaveLength(1);
    expect(linhaSerializada(records, 'G130', 0)).toBe(
      montarLinha('G130', G130_IM),
    );
    expect(camposDaLinha(records, 'G130', 0).length).toBe(
      BLOCO_G_LEIAUTES.G130.fieldCountAfterReg,
    );
  });

  it('emite G140 e reproduz a linha normativa (item do documento)', () => {
    expect(records.filter((r) => r.reg === 'G140')).toHaveLength(1);
    expect(linhaSerializada(records, 'G140', 0)).toBe(
      montarLinha('G140', G140_IM),
    );
    expect(camposDaLinha(records, 'G140', 0).length).toBe(
      BLOCO_G_LEIAUTES.G140.fieldCountAfterReg,
    );
  });

  // Comparação campo a campo do G125/G130/G140, para que a falha aponte o campo
  // divergente e valide também a posição oficial de cada campo.
  const porRegistro = [
    { reg: 'G130', campos: G130_IM },
    { reg: 'G140', campos: G140_IM },
    { reg: 'G125', campos: G125_IM },
  ] as const;

  describe.each(porRegistro)('$reg campo a campo', (fixture) => {
    const campos = camposDaLinha(records, fixture.reg, 0);
    const layout = BLOCO_G_LEIAUTES[fixture.reg];
    const comNome = fixture.campos.map((valor, indice) => {
      const spec = layout.fields.find((f) => f.position === indice);
      return { indice, nome: spec?.name ?? `campo${indice}`, valor };
    });
    it.each(comNome)(
      'campo $indice ($nome) = "$valor"',
      ({ indice, nome, valor }) => {
        expect({ reg: fixture.reg, nome, valor: campos[indice] }).toEqual({
          reg: fixture.reg,
          nome,
          valor,
        });
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Cenário 3 — Baixa (TIPO_MOV "BA"): campos de valor 05..10 não informados
// ---------------------------------------------------------------------------
// G125_LAYOUT: "Nos tipos de saída (BA, AT, PE, OT) os campos 05..10 não devem
// ser informados". A baixa é um fato de saída: só COD_IND_BEM/DT_MOV/TIPO_MOV
// são preenchidos; VL_IMOB_ICMS_OP..VL_PARC_PASS ficam VAZIOS. O input passa
// null nesses campos para que o builder serialize campos vazios (não "0,00").
//
//   02 COD_IND_BEM     = BEM-0001
//   03 DT_MOV          = 01082026
//   04 TIPO_MOV        = BA
//   05 VL_IMOB_ICMS_OP = (vazio)
//   06 VL_IMOB_ICMS_ST = (vazio)
//   07 VL_IMOB_ICMS_FRT= (vazio)
//   08 VL_IMOB_ICMS_DIF= (vazio)
//   09 NUM_PARC        = (vazio)
//   10 VL_PARC_PASS    = (vazio)
describe('5.3 cenário baixa (TIPO_MOV "BA") — campos 05..10 não informados (R4.3)', () => {
  const ciap: SpedCiapBuilderData = {
    saldoInicial: '0.00',
    somaParcelas: '0.00',
    saidasTributadas: '800.00',
    saidasTotais: '1000.00',
    somaIcmsOutrosCreditos: '0.00',
    bens: [
      bemBase({
        tipoMovimentacao: 'BA',
        // Tipo de saída: campos 05..10 não são informados (ficam vazios).
        valorIcmsOperacao: null as unknown as string,
        valorIcmsSt: null as unknown as string,
        valorIcmsFrete: null as unknown as string,
        valorIcmsDifal: null as unknown as string,
        numeroParcela: null as unknown as number,
        valorParcelaPassivel: null as unknown as string,
      }),
    ],
  };
  const { records } = buildEfdIcmsIpiRecords(makeInput(ciap));

  const G125_BA = [
    'BEM-0001',
    DT_PERIODO,
    'BA',
    '',
    '',
    '',
    '',
    '',
    '',
  ] as const;

  it('G125 "BA" reproduz a linha normativa (campos de valor vazios)', () => {
    expect(linhaSerializada(records, 'G125', 0)).toBe(
      montarLinha('G125', G125_BA),
    );
    expect(camposDaLinha(records, 'G125', 0).length).toBe(
      BLOCO_G_LEIAUTES.G125.fieldCountAfterReg,
    );
  });

  it('não emite G130/G140 (BA é saída, não exige origem documental)', () => {
    expect(records.some((r) => r.reg === 'G130')).toBe(false);
    expect(records.some((r) => r.reg === 'G140')).toBe(false);
  });

  describe('G125 "BA" campo a campo', () => {
    const campos = camposDaLinha(records, 'G125', 0);
    const layout = BLOCO_G_LEIAUTES.G125;
    const comNome = G125_BA.map((valor, indice) => {
      const spec = layout.fields.find((f) => f.position === indice);
      return { indice, nome: spec?.name ?? `campo${indice}`, valor };
    });
    it.each(comNome)('campo $indice ($nome) = "$valor"', ({ indice, nome, valor }) => {
      expect({ nome, valor: campos[indice] }).toEqual({ nome, valor });
    });
  });
});

// ---------------------------------------------------------------------------
// Cenário 4 — Frete / DIFAL / ST com valores distintos e não nulos
// ---------------------------------------------------------------------------
// Prova que ICMS-ST (campo 06), frete (campo 07) e DIFAL (campo 08) caem cada
// um na sua posição oficial. Valores escolhidos distintos e sem repetição para
// que uma troca de posição seja flagrante:
//   05 VL_IMOB_ICMS_OP = 1000,00
//   06 VL_IMOB_ICMS_ST = 150,55   (ST)
//   07 VL_IMOB_ICMS_FRT= 33,44    (frete)
//   08 VL_IMOB_ICMS_DIF= 77,88    (DIFAL)
//   09 NUM_PARC        = 1
//   10 VL_PARC_PASS    = 26,29
describe('5.3 cenário frete/DIFAL/ST — cada valor na posição oficial do G125 (R4.3)', () => {
  const ciap: SpedCiapBuilderData = {
    saldoInicial: '0.00',
    somaParcelas: '26.29',
    saidasTributadas: '800.00',
    saidasTotais: '1000.00',
    somaIcmsOutrosCreditos: '0.00',
    bens: [
      bemBase({
        codigoIndividualizacao: 'BEM-0003',
        identificacaoBem: 'EMPILHADEIRA',
        tipoMovimentacao: 'SI',
        valorIcmsOperacao: '1000.00',
        valorIcmsSt: '150.55',
        valorIcmsFrete: '33.44',
        valorIcmsDifal: '77.88',
        numeroParcela: 1,
        valorParcelaPassivel: '26.29',
      }),
    ],
  };
  const { records } = buildEfdIcmsIpiRecords(makeInput(ciap));

  const G125_VALORES = [
    'BEM-0003',
    DT_PERIODO,
    'SI',
    '1000,00',
    '150,55',
    '33,44',
    '77,88',
    '1',
    '26,29',
  ] as const;

  it('G125 reproduz a linha normativa com frete/DIFAL/ST distintos', () => {
    expect(linhaSerializada(records, 'G125', 0)).toBe(
      montarLinha('G125', G125_VALORES),
    );
    expect(camposDaLinha(records, 'G125', 0).length).toBe(
      BLOCO_G_LEIAUTES.G125.fieldCountAfterReg,
    );
  });

  describe('G125 campo a campo (posição oficial de ST/frete/DIFAL)', () => {
    const campos = camposDaLinha(records, 'G125', 0);
    const layout = BLOCO_G_LEIAUTES.G125;
    const comNome = G125_VALORES.map((valor, indice) => {
      const spec = layout.fields.find((f) => f.position === indice);
      return { indice, nome: spec?.name ?? `campo${indice}`, valor };
    });
    it.each(comNome)('campo $indice ($nome) = "$valor"', ({ indice, nome, valor }) => {
      expect({ nome, valor: campos[indice] }).toEqual({ nome, valor });
    });
  });

  it('ST (06), frete (07) e DIFAL (08) ocupam posições distintas e corretas', () => {
    const campos = camposDaLinha(records, 'G125', 0);
    // position 4 = VL_IMOB_ICMS_ST, 5 = VL_IMOB_ICMS_FRT, 6 = VL_IMOB_ICMS_DIF.
    expect(campos[4]).toBe('150,55'); // ST
    expect(campos[5]).toBe('33,44'); // frete
    expect(campos[6]).toBe('77,88'); // DIFAL
  });
});
