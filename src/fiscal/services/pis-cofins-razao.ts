/**
 * RAZÃO DE RECEITAS DE PIS/COFINS (Fase 4 / tarefa 3.2 — R2.2, R2.6).
 *
 * O estado anterior (`PisCofinsService.somarPorSegmento`) apurava a receita
 * EXCLUSIVAMENTE a partir dos itens de documentos fiscais de mercadoria
 * (`documentos_fiscais_itens`, XML da NF-e). O design (§PIS/COFINS F13) rejeita
 * essa dependência única: exige "um RAZÃO DE RECEITAS que NÃO depende só do XML
 * de mercadorias", no qual "receitas sem NF-e, retenções e saldos anteriores
 * DEVEM ser incorporados" (R2.6), e no qual uma receita não coberta pelos XMLs
 * "DEVE aparecer como PENDÊNCIA, não como zero" (R2.2).
 *
 * Este módulo é a PEÇA PURA desse razão, espelhando `difal-base.ts` (a
 * composição pura da base do DIFAL): recebe LANÇAMENTOS de receita de QUALQUER
 * fonte (XML, sem NF-e, retenções, saldos anteriores) e, opcionalmente, uma
 * RECEITA ESPERADA do período (ex.: receita contábil/declarada), e consolida um
 * razão por NATUREZA que:
 *   - agrega as bases por natureza/vinculação, para alimentar o calculador puro
 *     por natureza (`calcularPisCofinsNatureza`, tarefa 3.1) SEM reescrevê-lo;
 *   - incorpora retenções já sofridas e saldos de período anterior como
 *     lançamentos de primeira classe (R2.6);
 *   - quando a receita coberta pelos lançamentos é MENOR que a receita esperada,
 *     registra a diferença como uma PENDÊNCIA explícita (R2.2) — nunca a trata
 *     como zero silencioso.
 *
 * Não consulta banco, não resolve vigência nem calcula tributo: isso é do
 * serviço que o orquestra (`PisCofinsService`), que buscará os lançamentos de
 * cada fonte, montará a receita esperada e repassará tudo aqui. Manter o razão
 * puro deixa a consolidação testável sem banco, igual ao `difal-base`.
 *
 * DECIMAIS SEMPRE COMO STRING (restrição da fase): toda a aritmética usa
 * inteiros escalados (`bigint`) via `sped-decimal`; nenhum valor passa por
 * `Number`. As retenções e saldos chegam como strings e assim permanecem.
 *
 * RÓTULO "DEMONSTRATIVO" (R2.6, contexto da tarefa 3.6): enquanto a cobertura
 * não está completa — há pendência de receita (R2.2) ou algum lançamento é
 * simulação/sem fonte homologada — o razão expõe `demonstrativo = true`,
 * mantendo o rótulo provisório. A guia definitiva depende do calculador por
 * natureza (3.1) E da cobertura completa do razão.
 *
 * ESCOPO DESTA TAREFA (3.2): estabelecer o razão de receitas multi-fonte, a
 * incorporação de receitas sem NF-e/retenções/saldos anteriores e a pendência
 * de cobertura. NÃO entram aqui: a preservação do saldo credor a transportar
 * (tarefa 3.3), CST 03/CST 67 por hipótese (3.4) e o tratamento de regime
 * ausente (3.5 — modelado na 3.1). A estrutura é projetada para que essas
 * tarefas construam SOBRE ela: cada natureza já carrega vinculação e
 * `naturezaCredito`, e as retenções/saldos já são eixos do razão.
 */

import {
  fromScaledInteger,
  positive,
  toScaledInteger,
} from '../sped/sped-decimal';
import type {
  PisCofinsNaturezaCredito,
  PisCofinsNaturezaReceita,
  PisCofinsVinculacao,
} from './pis-cofins-natureza';

// Escala monetária (centavos), padrão das colunas `numeric(_,2)` do fiscal.
const ESCALA_VALOR = 2;

/**
 * FONTE de um lançamento de receita no razão (R2.6). A existência de fontes
 * ALÉM do XML é o cerne da tarefa: o razão não depende só da NF-e de mercadoria.
 *
 * - `XML_NFE`: receita apurada a partir dos itens de NF-e (fluxo legado).
 * - `SEM_NFE`: receita SEM nota fiscal eletrônica (ex.: serviço registrado por
 *   outro meio, receita financeira, venda a consumidor sem NF-e). Incorporada
 *   explicitamente por R2.6.
 * - `RETENCAO`: PIS/COFINS RETIDO na fonte por terceiro (ex.: retenção de
 *   órgão público, pessoa jurídica tomadora). Não é base de receita nova, mas um
 *   crédito/abatimento a rastrear; entra como lançamento próprio (R2.6).
 * - `SALDO_ANTERIOR`: saldo (credor/devedor) transportado do período anterior
 *   (R2.6). A preservação/transporte do saldo CREDOR em si é a tarefa 3.3; aqui
 *   ele é incorporado como lançamento rastreável do razão.
 * - `AJUSTE`: ajuste manual identificado (estorno, complemento), com fonte.
 */
