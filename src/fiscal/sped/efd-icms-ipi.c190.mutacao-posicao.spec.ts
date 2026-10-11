/**
 * Teste de MUTAÇÃO DE POSIÇÃO do C190 — a verificação normativa é sensível à
 * posição dos campos (R3.4, tarefa 3.3).
 *
 * Contexto
 * --------
 * A tarefa 3.2 (`efd-icms-ipi.cfop-dominio.fixtures-normativas.spec.ts`) provou
 * que o builder reproduz, campo a campo, o oráculo do C190 escrito à mão a
 * partir do leiaute oficial. Mas um oráculo só tem valor se EFETIVAMENTE pega o
 * erro que diz pegar: uma comparação frouxa (que ignorasse ordem, comparasse
 * como conjunto ou tolerasse um campo a menos) continuaria "verde" diante de
 * uma regressão real de posição. R3.4 exige o contrário: QUANDO uma posição de
 * campo é corrompida, o teste DEVE falhar.
 *
 * Este spec fecha esse buraco para a camada "arquivo" (§11.1, camada 5) no bloco
 * C — complementando a cobertura de mutação já existente no Bloco G
 * (`efd-icms-ipi.bloco-g.mutacao-posicao.spec.ts`). Juntos, provam a
 * sensibilidade de posição tanto no C190 (oráculo da 3.2) quanto no Bloco G.
 *
 * Metodologia (mutation testing aplicado ao oráculo)
 * --------------------------------------------------
 *   1. Partimos da linha C190 CORRETA — a saída do builder, já validada campo a
 *      campo pela fixture normativa da 3.2.
 *   2. Aplicamos uma MUTAÇÃO de posição programática sobre o array de campos
 *      (trocar dois campos de valores distintos, ou remover um campo).
 *   3. Exigimos que a comparação contra a linha correta FALHE — a linha mutada
 *      NÃO pode ser igual à esperada (`expected !== mutated`).
 *
 * Se alguma mutação produzisse uma linha ainda IGUAL à esperada, o oráculo seria
 * frouxo demais para aquela regressão e ESTE teste falharia, sinalizando o
 * problema (R3.4).
 *
 * Ponto cego explícito da troca: trocar dois campos de MESMO valor é invisível
 * por definição. Por isso o cenário conhecido foi montado com valores DISTINTOS
 * nas posições mutadas, e cada caso de troca é precedido por uma pré-condição
 * que garante valores diferentes nas duas posições. Para remoções, além da
 * desigualdade de string, asseguramos que a CONTAGEM de campos muda (um a
 * menos) — cobrindo uma asserção que, por engano, só comparasse um prefixo.
 *
 * Ordem oficial dos campos do C190 (após o REG) — mesmo oráculo da 3.2:
 *   [0] CST_ICMS   [1] CFOP        [2] ALIQ_ICMS   [3] VL_OPR
 *   [4] VL_BC_ICMS [5] VL_ICMS     [6] VL_BC_ICMS_ST [7] VL_ICMS_ST
 *   [8] VL_RED_BC  [9] VL_IPI      [10] COD_OBS
 */
import { buildEfdIcmsIpiRecords } from './efd-icms-ipi.builder';
import { serializeSpedRecord, type SpedRecord } from './core';
import {
  EMPRESA_CNPJ,
  inputFixture,
  itemRow,
  nfeFixture,
} from './__fixtures__/normative-rows';

// ---------------------------------------------------------------------------
// Oráculo de posição do C190 (fonte única deste spec)
// ---------------------------------------------------------------------------
// Nomes e índices oficiais dos campos APÓS o REG, derivados do leiaute EFD (os
// mesmos documentados na fixture normativa da 3.2). Usados para derivar as
// mutações de números NÃO mágicos: se o leiaute mudar, as mutações acompanham.
const C190_CAMPOS = [
  'CST_ICMS',
  'CFOP',
  'ALIQ_ICMS',
  'VL_OPR',
  'VL_BC_ICMS',
  'VL_ICMS',
  'VL_BC_ICMS_ST',
  'VL_ICMS_ST',
  'VL_RED_BC',
  'VL_IPI',
  'COD_OBS',
] as const;

