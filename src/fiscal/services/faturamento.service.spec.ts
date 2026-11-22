import { BadRequestException } from '@nestjs/common';
import {
  montarMesesFaturamento,
  parseFaturamentoPeriod,
} from './faturamento.service';
import type { ReceitaBrutaCompetencia } from './simples-nacional.service';

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
  const receita = (
    competencia: string,
    valores: Partial<ReceitaBrutaCompetencia>,
  ): ReceitaBrutaCompetencia => ({
    competencia,
    origem: 'DOCUMENTOS',
    statusApuracao: null,
    detalhado: true,
    mercadorias: '0.00',
    servicos: '0.00',
    transportes: '0.00',
    receitaBruta: '0.00',
    ...valores,
  });

  it('usa a receita bruta de apuração de cada mês e soma o período com precisão', () => {
    const { meses, total } = montarMesesFaturamento([
      receita('2026-09', {
        mercadorias: '49994.00',
        receitaBruta: '49994.00',
        origem: 'APURACAO_SIMPLES',
        statusApuracao: 'FECHADO',
      }),
      receita('2026-10', {
        mercadorias: '0.10',
        servicos: '0.20',
        receitaBruta: '0.30',
      }),
    ]);
    expect(total).toBe('49994.30');
    expect(meses[0]).toEqual({
      competencia: '2026-09',
      valorProdutos: '49994.00',
      valorServicos: '0.00',
      valorTransportes: '0.00',
      total: '49994.00',
      origem: 'APURACAO_SIMPLES',
      detalhado: true,
    });
    expect(meses[1].total).toBe('0.30');
  });

  it('mantém o mês do histórico informado sem composição por tipo', () => {
    const { meses, total } = montarMesesFaturamento([
      receita('2026-01', {
        origem: 'HISTORICO_INFORMADO',
        detalhado: false,
        receitaBruta: '126346.56',
      }),
    ]);
    expect(total).toBe('126346.56');
    expect(meses[0]).toMatchObject({
      origem: 'HISTORICO_INFORMADO',
      detalhado: false,
      valorProdutos: '0.00',
    });
  });

  it('não grava quantidade de documentos nem devoluções no snapshot', () => {
    const { meses } = montarMesesFaturamento([
      receita('2026-10', { transportes: '47827.27', receitaBruta: '47827.27' }),
    ]);
    expect(
      Object.keys(meses[0]).some(
        (chave) =>
          chave.startsWith('quantidade') || chave === 'valorDevolucoes',
      ),
    ).toBe(false);
  });
});