export type PisCofinsFonteReceita =
  | 'XML_NFE'
  | 'SEM_NFE'
  | 'RETENCAO'
  | 'SALDO_ANTERIOR'
  | 'AJUSTE';

/**
 * TIPO de lançamento quanto ao efeito no razão. Separa a RECEITA (base que gera
 * débito/crédito conforme a natureza, tarefa 3.1) da RETENÇÃO (valor já retido,
 * abatimento) e do SALDO anterior (transporte). Mantê-los distintos impede que
 * uma retenção seja somada como se fosse base de receita.
 *
 * - `RECEITA`: lançamento que compõe a BASE de uma natureza.
 * - `RETENCAO`: valor de PIS/COFINS já retido na fonte (abatimento), não base.
 * - `SALDO`: saldo transportado do período anterior (crédito ou débito).
 */
export type PisCofinsTipoLancamento = 'RECEITA' | 'RETENCAO' | 'SALDO';

/**
 * Um LANÇAMENTO no razão de receitas. É a unidade mínima do razão, agnóstica de
 * banco. Decimais são strings. `natureza`/`vinculacao` só se aplicam a
 * lançamentos de `RECEITA` (a base por natureza); para `RETENCAO`/`SALDO` o
 * `valor` é o montante retido/transportado e a natureza é opcional.
 */
export interface PisCofinsLancamentoReceita {
  // Fonte do lançamento (R2.6) — o eixo que torna o razão multi-fonte.
  fonte: PisCofinsFonteReceita;
  // Tipo quanto ao efeito (receita/retenção/saldo).
  tipo: PisCofinsTipoLancamento;
  // Natureza da receita (tarefa 3.1), para lançamentos de `RECEITA`.
  natureza?: PisCofinsNaturezaReceita;
  // Vinculação (tarefa 3.1), para lançamentos de `RECEITA`.
  vinculacao?: PisCofinsVinculacao;
  // Natureza do crédito, quando o lançamento alimenta crédito (não-cumulativo).
  // Mantida como eixo para a tarefa 3.4 (CST 03/67 por hipótese) construir sobre.
  naturezaCredito?: PisCofinsNaturezaCredito | null;
  // Montante do lançamento (string decimal, escala monetária). Para `RECEITA` é
  // a base; para `RETENCAO` é o valor retido; para `SALDO` é o saldo (positivo
  // = credor a favor do contribuinte).
  valor: string;
  // Verdadeiro quando o lançamento NÃO tem fonte homologada/definitiva (ex.:
  // receita estimada, saldo não conciliado). Mantém o rótulo "demonstrativo".
  simulado?: boolean;
  // Descrição auditável da origem do lançamento (ex.: documento, origem contábil).
  descricao?: string;
}

/**
 * Base consolidada de UMA natureza no razão, pronta para alimentar o calculador
 * por natureza (`calcularPisCofinsNatureza`, tarefa 3.1). Agrega as bases de
 * todos os lançamentos de `RECEITA` daquela natureza/vinculação, somando por
 * fonte para a auditoria. NÃO calcula tributo — só consolida a base.
 */
export interface PisCofinsRazaoNatureza {
  natureza: PisCofinsNaturezaReceita;
  vinculacao: PisCofinsVinculacao;
  naturezaCredito: PisCofinsNaturezaCredito | null;
  // Base total consolidada da natureza (string decimal) — a entrada do
  // calculador da tarefa 3.1.
  base: string;
  // Base originada de XML de mercadoria (fluxo legado), para a auditoria mostrar
  // o quanto da base NÃO veio do XML.
  baseXml: string;
  // Base originada de fontes SEM NF-e (R2.6), separada para auditoria.
  baseSemNfe: string;
  // Verdadeiro quando ao menos um lançamento desta natureza é simulado.
  simulado: boolean;
}

/**
 * PENDÊNCIA DE COBERTURA (R2.2): a parte da receita ESPERADA do período que os
 * lançamentos do razão NÃO cobrem. Em vez de a apuração assumir que "o que não
 * está no XML vale zero", a diferença é materializada aqui como pendência — a
 * receita não coberta APARECE, com o motivo, para ser resolvida.
 */
