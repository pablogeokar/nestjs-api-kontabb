import { BadRequestException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
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
  it('mantém a receita de competência no RBT12 e usa a emissão como base mensal no caixa', async () => {
    const calcularRbt12 = jest.fn().mockReturnValue({
      rbt12: '100.00',
      proporcional: false,
      origem: 'DOCUMENTOS',
    });
    const service = new SimplesNacionalService(
      null!,
      { calcularRbt12 } as never,
      null!,
      null!,
    );
    const mock = (name: string, value: unknown) =>
      Object.defineProperty(service, name, {
        value: jest.fn().mockResolvedValue(value),
      });
    mock('buscarClienteSimples', { uf: 'SP', regimeCompetencia: false });
    mock('buscarTabelaVigente', { id: 'tabela' });
    mock('carregarReceitasMensais', {
      rows: [{ mes: '2026-04', receita: '100.00' }],
      origem: 'DOCUMENTOS_FISCAIS',
    });
    mock('carregarPrimeiraCompetenciaReceita', '2026-04');
    mock('carregarReceitasAtividade', { grupos: [], pendencias: [] });
    mock('carregarReceitasAutomaticasPeriodo', []);
    mock('carregarFolha12m', { valor: '0.00', origem: 'FOLHA' });
    mock('carregarSublimite', { valor: '3600000.00', origem: 'TABELA' });
    mock('carregarAnexosCalculo', new Map());
    mock('auditarReceitasPeriodo', {
      pendencias: [],
      bonificacoesExcluidas: '0.00',
      operacoesSemReceitaExcluidas: '0.00',
    });
    mock('carregarFolhasAutomaticasPeriodo', []);

    const apuracao = await service['calcular']('cliente', '2026-04');
    expect(calcularRbt12).toHaveBeenCalledWith(
      expect.objectContaining({ receitaPrimeiroMes: '100.00' }),
    );
    expect(service['carregarReceitasAtividade']).toHaveBeenCalledWith(
      'cliente',
      expect.any(Date),
      expect.any(Date),
      false,
    );
    expect(service['carregarReceitasAutomaticasPeriodo']).toHaveBeenCalledWith(
      'cliente',
      '2026-04-01',
      '2026-04-01',
      false,
    );
    expect(apuracao.memoria_calculo.receitaMesCompetencia).toBe('100.00');
    expect(apuracao.memoria_calculo.receitaMesDocumentos).toBe('0.00');
    expect(apuracao.receita_bruta_mes).toBe('0.00');
  });

  it('seleciona emissão da NFS-e no caixa e competência declarada nos demais casos', () => {
    const service = new SimplesNacionalService(null!, null!, null!, null!);
    const dialect = new PgDialect();
    const caixa = dialect.sqlToQuery(service['dataReceitaDocumento'](false)).sql;
    const competencia = dialect.sqlToQuery(service['dataReceitaDocumento'](true)).sql;
    expect(caixa).toContain("CASE WHEN");
    expect(caixa).toContain('tipo_documento');
    expect(caixa).toContain('data_emissao_fiscal');
    expect(caixa).toContain('competencia_declarada');
    expect(competencia).not.toContain('CASE WHEN');
    expect(competencia).toContain('competencia_declarada');
  });

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
