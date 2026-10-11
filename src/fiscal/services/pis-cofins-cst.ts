/**
 * CST → HIPÓTESE DE PIS/COFINS (Fase 4 / tarefa 3.4 — R2.4).
 *
 * O estado anterior (`PisCofinsService`) decidia o tratamento de cada CST por
 * TRÊS `Set`s estáticos — `CST_TRIBUTADO` (01/02), `CST_SEM_DEBITO` (04–09) e
 * `CST_CREDITO` (50–56 e 60–66). Essa modelagem por "pertencer a um Set" tem
 * dois defeitos que o design (§PIS/COFINS F13) e o requisito R2.4 rejeitam
 * explicitamente:
 *
 *   1. CST 03 ("tributação por ALÍQUOTA POR UNIDADE DE MEDIDA" — ad rem) ficava
 *      FORA de `CST_TRIBUTADO`: ou era ignorado, ou, se fosse só adicionado ao
 *      `Set`, cairia no cálculo base × percentual, que é a hipótese ERRADA. O
 *      débito do CST 03 é `quantidade × alíquota-em-reais` (ad rem), uma
 *      HIPÓTESE DE CÁLCULO distinta de base × percentual. Ampliar o `Set` de
 *      tributados não resolve: misturaria duas aritméticas incompatíveis.
 *
 *   2. CST 67 (crédito PRESUMIDO) e os créditos BÁSICOS (50–56) estavam no MESMO
 *      `Set` `CST_CREDITO` (que inclui 60–66). Somar tudo num `Set` único
 *      MISTURA tipos de crédito distintos — exatamente o que R2.4 proíbe:
 *      "Tipos de crédito distintos NÃO DEVEM se misturar; (...) créditos
 *      presumidos (CST 67) DEVEM ser tratados por hipótese, não por ampliação de
 *      um Set." O crédito presumido tem base legal e limitação próprias e NÃO
 *      pode compor o mesmo total do crédito básico.
 *
 * Este módulo substitui os `Set`s por um MAPEAMENTO POR HIPÓTESE: cada CST é
 * resolvido para (a) a `PisCofinsNaturezaReceita`/`PisCofinsNaturezaCredito` da
 * tarefa 3.1, e (b) o MÉTODO DE CÁLCULO do débito — `BASE_PERCENTUAL` (base ×
 * alíquota / 100, CST 01/02) ou `AD_REM` (quantidade × alíquota-em-reais, CST
 * 03). Assim o CST 03 vira uma hipótese própria (não um tributado genérico) e o
 * CST 67 vira `PRESUMIDO` (não um crédito básico), SEM ampliar nenhum `Set`.
 *
 * É a PEÇA PURA que fica ENTRE a classificação documental (o CST do item) e o
 * calculador por natureza (`pis-cofins-natureza.ts`, 3.1) e o razão
 * (`pis-cofins-razao.ts`, 3.2): o chamador resolve o CST aqui, obtém a hipótese,
 * e então calcula o débito ad rem localmente (quando `AD_REM`) ou alimenta a
 * base no calculador percentual (quando `BASE_PERCENTUAL`). Não consulta banco.
 *
 * DECIMAIS SEMPRE COMO STRING (restrição da fase): o débito ad rem usa inteiros
 * escalados (`bigint`) via `sped-decimal`; nenhum valor passa por `Number`. A
 * quantidade e a alíquota ad rem (em reais por unidade) chegam como strings e
 * assim permanecem.
 *
 * ESCOPO DESTA TAREFA (3.4): o mapeamento por hipótese, o cálculo ad rem do CST
 * 03 e a separação do crédito presumido (CST 67) do básico. NÃO entram aqui o
 * tratamento de regime ausente (3.5 — modelado na 3.1) nem a persistência.
 */

import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';
import type {
  PisCofinsNaturezaCredito,
  PisCofinsNaturezaReceita,
} from './pis-cofins-natureza';

// Escala monetária (centavos), padrão das colunas `numeric(_,2)` do fiscal.
const ESCALA_VALOR = 2;
// Escala da quantidade (4 casas) e da alíquota ad rem em reais por unidade (4
// casas), coerente com `qBCProd`/`vAliqProd` do item PIS/COFINS da NF-e.
const ESCALA_QUANTIDADE = 4;
const ESCALA_ALIQUOTA_AD_REM = 4;

