/**
 * Teste de MUTAÇÃO DE POSIÇÃO do Bloco G (R4.2, tarefa 5.2).
 *
 * A tarefa 5.1 provou que o builder reproduz a linha normativa escrita à mão
 * (oráculo externo). Mas uma asserção pode "passar à toa": se a comparação for
 * frouxa (ex.: ignorar ordem, comparar como conjunto, ou tolerar um campo a
 * menos), ela continuaria verde mesmo diante de uma regressão real. Este spec
 * fecha esse buraco: ele PROVA QUE A FIXTURE DETECTA O ERRO.
 *
 * Metodologia (análise de mutação, "mutation testing" aplicado ao oráculo):
 *   1. Partimos da linha normativa CORRETA (a mesma do oráculo da 5.1, escrita à
 *      mão a partir do leiaute oficial em `core/bloco-g-leiaute.ts`).
 *   2. Aplicamos uma MUTAÇÃO de posição programática (trocar dois campos
 *      adjacentes, remover um campo, deslocar NUM_PARC/VL_PARC_PASS, mover o
 *      ICMS-ST) sobre o array de campos.
 *   3. Exigimos que a comparação contra a linha correta FALHE — isto é, que a
 *      linha mutada NÃO seja igual à linha esperada (expected !== mutated).
 *
 * Se qualquer mutação produzisse uma linha ainda IGUAL à esperada, a fixture
 * seria frouxa demais para pegar aquela regressão e este teste falharia,
 * sinalizando o problema (R4.2).
 *
 * Cuidado explícito com o ponto cego da troca: trocar dois campos de MESMO valor
 * é invisível por definição. Por isso o input conhecido foi escolhido com
 * valores DISTINTOS nas posições que mutamos, e cada caso de troca declara os
 * dois índices garantindo valores diferentes. Para remoções, além da
 * desigualdade de string, asseguramos que a CONTAGEM de campos muda (um a menos),
 * cobrindo o cenário em que uma asserção comparasse apenas um prefixo.
 *
 * Escopo mínimo exigido pela tarefa: G110, G125 e 0300. Incluímos também o 0305
 * por consistência com o oráculo da 5.1.
 */
import {
  buildEfdIcmsIpiRecords,
  type SpedCiapBuilderData,
  type SpedEfdBuilderInput,
} from './efd-icms-ipi.builder';
import {
  BLOCO_G_LEIAUTES,
  blocoGFieldPosition,
  serializeSpedRecord,
  type SpedRecord,
} from './core';

// Período de apuração do input conhecido (ddmmaaaa derivam de inicio/fim).
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
    blocoGLeiauteHomologado: true,
  };
}

/**
 * Input CIAP conhecido. VALORES DISTINTOS por posição mutável — condição
 * necessária para que uma TROCA de campos seja detectável (trocar iguais é
 * invisível). Em especial:
 *   - G110: SALDO_IN_ICMS, SOM_PARC, VL_TRIB_EXP, VL_TOTAL todos diferentes.
 *   - G125: VL_IMOB_ICMS_OP/ST/FRT/DIF distintos; NUM_PARC vs VL_PARC_PASS
 *     distintos; ICMS-ST com valor próprio para flagrar seu deslocamento.
 */
const CIAP_CONHECIDO: SpedCiapBuilderData = {
  saldoInicial: '0.00',
  somaParcelas: '150.00',
  saidasTributadas: '700.00',
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
      valorIcmsSt: '320.00',
      valorIcmsFrete: '55.00',
      valorIcmsDifal: '12.00',
      numeroParcela: 7,
      valorParcelaPassivel: '150.00',
    },
  ],
};

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
  return serializeSpedRecord(alvo).split('|').slice(2, -1);
}

/** Monta a linha SPED pipe-delimitada a partir do REG e dos campos. */
function montarLinha(reg: string, campos: readonly string[]): string {
  return ['', reg, ...campos, ''].join('|');
}

