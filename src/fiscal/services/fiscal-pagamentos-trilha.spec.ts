import {
  projetarSaldoObrigacao,
  sinalDoEvento,
  type EventoPagamentoTrilha,
} from './fiscal-pagamentos-trilha';

// Fase 5, tarefa 1.4 (R1.3): o SALDO da obrigação é SEMPRE reconstruído da
// trilha append-only de pagamentos/estornos — `saldo = valorTotal − Σ(sinal·
// valor)` — nunca de um status mutável. Testes PUROS e determinísticos, sem
// banco: dado o total da guia e a lista de eventos, o saldo é sempre o mesmo.

function pagamento(valor: string): EventoPagamentoTrilha {
  return { tipo: 'PAGAMENTO', valor, sinal: 1 };
}
function parcial(valor: string): EventoPagamentoTrilha {
  return { tipo: 'PAGAMENTO_PARCIAL', valor, sinal: 1 };
}
function estorno(valor: string): EventoPagamentoTrilha {
  return { tipo: 'ESTORNO', valor, sinal: -1 };
}

describe('sinalDoEvento — convenção +1 pagamento / -1 estorno', () => {
  it('pagamento (total/parcial) soma (+1); estorno subtrai (-1)', () => {
    expect(sinalDoEvento('PAGAMENTO')).toBe(1);
    expect(sinalDoEvento('PAGAMENTO_PARCIAL')).toBe(1);
    expect(sinalDoEvento('ESTORNO')).toBe(-1);
  });
});

describe('projetarSaldoObrigacao — saldo reconstruído da trilha (R1.3)', () => {
  it('sem eventos: saldo é o total da guia (nada pago)', () => {
    const s = projetarSaldoObrigacao('100.00', []);
    expect(s.totalPago).toBe('0.00');
    expect(s.saldo).toBe('100.00');
    expect(s.quitada).toBe(false);
    expect(s.quantidadeEventos).toBe(0);
  });

  it('PAGAMENTO total quita a obrigação (saldo zero)', () => {
    const s = projetarSaldoObrigacao('100.00', [pagamento('100.00')]);
    expect(s.totalPago).toBe('100.00');
    expect(s.saldo).toBe('0.00');
    expect(s.quitada).toBe(true);
  });

  it('PAGAMENTO PARCIAL preserva o saldo remanescente (R1.3)', () => {
    const s = projetarSaldoObrigacao('100.00', [parcial('40.00')]);
    expect(s.totalPago).toBe('40.00');
    expect(s.saldo).toBe('60.00');
    expect(s.quitada).toBe(false);
  });

  it('parciais somam e podem quitar sem sobrescrever eventos anteriores', () => {
    const s = projetarSaldoObrigacao('100.00', [
      parcial('40.00'),
      parcial('60.00'),
    ]);
    expect(s.totalPago).toBe('100.00');
    expect(s.saldo).toBe('0.00');
    expect(s.quitada).toBe(true);
    expect(s.quantidadeEventos).toBe(2);
  });

  it('ESTORNO devolve exatamente o valor do pagamento revertido (trilha preservada)', () => {
    // Paga 100, estorna 100: a trilha mantém AMBOS os eventos e o saldo volta
    // ao total integral — nada é sobrescrito nem apagado.
    const s = projetarSaldoObrigacao('100.00', [
      pagamento('100.00'),
      estorno('100.00'),
    ]);
    expect(s.totalPago).toBe('0.00');
    expect(s.saldo).toBe('100.00');
    expect(s.quantidadeEventos).toBe(2);
  });

  it('pagamento parcial + estorno parcial preserva o saldo correto', () => {
    const s = projetarSaldoObrigacao('100.00', [
      parcial('70.00'),
      estorno('30.00'),
    ]);
    expect(s.totalPago).toBe('40.00');
    expect(s.saldo).toBe('60.00');
  });

  it('o saldo independe da ordem dos eventos (determinístico)', () => {
    const a = projetarSaldoObrigacao('100.00', [
      pagamento('80.00'),
      estorno('30.00'),
      parcial('20.00'),
    ]);
    const b = projetarSaldoObrigacao('100.00', [
      parcial('20.00'),
      estorno('30.00'),
      pagamento('80.00'),
    ]);
    expect(a.saldo).toBe(b.saldo);
    expect(a.totalPago).toBe(b.totalPago);
    expect(a.saldo).toBe('30.00');
  });

  it('sobrepagamento resulta em saldo negativo e quitada = true', () => {
    const s = projetarSaldoObrigacao('100.00', [pagamento('120.00')]);
    expect(s.saldo).toBe('-20.00');
    expect(s.quitada).toBe(true);
  });
});
