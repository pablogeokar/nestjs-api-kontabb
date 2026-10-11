/**
 * SALDO CREDOR DE PIS/COFINS: PRESERVAÇÃO E TRANSPORTE (Fase 4 / tarefa 3.3 —
 * R2.3).
 *
 * O estado anterior (`PisCofinsService.calcularTributo`) resumia a apuração a
 * `saldo = positive(debito - credito)`. Esse `positive(...)` resolve CORRETAMENTE
 * o SALDO A RECOLHER (o valor devido no período nunca é negativo), mas, ao fazê-
 * lo, DESCARTA SILENCIOSAMENTE o excedente quando o crédito supera o débito: o
 * saldo CREDOR — crédito que a lei manda preservar e transportar para o período
 * seguinte — era "cortado em zero" e perdido. O design (§PIS/COFINS F13) exige o
 * oposto: "Saldo credor preservado e transportado (REMOVER o corte em zero para
 * o saldo a transportar; manter separação débito/crédito)", e R2.3: "QUANDO há
 * saldo credor, ele DEVE ser preservado e rastreado para o período seguinte (não
 * cortado em zero)".
 *
 * Este módulo é a PEÇA PURA dessa apuração de saldo, espelhando os demais puros
 * da fase (`difal-base.ts`, `pis-cofins-natureza.ts`, `pis-cofins-razao.ts`):
 * recebe o débito e o crédito já consolidados de UM tributo (PIS ou COFINS) no
 * período — a soma por natureza vinda do calculador 3.1 — mais o SALDO CREDOR
 * ANTERIOR transportado (que o razão 3.2 incorpora como lançamento
 * `SALDO_ANTERIOR`), e separa dois resultados DISTINTOS que o `positive` único
 * confundia:
 *
 *   - SALDO A RECOLHER (devido no período): `positive(debito - creditoTotal)`.
 *     Permanece NÃO-NEGATIVO — não se "recolhe" valor negativo. Aqui o corte em
 *     zero é CORRETO e é mantido.
 *   - SALDO CREDOR A TRANSPORTAR (excedente para o período seguinte):
 *     `positive(creditoTotal - debito)`. É EXATAMENTE o oposto — quando o crédito
 *     supera o débito, o excedente é PRESERVADO como transporte positivo, NUNCA
 *     cortado em zero. Este é o conserto da tarefa 3.3.
 *
 * `creditoTotal = credito (do período) + saldoCredorAnterior (transportado)`: o
 * crédito do período anterior continua a abater débito do período atual e, se
 * sobrar, segue sendo transportado. Débito e crédito NUNCA são misturados antes
 * desta conta (R2.3 "manter separação débito/crédito"): chegam separados e só o
 * NET final (recolher × transportar) é derivado deles.
 *
 * ELO COM O RAZÃO (tarefa 3.2): o saldo credor a transportar é devolvido também
 * como um LANÇAMENTO pronto (`lancamentoTransporte`) no formato que
 * `consolidarRazaoReceitas` consome — `fonte: 'SALDO_ANTERIOR'`, `tipo: 'SALDO'`
 * — para ser incorporado ao razão do PRÓXIMO período como saldo anterior. Assim
 * o excedente não só é preservado como também é efetivamente RASTREADO para o
 * período seguinte (R2.3), fechando o ciclo com o `SALDO_ANTERIOR` da 3.2.
 *
 * DECIMAIS SEMPRE COMO STRING (restrição da fase): toda a aritmética usa inteiros
 * escalados (`bigint`) via `sped-decimal`; nenhum valor passa por `Number`.
 *
 * ESCOPO DESTA TAREFA (3.3): preservar e transportar o saldo credor, mantendo o
 * saldo a recolher não-negativo e a separação débito/crédito. NÃO entram aqui:
 * CST 03/CST 67 por hipótese (3.4) nem o tratamento de regime ausente (3.5).
 */

import type { PisCofinsTributo } from './pis-cofins-natureza';
import type { PisCofinsLancamentoReceita } from './pis-cofins-razao';
import {
  fromScaledInteger,
  positive,
  toScaledInteger,
} from '../sped/sped-decimal';

// Escala monetária (centavos), padrão das colunas `numeric(_,2)` do fiscal.
const ESCALA_VALOR = 2;

/**
 * Entrada da apuração de saldo de UM tributo (PIS ou COFINS) no período. Débito
 * e crédito chegam JÁ CONSOLIDADOS (soma por natureza do calculador 3.1) e
 * SEPARADOS (R2.3). O saldo credor anterior é o excedente transportado do
 * período passado (sinal convencional: positivo = crédito a favor do
 * contribuinte); default '0.00' quando não há transporte.
 */
