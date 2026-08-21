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

    const rows = await service.getC190({ clienteId: 'cliente-1' });

    expect(rows).toEqual([
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
});

function createReportDatabase(
  capture: (selection: Record<string, unknown>) => void,
  groupBy = jest.fn().mockReturnValue({
    orderBy: jest.fn().mockResolvedValue([]),
  }),
) {
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
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
