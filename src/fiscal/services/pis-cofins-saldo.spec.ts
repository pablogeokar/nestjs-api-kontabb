import {
  apurarSaldoPisCofins,
  type PisCofinsSaldoInput,
} from './pis-cofins-saldo';
import { consolidarRazaoReceitas } from './pis-cofins-razao';

// Entrada mínima da apuração de saldo, com overrides pontuais por teste.
function input(
  overrides: Partial<PisCofinsSaldoInput> = {},
): PisCofinsSaldoInput {
  return {
    tributo: 'PIS',
    competencia: '2026-09',
    debito: '0.00',
    credito: '0.00',
    ...overrides,
  };
}

describe('apurarSaldoPisCofins (Fase 4 / tarefa 3.3 — R2.3)', () => {
  describe('saldo a recolher permanece não-negativo (corte em zero correto)', () => {
    it('débito > crédito → saldo a recolher = débito − crédito', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '165.00', credito: '66.00' }),
      );
      expect(r.saldoARecolher).toBe('99.00');
      expect(r.saldoCredorATransportar).toBe('0.00');
      expect(r.temSaldoCredor).toBe(false);
    });

    it('crédito > débito → saldo a recolher cortado em zero (nunca negativo)', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '66.00', credito: '165.00' }),
      );
      // O que é DEVIDO nunca é negativo: aqui o corte em zero é correto.
      expect(r.saldoARecolher).toBe('0.00');
    });

    it('débito == crédito → ambos os saldos zerados', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '100.00', credito: '100.00' }),
      );
      expect(r.saldoARecolher).toBe('0.00');
      expect(r.saldoCredorATransportar).toBe('0.00');
      expect(r.temSaldoCredor).toBe(false);
    });
  });

  describe('saldo credor preservado e transportado, NÃO cortado em zero (R2.3)', () => {
    it('crédito > débito → excedente preservado como saldo credor a transportar', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '66.00', credito: '165.00' }),
      );
      // Conserto da 3.3: o excedente (165 − 66) é PRESERVADO, não perdido.
      expect(r.saldoCredorATransportar).toBe('99.00');
      expect(r.temSaldoCredor).toBe(true);
      // E o saldo a recolher continua zero (não-negativo).
      expect(r.saldoARecolher).toBe('0.00');
    });

    it('crédito total só de crédito do período (sem saldo anterior) é transportado', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '0.00', credito: '500.00' }),
      );
      expect(r.saldoCredorATransportar).toBe('500.00');
      expect(r.saldoARecolher).toBe('0.00');
    });

    it('a memória explicita a preservação do saldo credor (R2.3)', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '10.00', credito: '90.00' }),
      );
      expect(r.saldoCredorATransportar).toBe('80.00');
      expect(r.memoria).toContain('PRESERVADO');
      expect(r.memoria).toContain('R2.3');
      expect(r.memoria).toContain('não cortado em zero');
    });
  });

  describe('saldo credor anterior abate o débito e, se sobra, segue transportado', () => {
    it('saldo anterior + crédito abatem o débito, reduzindo o a recolher', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '200.00', credito: '50.00', saldoCredorAnterior: '30.00' }),
      );
      // Crédito total disponível = 50 + 30 = 80; a recolher = 200 − 80 = 120.
      expect(r.creditoTotalDisponivel).toBe('80.00');
      expect(r.saldoARecolher).toBe('120.00');
      expect(r.saldoCredorATransportar).toBe('0.00');
    });

    it('saldo anterior que supera o débito é transportado adiante (acúmulo)', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '40.00', credito: '20.00', saldoCredorAnterior: '100.00' }),
      );
      // Disponível = 20 + 100 = 120; a recolher = 0; transporta 120 − 40 = 80.
      expect(r.creditoTotalDisponivel).toBe('120.00');
      expect(r.saldoARecolher).toBe('0.00');
      expect(r.saldoCredorATransportar).toBe('80.00');
    });

    it('saldo anterior ausente default 0.00 (sem transporte prévio)', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '100.00', credito: '0.00' }),
      );
      expect(r.saldoCredorAnterior).toBe('0.00');
      expect(r.creditoTotalDisponivel).toBe('0.00');
      expect(r.saldoARecolher).toBe('100.00');
    });
  });

  describe('débito e crédito permanecem separados no envelope (R2.3)', () => {
    it('ecoa débito e crédito do período sem misturá-los no net', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '300.00', credito: '120.00', saldoCredorAnterior: '0.00' }),
      );
      expect(r.debito).toBe('300.00');
      expect(r.credito).toBe('120.00');
      // crédito do período NÃO inclui saldo anterior; esse fica em outro campo.
      expect(r.creditoTotalDisponivel).toBe('120.00');
    });

    it('crédito do período é distinto do crédito total disponível (com saldo anterior)', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '0.00', credito: '120.00', saldoCredorAnterior: '30.00' }),
      );
      expect(r.credito).toBe('120.00');
      expect(r.creditoTotalDisponivel).toBe('150.00');
    });
  });

  describe('elo com o razão (3.2): transporte vira SALDO_ANTERIOR do próximo período', () => {
    it('gera lançamento SALDO_ANTERIOR/SALDO com o valor do saldo credor', () => {
      const r = apurarSaldoPisCofins(
        input({ tributo: 'COFINS', debito: '0.00', credito: '760.00' }),
      );
      expect(r.lancamentoTransporte).not.toBeNull();
      expect(r.lancamentoTransporte?.fonte).toBe('SALDO_ANTERIOR');
      expect(r.lancamentoTransporte?.tipo).toBe('SALDO');
      expect(r.lancamentoTransporte?.valor).toBe('760.00');
    });

    it('sem saldo credor → não há lançamento de transporte', () => {
      const r = apurarSaldoPisCofins(
        input({ debito: '500.00', credito: '100.00' }),
      );
      expect(r.lancamentoTransporte).toBeNull();
    });

    it('o lançamento de transporte é incorporado como saldo anterior pelo razão (3.2)', () => {
      // Período 1: crédito excede o débito; o excedente é preservado.
      const periodo1 = apurarSaldoPisCofins(
        input({ competencia: '2026-09', debito: '100.00', credito: '450.00' }),
      );
      expect(periodo1.saldoCredorATransportar).toBe('350.00');
      expect(periodo1.lancamentoTransporte).not.toBeNull();

      // Período 2: o razão incorpora o transporte como saldo anterior (R2.3/R2.6),
      // comprovando que o saldo credor é efetivamente RASTREADO adiante.
      const razaoPeriodo2 = consolidarRazaoReceitas({
        competencia: '2026-10',
        lancamentos: [periodo1.lancamentoTransporte!],
      });
      expect(razaoPeriodo2.saldoAnterior).toBe('350.00');
      expect(razaoPeriodo2.memoria).toContain('Saldo do período anterior');
    });
  });

  it('tudo zero → sem recolher, sem transportar, sem lançamento', () => {
    const r = apurarSaldoPisCofins(input());
    expect(r.saldoARecolher).toBe('0.00');
    expect(r.saldoCredorATransportar).toBe('0.00');
    expect(r.temSaldoCredor).toBe(false);
    expect(r.lancamentoTransporte).toBeNull();
  });
});