export interface PisCofinsSaldoInput {
  tributo: PisCofinsTributo;
  // Competência mensal 'YYYY-MM' deste período (rótulo auditável e base do
  // lançamento de transporte para o período seguinte).
  competencia: string;
  // Débito total do período (string decimal). Soma das naturezas que geram
  // débito (3.1).
  debito: string;
  // Crédito total do período (string decimal). Soma das naturezas que geram
  // crédito (3.1), regime não-cumulativo.
  credito: string;
  // Saldo CREDOR transportado do período anterior (string decimal, positivo =
  // a favor do contribuinte). Opcional; '0.00' por default. É o `SALDO_ANTERIOR`
  // incorporado pelo razão 3.2.
  saldoCredorAnterior?: string | null;
}

/**
 * Resultado da apuração de saldo. Expõe os DOIS saldos distintos — o a recolher
 * (não-negativo) e o credor a transportar (preservado, não cortado) — além do
 * crédito total utilizado e de um lançamento pronto para o razão do próximo
 * período (elo com a 3.2). Mantém a separação débito/crédito no envelope.
 */
export interface PisCofinsSaldoResultado {
  tributo: PisCofinsTributo;
  competencia: string;
  // Débito do período (ecoado, separado — R2.3).
  debito: string;
  // Crédito do período (ecoado, separado — R2.3), SEM o saldo anterior.
  credito: string;
  // Saldo credor anterior aplicado neste período (ecoado).
  saldoCredorAnterior: string;
  // Crédito total disponível para abater o débito = crédito do período + saldo
  // credor anterior. Explicitado para auditoria (não se confunde com `credito`).
  creditoTotalDisponivel: string;
  // SALDO A RECOLHER no período: positive(debito - creditoTotalDisponivel).
  // NÃO-NEGATIVO — o corte em zero AQUI é correto e mantido.
  saldoARecolher: string;
  // SALDO CREDOR A TRANSPORTAR ao período seguinte:
  // positive(creditoTotalDisponivel - debito). PRESERVADO (não cortado em zero)
  // — o conserto da tarefa 3.3 (R2.3).
  saldoCredorATransportar: string;
  // Verdadeiro quando há saldo credor a transportar (> 0). Facilita o chamador
  // decidir incorporar o transporte ao próximo período sem reparsear decimais.
  temSaldoCredor: boolean;
  // Lançamento pronto para o razão (3.2) do PRÓXIMO período, materializando o
  // transporte do saldo credor (R2.3). `null` quando não há saldo credor.
  lancamentoTransporte: PisCofinsLancamentoReceita | null;
  // Memória textual auditável da apuração do saldo.
  memoria: string;
}

/**
 * Apura o saldo de PIS/COFINS de um tributo no período, PRESERVANDO e
 * TRANSPORTANDO o saldo credor (R2.3).
 *
 * Fluxo:
 *  1. Soma ao crédito do período o saldo credor anterior transportado, obtendo
 *     o CRÉDITO TOTAL DISPONÍVEL para abater o débito (débito e crédito seguem
 *     separados até esta conta — R2.3).
 *  2. SALDO A RECOLHER = positive(debito - creditoTotalDisponivel): não-negativo
 *     (o corte em zero é correto para o que é devido).
 *  3. SALDO CREDOR A TRANSPORTAR = positive(creditoTotalDisponivel - debito):
 *     preservado como excedente positivo, NUNCA cortado em zero — o oposto do
 *     saldo a recolher. É o conserto desta tarefa.
 *  4. Quando há saldo credor, monta um lançamento `SALDO_ANTERIOR`/`SALDO` pronto
 *     para o razão (3.2) do próximo período incorporar — fechando o rastreio.
 *
 * No máximo UM dos dois saldos é positivo: ou se recolhe (débito > crédito) ou
 * se transporta (crédito > débito); empate zera ambos.
 */
