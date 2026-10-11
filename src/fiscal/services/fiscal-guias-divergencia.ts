import type {
  ResultadoApuracaoTotais,
  SaldoDevedorApurado,
} from './resultado-apuracao.contract';
import { projetarSaldoDevedorApurado } from './resultado-apuracao.projector';
import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';

/**
 * Núcleo PURO da sinalização de guia divergente da obrigação apurada
 * (Fase 5, tarefa 1.3 / R1.2 — "QUANDO uma guia diverge da obrigação apurada,
 * o sistema DEVE sinalizá-la").
 *
 * A obrigação apurada NÃO é recomputada aqui: ela vem do SNAPSHOT CONGELADO do
 * fechamento (versão de apuração da Fase 3), projetado pelo MESMO contrato que
 * livros/painéis/SPED consomem (`projetarSaldoDevedorApurado`). Assim, "o total
 * da obrigação" é exatamente o mesmo valor que a conciliação enxerga — não um
 * segundo motor com regra divergente. Dado o mesmo snapshot e o mesmo total de
 * guia, o resultado é sempre o mesmo (determinístico, testável sem banco).
 */

/**
 * Tolerância de arredondamento (R$ 0,02): guia e obrigação são valores
 * monetários com 2 casas; diferenças de centavo por arredondamento NÃO são
 * divergência real. Mesma convenção de `differenceWithinTolerance`. Acima da
 * tolerância a guia é SINALIZADA como divergente da obrigação.
 */
export const TOLERANCIA_DIVERGENCIA_GUIA = '0.02';

/**
 * Sinal da comparação guia × obrigação apurada. É INFORMATIVO: sinalizar não
 * bloqueia a emissão (uma guia pode legitimamente divergir — multa/juros, por
 * exemplo); apenas marca para a conciliação e o cockpit fiscal destacarem.
 */
export interface SinalDivergenciaGuia {
  /** `true` quando |guia − obrigação| excede a tolerância de centavos. */
  divergente: boolean;
  /** Total da guia emitida (string decimal, nunca `Number`). */
  valorGuia: string;
  /**
   * Total da obrigação apurada projetado do fechamento (string decimal). É o
   * saldo devedor documental da versão de apuração vinculada à guia.
   */
  valorObrigacao: string;
  /**
   * Diferença assinada `guia − obrigação` (string decimal). Positiva = guia
   * acima da obrigação; negativa = guia abaixo. Zero (dentro da tolerância)
   * quando não há divergência.
   */
  diferenca: string;
}

/**
 * Compara o total de uma guia emitida com o total da obrigação apurada (ambos
 * strings decimais) e sinaliza divergência quando a diferença absoluta excede a
 * tolerância de centavos. Puro e determinístico.
 *
 * `valorObrigacao` deve ser o total projetado da versão de apuração (ver
 * `obrigacaoDoFechamento`), para que a comparação seja contra o MESMO valor da
 * conciliação — nunca um recálculo próprio.
 */
export function compararGuiaComObrigacao(
  valorGuia: string,
  valorObrigacao: string,
  tolerancia: string = TOLERANCIA_DIVERGENCIA_GUIA,
): SinalDivergenciaGuia {
  const guia = toScaledInteger(valorGuia);
  const obrigacao = toScaledInteger(valorObrigacao);
  const diferenca = guia - obrigacao;
  const absoluto = diferenca < 0n ? -diferenca : diferenca;
  const divergente = absoluto > toScaledInteger(tolerancia);
  return {
    divergente,
    valorGuia: fromScaledInteger(guia),
    valorObrigacao: fromScaledInteger(obrigacao),
    diferenca: fromScaledInteger(diferenca),
  };
}

/**
 * Extrai o total da OBRIGAÇÃO APURADA do snapshot `saldos` congelado do
 * fechamento, reusando a projeção do contrato (`projetarSaldoDevedorApurado`).
 * É o valor contra o qual a guia é comparada — o saldo devedor documental da
 * versão de apuração, sem segundo motor. Retorna string decimal (`0.00` quando
 * não há saldo devedor).
 */
export function obrigacaoDoFechamento(
  totais: ResultadoApuracaoTotais,
): SaldoDevedorApurado {
  return projetarSaldoDevedorApurado(totais);
}