/**
 * MÉTODO de cálculo do débito de uma receita tributada — a HIPÓTESE que o CST
 * seleciona (R2.4). É o eixo que o `Set` único não distinguia:
 *
 * - `BASE_PERCENTUAL`: débito = base × alíquota(%) / 100. Hipótese do CST 01
 *   (alíquota básica) e CST 02 (alíquota diferenciada). É a aritmética que o
 *   calculador por natureza (3.1) já implementa.
 * - `AD_REM`: débito = quantidade × alíquota-em-reais-por-unidade. Hipótese do
 *   CST 03 (tributação por unidade de medida). NÃO é base × percentual — por
 *   isso é uma hipótese separada, calculada por `calcularDebitoAdRem` aqui, e
 *   nunca somada à base percentual.
 * - `NENHUM`: a natureza não gera débito próprio (monofásica/ST/alíquota zero/
 *   crédito), ou o CST não é de receita tributada.
 */
export type PisCofinsMetodoCalculo = 'BASE_PERCENTUAL' | 'AD_REM' | 'NENHUM';

/**
 * EFEITO de um CST quanto à apuração: ele classifica uma RECEITA (débito ou
 * ausência dele) ou uma AQUISIÇÃO (crédito, regime não-cumulativo). Mantê-los
 * distintos impede que um CST de crédito seja tratado como receita e vice-versa.
 *
 * - `RECEITA`: CST de saída (01–09) — débito ou base sem débito.
 * - `CREDITO`: CST de entrada (50–56, 60–67) — crédito, por natureza de crédito.
 */
export type PisCofinsEfeitoCst = 'RECEITA' | 'CREDITO';

/**
 * HIPÓTESE resolvida de um CST: o resultado do mapeamento. Reúne o efeito
 * (receita × crédito), a natureza da tarefa 3.1 e o método de cálculo (R2.4).
 * Para CST de crédito, `naturezaCredito` é o tipo (básico × presumido ×
 * importação) que NÃO se mistura num `Set` único.
 */
export interface PisCofinsHipoteseCst {
  // O CST normalizado (dois dígitos) que originou a hipótese.
  cst: string;
  // Receita ou crédito (eixo primário).
  efeito: PisCofinsEfeitoCst;
  // Natureza da receita (quando `efeito === 'RECEITA'`), tarefa 3.1.
  naturezaReceita: PisCofinsNaturezaReceita;
  // Natureza do crédito (quando `efeito === 'CREDITO'`), tarefa 3.1. `NENHUM`
  // para CST de receita. CST 67 → `PRESUMIDO`, distinto de `BASICO` (R2.4).
  naturezaCredito: PisCofinsNaturezaCredito;
  // Método de cálculo do débito (R2.4): base × percentual, ad rem ou nenhum.
  metodoCalculo: PisCofinsMetodoCalculo;
  // Verdadeiro quando a receita gera débito próprio (CST 01/02/03).
  geraDebito: boolean;
  // Verdadeiro quando a aquisição gera crédito (CST 50–56, 60–67).
  geraCredito: boolean;
  // Descrição auditável da hipótese do CST.
  descricao: string;
}

