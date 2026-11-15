import { BadRequestException } from '@nestjs/common';
import {
  buildFaturamentoMeses,
  parseFaturamentoPeriod,
} from './faturamento.service';

describe('período do demonstrativo de faturamento', () => {
  it('atravessa a virada do ano e calcula a data final exclusiva', () => {
    expect(parseFaturamentoPeriod('2025-12', '2026-02')).toMatchObject({
      startDate: '2025-12-01',
      nextDate: '2026-03-01',
    });
  });

  it.each([
    ['2026-13', '2026-12'],
    ['2026-03', '2026-02'],
    ['2020-01', '2030-01'],
    ['0000-01', '0000-12'],
    ['9999-01', '9999-12'],
    ['', '2026-01'],
  ])('rejeita período inválido %s a %s', (start, end) => {
    expect(() => parseFaturamentoPeriod(start, end)).toThrow(
      BadRequestException,
    );
  });
});

describe('valores mensais do demonstrativo', () => {
  it('soma centavos com precisão, separa produtos e serviços e preenche mês sem documentos', () => {
    const period = parseFaturamentoPeriod('2026-01', '2026-03');
    expect(
      buildFaturamentoMeses(period.first, period.last, [
        {
          competencia: '2026-01',
          tipo: 'PRODUTO',
          valor: '0.10',
          quantidade: 1,
        },
        {
          competencia: '2026-01',
          tipo: 'PRODUTO',
          valor: '0.20',
          quantidade: 2,
        },
        {
          competencia: '2026-03',
          tipo: 'SERVICO',
          valor: '100.01',
          quantidade: 1,
        },
      ]),
    ).toEqual({
      total: '100.31',
      meses: [
        {
          competencia: '2026-01',
          valorProdutos: '0.30',
          valorServicos: '0.00',
          total: '0.30',
          quantidadeProdutos: 3,
          quantidadeServicos: 0,
        },
        {
          competencia: '2026-02',
          valorProdutos: '0.00',
          valorServicos: '0.00',
          total: '0.00',
          quantidadeProdutos: 0,
          quantidadeServicos: 0,
        },
        {
          competencia: '2026-03',
          valorProdutos: '0.00',
          valorServicos: '100.01',
          total: '100.01',
          quantidadeProdutos: 0,
          quantidadeServicos: 1,
        },
      ],
    });
  });
});
