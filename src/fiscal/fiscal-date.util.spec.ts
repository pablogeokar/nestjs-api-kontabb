import {
  monthsBetweenCompetencias,
  parseFiscalEndDate,
  parseFiscalStartDate,
} from './fiscal-date.util';

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

describe('monthsBetweenCompetencias (calendário do CIAP, R1.4)', () => {
  it('mesmo mês de entrada → 0 (parcela 1)', () => {
    expect(monthsBetweenCompetencias('2026-01-10', '2026-01-01')).toBe(0);
  });

  it('conta meses de calendário até a competência de referência', () => {
    // jan → set = 8 meses (parcela 9).
    expect(monthsBetweenCompetencias('2026-01-10', '2026-09-01')).toBe(8);
  });

  it('atravessa a virada de ano', () => {
    // nov/2025 → fev/2026 = 3 meses (parcela 4).
    expect(monthsBetweenCompetencias('2025-11-01', '2026-02-01')).toBe(3);
  });

  it('competência anterior à entrada → negativo (bem futuro, R1.3)', () => {
    // Entrada out/2026 avaliada em set/2026 → -1 (parcela < 1, inelegível).
    expect(monthsBetweenCompetencias('2026-10-05', '2026-09-01')).toBe(-1);
  });

  it('aceita entradas no formato AAAA-MM (sem dia)', () => {
    expect(monthsBetweenCompetencias('2026-03', '2026-07')).toBe(4);
  });

  it('rejeita datas sem o prefixo AAAA-MM válido', () => {
    expect(() => monthsBetweenCompetencias('2026/01', '2026-09-01')).toThrow(
      'Data de competência inválida',
    );
  });
});
