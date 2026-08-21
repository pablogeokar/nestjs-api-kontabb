import { parseFiscalEndDate, parseFiscalStartDate } from './fiscal-date.util';

describe('fiscal date range', () => {
  it('inclui o dia inteiro na data final', () => {
    expect(parseFiscalEndDate('2026-08-16')?.toISOString()).toBe(
      '2026-08-16T23:59:59.999Z',
    );
  });

  it('mantém o início do período', () => {
    expect(parseFiscalStartDate('2026-08-16')?.toISOString()).toBe(
      '2026-08-16T00:00:00.000Z',
    );
  });
});
