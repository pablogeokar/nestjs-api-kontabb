import type { FaturamentoMesSnapshot } from '../../database/schema';
import {
  centavos,
  colunasAtivas,
  decimal,
  documentosDoMes,
  formatarCentavos,
  formatarDataHora,
  formatarDocumentoFiscal,
  rotuloPeriodo,
  totaisPeriodo,
} from './faturamento-relatorio';

const mes = (
  competencia: string,
  produtos: string,
  servicos: string,
  transportes: string | undefined,
  qtd = [0, 0, 0],
): FaturamentoMesSnapshot => {
  const total =
    centavos(produtos) + centavos(servicos) + centavos(transportes ?? '0.00');
  return {
    competencia,
    valorProdutos: produtos,
    valorServicos: servicos,
    ...(transportes === undefined ? {} : { valorTransportes: transportes }),
    total: decimal(total),
    quantidadeProdutos: qtd[0],
    quantidadeServicos: qtd[1],
    ...(transportes === undefined ? {} : { quantidadeTransportes: qtd[2] }),
  };
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
    // 22/11/2026 17:32 UTC = 14:32 em Salvador (UTC-3)
    expect(formatarDataHora(new Date('2026-11-22T17:32:00Z'))).toBe(
      '22/11/2026 às 14:32',
    );
    // virada de dia: 01:10 UTC do dia 1º ainda é dia 30 na Bahia
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
      colunasAtivas([mes('2026-10', '0.00', '0.00', '100.00', [0, 0, 3])]),
    ).toEqual(['TRANSPORTES']);
    expect(
      colunasAtivas([
        mes('2026-09', '10.00', '0.00', '0.00', [1, 0, 0]),
        mes('2026-10', '0.00', '5.00', '0.00', [0, 1, 0]),
      ]),
    ).toEqual(['MERCADORIAS', 'SERVICOS']);
  });

  it('sem movimento algum, mantém mercadorias e serviços', () => {
    expect(colunasAtivas([mes('2026-10', '0.00', '0.00', '0.00')])).toEqual([
      'MERCADORIAS',
      'SERVICOS',
    ]);
  });

  it('lê relatórios antigos, emitidos sem o campo de transportes', () => {
    const antigo = mes('2026-01', '100.00', '50.00', undefined, [2, 1, 0]);
    expect(antigo.valorTransportes).toBeUndefined();
    expect(colunasAtivas([antigo])).toEqual(['MERCADORIAS', 'SERVICOS']);
    expect(documentosDoMes(antigo)).toBe(3);
    expect(totaisPeriodo([antigo]).porTipo.TRANSPORTES).toBe(0n);
  });

  it('totaliza por tipo, documentos e total, e calcula a média sobre todas as competências', () => {
    const t = totaisPeriodo([
      mes('2026-08', '0.00', '0.00', '40000.00', [0, 0, 80]),
      mes('2026-09', '0.00', '0.00', '43827.27', [0, 0, 81]),
      mes('2026-10', '10.00', '0.00', '47654.54', [1, 0, 82]),
    ]);
    expect(t.porTipo.TRANSPORTES).toBe(centavos('131481.81'));
    expect(t.porTipo.MERCADORIAS).toBe(centavos('10.00'));
    expect(t.documentos).toBe(244);
    expect(t.total).toBe(centavos('131491.81'));
    expect(t.competencias).toBe(3);
    // 131491,81 / 3 = 43830,6033... -> 43830,60
    expect(t.mediaMensal).toBe(centavos('43830.60'));
  });

  it('inclui meses sem receita na média e arredonda meio centavo para cima', () => {
    const t = totaisPeriodo([
      mes('2026-01', '0.01', '0.00', '0.00', [1, 0, 0]),
      mes('2026-02', '0.00', '0.00', '0.00'),
    ]);
    expect(t.mediaMensal).toBe(1n);
    expect(totaisPeriodo([]).mediaMensal).toBe(0n);
  });
});