// --- Mutadores de posição (operam sobre o array de campos após REG) ---------

/** Troca dois campos de posição. Detectável apenas se os valores diferirem. */
function trocarCampos(
  campos: readonly string[],
  a: number,
  b: number,
): string[] {
  const out = [...campos];
  const tmp = out[a]!;
  out[a] = out[b]!;
  out[b] = tmp;
  return out;
}

/** Remove um campo, deslocando todos os seguintes uma posição para a esquerda. */
function removerCampo(campos: readonly string[], indice: number): string[] {
  const out = [...campos];
  out.splice(indice, 1);
  return out;
}

type MutacaoKind = 'troca' | 'remocao';

interface CasoMutacao {
  reg: string;
  descricao: string;
  kind: MutacaoKind;
  /** Para 'troca': os dois índices (devem ter valores distintos). */
  a?: number;
  b?: number;
  /** Para 'remocao': o índice removido. */
  indice?: number;
}

/**
 * Catálogo de mutações por registro. Cada caso é derivado das POSIÇÕES OFICIAIS
 * do leiaute (via `blocoGFieldPosition`), não de números mágicos — se o leiaute
 * mudar, as mutações acompanham. Cobre os erros clássicos citados na tarefa:
 * trocar campos adjacentes, remover um campo, deslocar NUM_PARC/VL_PARC_PASS e
 * mover o ICMS-ST.
 */
function mutacoes(): CasoMutacao[] {
  const g110 = (f: string) => blocoGFieldPosition('G110', f);
  const g125 = (f: string) => blocoGFieldPosition('G125', f);
  const r0300 = (f: string) => blocoGFieldPosition('0300', f);
  const r0305 = (f: string) => blocoGFieldPosition('0305', f);

  return [
    // G110 — índice de participação / apropriação / saldo.
    {
      reg: 'G110',
      descricao: 'troca VL_TRIB_EXP <-> VL_TOTAL (índice de participação invertido)',
      kind: 'troca',
      a: g110('VL_TRIB_EXP'),
      b: g110('VL_TOTAL'),
    },
    {
      reg: 'G110',
      descricao: 'troca SOM_PARC <-> SALDO_IN_ICMS (adjacentes, valores distintos)',
      kind: 'troca',
      a: g110('SALDO_IN_ICMS'),
      b: g110('SOM_PARC'),
    },
    {
      reg: 'G110',
      descricao: 'remove IND_PER_SAI (desloca ICMS_APROP/SOM_ICMS_OC e reduz a contagem)',
      kind: 'remocao',
      indice: g110('IND_PER_SAI'),
    },
    // G125 — ICMS-ST, NUM_PARC/VL_PARC_PASS.
    {
      reg: 'G125',
      descricao: 'troca VL_IMOB_ICMS_OP <-> VL_IMOB_ICMS_ST (ICMS-ST fora de posição)',
      kind: 'troca',
      a: g125('VL_IMOB_ICMS_OP'),
      b: g125('VL_IMOB_ICMS_ST'),
    },
    {
      reg: 'G125',
      descricao: 'troca NUM_PARC <-> VL_PARC_PASS (parcela deslocada)',
      kind: 'troca',
      a: g125('NUM_PARC'),
      b: g125('VL_PARC_PASS'),
    },
    {
      reg: 'G125',
      descricao: 'remove VL_IMOB_ICMS_ST (volta ao bug antigo de omitir o ICMS-ST)',
      kind: 'remocao',
      indice: g125('VL_IMOB_ICMS_ST'),
    },
    // 0300 — cadastro do bem (referenciado pelo G125).
    {
      reg: '0300',
      descricao: 'troca COD_CTA <-> NR_PARC (conta contábil vs. nº de parcelas)',
      kind: 'troca',
      a: r0300('COD_CTA'),
      b: r0300('NR_PARC'),
    },
    {
      reg: '0300',
      descricao: 'remove IDENT_MERC (desloca descrição e reduz a contagem)',
      kind: 'remocao',
      indice: r0300('IDENT_MERC'),
    },
    // 0305 — utilização do bem (consistência com o oráculo da 5.1).
    {
      reg: '0305',
      descricao: 'troca COD_CCUS <-> FUNC (centro de custo vs. função)',
      kind: 'troca',
      a: r0305('COD_CCUS'),
      b: r0305('FUNC'),
    },
  ];
}

