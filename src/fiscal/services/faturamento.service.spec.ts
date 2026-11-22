import { BadRequestException } from '@nestjs/common';
import {
  buildFaturamentoMeses,
  parseFaturamentoPeriod,
} from './faturamento.service';

describe('período da relação de faturamento', () => {
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

describe('valores mensais da relação de faturamento', () => {
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
          valorTransportes: '0.00',
          total: '0.30',
          quantidadeProdutos: 3,
          quantidadeServicos: 0,
          quantidadeTransportes: 0,
        },
        {
          competencia: '2026-02',
          valorProdutos: '0.00',
          valorServicos: '0.00',
          valorTransportes: '0.00',
          total: '0.00',
          quantidadeProdutos: 0,
          quantidadeServicos: 0,
          quantidadeTransportes: 0,
        },
        {
          competencia: '2026-03',
          valorProdutos: '0.00',
          valorServicos: '100.01',
          valorTransportes: '0.00',
          total: '100.01',
          quantidadeProdutos: 0,
          quantidadeServicos: 1,
          quantidadeTransportes: 0,
        },
      ],
    });
  });

  it('soma a prestação de transporte (CT-e) ao total do mês, em coluna própria', () => {
    const period = parseFaturamentoPeriod('2026-10', '2026-10');
    expect(
      buildFaturamentoMeses(period.first, period.last, [
        {
          competencia: '2026-10',
          tipo: 'PRODUTO',
          valor: '100.10',
          quantidade: 2,
        },
        {
          competencia: '2026-10',
          tipo: 'SERVICO',
          valor: '50.20',
          quantidade: 1,
        },
        {
          competencia: '2026-10',
          tipo: 'TRANSPORTE',
          valor: '47827.27',
          quantidade: 89,
        },
      ]),
    ).toEqual({
      total: '47977.57',
      meses: [
        {
          competencia: '2026-10',
          valorProdutos: '100.10',
          valorServicos: '50.20',
          valorTransportes: '47827.27',
          total: '47977.57',
          quantidadeProdutos: 2,
          quantidadeServicos: 1,
          quantidadeTransportes: 89,
        },
      ],
    });
  });

  it('uma transportadora sem NF-e nem NFS-e deixa de sair com faturamento zerado', () => {
    const period = parseFaturamentoPeriod('2026-10', '2026-10');
    const { total, meses } = buildFaturamentoMeses(period.first, period.last, [
      {
        competencia: '2026-10',
        tipo: 'TRANSPORTE',
        valor: '47827.27',
        quantidade: 89,
      },
    ]);
    expect(total).toBe('47827.27');
    expect(meses[0]).toMatchObject({
      valorProdutos: '0.00',
      valorServicos: '0.00',
      valorTransportes: '47827.27',
    });
  });
});
