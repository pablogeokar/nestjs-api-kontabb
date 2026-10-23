import { BadRequestException } from '@nestjs/common';
import {
  SimplesNacionalService,
  anexoPorServico,
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

  it('classifica psicologia como atividade sujeita ao Fator R', () => {
    expect(anexoPorServico('0416', '8650003')).toBe('ANEXO_V');
  });

  it('classifica construção, limpeza e vigilância no Anexo IV', () => {
    expect(anexoPorServico('0702', '4120400')).toBe('ANEXO_IV');
    expect(anexoPorServico('0710', '8121400')).toBe('ANEXO_IV');
    expect(anexoPorServico('1102', '8011101')).toBe('ANEXO_IV');
  });

  it('mantém serviços gerais no Anexo III direto', () => {
    expect(anexoPorServico('1401', '4520001')).toBe('ANEXO_III');
  });
});

describe('integração da receita do Simples entre atividade e RBT12', () => {
  it('ignora bonificação em nota mista nos dois caminhos de cálculo', async () => {
    const service = new SimplesNacionalService(null!, null!, null!, null!);
    const base = {
      documentoId: 'nota-1',
      numeroDocumento: '123',
      mes: '2026-04',
      documentoTotal: '1130.00',
      tipoDocumento: 'NFE',
      municipioPrestador: null,
      itemListaServico: null,
      cnae: null,
      issRetido: false,
      municipioIncidencia: null,
      csosn: null,
      cstPis: null,
      cstCofins: null,
      indTotal: '1',
      frete: '0.00',
      seguro: '0.00',
      outras: '0.00',
      desconto: '0.00',
    };
    const rows = [
      { ...base, cfop: '5102', cfopXml: '5102', bruto: '930.00' },
      { ...base, cfop: '5910', cfopXml: '5910', bruto: '200.00' },
    ];
    Object.defineProperty(service, 'carregarItensReceitaPeriodo', {
      value: jest.fn().mockResolvedValue(rows),
    });
    const atividade = await service['carregarReceitasAtividade'](
      'cliente',
      new Date('2026-04-01'),
      new Date('2026-04-30'),
    );
    const mensal = await service['carregarReceitasAutomaticasPeriodo'](
      'cliente',
      '2026-04-01',
      '2026-04-01',
    );
    expect(atividade.grupos.map((grupo) => grupo.receita)).toEqual([93000n]);
    expect(mensal).toEqual([{ mes: '2026-04', valor: '930.00' }]);
  });
});
