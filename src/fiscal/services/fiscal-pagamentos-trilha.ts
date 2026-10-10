import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';

/**
 * Núcleo PURO da TRILHA de pagamentos/estornos de uma guia (Fase 5, tarefa 1.4 /
 * R1.3 — "QUANDO há pagamento parcial ou estorno, o sistema DEVE manter trilha e
 * preservar o saldo da obrigação").
 *
 * A trilha é APPEND-ONLY: cada pagamento (total ou parcial) e cada estorno é um
 * EVENTO imutável em `fiscal_pagamentos_eventos` — nunca uma sobrescrita de
 * status. O saldo da obrigação é SEMPRE reconstruído da trilha, nunca persistido
 * como um número que se sobrescreve:
 *
 *     saldo = valorTotal(guia) − Σ(sinal · valor)
 *
 * onde `sinal` é +1 para pagamento/pagamento parcial e −1 para estorno. Assim, a
 * ordem dos eventos não importa para o saldo final, a trilha completa é sempre
 * reconstruível, e um estorno devolve exatamente o valor que o pagamento tirou.
 *
 * Puro e determinístico: dado o total da guia e a lista de eventos, o saldo e o
 * total pago são sempre os mesmos — testável sem banco.
 */

/** Tipos de evento na trilha de pagamento (espelha o domínio do banco). */
export type TipoEventoPagamento = 'PAGAMENTO' | 'PAGAMENTO_PARCIAL' | 'ESTORNO';

/** Sinal do efeito no saldo: +1 soma (pagamento), −1 subtrai (estorno). */
export type SinalEventoPagamento = 1 | -1;

/**
 * Projeção mínima de um evento da trilha, do ponto de vista do saldo. `valor` é
 * a MAGNITUDE decimal não-negativa (string, nunca `Number`); o efeito no saldo
 * vem de `sinal`.
 */
export interface EventoPagamentoTrilha {
  tipo: TipoEventoPagamento;
  valor: string;
  sinal: SinalEventoPagamento;
}

/** Saldo e totais reconstruídos da trilha de uma guia (strings decimais). */
export interface SaldoObrigacao {
  /** Total da guia emitida (valor da obrigação a quitar). */
  valorTotal: string;
  /** Soma dos efeitos dos eventos: Σ(sinal · valor). Pode ser negativa. */
  totalPago: string;
  /** Saldo remanescente: valorTotal − totalPago. */
  saldo: string;
  /** `true` quando o saldo é zero (ou negativo por sobrepagamento). */
  quitada: boolean;
  /** Quantidade de eventos considerados na trilha. */
  quantidadeEventos: number;
}

/**
 * Sinal canônico de um tipo de evento: ESTORNO subtrai (−1); pagamento (total
 * ou parcial) soma (+1). Fonte única da convenção usada tanto na projeção do
 * saldo quanto na persistência do evento (serviço), para que nunca divirjam.
 */
export function sinalDoEvento(tipo: TipoEventoPagamento): SinalEventoPagamento {
  return tipo === 'ESTORNO' ? -1 : 1;
}

/**
 * Reconstrói o SALDO da obrigação a partir do total da guia e da trilha completa
 * de eventos (R1.3). Nunca sobrescreve nada: deriva o saldo somando os efeitos
 * (sinal · valor) de cada evento. Determinístico e independente da ordem.
 */
export function projetarSaldoObrigacao(
  valorTotal: string,
  eventos: readonly EventoPagamentoTrilha[],
): SaldoObrigacao {
  const total = toScaledInteger(valorTotal);
  const pago = eventos.reduce(
    (acc, evento) =>
      acc + BigInt(evento.sinal) * toScaledInteger(evento.valor),
    0n,
  );
  const saldo = total - pago;
  return {
    valorTotal: fromScaledInteger(total),
    totalPago: fromScaledInteger(pago),
    saldo: fromScaledInteger(saldo),
    quitada: saldo <= 0n,
    quantidadeEventos: eventos.length,
  };
}
