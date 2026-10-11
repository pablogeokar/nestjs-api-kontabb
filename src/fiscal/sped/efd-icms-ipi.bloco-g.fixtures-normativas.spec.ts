/**
 * Fixtures normativas INDEPENDENTES do builder para o Bloco G (R4.1, tarefa 5.1).
 *
 * Diferente de um teste de round-trip (que compara a saída do builder contra ela
 * mesma e, por isso, não detecta um builder "autoconsistente mas errado"), este
 * spec define o ORÁCULO campo a campo À MÃO, derivado exclusivamente do leiaute
 * oficial do Guia Prático 3.2.2 reproduzido em `core/bloco-g-leiaute.ts`
 * (G110_LAYOUT, G125_LAYOUT, REGISTRO_0300_LAYOUT, REGISTRO_0305_LAYOUT).
 *
 * Nenhuma linha esperada abaixo é produzida chamando `buildEfdIcmsIpiRecords`:
 * cada `linha` é uma string pipe-delimitada escrita manualmente, com todos os
 * campos anotados pelo número/nome oficial. O teste então ALIMENTA o builder com
 * um input CIAP conhecido, serializa a saída e exige igualdade exata contra o
 * oráculo. Se o builder trocar duas posições, omitir um campo ou calcular um
 * derivado errado, a comparação falha — mesmo que o builder seja internamente
 * consistente (R4.1: a fixture é o oráculo externo).
 *
 * Os campos derivados do G110 (IND_PER_SAI, ICMS_APROP) são recomputados aqui à
 * mão a partir da definição oficial — campo 06 ÷ campo 07 e campo 05 × campo 08
 * — para que o teste prove a FÓRMULA e a POSIÇÃO, não apenas que o builder
 * repete o próprio resultado.
 *
 * Escopo da tarefa 5.1: G110, G125 e 0300 (e 0305 quando aplicável), campo a
 * campo. O teste de mutação de posição (5.2) e a cobertura de cenários de
 * movimentação — saldo inicial, imobilização, baixa, frete/DIFAL/ST — (5.3) são
 * tarefas separadas.
 */
import {
  buildEfdIcmsIpiRecords,
  type SpedCiapBuilderData,
  type SpedEfdBuilderInput,
} from './efd-icms-ipi.builder';
import { BLOCO_G_LEIAUTES, serializeSpedRecord, type SpedRecord } from './core';

// Período de apuração usado no input conhecido. DT_INI / DT_FIN do G110 derivam
// de `inicio` / `fim` (ddmmaaaa). Agosto/2026 (competência vigente nos testes).
const INICIO = new Date('2026-08-01T00:00:00.000Z');
const FIM = new Date('2026-08-31T00:00:00.000Z');

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
    // O Bloco G só é serializado quando o leiaute está homologado; sem isso o
    // builder bloqueia a geração (contenção da Fase 0) e não emite G110/G125/0300.
    blocoGLeiauteHomologado: true,
  };
}

/**
 * Input CIAP conhecido. Números escolhidos para que os derivados do G110 sejam
 * exatos e verificáveis à mão:
 *   VL_TRIB_EXP / VL_TOTAL = 800 / 1000 = 0,80000000 (IND_PER_SAI, 8 casas)
 *   ICMS_APROP = SOM_PARC × IND_PER_SAI = 100,00 × 0,8 = 80,00
 * Um único bem (IDENT_MERC = '1'), movimentação de saldo inicial (TIPO_MOV
 * "SI"), que NÃO exige G130/G140 — mantendo o foco da 5.1 em G110/G125/0300/0305.
 */
const CIAP_CONHECIDO: SpedCiapBuilderData = {
  saldoInicial: '0.00',
  somaParcelas: '100.00',
  saidasTributadas: '800.00',
  saidasTotais: '1000.00',
  somaIcmsOutrosCreditos: '0.00',
  bens: [
    {
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
    },
  ],
};

/**
 * Oráculo externo: a linha serializada esperada, escrita à mão a partir do
 * leiaute oficial. Cada campo é anotado pelo número/nome oficial. Formato SPED:
 * |REG|campo02|campo03|...|  (pipe inicial e final, sem o REG na contagem de
 * `fields`).
 */
interface LinhaNormativa {
  reg: string;
  /** Índice da ocorrência do registro no arquivo gerado. */
  ocorrencia: number;
  /** Linha pipe-delimitada esperada, montada à mão a partir do Guia. */
  linha: string;
  /** Campos esperados (após REG), na ordem oficial — usados na comparação. */
  campos: readonly string[];
}

// G110 — ICMS Ativo Permanente (CIAP). 9 campos após REG (R3.1).
//   02 DT_INI        = 01082026   (period inicio)
//   03 DT_FIN        = 31082026   (period fim)
//   04 SALDO_IN_ICMS = 0,00       (ciap.saldoInicial)
//   05 SOM_PARC      = 100,00     (ciap.somaParcelas)
//   06 VL_TRIB_EXP   = 800,00     (ciap.saidasTributadas)
//   07 VL_TOTAL      = 1000,00    (ciap.saidasTotais)
//   08 IND_PER_SAI   = 0,80000000 (= campo 06 ÷ campo 07, 8 casas) — derivado à mão
//   09 ICMS_APROP    = 80,00      (= campo 05 × campo 08) — derivado à mão
//   10 SOM_ICMS_OC   = 0,00       (ciap.somaIcmsOutrosCreditos)
const G110_CAMPOS = [
  '01082026',
  '31082026',
  '0,00',
  '100,00',
  '800,00',
  '1000,00',
  '0,80000000',
  '80,00',
  '0,00',
] as const;

