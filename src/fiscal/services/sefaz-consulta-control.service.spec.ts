import { PgDialect } from 'drizzle-orm/pg-core';
import { SQL } from 'drizzle-orm';
import { appRateLimits } from '../../database/schema';
import { DatabaseService } from '../../database/database.service';
import {
  SefazConsultaAdiadaError,
  SefazConsultaControlService,
} from './sefaz-consulta-control.service';

describe('SefazConsultaControlService', () => {
  const input = { cnpj: '12345678000195', ambiente: 1, porChave: true };
  beforeEach(() =>
    jest.useFakeTimers({ now: new Date('2026-10-19T15:00:00Z') }),
  );
  afterEach(() => jest.useRealTimers());

  it('reserva no máximo 20 chamadas concorrentes entre instâncias', async () => {
    const db = memoryDatabase();
    const a = new SefazConsultaControlService(db.database);
    const b = new SefazConsultaControlService(db.database);
    const action = jest.fn().mockResolvedValue({ cStat: 137 });
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) =>
        (i % 2 ? a : b).consultar(input, action),
      ),
    );
    expect(action).toHaveBeenCalledTimes(20);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(5);
    expect(
      db.lockSql.every((query) => query.includes('pg_advisory_xact_lock')),
    ).toBe(true);
    // Recriar o serviço não libera a cota.
    await expect(
      new SefazConsultaControlService(db.database).consultar(input, action),
    ).rejects.toMatchObject({ motivo: 'LIMITE_LOCAL' });
    // Distribuição por NSU tem cota distinta.
    await expect(
      a.consultar({ ...input, porChave: false }, action),
    ).resolves.toEqual({ cStat: 137 });
    jest.setSystemTime(Date.now() + 3600000);
    await expect(a.consultar(input, action)).resolves.toEqual({ cStat: 137 });
  });

  it.each([
    () =>
      Promise.resolve({
        retDistDFeInt: { cStat: '656', xMotivo: 'Consumo Indevido' },
      }),
    () =>
      Promise.reject(
        new Error('NFE_DistribuicaoDFePorChave: Rejeição: Consumo Indevido'),
      ),
  ])(
    'persiste bloqueio para chave e NSU sem estender a espera local',
    async (action) => {
      const db = memoryDatabase();
      const service = new SefazConsultaControlService(db.database);
      await expect(service.consultar(input, action)).rejects.toBeInstanceOf(
        SefazConsultaAdiadaError,
      );
      const deadline = Date.now() + 3600000;
      jest.setSystemTime(Date.now() + 600000);
      const blockedAction = jest.fn();
      await expect(
        new SefazConsultaControlService(db.database).consultar(
          { ...input, porChave: false },
          blockedAction,
        ),
      ).rejects.toMatchObject({ retryAt: new Date(deadline) });
      expect(blockedAction).not.toHaveBeenCalled();
      expect(
        [...db.rows.values()].find((row) => row.key.endsWith(':bloqueio'))
          ?.resetAt,
      ).toBe(deadline);
    },
  );

  it('separa empresas e ambientes', async () => {
    const db = memoryDatabase();
    const service = new SefazConsultaControlService(db.database);
    await expect(
      service.consultar(input, () => Promise.resolve({ cStat: 656 })),
    ).rejects.toBeInstanceOf(SefazConsultaAdiadaError);
    const action = jest.fn().mockResolvedValue({ cStat: 138 });
    await service.consultar({ ...input, ambiente: 2 }, action);
    await service.consultar({ ...input, cnpj: '98765432000110' }, action);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('honra bloqueio legado e falha fechada quando o banco está indisponível', async () => {
    const db = memoryDatabase();
    db.controles.push({ retryAt: new Date(Date.now() + 300000) });
    const service = new SefazConsultaControlService(db.database);
    const action = jest.fn();
    await expect(service.consultar(input, action)).rejects.toMatchObject({
      motivo: 'CONSUMO_INDEVIDO',
    });
    expect(action).not.toHaveBeenCalled();
    const broken = new SefazConsultaControlService({
      db: { transaction: () => Promise.reject(new Error('offline')) },
    } as unknown as DatabaseService);
    await expect(broken.consultar(input, action)).rejects.toThrow('offline');
    expect(action).not.toHaveBeenCalled();
  });
});

// Store transacional compartilhado entre instâncias; nenhum dado fiscal real.
function memoryDatabase() {
  type Row = { key: string; count: number; resetAt: number };
  const rows = new Map<string, Row>();
  const controles: { retryAt: Date }[] = [];
  const lockSql: string[] = [];
  const dialect = new PgDialect();
  let tail = Promise.resolve();
  const db = {
    execute: (query: SQL) => {
      lockSql.push(dialect.sqlToQuery(query).sql);
      return Promise.resolve();
    },
    select: () => ({
      from: (table: unknown) => ({
        where: (where: SQL) => {
          const params = dialect.sqlToQuery(where).params;
          return Promise.resolve(
            table === appRateLimits
              ? [...rows.values()].filter((row) => params.includes(row.key))
              : controles,
          );
        },
      }),
    }),
    insert: () => ({
      values: (value: Row) => ({
        onConflictDoUpdate: () => {
          rows.set(value.key, {
            ...value,
            resetAt: Math.max(value.resetAt, rows.get(value.key)?.resetAt ?? 0),
          });
          return Promise.resolve();
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        await fn(db);
      } finally {
        release();
      }
    },
  };
  return {
    rows,
    controles,
    lockSql,
    database: { db } as unknown as DatabaseService,
  };
}