export interface PisCofinsPendenciaCobertura {
  // Receita esperada do período (string decimal) informada pelo chamador.
  receitaEsperada: string;
  // Receita efetivamente coberta pelos lançamentos de `RECEITA` (string decimal).
  receitaCoberta: string;
  // Diferença não coberta (esperada − coberta, nunca negativa) — a pendência.
  receitaNaoCoberta: string;
  // Motivo textual auditável (R2.2).
  motivo: string;
}

/**
 * RESULTADO do razão de receitas. Expõe:
 *  - as bases consolidadas por natureza (`naturezas`) para o calculador 3.1;
 *  - os totais de RETENÇÃO e de SALDO anterior incorporados (R2.6);
 *  - a pendência de cobertura (R2.2), quando houver;
 *  - o rótulo `demonstrativo` enquanto a cobertura não está completa (R2.6);
 *  - uma memória textual auditável.
 */
export interface PisCofinsRazaoResultado {
  // Bases consolidadas por natureza (ordenadas por natureza/vinculação), prontas
  // para o calculador por natureza (tarefa 3.1).
  naturezas: PisCofinsRazaoNatureza[];
  // Receita total de lançamentos de `RECEITA` (soma das bases), string decimal.
  receitaTotal: string;
  // Receita de lançamentos SEM NF-e (R2.6), string decimal.
  receitaSemNfe: string;
  // Total de PIS/COFINS RETIDO na fonte incorporado (R2.6), string decimal. O
  // abatimento do retido na apuração final é do serviço orquestrador; aqui ele
  // é consolidado e rastreado.
  retencaoTotal: string;
  // Saldo transportado do período anterior (R2.6), string decimal. Positivo =
  // credor a favor do contribuinte. A preservação do saldo credor a transportar
  // é a tarefa 3.3; aqui apenas o incorporamos como entrada.
  saldoAnterior: string;
  // Pendência de cobertura (R2.2) — `null` quando a receita coberta ≥ esperada
  // (ou quando o chamador não informou receita esperada).
  pendenciaCobertura: PisCofinsPendenciaCobertura | null;
  // Verdadeiro enquanto o razão é provisório (R2.6): há pendência de cobertura
  // (R2.2) ou algum lançamento é simulado/sem fonte homologada. Mantém o rótulo
  // "demonstrativo" até a cobertura completa.
  demonstrativo: boolean;
  // Memória textual auditável do razão (fontes incorporadas, pendência).
  memoria: string;
}

/**
 * Parâmetros do razão. Os lançamentos vêm de QUALQUER fonte (R2.6). A
 * `receitaEsperada` é opcional: quando informada (ex.: receita contábil
 * declarada do período), habilita a pendência de cobertura (R2.2); quando
 * ausente, o razão apenas consolida o que foi lançado, sem presumir cobertura
 * total nem zerar o que falta.
 */
export interface PisCofinsRazaoInput {
  // Competência mensal 'YYYY-MM', para a memória (o calculador 3.1 resolve a
  // vigência; aqui é só rótulo auditável).
  competencia: string;
  // Lançamentos de receita de todas as fontes (XML, sem NF-e, retenção, saldo).
  lancamentos: PisCofinsLancamentoReceita[];
  // Receita total esperada do período (string decimal), opcional. Quando
  // presente, a diferença não coberta vira pendência (R2.2).
  receitaEsperada?: string | null;
}

// Chave de agregação por natureza + vinculação (uma base por combinação).
type ChaveNatureza = `${PisCofinsNaturezaReceita}|${PisCofinsVinculacao}`;

/**
 * Consolida o razão de receitas de PIS/COFINS a partir de lançamentos
 * multi-fonte, incorporando receitas sem NF-e, retenções e saldos anteriores
 * (R2.6) e materializando a receita não coberta como pendência (R2.2).
 *
 * Fluxo:
 *  1. Separa os lançamentos por tipo (RECEITA / RETENCAO / SALDO).
 *  2. Agrega as RECEITAS por natureza + vinculação, somando a base e separando
 *     a origem XML da origem sem NF-e (para a auditoria mostrar a dependência).
 *  3. Soma as RETENÇÕES e os SALDOS anteriores incorporados (R2.6).
 *  4. Compara a receita coberta com a esperada (quando informada) e, havendo
 *     falta, registra a pendência de cobertura (R2.2) — nunca zera a diferença.
 *  5. Decide o rótulo `demonstrativo` (R2.6): provisório enquanto há pendência
 *     ou lançamento simulado.
 */
