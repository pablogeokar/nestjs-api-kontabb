import { isValidPaymentDate } from './payment-date';

describe('isValidPaymentDate', () => {
  const today = '2026-10-23';

  it('aceita uma data passada e o dia atual', () => {
    expect(isValidPaymentDate('2026-10-20', today)).toBe(true);
    expect(isValidPaymentDate(today, today)).toBe(true);
  });

  it('rejeita data futura, inválida ou em formato diferente', () => {
    expect(isValidPaymentDate('2026-10-24', today)).toBe(false);
    expect(isValidPaymentDate('2026-02-30', today)).toBe(false);
    expect(isValidPaymentDate('20/10/2026', today)).toBe(false);
  });
});