// ── Tabela de hipóteses por CST ───────────────────────────────────────────────
// Cada CST tem UMA hipótese explícita, em vez de pertencer a um `Set`. CST 03 é
// a única com `metodoCalculo: 'AD_REM'`; CST 67 é a única com `naturezaCredito:
// 'PRESUMIDO'` — ambos tratados por hipótese, não por ampliação de `Set` (R2.4).
const HIPOTESES_CST: Record<string, Omit<PisCofinsHipoteseCst, 'cst'>> = {
  // Receita tributada — base × percentual (hipótese padrão).
  '01': {
    efeito: 'RECEITA',
    naturezaReceita: 'TRIBUTADA',
    naturezaCredito: 'NENHUM',
    metodoCalculo: 'BASE_PERCENTUAL',
    geraDebito: true,
    geraCredito: false,
    descricao:
      'CST 01: receita tributável à alíquota básica — débito por base × ' +
      'percentual.',
  },
  '02': {
    efeito: 'RECEITA',
    naturezaReceita: 'TRIBUTADA',
    naturezaCredito: 'NENHUM',
    metodoCalculo: 'BASE_PERCENTUAL',
    geraDebito: true,
    geraCredito: false,
    descricao:
      'CST 02: receita tributável à alíquota diferenciada — débito por base × ' +
      'percentual (alíquota do item).',
  },
  // CST 03: tributação por ALÍQUOTA POR UNIDADE DE MEDIDA (ad rem). HIPÓTESE
  // DISTINTA (R2.4): débito = quantidade × alíquota-em-reais, NÃO base ×
  // percentual. Não é somado à base dos CST 01/02.
  '03': {
    efeito: 'RECEITA',
    naturezaReceita: 'TRIBUTADA',
    naturezaCredito: 'NENHUM',
    metodoCalculo: 'AD_REM',
    geraDebito: true,
    geraCredito: false,
    descricao:
      'CST 03: receita tributável à alíquota POR UNIDADE DE MEDIDA (ad rem) — ' +
      'débito por quantidade × alíquota-em-reais, hipótese distinta de base × ' +
      'percentual (R2.4).',
  },
  // Receitas SEM débito próprio (monofásica/ST/alíquota zero/isenta/suspensa).
  '04': {
    efeito: 'RECEITA',
    naturezaReceita: 'MONOFASICA',
    naturezaCredito: 'NENHUM',
    metodoCalculo: 'NENHUM',
    geraDebito: false,
    geraCredito: false,
    descricao:
      'CST 04: receita monofásica à alíquota zero — base registrada, sem ' +
      'débito próprio.',
  },
  '05': {
    efeito: 'RECEITA',
    naturezaReceita: 'SUBSTITUICAO',
    naturezaCredito: 'NENHUM',
    metodoCalculo: 'NENHUM',
    geraDebito: false,
    geraCredito: false,
    descricao:
      'CST 05: receita por substituição tributária — base registrada, sem ' +
      'débito próprio.',
  },
  '06': {
    efeito: 'RECEITA',
    naturezaReceita: 'ALIQUOTA_ZERO',
    naturezaCredito: 'NENHUM',
    metodoCalculo: 'NENHUM',
    geraDebito: false,
    geraCredito: false,
    descricao: 'CST 06: receita à alíquota zero — base registrada, sem débito.',
  },
  '07': {
    efeito: 'RECEITA',
    naturezaReceita: 'ALIQUOTA_ZERO',
    naturezaCredito: 'NENHUM',
    metodoCalculo: 'NENHUM',
    geraDebito: false,
    geraCredito: false,
    descricao: 'CST 07: receita isenta — base registrada, sem débito.',
  },
  '08': {
    efeito: 'RECEITA',
    naturezaReceita: 'ALIQUOTA_ZERO',
    naturezaCredito: 'NENHUM',
    metodoCalculo: 'NENHUM',
    geraDebito: false,
    geraCredito: false,
    descricao: 'CST 08: receita sem incidência — base registrada, sem débito.',
  },
  '09': {
    efeito: 'RECEITA',
    naturezaReceita: 'ALIQUOTA_ZERO',
    naturezaCredito: 'NENHUM',
    metodoCalculo: 'NENHUM',
    geraDebito: false,
    geraCredito: false,
    descricao: 'CST 09: receita com suspensão — base registrada, sem débito.',
  },
  // Créditos BÁSICOS (50–56): aquisições do mercado interno/exportação.
  ...creditoBasico(
    '50',
    'operação com direito a crédito — vinculada à receita tributada no mercado interno',
  ),
  ...creditoBasico(
    '51',
    'operação com direito a crédito — vinculada à receita não tributada no mercado interno',
  ),
  ...creditoBasico(
    '52',
    'operação com direito a crédito — vinculada à receita de exportação',
  ),
  ...creditoBasico(
    '53',
    'operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno',
  ),
  ...creditoBasico(
    '54',
    'operação com direito a crédito — vinculada a receitas tributadas no mercado interno e de exportação',
  ),
  ...creditoBasico(
    '55',
    'operação com direito a crédito — vinculada a receitas não tributadas no mercado interno e de exportação',
  ),
  ...creditoBasico(
    '56',
    'operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno e de exportação',
  ),
  // Créditos PRESUMIDOS da agroindústria (60–66). Natureza PRESUMIDO — NÃO se
  // mistura ao básico (R2.4).
  ...creditoPresumido(
    '60',
    'crédito presumido da agroindústria — vinculado à receita tributada no mercado interno',
  ),
  ...creditoPresumido(
    '61',
    'crédito presumido da agroindústria — vinculado à receita não tributada no mercado interno',
  ),
  ...creditoPresumido(
    '62',
    'crédito presumido da agroindústria — vinculado à receita de exportação',
  ),
  ...creditoPresumido(
    '63',
    'crédito presumido da agroindústria — vinculado a receitas tributadas e não tributadas no mercado interno',
  ),
  ...creditoPresumido(
    '64',
    'crédito presumido da agroindústria — vinculado a receitas tributadas no mercado interno e de exportação',
  ),
  ...creditoPresumido(
    '65',
    'crédito presumido da agroindústria — vinculado a receitas não tributadas no mercado interno e de exportação',
  ),
  ...creditoPresumido(
    '66',
    'crédito presumido da agroindústria — vinculado a receitas tributadas e não tributadas no mercado interno e de exportação',
  ),
  // CST 67: outros CRÉDITOS PRESUMIDOS. É o foco de R2.4: tratado como
  // PRESUMIDO por hipótese, NUNCA somado ao crédito básico num `Set` único.
  '67': {
    efeito: 'CREDITO',
    naturezaReceita: 'OUTRA',
    naturezaCredito: 'PRESUMIDO',
    metodoCalculo: 'NENHUM',
    geraDebito: false,
    geraCredito: true,
    descricao:
      'CST 67: outros créditos presumidos — natureza PRESUMIDO, tratada por ' +
      'hipótese e NÃO misturada ao crédito básico (R2.4).',
  },
};

