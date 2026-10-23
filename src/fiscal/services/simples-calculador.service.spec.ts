import { BadRequestException } from '@nestjs/common';
import {
  SimplesCalculadorService,
  type SimplesFaixaCalculo,
} from './simples-calculador.service';

const partilha = {
  irpj: '0.0550',
  csll: '0.0350',
  cofins: '0.1274',
  pis: '0.0276',
  cpp: '0.4150',
  ipi: '0.0000',
  icms: '0.3400',
  iss: '0.0000',
};

const faixa: SimplesFaixaCalculo = {
  faixa: 2,
  rbt12De: '180000.01',
  rbt12Ate: '360000.00',
  aliquotaNominal: '0.0730',
  parcelaDeduzir: '5940.00',
  partilha,
};

describe('SimplesCalculadorService', () => {
  const service = new SimplesCalculadorService();

  it('calcula a alíquota efetiva sem Number', () => {
    expect(
      service.calcularAliquotaEfetiva({
        rbt12: '300000.00',
        aliquotaNominal: faixa.aliquotaNominal,
        parcelaDeduzir: faixa.parcelaDeduzir,
      }),
    ).toBe('0.0532');
  });

  it('mantém a alíquota nominal na primeira faixa', () => {
    expect(
      service.calcularAliquotaEfetiva({
        rbt12: '180000.00',
        aliquotaNominal: '0.0400',
        parcelaDeduzir: '0.00',
      }),
    ).toBe('0.0400');
  });

  it('resolve a transição do Fator R exatamente em 28%', () => {
    expect(service.calcularFatorR('28000.00', '100000.00')).toBe('0.2800');
    expect(service.resolverAnexoFatorR('0.2799')).toBe('ANEXO_V');
    expect(service.resolverAnexoFatorR('0.2800')).toBe('ANEXO_III');
  });

  it('aplica os casos especiais do Fator R e usa a receita do primeiro mês', () => {
    expect(service.calcularFatorR('0.00', '0.00')).toBe('0.0100');
    expect(service.calcularFatorR('100.00', '0.00')).toBe('0.2800');
    expect(service.calcularFatorR('0.00', '100.00')).toBe('0.0100');
    expect(
      service.calcularFatorR('0.00', '120000.00', {
        folhaMes: '3000.00',
        receitaMes: '10000.00',
      }),
    ).toBe('0.3000');
  });

  it('anualiza o primeiro mês e a média dos meses iniciais', () => {
    expect(
      service.calcularRbt12({
        receitasAnteriores: [],
        mesesAnteriores: 0,
        receitaPrimeiroMes: '10000.00',
      }).rbt12,
    ).toBe('120000.00');
    expect(
      service.calcularRbt12({
        receitasAnteriores: ['10000.00', '20000.00'],
        mesesAnteriores: 2,
      }).rbt12,
    ).toBe('180000.00');
  });

  it('deduz o ICMS da receita com ST', () => {
    const result = service.calcularItem({
      anexo: 'ANEXO_I',
      receita: '10000.00',
      segregacao: 'ICMS_ST',
      faixa,
      rbt12: '300000.00',
      excedeuSublimite: false,
    });
    expect(result.aliquotaEfetiva).toBe('0.0532');
    expect(result.tributosPartilhados.icms).toBe('0.00');
    expect(result.deducoes).toContain('ICMS');
    expect(result.valorDevido).toBe('351.12');
  });

  it('reproduz a declaração PGDAS-D de 09/2026 com partilha em centavos', () => {
    const result = service.calcularItem({
      anexo: 'ANEXO_II',
      receita: '58837.00',
      segregacao: 'TRIBUTACAO_INTEGRAL',
      faixa: {
        faixa: 4,
        rbt12De: '720000.01',
        rbt12Ate: '1800000.00',
        aliquotaNominal: '0.1120',
        parcelaDeduzir: '22500.00',
        partilha: {
          irpj: '0.0550',
          csll: '0.0350',
          cofins: '0.1151',
          pis: '0.0249',
          cpp: '0.3750',
          ipi: '0.0750',
          icms: '0.3200',
          iss: '0.0000',
        },
      },
      rbt12: '741731.29',
      excedeuSublimite: false,
    });
    expect(result.aliquotaEfetiva).toBe('0.0817');
    expect(result.valorDevido).toBe('4804.95');
    expect(result.tributosPartilhados).toEqual({
      irpj: '264.27',
      csll: '168.17',
      cofins: '553.05',
      pis: '119.64',
      cpp: '1801.86',
      ipi: '360.37',
      icms: '1537.59',
      iss: '0.00',
    });
  });

  it('deduz PIS e COFINS de receita monofásica', () => {
    const result = service.calcularItem({
      anexo: 'ANEXO_I',
      receita: '10000.00',
      segregacao: 'PIS_COFINS_MONOFASICO',
      faixa,
      rbt12: '300000.00',
      excedeuSublimite: false,
    });
    expect(result.tributosPartilhados.pis).toBe('0.00');
    expect(result.tributosPartilhados.cofins).toBe('0.00');
    expect(result.deducoes).toEqual(expect.arrayContaining(['PIS', 'COFINS']));
  });

  it('exclui o ICMS do DAS ao ultrapassar o sublimite', () => {
    const result = service.calcularItem({
      anexo: 'ANEXO_I',
      receita: '10000.00',
      segregacao: 'TRIBUTACAO_INTEGRAL',
      faixa,
      rbt12: '300000.00',
      excedeuSublimite: true,
    });
    expect(result.tributosPartilhados.icms).toBe('0.00');
  });

  it('rejeita faturamento acima do limite do Simples', () => {
    expect(() => service.selecionarFaixa('4800000.01', [faixa])).toThrow(
      BadRequestException,
    );
  });
});