export function consolidarRazaoReceitas(
  input: PisCofinsRazaoInput,
): PisCofinsRazaoResultado {
  const agregadas = new Map<
    ChaveNatureza,
    {
      natureza: PisCofinsNaturezaReceita;
      vinculacao: PisCofinsVinculacao;
      naturezaCredito: PisCofinsNaturezaCredito | null;
      baseScaled: bigint;
      baseXmlScaled: bigint;
      baseSemNfeScaled: bigint;
      simulado: boolean;
    }
  >();

  let receitaTotalScaled = 0n;
  let receitaSemNfeScaled = 0n;
  let retencaoTotalScaled = 0n;
  let saldoAnteriorScaled = 0n;
  let algumSimulado = false;

  for (const lanc of input.lancamentos) {
    const valorScaled = toScaledInteger(lanc.valor ?? '0', ESCALA_VALOR);
    if (lanc.simulado) algumSimulado = true;

    if (lanc.tipo === 'RETENCAO') {
      // Retenção na fonte incorporada (R2.6): não é base de receita, é
      // abatimento rastreado. Não entra nas bases por natureza.
      retencaoTotalScaled += valorScaled;
      continue;
    }

    if (lanc.tipo === 'SALDO') {
      // Saldo anterior incorporado (R2.6): transporte do período anterior. A
      // preservação do saldo credor é a tarefa 3.3; aqui só o acumulamos.
      saldoAnteriorScaled += valorScaled;
      continue;
    }

    // tipo === 'RECEITA': compõe a base de uma natureza. A natureza/vinculação
    // são exigidas para a agregação; na ausência, cai em OUTRA/NAO_APLICAVEL,
    // que o calculador 3.1 tratará como pendência (sem regra), nunca como
    // tributada presumida.
    const natureza = lanc.natureza ?? 'OUTRA';
    const vinculacao = lanc.vinculacao ?? 'NAO_APLICAVEL';
    const chave: ChaveNatureza = `${natureza}|${vinculacao}`;

    const atual =
      agregadas.get(chave) ??
      {
        natureza,
        vinculacao,
        naturezaCredito: lanc.naturezaCredito ?? null,
        baseScaled: 0n,
        baseXmlScaled: 0n,
        baseSemNfeScaled: 0n,
        simulado: false,
      };

    atual.baseScaled += valorScaled;
    if (lanc.fonte === 'XML_NFE') {
      atual.baseXmlScaled += valorScaled;
    } else if (lanc.fonte === 'SEM_NFE') {
      atual.baseSemNfeScaled += valorScaled;
      receitaSemNfeScaled += valorScaled;
    }
    // Preservar a naturezaCredito do primeiro lançamento que a informar, sem
    // sobrescrever com null (tarefa 3.4 refina a classificação por hipótese).
    if (atual.naturezaCredito == null && lanc.naturezaCredito != null) {
      atual.naturezaCredito = lanc.naturezaCredito;
    }
    if (lanc.simulado) atual.simulado = true;

    agregadas.set(chave, atual);
    receitaTotalScaled += valorScaled;
  }

  // Ordena as naturezas de forma determinística (natureza, depois vinculação)
  // para que o resultado e a memória sejam estáveis entre execuções.
  const naturezas: PisCofinsRazaoNatureza[] = [...agregadas.values()]
    .sort((a, b) =>
      a.natureza === b.natureza
        ? a.vinculacao.localeCompare(b.vinculacao)
        : a.natureza.localeCompare(b.natureza),
    )
    .map((n) => ({
      natureza: n.natureza,
      vinculacao: n.vinculacao,
      naturezaCredito: n.naturezaCredito,
      base: fromScaledInteger(n.baseScaled, ESCALA_VALOR),
      baseXml: fromScaledInteger(n.baseXmlScaled, ESCALA_VALOR),
      baseSemNfe: fromScaledInteger(n.baseSemNfeScaled, ESCALA_VALOR),
      simulado: n.simulado,
    }));

  // ── Pendência de cobertura (R2.2) ──────────────────────────────────────────
  // Quando o chamador informa a receita esperada do período, a parte não
  // coberta pelos lançamentos de RECEITA vira pendência explícita — nunca zero.
  let pendenciaCobertura: PisCofinsPendenciaCobertura | null = null;
  const esperadaStr = naoVazio(input.receitaEsperada);
  if (esperadaStr != null) {
    const esperadaScaled = toScaledInteger(esperadaStr, ESCALA_VALOR);
    const naoCobertaScaled = positive(esperadaScaled - receitaTotalScaled);
    if (naoCobertaScaled > 0n) {
      pendenciaCobertura = {
        receitaEsperada: fromScaledInteger(esperadaScaled, ESCALA_VALOR),
        receitaCoberta: fromScaledInteger(receitaTotalScaled, ESCALA_VALOR),
        receitaNaoCoberta: fromScaledInteger(naoCobertaScaled, ESCALA_VALOR),
        motivo:
          `Receita esperada ${fromScaledInteger(esperadaScaled, ESCALA_VALOR)} ` +
          `para a competência ${input.competencia} excede a receita coberta ` +
          `pelos lançamentos (${fromScaledInteger(receitaTotalScaled, ESCALA_VALOR)}). ` +
          `A diferença ${fromScaledInteger(naoCobertaScaled, ESCALA_VALOR)} ` +
          'aparece como PENDÊNCIA (R2.2), não como zero: há receita a cobrir ' +
          'fora dos lançamentos atuais.',
      };
    }
  }

  // ── Rótulo "demonstrativo" (R2.6) ──────────────────────────────────────────
  // Provisório enquanto a cobertura não está completa: há pendência (R2.2) ou
  // algum lançamento é simulado/sem fonte homologada.
  const demonstrativo = pendenciaCobertura != null || algumSimulado;

  return {
    naturezas,
    receitaTotal: fromScaledInteger(receitaTotalScaled, ESCALA_VALOR),
    receitaSemNfe: fromScaledInteger(receitaSemNfeScaled, ESCALA_VALOR),
    retencaoTotal: fromScaledInteger(retencaoTotalScaled, ESCALA_VALOR),
    saldoAnterior: fromScaledInteger(saldoAnteriorScaled, ESCALA_VALOR),
    pendenciaCobertura,
    demonstrativo,
    memoria: montarMemoria({
      competencia: input.competencia,
      naturezas,
      receitaTotalScaled,
      receitaSemNfeScaled,
      retencaoTotalScaled,
      saldoAnteriorScaled,
      pendenciaCobertura,
      demonstrativo,
    }),
  };
}