export function apurarSaldoPisCofins(
  input: PisCofinsSaldoInput,
): PisCofinsSaldoResultado {
  const debitoScaled = toScaledInteger(input.debito ?? '0', ESCALA_VALOR);
  const creditoScaled = toScaledInteger(input.credito ?? '0', ESCALA_VALOR);
  const saldoAnteriorScaled = toScaledInteger(
    input.saldoCredorAnterior ?? '0',
    ESCALA_VALOR,
  );

  // Crédito total disponível = crédito do período + saldo credor transportado.
  // Débito e crédito permaneceram SEPARADOS até aqui (R2.3); só agora derivamos
  // o net recolher × transportar.
  const creditoTotalScaled = creditoScaled + saldoAnteriorScaled;

  // SALDO A RECOLHER: não-negativo. O corte em zero é CORRETO aqui — não se
  // recolhe valor negativo. (Mesmo critério do serviço legado, mas aplicado
  // apenas ao que é devido, não ao excedente.)
  const saldoARecolherScaled = positive(debitoScaled - creditoTotalScaled);

  // SALDO CREDOR A TRANSPORTAR: o oposto exato — o excedente de crédito é
  // PRESERVADO, não cortado em zero (R2.3). Este é o conserto da tarefa 3.3.
  const saldoCredorScaled = positive(creditoTotalScaled - debitoScaled);

  const debitoStr = fromScaledInteger(debitoScaled, ESCALA_VALOR);
  const creditoStr = fromScaledInteger(creditoScaled, ESCALA_VALOR);
  const saldoAnteriorStr = fromScaledInteger(saldoAnteriorScaled, ESCALA_VALOR);
  const creditoTotalStr = fromScaledInteger(creditoTotalScaled, ESCALA_VALOR);
  const saldoARecolherStr = fromScaledInteger(
    saldoARecolherScaled,
    ESCALA_VALOR,
  );
  const saldoCredorStr = fromScaledInteger(saldoCredorScaled, ESCALA_VALOR);
  const temSaldoCredor = saldoCredorScaled > 0n;

  // Lançamento de transporte para o razão (3.2) do PRÓXIMO período, materializando
  // o rastreio do saldo credor (R2.3). Mantém decimais como string.
  const lancamentoTransporte: PisCofinsLancamentoReceita | null = temSaldoCredor
    ? {
        fonte: 'SALDO_ANTERIOR',
        tipo: 'SALDO',
        valor: saldoCredorStr,
        descricao:
          `Saldo credor de ${input.tributo} transportado da competência ` +
          `${input.competencia} (R2.3): crédito disponível ${creditoTotalStr} ` +
          `excede o débito ${debitoStr}; excedente ${saldoCredorStr} preservado ` +
          'para o período seguinte, não cortado em zero.',
      }
    : null;

  return {
    tributo: input.tributo,
    competencia: input.competencia,
    debito: debitoStr,
    credito: creditoStr,
    saldoCredorAnterior: saldoAnteriorStr,
    creditoTotalDisponivel: creditoTotalStr,
    saldoARecolher: saldoARecolherStr,
    saldoCredorATransportar: saldoCredorStr,
    temSaldoCredor,
    lancamentoTransporte,
    memoria: montarMemoria({
      tributo: input.tributo,
      competencia: input.competencia,
      debitoStr,
      creditoStr,
      saldoAnteriorStr,
      creditoTotalStr,
      saldoARecolherStr,
      saldoCredorStr,
      temSaldoCredor,
    }),
  };
}

// Monta a memória textual da apuração do saldo, distinguindo o caso de recolher
// do caso de transportar o saldo credor (R2.3).
function montarMemoria(args: {
  tributo: PisCofinsTributo;
  competencia: string;
  debitoStr: string;
  creditoStr: string;
  saldoAnteriorStr: string;
  creditoTotalStr: string;
  saldoARecolherStr: string;
  saldoCredorStr: string;
  temSaldoCredor: boolean;
}): string {
  const {
    tributo,
    competencia,
    debitoStr,
    creditoStr,
    saldoAnteriorStr,
    creditoTotalStr,
    saldoARecolherStr,
    saldoCredorStr,
    temSaldoCredor,
  } = args;

  const partes: string[] = [];
  partes.push(
    `${tributo} competência ${competencia}: débito ${debitoStr}, crédito do ` +
      `período ${creditoStr}, saldo credor anterior ${saldoAnteriorStr} ⇒ ` +
      `crédito total disponível ${creditoTotalStr} (débito e crédito mantidos ` +
      'separados — R2.3).',
  );
  if (temSaldoCredor) {
    partes.push(
      `Crédito disponível excede o débito: saldo credor ${saldoCredorStr} ` +
        'PRESERVADO e transportado ao período seguinte (R2.3), não cortado em ' +
        'zero. Saldo a recolher no período: 0.00.',
    );
  } else {
    partes.push(
      `Saldo a recolher no período: ${saldoARecolherStr} ` +
        '(positive(débito − crédito disponível), não-negativo). Sem saldo credor ' +
        'a transportar.',
    );
  }
  return partes.join(' ');
}
