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
});
