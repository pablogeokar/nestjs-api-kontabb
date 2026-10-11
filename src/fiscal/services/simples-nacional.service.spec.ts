import { BadRequestException } from '@nestjs/common';
import {
  mesesAnteriores,
  proximaCompetencia,
  vencimentoDas,
} from './simples-nacional.service';

describe('utilitários do SimplesNacionalService', () => {
  it('gera os 12 meses anteriores em ordem cronológica e cruza o ano', () => {
    expect(mesesAnteriores('2026-03', 12)).toEqual([
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('avança a competência de dezembro para janeiro', () => {
    expect(proximaCompetencia('2026-12')).toBe('2027-01');
  });

  it('antecipa o DAS quando o dia 20 cair no fim de semana', () => {
    expect(vencimentoDas('2026-05')).toBe('2026-06-19');
  });

  it('rejeita competência inválida', () => {
    expect(() => mesesAnteriores('2026-13', 12)).toThrow(BadRequestException);
  });
});