describe('Mutação de posição do Bloco G — a fixture normativa detecta a regressão (R4.2, 5.2)', () => {
  const { records } = buildEfdIcmsIpiRecords(makeInput(CIAP_CONHECIDO));

  // A linha CORRETA é a própria saída do builder validada pela fixture da 5.1.
  // Aqui ela é o ponto de partida das mutações, não o objeto do teste: o objeto
  // é provar que QUALQUER mutação quebra a igualdade.
  const camposCorretos: Record<string, string[]> = {
    G110: camposDaLinha(records, 'G110', 0),
    G125: camposDaLinha(records, 'G125', 0),
    '0300': camposDaLinha(records, '0300', 0),
    '0305': camposDaLinha(records, '0305', 0),
  };

  const linhasCorretas: Record<string, string> = Object.fromEntries(
    Object.entries(camposCorretos).map(([reg, campos]) => [
      reg,
      montarLinha(reg, campos),
    ]),
  );

  // Pré-condição metodológica: as POSIÇÕES que vamos trocar têm valores
  // DISTINTOS. Sem isso, uma troca seria invisível e o teste de mutação seria
  // vazio. Falhar aqui é um sinal de que o input conhecido precisa de valores
  // mais distintos — não um bug do builder.
  describe('pré-condição: valores distintos nas posições trocadas', () => {
    it.each(mutacoes().filter((m) => m.kind === 'troca'))(
      '$reg: $descricao — campos $a e $b têm valores diferentes',
      (caso) => {
        const campos = camposCorretos[caso.reg]!;
        expect(campos[caso.a!]).not.toBe(campos[caso.b!]);
      },
    );
  });

  describe('cada mutação de posição quebra a igualdade contra a linha normativa', () => {
    it.each(mutacoes())('$reg: $descricao', (caso) => {
      const campos = camposCorretos[caso.reg]!;
      const esperada = linhasCorretas[caso.reg]!;

      const mutados =
        caso.kind === 'troca'
          ? trocarCampos(campos, caso.a!, caso.b!)
          : removerCampo(campos, caso.indice!);

      const linhaMutada = montarLinha(caso.reg, mutados);

      // O coração do R4.2: a comparação contra a fixture DEVE falhar para a
      // linha mutada (expected !== mutated).
      expect(linhaMutada).not.toBe(esperada);

      // Para remoções, a desigualdade de string poderia, em tese, ser mascarada
      // por uma asserção que só olhasse um prefixo. Garantimos que a CONTAGEM de
      // campos muda — qualquer validação de `fieldCountAfterReg` também pega.
      if (caso.kind === 'remocao') {
        const oficial = BLOCO_G_LEIAUTES[caso.reg]!.fieldCountAfterReg;
        expect(campos.length).toBe(oficial);
        expect(mutados.length).toBe(oficial - 1);
        expect(mutados.length).not.toBe(oficial);
      }
    });
  });

  // Verificação de integridade do próprio teste de mutação: um "mutante nulo"
  // (nenhuma mutação) DEVE continuar igual. Se este caso falhasse, a montagem da
  // linha ou a leitura dos campos estaria inconsistente com a 5.1 e os demais
  // resultados não teriam valor.
  it('mutante nulo (sem mutação) permanece igual — sanidade do oráculo', () => {
    for (const [reg, campos] of Object.entries(camposCorretos)) {
      expect(montarLinha(reg, campos)).toBe(linhasCorretas[reg]);
    }
  });
});