// G125 — Movimentação do bem/componente. 9 campos após REG (R3.2).
//   02 COD_IND_BEM     = BEM-0001   (referencia o 0300)
//   03 DT_MOV          = 01082026   (TIPO_MOV "SI" => DT_INI do G110)
//   04 TIPO_MOV        = SI
//   05 VL_IMOB_ICMS_OP = 4800,00
//   06 VL_IMOB_ICMS_ST = 0,00       (posição oficial do ICMS-ST — antes omitida)
//   07 VL_IMOB_ICMS_FRT= 0,00
//   08 VL_IMOB_ICMS_DIF= 0,00
//   09 NUM_PARC        = 1
//   10 VL_PARC_PASS    = 100,00
const G125_CAMPOS = [
  'BEM-0001',
  '01082026',
  'SI',
  '4800,00',
  '0,00',
  '0,00',
  '0,00',
  '1',
  '100,00',
] as const;

// 0300 — Cadastro do bem/componente. 6 campos após REG (R3.3).
//   02 COD_IND_BEM = BEM-0001
//   03 IDENT_MERC  = 1          (bem)
//   04 DESCR_ITEM  = TORNO CNC MODELO X
//   05 COD_PRNC    = (vazio)    (só preenchido para componente IDENT_MERC = 2)
//   06 COD_CTA     = 1210101
//   07 NR_PARC     = 48
const REG_0300_CAMPOS = [
  'BEM-0001',
  '1',
  'TORNO CNC MODELO X',
  '',
  '1210101',
  '48',
] as const;

// 0305 — Utilização do bem (emitido só quando IDENT_MERC = '1'). 3 campos após REG.
//   02 COD_CCUS  = CC-PRODUCAO
//   03 FUNC      = USINAGEM DE PECAS
//   04 VIDA_UTIL = 120
const REG_0305_CAMPOS = ['CC-PRODUCAO', 'USINAGEM DE PECAS', '120'] as const;

function montarLinha(reg: string, campos: readonly string[]): string {
  return ['', reg, ...campos, ''].join('|');
}

const FIXTURES: readonly LinhaNormativa[] = [
  {
    reg: 'G110',
    ocorrencia: 0,
    campos: G110_CAMPOS,
    linha: montarLinha('G110', G110_CAMPOS),
  },
  {
    reg: 'G125',
    ocorrencia: 0,
    campos: G125_CAMPOS,
    linha: montarLinha('G125', G125_CAMPOS),
  },
  {
    reg: '0300',
    ocorrencia: 0,
    campos: REG_0300_CAMPOS,
    linha: montarLinha('0300', REG_0300_CAMPOS),
  },
  {
    reg: '0305',
    ocorrencia: 0,
    campos: REG_0305_CAMPOS,
    linha: montarLinha('0305', REG_0305_CAMPOS),
  },
];

/** Campos (após REG) da n-ésima ocorrência de um registro no arquivo gerado. */
function camposDaLinha(
  records: readonly SpedRecord[],
  reg: string,
  ocorrencia: number,
): string[] {
  const alvo = records.filter((record) => record.reg === reg)[ocorrencia];
  if (!alvo) {
    throw new Error(
      `Registro ${reg}[${ocorrencia}] ausente no arquivo gerado.`,
    );
  }
  // |REG|c0|c1|...| ⇒ remove os vazios de borda e o próprio REG.
  return serializeSpedRecord(alvo).split('|').slice(2, -1);
}

describe('Fixtures normativas do Bloco G — oráculo externo ao builder (R4.1, 5.1)', () => {
  const { records } = buildEfdIcmsIpiRecords(makeInput(CIAP_CONHECIDO));

  it.each(FIXTURES)(
    '$reg: builder reproduz a linha normativa escrita à mão',
    (fixture) => {
      const serial = serializeSpedRecord(
        records.filter((r) => r.reg === fixture.reg)[fixture.ocorrencia],
      );
      expect(serial).toBe(fixture.linha);
    },
  );

  // Comparação campo a campo, para que a falha aponte o campo divergente (e não
  // só "a linha mudou"). Também valida a CONTAGEM contra o leiaute oficial.
  describe.each(FIXTURES)('$reg campo a campo', (fixture) => {
    const campos = camposDaLinha(records, fixture.reg, fixture.ocorrencia);
    const layout = BLOCO_G_LEIAUTES[fixture.reg];

    it('tem a contagem oficial de campos após REG', () => {
      expect(campos.length).toBe(layout.fieldCountAfterReg);
      expect(fixture.campos.length).toBe(layout.fieldCountAfterReg);
    });

    const comNome = fixture.campos.map((valor, indice) => {
      // Campo oficial nº (indice + 2): REG é 01, primeiro dado é 02.
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

  it('emite exatamente um 0300 e um 0305 para o bem conhecido (integridade G125 -> 0300)', () => {
    expect(records.filter((r) => r.reg === '0300')).toHaveLength(1);
    expect(records.filter((r) => r.reg === '0305')).toHaveLength(1);
    // O COD_IND_BEM do G125 (campo 02) referencia o COD_IND_BEM do 0300 (R3.3).
    const g125 = camposDaLinha(records, 'G125', 0);
    const r0300 = camposDaLinha(records, '0300', 0);
    expect(g125[0]).toBe(r0300[0]);
  });

  it('não emite G130/G140 para o saldo inicial (TIPO_MOV "SI" não tem documento de origem)', () => {
    expect(records.some((r) => r.reg === 'G130')).toBe(false);
    expect(records.some((r) => r.reg === 'G140')).toBe(false);
  });
});