// Monta a hipótese de um CST de crédito básico (50–56).
function creditoBasico(
  cst: string,
  detalhe: string,
): Record<string, Omit<PisCofinsHipoteseCst, 'cst'>> {
  return {
    [cst]: {
      efeito: 'CREDITO',
      naturezaReceita: 'OUTRA',
      naturezaCredito: 'BASICO',
      metodoCalculo: 'NENHUM',
      geraDebito: false,
      geraCredito: true,
      descricao: `CST ${cst}: ${detalhe} — crédito BÁSICO.`,
    },
  };
}

// Monta a hipótese de um CST de crédito presumido (60–66). Natureza PRESUMIDO,
// distinta do básico (R2.4).
function creditoPresumido(
  cst: string,
  detalhe: string,
): Record<string, Omit<PisCofinsHipoteseCst, 'cst'>> {
  return {
    [cst]: {
      efeito: 'CREDITO',
      naturezaReceita: 'OUTRA',
      naturezaCredito: 'PRESUMIDO',
      metodoCalculo: 'NENHUM',
      geraDebito: false,
      geraCredito: true,
      descricao: `CST ${cst}: ${detalhe} — crédito PRESUMIDO (R2.4).`,
    },
  };
}

/**
 * Resolve a HIPÓTESE de um CST de PIS/COFINS (R2.4), substituindo os `Set`s
 * estáticos. Normaliza o CST para dois dígitos (ex.: '1' → '01', '03 ' → '03') e
 * devolve a natureza (3.1), o método de cálculo e os eixos de débito/crédito.
 *
 * Quando o CST não é reconhecido, NÃO cai em um tratamento presumido: devolve
 * `null`, para o chamador registrar a pendência (R2.1/escopo honesto) em vez de
 * tributar ou creditar por engano.
 */
export function resolverHipoteseCst(
  cst: string | null | undefined,
): PisCofinsHipoteseCst | null {
  const normalizado = normalizarCst(cst);
  if (normalizado == null) return null;
  const hipotese = HIPOTESES_CST[normalizado];
  if (!hipotese) return null;
  return { cst: normalizado, ...hipotese };
}