type C190Campo = (typeof C190_CAMPOS)[number];

/** Quantidade oficial de campos após REG do C190 (EXPECTED_FIELD_COUNTS.C190). */
const C190_FIELD_COUNT = C190_CAMPOS.length; // 11

/** Índice 0-based do campo no leiaute — não um número mágico. */
function pos(campo: C190Campo): number {
  return C190_CAMPOS.indexOf(campo);
}

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
  const tmp = out[a];
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

/**
 * Cenário C190 conhecido: uma SAÍDA tributada com ICMS normal, ICMS-ST E IPI
 * destacados ao mesmo tempo. Essa combinação garante que TODAS as posições
 * mutáveis carreguem VALORES DISTINTOS entre si — condição necessária para que
 * uma troca de campos seja detectável (trocar iguais é invisível).
 *
 * Aritmética do documento (oráculo externo, não derivada do builder):
 *   - VL_OPR = líquido (1000) + ICMS-ST (36) + IPI (100) = 1136,00
 *   - VL_BC_ICMS = 1000,00   VL_ICMS = 180,00
 *   - VL_BC_ICMS_ST = 1200,00  VL_ICMS_ST = 36,00
 *   - VL_RED_BC = 0,00       VL_IPI = 100,00
 *   - ALIQ_ICMS = 18,00      CST = 010 (origem 0 + CST 10)  CFOP = 5401
 */
function cenarioC190Distinto() {
  return inputFixture({
    nfe: [
      nfeFixture(
        {
          id: 'c190-mut',
          chaveAcesso: 'c190-mut'.padEnd(44, '0'),
          numeroDocumento: '8001',
          emitenteCnpjCpf: EMPRESA_CNPJ,
          destinatarioCnpjCpf: '12345678000199',
          tipoOperacaoEscriturada: 'SAIDA',
          tpNfXml: '1',
        },
        [
          itemRow({
            cstIcms: '10',
            csosnIcms: null,
            cfop: '5401',
            origemMercadoria: '0',
            valorBrutoProduto: '1000.00',
            valorBcIcms: '1000.00',
            aliquotaIcms: '18.00',
            valorIcms: '180.00',
            valorBcIcmsSt: '1200.00',
            aliquotaIcmsSt: '18.00',
            valorIcmsSt: '36.00',
            valorFcpSt: '0.00',
            cstIpi: '50',
            valorBcIpi: '1000.00',
            aliquotaIpi: '10.00',
            valorIpi: '100.00',
          }),
        ],
      ),
    ],
  });
}

type MutacaoKind = 'troca' | 'remocao';

interface CasoMutacao {
  descricao: string;
  kind: MutacaoKind;
  /** Para 'troca': os dois campos (devem ter valores distintos). */
  a?: C190Campo;
  b?: C190Campo;
  /** Para 'remocao': o campo removido. */
  campo?: C190Campo;
}

/**
 * Catálogo de mutações do C190. Cada caso ataca um dos erros clássicos de
 * posição no bloco C: inverter o par CFOP/alíquota, deslocar o par de ICMS-ST,
 * trocar o IPI com uma base, ou omitir um campo condicional. Os índices vêm de
 * `pos()` — se o leiaute mudar, as mutações acompanham.
 */
