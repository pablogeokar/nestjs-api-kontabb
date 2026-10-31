import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { StorageCleanupService } from './storage-cleanup.service';

describe('StorageCleanupService', () => {
  it('limita o claim de jobs ao número solicitado, sem passar do teto', async () => {
    const execute = jest.fn<Promise<unknown[]>, [SQL]>().mockResolvedValue([]);
    const database = { db: { execute } };
    const storage = { delete: jest.fn() };
    const logger = { info: jest.fn() };
    const service = new StorageCleanupService(
      database as never,
      storage as never,
      logger as never,
    );
    const dialect = new PgDialect();

    await service.processJobs(undefined, {}, 7);
    expect(dialect.sqlToQuery(execute.mock.calls[0][0]).params).toContain(7);

    await service.processJobs(undefined, {}, 100);
    expect(dialect.sqlToQuery(execute.mock.calls[1][0]).params).toContain(50);
  });
});
