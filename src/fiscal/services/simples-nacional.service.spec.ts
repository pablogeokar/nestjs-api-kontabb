import { BadRequestException } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  SimplesNacionalService,
  anexoPorServico,
  mesesAnteriores,
  proximaCompetencia,
  vencimentoDas,
} from './simples-nacional.service';
import { SimplesCalculadorService } from './simples-calculador.service';

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
    const caixa = dialect.sqlToQuery(
      service['dataReceitaDocumento'](false),
    ).sql;
    const competencia = dialect.sqlToQuery(
      service['dataReceitaDocumento'](true),
    ).sql;
    expect(caixa).toContain('CASE WHEN');
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
    Object.defineProperty(service, 'carregarLinhasReceitaPeriodo', {
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

  it('inclui o CT-e emitido na receita mensal e no Anexo III de transporte', async () => {
    const service = new SimplesNacionalService(null!, null!, null!, null!);
    const cte = {
      documentoId: 'cte-1',
      numeroDocumento: '321',
      mes: '2026-04',
      documentoTotal: '1500.00',
      tipoDocumento: 'CTE',
      cfop: '5353',
      cfopXml: '5353',
      revisaoNecessaria: false,
      tpCte: '0',
      bruto: '1500.00',
      frete: null,
      seguro: null,
      outras: null,
      desconto: null,
      indTotal: '1',
      itemListaServico: null,
      cnae: null,
      issRetido: false,
      municipioIncidencia: null,
      municipioPrestador: null,
      csosn: null,
      cstIcms: null,
      cstPis: null,
      cstCofins: null,
    };
    Object.defineProperty(service, 'carregarLinhasReceitaPeriodo', {
      value: jest.fn().mockResolvedValue([cte]),
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

    expect(atividade.pendencias).toEqual([]);
    expect(atividade.grupos).toEqual([
      expect.objectContaining({
        anexo: 'ANEXO_III',
        transporteCte: true,
        receita: 150000n,
      }),
    ]);
    expect(mensal).toEqual([{ mes: '2026-04', valor: '1500.00' }]);
  });

  it('compensa anulação na mesma competência e exige revisão de CT-e especial', async () => {
    const service = new SimplesNacionalService(null!, null!, null!, null!);
    const base = {
      documentoId: 'cte-1',
      numeroDocumento: '321',
      mes: '2026-04',
      documentoTotal: '1500.00',
      tipoDocumento: 'CTE',
      cfop: '5353',
      cfopXml: '5353',
      revisaoNecessaria: false,
      tpCte: '0',
      bruto: '1500.00',
      frete: null,
      seguro: null,
      outras: null,
      desconto: null,
      indTotal: '1',
      itemListaServico: null,
      cnae: null,
      issRetido: false,
      municipioIncidencia: null,
      municipioPrestador: null,
      csosn: null,
      cstIcms: null,
      cstPis: null,
      cstCofins: null,
    };
    Object.defineProperty(service, 'carregarLinhasReceitaPeriodo', {
      value: jest.fn().mockResolvedValue([
        base,
        { ...base, documentoId: 'cte-2', tpCte: '2', bruto: '-500.00' },
        {
          ...base,
          documentoId: 'cte-3',
          revisaoNecessaria: true,
          bruto: '100.00',
        },
      ]),
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
    expect(atividade.grupos[0].receita).toBe(110000n);
    expect(atividade.pendencias).toEqual([
      expect.stringContaining('exige revisão'),
    ]);
    expect(mensal).toEqual([{ mes: '2026-04', valor: '1100.00' }]);
  });

  it('consulta apenas CT-e autorizado, escriturável e de saída', async () => {
    let filtro: SQL | undefined;
    const database = {
      db: {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn((condition: SQL) => {
                filtro = condition;
                return Promise.resolve([]);
              }),
            }),
          }),
        }),
      },
    };
    const service = new SimplesNacionalService(
      database as never,
      null!,
      null!,
      null!,
    );
    Object.defineProperty(service, 'carregarItensReceitaPeriodo', {
      value: jest.fn().mockResolvedValue([]),
    });
    await service['carregarLinhasReceitaPeriodo'](
      'cliente',
      '2026-04-01',
      '2026-04-30',
    );
    const query = new PgDialect().sqlToQuery(filtro!);
    expect(query.sql).toContain('escrituravel');
    expect(query.sql).toContain('tipo_operacao_escriturada');
    expect(query.sql).toContain('situacao');
    expect(query.params).toEqual(
      expect.arrayContaining(['cliente', 'CTE', 'AUTORIZADA', true, 'SAIDA']),
    );
  });

  it('simula DAS da transportadora com a partilha de ICMS correta', async () => {
    const service = new SimplesNacionalService(
      null!,
      new SimplesCalculadorService(),
      null!,
      null!,
    );
    const mock = (name: string, value: unknown) =>
      Object.defineProperty(service, name, {
        value: jest.fn().mockResolvedValue(value),
      });
    mock('buscarClienteSimples', { uf: 'BA', regimeCompetencia: true });
    mock('buscarTabelaVigente', { id: 'tabela' });
    mock('carregarReceitasMensais', {
      rows: [{ mes: '2026-04', receita: '1500.00' }],
      origem: 'DOCUMENTOS_FISCAIS',
    });
    mock('carregarPrimeiraCompetenciaReceita', '2026-04');
    mock('carregarReceitasAtividade', {
      grupos: [
        {
          anexo: 'ANEXO_III',
          segregacao: 'TRIBUTACAO_INTEGRAL',
          deducoes: [],
          receita: 150000n,
          issOutroMunicipio: false,
          transporteCte: true,
        },
      ],
      pendencias: [],
    });
    mock('carregarFolha12m', { valor: '0.00', origem: 'FOLHA' });
    mock('carregarSublimite', { valor: '3600000.00', origem: 'TABELA' });
    mock(
      'carregarAnexosCalculo',
      new Map([
        [
          'ANEXO_III',
          [
            {
              faixa: 1,
              rbt12De: '0.00',
              rbt12Ate: '180000.00',
              aliquotaNominal: '0.0600',
              parcelaDeduzir: '0.00',
              partilha: {
                irpj: '0.0400',
                csll: '0.0350',
                cofins: '0.1282',
                pis: '0.0278',
                cpp: '0.4340',
                ipi: '0.0000',
                icms: '0.0000',
                iss: '0.3350',
              },
            },
          ],
        ],
        [
          'ANEXO_I',
          [
            {
              faixa: 1,
              rbt12De: '0.00',
              rbt12Ate: '180000.00',
              aliquotaNominal: '0.0400',
              parcelaDeduzir: '0.00',
              partilha: {
                irpj: '0.0550',
                csll: '0.0350',
                cofins: '0.1274',
                pis: '0.0276',
                cpp: '0.4150',
                ipi: '0.0000',
                icms: '0.3400',
                iss: '0.0000',
              },
            },
          ],
        ],
      ]),
    );
    mock('auditarReceitasPeriodo', {
      pendencias: [],
      bonificacoesExcluidas: '0.00',
      operacoesSemReceitaExcluidas: '0.00',
    });
    mock('carregarFolhasAutomaticasPeriodo', []);

    const apuracao = await service['calcular']('cliente', '2026-04');
    expect(apuracao.receita_bruta_mes).toBe('1500.00');
    expect(apuracao.rbt12).toBe('18000.00');
    expect(apuracao.valor_total_das).toBe('80.25');
    expect(apuracao.itens[0].tributos_partilhados).toMatchObject({
      icms: '20.40',
      iss: '0.00',
    });
    expect(apuracao.memoria_calculo.pendencias).toEqual([]);
  });

  it('não reduz receita de NFS-e quando anulações de CT-e excedem os fretes do mês', async () => {
    const service = new SimplesNacionalService(null!, null!, null!, null!);
    const base = {
      documentoId: 'doc',
      numeroDocumento: '1',
      mes: '2026-04',
      documentoTotal: '1000.00',
      cfop: '5353',
      cfopXml: '5353',
      bruto: '1000.00',
      frete: null,
      seguro: null,
      outras: null,
      desconto: null,
      indTotal: '1',
    };
    Object.defineProperty(service, 'carregarLinhasReceitaPeriodo', {
      value: jest.fn().mockResolvedValue([
        { ...base, tipoDocumento: 'NFSE', cfop: null, cfopXml: null },
        { ...base, tipoDocumento: 'CTE', tpCte: '2', bruto: '-1500.00' },
      ]),
    });
    const mensal = await service['carregarReceitasAutomaticasPeriodo'](
      'cliente',
      '2026-04-01',
      '2026-04-01',
    );
    expect(mensal).toEqual([{ mes: '2026-04', valor: '1000.00' }]);
  });

  it('sinaliza CT-e de saída antigo sem linha de escrituração para reprocessamento', async () => {
    const database = {
      db: {
        select: jest.fn((selection: Record<string, unknown>) => {
          const rows =
            'id' in selection
              ? [
                  {
                    id: 'cte-antigo',
                    numero: '77',
                    tipoDocumento: 'CTE',
                    chaveAcesso: 'A'.repeat(44),
                    cteEscrituracaoId: null,
                    cteEscrituravel: null,
                    mes: '2026-04',
                    total: '900.00',
                  },
                ]
              : [];
          const chain = {
            where: jest.fn().mockResolvedValue(rows),
            leftJoin: jest.fn(),
            innerJoin: jest.fn(),
          };
          chain.innerJoin.mockReturnValue(chain);
          chain.leftJoin.mockReturnValue(chain);
          return { from: jest.fn().mockReturnValue(chain) };
        }),
      },
    };
    const service = new SimplesNacionalService(
      database as never,
      null!,
      null!,
      null!,
    );
    Object.defineProperty(service, 'carregarLinhasReceitaPeriodo', {
      value: jest.fn().mockResolvedValue([]),
    });
    const auditoria = await service['auditarReceitasPeriodo'](
      'cliente',
      '2026-04-01',
      '2026-04-30',
      '2026-04',
    );
    expect(auditoria.pendencias).toEqual([
      expect.stringContaining('Reprocesse o XML'),
    ]);
  });
});