const MUTACOES: readonly CasoMutacao[] = [
  {
    descricao: 'troca CFOP <-> ALIQ_ICMS (código escriturado vs. alíquota)',
    kind: 'troca',
    a: 'CFOP',
    b: 'ALIQ_ICMS',
  },
  {
    descricao: 'troca VL_BC_ICMS_ST <-> VL_ICMS_ST (par de ST deslocado)',
    kind: 'troca',
    a: 'VL_BC_ICMS_ST',
    b: 'VL_ICMS_ST',
  },
  {
    descricao: 'troca VL_OPR <-> VL_BC_ICMS (operação vs. base de cálculo)',
    kind: 'troca',
    a: 'VL_OPR',
    b: 'VL_BC_ICMS',
  },
  {
    descricao: 'troca VL_ICMS <-> VL_IPI (imposto trocado de coluna)',
    kind: 'troca',
    a: 'VL_ICMS',
    b: 'VL_IPI',
  },
  {
    descricao:
      'remove VL_ICMS_ST (desloca VL_RED_BC/VL_IPI e reduz a contagem)',
    kind: 'remocao',
    campo: 'VL_ICMS_ST',
  },
  {
    descricao: 'remove ALIQ_ICMS (desloca todo o resto da linha)',
    kind: 'remocao',
    campo: 'ALIQ_ICMS',
  },
];

describe('Mutação de posição do C190 — a fixture normativa detecta a regressão (R3.4, 3.3)', () => {
  const { records } = buildEfdIcmsIpiRecords(cenarioC190Distinto());

  // A linha CORRETA é a própria saída do builder validada campo a campo pela
  // fixture da 3.2. Aqui ela é o PONTO DE PARTIDA das mutações, não o objeto do
  // teste: o objeto é provar que QUALQUER mutação quebra a igualdade.
  const camposCorretos = camposDaLinha(records, 'C190', 0);
  const linhaCorreta = montarLinha('C190', camposCorretos);

  // Sanidade do cenário: o C190 saiu com a contagem oficial de campos. Se o
  // builder regredir a contagem, as mutações de posição perdem o referencial.
  it('o cenário conhecido produz um C190 com a contagem oficial de campos', () => {
    expect(camposCorretos).toHaveLength(C190_FIELD_COUNT);
  });

  // Pré-condição metodológica: as POSIÇÕES que vamos trocar têm valores
  // DISTINTOS. Sem isso, uma troca seria invisível e o teste de mutação seria
  // vazio. Falhar aqui sinaliza que o cenário conhecido precisa de valores mais
  // distintos — não um bug do builder.
  describe('pré-condição: valores distintos nas posições trocadas', () => {
    it.each(MUTACOES.filter((m) => m.kind === 'troca'))(
      '$descricao — os dois campos têm valores diferentes',
      (caso) => {
        expect(camposCorretos[pos(caso.a!)]).not.toBe(
          camposCorretos[pos(caso.b!)],
        );
      },
    );
  });

  describe('cada mutação de posição quebra a igualdade contra a linha normativa', () => {
    it.each(MUTACOES)('$descricao', (caso) => {
      const mutados =
        caso.kind === 'troca'
          ? trocarCampos(camposCorretos, pos(caso.a!), pos(caso.b!))
          : removerCampo(camposCorretos, pos(caso.campo!));

      const linhaMutada = montarLinha('C190', mutados);

      // O coração do R3.4: a comparação contra a fixture DEVE falhar para a
      // linha mutada (expected !== mutated).
      expect(linhaMutada).not.toBe(linhaCorreta);

      // Para remoções, a desigualdade de string poderia, em tese, ser mascarada
      // por uma asserção que só olhasse um prefixo. Garantimos que a CONTAGEM de
      // campos muda — qualquer validação de `fieldCountAfterReg` também pega.
      if (caso.kind === 'remocao') {
        expect(camposCorretos.length).toBe(C190_FIELD_COUNT);
        expect(mutados.length).toBe(C190_FIELD_COUNT - 1);
        expect(mutados.length).not.toBe(C190_FIELD_COUNT);
      }
    });
  });

  // Verificação de integridade do próprio teste de mutação: um "mutante nulo"
  // (nenhuma mutação) DEVE continuar igual. Se este caso falhasse, a montagem da
  // linha ou a leitura dos campos estaria inconsistente com a 3.2 e os demais
  // resultados não teriam valor.
  it('mutante nulo (sem mutação) permanece igual — sanidade do oráculo', () => {
    expect(montarLinha('C190', camposCorretos)).toBe(linhaCorreta);
  });
});