/**
 * Entrada do cálculo AD REM (CST 03): a quantidade vendida (na unidade de
 * medida tributada) e a alíquota em REAIS POR UNIDADE. Ambas chegam como string
 * decimal e assim permanecem — nunca `Number`.
 */
export interface PisCofinsAdRemInput {
  // Quantidade na unidade de medida tributada (string decimal, 4 casas).
  quantidade: string;
  // Alíquota em REAIS por unidade (string decimal, 4 casas). É `vAliqProd` da
  // NF-e: um valor monetário por unidade, NÃO um percentual.
  aliquotaReais: string;
}

/**
 * CÁLCULO AD REM do débito do CST 03 (R2.4): `débito = quantidade × alíquota-
 * em-reais`. É a HIPÓTESE que o `Set` de tributados não contemplava — por isso
 * fica isolada aqui e NUNCA é confundida com base × percentual.
 *
 * A multiplicação é feita em inteiros escalados: quantidade (escala 4) ×
 * alíquota-reais (escala 4) resultaria em escala 8; dividimos por 10^(4+4−2)
 * para voltar à escala monetária (2 casas), com arredondamento meia casa para
 * cima — mesmo critério do `ROUND(.,2)` usado no débito percentual (R5.5), para
 * não divergir ao integrar com o calculador por natureza.
 */
export function calcularDebitoAdRem(input: PisCofinsAdRemInput): string {
  const quantidadeScaled = toScaledInteger(input.quantidade, ESCALA_QUANTIDADE);
  const aliquotaScaled = toScaledInteger(
    input.aliquotaReais,
    ESCALA_ALIQUOTA_AD_REM,
  );
  // produto tem escala (4 + 4) = 8; divisor leva de 8 → 2 casas.
  const produtoScaled = quantidadeScaled * aliquotaScaled;
  const divisor =
    10n ** BigInt(ESCALA_QUANTIDADE + ESCALA_ALIQUOTA_AD_REM - ESCALA_VALOR);
  const debitoScaled = roundScaledDivision(produtoScaled, divisor);
  return fromScaledInteger(debitoScaled, ESCALA_VALOR);
}

/**
 * GUARDA DE NÃO-MISTURA DE CRÉDITOS (R2.4). Verdadeiro apenas quando as DUAS
 * naturezas de crédito são a MESMA. É o ponto único que impede somar crédito
 * BÁSICO com PRESUMIDO (ou importação) num mesmo total — o que a ampliação de um
 * `Set` fazia silenciosamente. O chamador usa esta guarda para acumular créditos
 * em baldes SEPARADOS por natureza, nunca num balde único.
 */
export function creditosMesmaNatureza(
  a: PisCofinsNaturezaCredito,
  b: PisCofinsNaturezaCredito,
): boolean {
  return a === b;
}

// Normaliza o CST para dois dígitos. Aceita '1'→'01', '03'→'03', '03 '→'03';
// devolve `null` para entradas vazias/não numéricas (o chamador trata como
// pendência, nunca como tributado presumido).
function normalizarCst(cst: string | null | undefined): string | null {
  if (cst == null) return null;
  const t = cst.trim();
  if (t === '' || !/^\d{1,2}$/.test(t)) return null;
  return t.padStart(2, '0');
}

/**
 * Divisão inteira de bigint com arredondamento meia casa para cima (half-up),
 * equivalente ao `ROUND(x, 2)` do PostgreSQL. Idêntica à usada em
 * `PisCofinsService`/`pis-cofins-natureza.ts` (R5.5), para que o débito ad rem
 * NÃO divirja do débito percentual ao ser integrado.
 */
function roundScaledDivision(numerator: bigint, divisor: bigint): bigint {
  if (divisor === 0n) return 0n;
  const negative = numerator < 0n !== divisor < 0n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDiv = divisor < 0n ? -divisor : divisor;
  const rounded = (absNum + absDiv / 2n) / absDiv;
  return negative ? -rounded : rounded;
}
