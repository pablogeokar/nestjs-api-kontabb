import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { FiscalItensService } from './fiscal-itens.service';

describe('FiscalItensService', () => {
  it('serializa filtros de período com os encoders dos timestamps', () => {
    const service = new FiscalItensService({} as never);
    const dataInicio = new Date('2026-08-01T03:00:00.000Z');
    const dataFim = new Date('2026-08-22T02:59:59.999Z');

    const where = (
      service as unknown as {
        buildWhere(input: { dataInicio: Date; dataFim: Date }): SQL;
      }
    ).buildWhere({ dataInicio, dataFim });
    const query = new PgDialect().sqlToQuery(where);

    expect(query.params).toEqual([
      dataInicio.toISOString(),
      dataFim.toISOString(),
    ]);
  });

  it('consolida C190 pelo CFOP escriturado e mantém o CFOP XML para auditoria', async () => {
    let selection: Record<string, unknown> = {};
    const groupBy = jest.fn().mockReturnValue({
      orderBy: jest.fn().mockResolvedValue([
        {
          tipo_operacao: 'ENTRADA',
          cfop: '1102',
          cfops_xml: ['5102'],
          vl_icms: '18.00',
        },
      ]),
    });
    const database = createReportDatabase((value) => {
      selection = value;
    }, groupBy);
    const service = new FiscalItensService(database as never);

    const report = await service.getC190({ clienteId: 'cliente-1' });

    expect(report.data).toEqual([
      expect.objectContaining({
        tipo_operacao: 'ENTRADA',
        cfop: '1102',
        cfops_xml: ['5102'],
      }),
    ]);
    expect(selection).toHaveProperty('cfop');
    expect(selection).toHaveProperty('cfops_xml');
    expect(groupBy).toHaveBeenCalledTimes(1);
  });

  it('zera a apuração do Simples Nacional sem ICMS separado', async () => {
    const reportSelect = jest.fn();
    const database = createReportDatabase(reportSelect, undefined, {
      regimeTributario: 'SIMPLES_NACIONAL',
      apuraIcms: false,
    });
    const service = new FiscalItensService(database as never);

    const result = await service.getApuracaoIcms({
      clienteId: 'cliente-1',
    });

    expect(result).toMatchObject({
      total_creditos: '0.00',
      total_debitos: '0.00',
      saldo_apurado: '0.00',
    });
    expect(result.observacao).toContain('ICMS recolhido via DAS');
    expect(reportSelect).not.toHaveBeenCalled();
  });

  it('mantém a apuração normal para Simples Nacional com ICMS separado', async () => {
    const database = createApuracaoDatabase(
      { regimeTributario: 'SIMPLES_NACIONAL', apuraIcms: true },
      {
        total_creditos: '15.00',
        total_debitos: '40.00',
        saldo_apurado: '25.00',
      },
    );
    const service = new FiscalItensService(database as never);

    const result = await service.getApuracaoIcms({
      clienteId: 'cliente-1',
    });

    expect(result).toEqual({
      total_creditos: '15.00',
      total_debitos: '40.00',
      saldo_apurado: '25.00',
      observacao: null,
    });
  });

  it('marca o C190 do Simples sem apuração como conferência', async () => {
    const database = createReportDatabase(jest.fn(), undefined, {
      regimeTributario: 'SIMPLES_NACIONAL',
      apuraIcms: false,
    });
    const service = new FiscalItensService(database as never);

    const report = await service.getC190({ clienteId: 'cliente-1' });

    expect(report.icms_compoe_apuracao).toBe(false);
    expect(report.observacao).toContain('apenas para conferência');
  });

  it('separa crédito de entrada tributada e débito de saída nos livros', async () => {
    let selection: Record<string, SQL> = {};
    const database = createReportDatabase((value) => {
      selection = value as Record<string, SQL>;
    });
    const service = new FiscalItensService(database as never);

    await service.getResumoLivros({ clienteId: 'cliente-1' });

    const dialect = new PgDialect();
    const credito = dialect.sqlToQuery(selection.credito_icms).sql;
    const debito = dialect.sqlToQuery(selection.debito_icms).sql;
    expect(credito).toContain('tipo_operacao_escriturada');
    expect(credito).toContain('cst_icms');
    expect(credito).toContain('csosn_icms');
    expect(debito).toContain('tipo_operacao_escriturada');
    expect(selection).toHaveProperty('cfop');
  });

  it('não leva créditos e débitos aos livros do Simples sem apuração separada', async () => {
    const groupBy = jest.fn().mockReturnValue({
      orderBy: jest.fn().mockResolvedValue([
        {
          tipo_operacao: 'ENTRADA',
          cfop: '1102',
          icms_creditado_debitado: '18.00',
          credito_icms: '18.00',
          debito_icms: '0.00',
        },
      ]),
    });
    const database = createReportDatabase(jest.fn(), groupBy, {
      regimeTributario: 'SIMPLES_NACIONAL',
      apuraIcms: false,
    });
    const service = new FiscalItensService(database as never);

    const rows = await service.getResumoLivros({ clienteId: 'cliente-1' });

    expect(rows[0]).toMatchObject({
      icms_creditado_debitado: '0.00',
      credito_icms: '0.00',
      debito_icms: '0.00',
    });
  });
});

function createReportDatabase(
  capture: (selection: Record<string, unknown>) => void,
  groupBy = jest.fn().mockReturnValue({
    orderBy: jest.fn().mockResolvedValue([]),
  }),
  fiscalConfig: {
    regimeTributario: string | null;
    apuraIcms: boolean;
  } = { regimeTributario: null, apuraIcms: false },
) {
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('regimeTributario' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([fiscalConfig]),
                }),
              }),
            };
          }
          capture(selection);
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({ groupBy }),
              }),
            }),
          };
        }),
    },
  };
}

function createApuracaoDatabase(
  fiscalConfig: { regimeTributario: string | null; apuraIcms: boolean },
  apuracao: {
    total_creditos: string;
    total_debitos: string;
    saldo_apurado: string;
  },
) {
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('regimeTributario' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([fiscalConfig]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue([apuracao]),
              }),
            }),
          };
        }),
    },
  };
}
