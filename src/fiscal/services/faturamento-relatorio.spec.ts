import type { FaturamentoMesSnapshot } from '../../database/schema';
import {
  centavos,
  colunasAtivas,
  decimal,
  formatarCentavos,
  formatarDataHora,
  formatarDocumentoFiscal,
  rotuloPeriodo,
  temDevolucoes,
  totaisPeriodo,
} from './faturamento-relatorio';

const mes = (
  competencia: string,
  valores: Partial<FaturamentoMesSnapshot> = {},
): FaturamentoMesSnapshot => {
  const base = {
    competencia,
    valorProdutos: '0.00',
    valorServicos: '0.00',
    valorTransportes: '0.00',
    valorDevolucoes: '0.00',
    ...valores,
  };
  const total =
    valores.total ??
    decimal(
      centavos(base.valorProdutos) +
        centavos(base.valorServicos) +
        centavos(base.valorTransportes) -
        centavos(base.valorDevolucoes),
    );
  return { ...base, total };
};

describe('formatação de valores', () => {
  it('formata centavos com milhar e vírgula, sem erro de ponto flutuante', () => {
    expect(formatarCentavos(centavos('0.05'))).toBe('0,05');
    expect(formatarCentavos(centavos('1234567.89'))).toBe('1.234.567,89');
    expect(formatarCentavos(centavos('47827.27'))).toBe('47.827,27');
    expect(formatarCentavos(centavos('0.1') + centavos('0.2'))).toBe('0,30');
    expect(formatarCentavos(0n)).toBe('0,00');
    expect(decimal(centavos('-12.30'))).toBe('-12.30');
  });

  it('aplica a máscara de CNPJ, CNPJ alfanumérico e CPF', () => {
    expect(formatarDocumentoFiscal('05776490000136')).toBe(
      '05.776.490/0001-36',
    );
    expect(formatarDocumentoFiscal('05.776.490/0001-36')).toBe(
      '05.776.490/0001-36',
    );
    expect(formatarDocumentoFiscal('12ABC34501DE35')).toBe(
      '12.ABC.345/01DE-35',
    );
    expect(formatarDocumentoFiscal('12345678901')).toBe('123.456.789-01');
    expect(formatarDocumentoFiscal('abc')).toBe('abc');
  });

  it('formata data e hora no horário da Bahia', () => {
    expect(formatarDataHora(new Date('2026-11-22T17:32:00Z'))).toBe(
      '22/11/2026 às 14:32',
    );
    expect(formatarDataHora(new Date('2026-12-01T01:10:00Z'))).toBe(
      '30/11/2026 às 22:10',
    );
  });

  it('descreve o período, com mês único ou intervalo', () => {
    expect(rotuloPeriodo('2026-10', '2026-10')).toBe('10/2026');
    expect(rotuloPeriodo('2025-11', '2026-10')).toBe('11/2025 a 10/2026');
  });
});

describe('colunas e totais do período', () => {
  it('mostra só os tipos de receita com movimento', () => {
    expect(
      colunasAtivas([mes('2026-10', { valorTransportes: '100.00' })]),
    ).toEqual(['TRANSPORTES']);
    expect(
      colunasAtivas([
        mes('2026-09', { valorProdutos: '10.00' }),
        mes('2026-10', { valorServicos: '5.00' }),
      ]),
    ).toEqual(['MERCADORIAS', 'SERVICOS']);
    expect(colunasAtivas([mes('2026-10')])).toEqual([
      'MERCADORIAS',
      'SERVICOS',
    ]);
  });

  it('deduz as devoluções: a receita bruta é a base da apuração', () => {
    const t = totaisPeriodo([
      mes('2026-10', { valorProdutos: '54129.00', valorDevolucoes: '4135.00' }),
      mes('2026-11', { valorProdutos: '23932.00', valorDevolucoes: '902.00' }),
    ]);
    expect(t.porTipo.MERCADORIAS).toBe(centavos('78061.00'));
    expect(t.devolucoes).toBe(centavos('5037.00'));
    expect(t.total).toBe(centavos('73024.00'));
    expect(t.porTipo.MERCADORIAS - t.devolucoes).toBe(t.total);
  });

  it('o mês do histórico informado soma no total, fora da composição por tipo', () => {
    const t = totaisPeriodo([
      mes('2026-01', {
        total: '126346.56',
        origem: 'HISTORICO_INFORMADO',
        detalhado: false,
      }),
      mes('2026-02', { valorProdutos: '100.00' }),
    ]);
    expect(t.total).toBe(centavos('126446.56'));
    expect(t.porTipo.MERCADORIAS).toBe(centavos('100.00'));
    expect(
      colunasAtivas([
        mes('2026-01', { detalhado: false, valorServicos: '9.00' }),
      ]),
    ).toEqual(['MERCADORIAS', 'SERVICOS']);
  });

  it('lê relatórios antigos, sem transportes, devoluções nem origem', () => {
    const antigo: FaturamentoMesSnapshot = {
      competencia: '2026-01',
      valorProdutos: '100.00',
      valorServicos: '50.00',
      total: '150.00',
      quantidadeProdutos: 2,
      quantidadeServicos: 1,
    };
    expect(colunasAtivas([antigo])).toEqual(['MERCADORIAS', 'SERVICOS']);
    expect(temDevolucoes([antigo])).toBe(false);
    expect(totaisPeriodo([antigo])).toMatchObject({
      total: centavos('150.00'),
      devolucoes: 0n,
    });
  });

  it('calcula a média sobre todas as competências e arredonda meio centavo para cima', () => {
    expect(
      totaisPeriodo([
        mes('2026-08', { valorTransportes: '40000.00' }),
        mes('2026-09', { valorTransportes: '43827.27' }),
        mes('2026-10', { valorTransportes: '47654.54' }),
      ]).mediaMensal,
    ).toBe(centavos('43827.27'));
    expect(
      totaisPeriodo([mes('2026-01', { valorProdutos: '0.01' }), mes('2026-02')])
        .mediaMensal,
    ).toBe(1n);
    expect(totaisPeriodo([]).mediaMensal).toBe(0n);
  });
});