// Monta a memória textual do razão: fontes incorporadas, pendência e rótulo.
function montarMemoria(args: {
  competencia: string;
  naturezas: PisCofinsRazaoNatureza[];
  receitaTotalScaled: bigint;
  receitaSemNfeScaled: bigint;
  retencaoTotalScaled: bigint;
  saldoAnteriorScaled: bigint;
  pendenciaCobertura: PisCofinsPendenciaCobertura | null;
  demonstrativo: boolean;
}): string {
  const {
    competencia,
    naturezas,
    receitaTotalScaled,
    receitaSemNfeScaled,
    retencaoTotalScaled,
    saldoAnteriorScaled,
    pendenciaCobertura,
    demonstrativo,
  } = args;

  const partes: string[] = [];
  partes.push(
    `Razão de receitas PIS/COFINS da competência ${competencia}: ` +
      `${naturezas.length} natureza(s), receita total ` +
      `${fromScaledInteger(receitaTotalScaled, ESCALA_VALOR)}.`,
  );
  if (receitaSemNfeScaled > 0n) {
    partes.push(
      `Receita SEM NF-e incorporada (R2.6): ` +
        `${fromScaledInteger(receitaSemNfeScaled, ESCALA_VALOR)}.`,
    );
  }
  if (retencaoTotalScaled > 0n) {
    partes.push(
      `Retenções na fonte incorporadas (R2.6): ` +
        `${fromScaledInteger(retencaoTotalScaled, ESCALA_VALOR)}.`,
    );
  }
  if (saldoAnteriorScaled !== 0n) {
    partes.push(
      `Saldo do período anterior incorporado (R2.6): ` +
        `${fromScaledInteger(saldoAnteriorScaled, ESCALA_VALOR)}.`,
    );
  }
  if (pendenciaCobertura) {
    partes.push(pendenciaCobertura.motivo);
  }
  partes.push(
    demonstrativo
      ? 'Rótulo DEMONSTRATIVO mantido: cobertura ainda incompleta (R2.6).'
      : 'Cobertura completa pelos lançamentos informados; sem pendência de receita.',
  );
  return partes.join(' ');
}

// Devolve a string quando não é nula/vazia; `null` caso contrário. Mantém os
// decimais como string e evita tratar '' como zero por engano.
function naoVazio(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const t = valor.trim();
  return t === '' ? null : t;
}
