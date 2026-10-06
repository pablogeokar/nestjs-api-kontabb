import {
  monthsBetweenCompetencias,
  parseCompetenciaMensal,
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

describe('XML emitido 31/08 23h fuso local — fuso vs timestamp (R3.2)', () => {
  // A nota é emitida às 23h de 31/08 no horário de Brasília (UTC-3). O instante
  // bruto em UTC é, portanto, 01/09 02:00Z — já em setembro. Se a competência de
  // emissão fosse recortada SÓ pelo timestamp UTC, a nota "escaparia" de agosto.
  // A data fiscal (`date` em fuso local, derivada na importação) guarda
  // '2026-08-31' e é quem define a competência; o timestamp é só fallback.
  const brasiliaLocal31Ago23h = new Date('2026-08-31T23:00:00.000-03:00');
  const emissaoFiscal = '2026-08-31'; // data fiscal (fuso local) da mesma nota

  it('o timestamp bruto UTC da nota cai em setembro (por que o fuso importa)', () => {
    // Documenta o motivo da política: confiar só no timestamp bruto erraria a
    // competência de uma nota de virada de mês.
    expect(brasiliaLocal31Ago23h.toISOString()).toBe('2026-09-01T02:00:00.000Z');
  });

  it('a data fiscal 31/08 pertence à competência de agosto (date, não timestamp)', () => {
    const agosto = parseCompetenciaMensal('2026-08');
    // O serviço compara a coluna `date` fiscal com estes limites de string.
    expect(emissaoFiscal >= agosto.competencia).toBe(true);
    expect(emissaoFiscal <= '2026-08-31').toBe(true);
    // O timestamp bruto, ao contrário, cairia FORA da janela de agosto.
    expect(brasiliaLocal31Ago23h.getTime()).toBeGreaterThan(agosto.fim.getTime());
  });

  it('o mesmo instante bruto pertence à janela de timestamp de setembro', () => {
    const setembro = parseCompetenciaMensal('2026-09');
    expect(brasiliaLocal31Ago23h.getTime()).toBeGreaterThanOrEqual(
      setembro.inicio.getTime(),
    );
    expect(brasiliaLocal31Ago23h.getTime()).toBeLessThanOrEqual(
      setembro.fim.getTime(),
    );
  });
});
