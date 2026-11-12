import {
  calcularVencimento,
  derivarStatusFatura,
  fromCents,
  isValidCivilDate,
  resolverStatusFatura,
  toCents,
} from '../financeiro.utils';

describe('financeiro.utils', () => {
  it('converte valores monetários sem erro de ponto flutuante', () => {
    expect(toCents('0.1') + toCents('0.2')).toBe(30);
    expect(fromCents(toCents(1234.5))).toBe('1234.50');
    expect(fromCents(5)).toBe('0.05');
  });

  it('calcula o vencimento no mês seguinte ajustando o último dia', () => {
    expect(calcularVencimento('11/2026', 10)).toBe('2026-12-10');
    expect(calcularVencimento('12/2026', 10)).toBe('2027-01-10');
    expect(calcularVencimento('01/2027', 31)).toBe('2027-02-28');
    expect(calcularVencimento('01/2028', 31)).toBe('2028-02-29');
  });

  it('valida datas civis existentes', () => {
    expect(isValidCivilDate('2026-02-28')).toBe(true);
    expect(isValidCivilDate('2026-02-31')).toBe(false);
  });

  it('resolve e deriva o status da fatura', () => {
    const base = { liquidoCents: 10000, hoje: '2026-11-12' };
    expect(
      resolverStatusFatura({
        ...base,
        abatidoCents: 10000,
        dataVencimento: '2026-01-01',
      }),
    ).toBe('PAGA');
    expect(
      resolverStatusFatura({
        ...base,
        abatidoCents: 5000,
        dataVencimento: '2026-12-01',
      }),
    ).toBe('PARCIALMENTE_PAGA');
    expect(
      resolverStatusFatura({
        ...base,
        abatidoCents: 0,
        dataVencimento: '2026-12-01',
      }),
    ).toBe('PENDENTE');
    expect(
      resolverStatusFatura({
        ...base,
        abatidoCents: 0,
        dataVencimento: '2026-11-01',
      }),
    ).toBe('VENCIDA');
    expect(derivarStatusFatura('PENDENTE', '2026-11-01', '2026-11-12')).toBe(
      'VENCIDA',
    );
    expect(derivarStatusFatura('PAGA', '2026-11-01', '2026-11-12')).toBe(
      'PAGA',
    );
  });
});
