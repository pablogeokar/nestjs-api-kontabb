import {
  eventosAuditoria,
  fiscalApuracoesGuias,
  fiscalPagamentosEventos,
  guias,
} from '../database/schema';
import { GuiasService } from './guias.service';

const GUIA_ID = 'cb9ac925-0318-43c0-bd20-58586a3896c8';
const CLIENTE_ID = '10d4e7cd-a766-4bd9-a2c7-b89f06d3dc4d';
const FISCAL_ID = 'f4f7ced7-9a78-44fb-9a8c-fdd746722b01';

function paymentStore(
  options: {
    linked?: boolean;
    cancelled?: boolean;
    value?: string | null;
    fiscalTotal?: string;
    failOn?: 'event' | 'audit';
  } = {},
) {
  const state = {
    status: 'PENDENTE',
    fiscalStatus: 'PENDENTE',
    events: [] as Record<string, unknown>[],
    audits: [] as Record<string, unknown>[],
  };
  const storage = {
    receiptObjectKey: jest.fn().mockReturnValue('receipts/test.pdf'),
    upload: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const logger = { error: jest.fn() };
  const database = {
    db: {
      select: jest.fn().mockReturnValue({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  { cnpj: '12345678000190', cpf: null, tipoPessoa: 'PJ' },
                ]),
            }),
          }),
        }),
      }),
      transaction: jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const before = {
            status: state.status,
            fiscalStatus: state.fiscalStatus,
            events: [...state.events],
            audits: [...state.audits],
          };
          const tx = {
            update: (table: unknown) => ({
              set: (values: Record<string, unknown>) => ({
                where: () => ({
                  returning: () => {
                    if (table === guias) {
                      if (state.status === 'PAGO') return Promise.resolve([]);
                      state.status = values.status as string;
                      return Promise.resolve([
                        {
                          id: GUIA_ID,
                          clienteId: CLIENTE_ID,
                          valor:
                            options.value === undefined
                              ? '100.00'
                              : options.value,
                        },
                      ]);
                    }
                    if (table === fiscalApuracoesGuias) {
                      if (values.statusPagamento !== undefined) {
                        state.fiscalStatus = values.statusPagamento as string;
                      }
                      return Promise.resolve([{ id: FISCAL_ID }]);
                    }
                    throw new Error('Unexpected update');
                  },
                }),
              }),
            }),
            select: () => ({
              from: (table: unknown) => ({
                where: () => ({
                  limit: () =>
                    Promise.resolve(
                      options.linked
                        ? [
                            {
                              id: FISCAL_ID,
                              clienteId: CLIENTE_ID,
                              fechamentoId: null,
                              cancelada: options.cancelled ?? false,
                              valorTotal: options.fiscalTotal ?? '100.00',
                            },
                          ]
                        : [],
                    ),
                  then: (resolve: (rows: Record<string, unknown>[]) => void) =>
                    resolve(
                      table === fiscalPagamentosEventos ? state.events : [],
                    ),
                }),
              }),
            }),
            insert: (table: unknown) => ({
              values: (values: Record<string, unknown>) => {
                if (table === fiscalPagamentosEventos) {
                  if (options.failOn === 'event')
                    throw new Error('event insert failed');
                  state.events.push(values);
                } else if (table === eventosAuditoria) {
                  if (options.failOn === 'audit')
                    throw new Error('audit insert failed');
                  state.audits.push(values);
                } else throw new Error('Unexpected insert');
                return Promise.resolve();
              },
            }),
          };
          try {
            return await callback(tx);
          } catch (error) {
            Object.assign(state, before);
            throw error;
          }
        },
      ),
    },
  };
  const service = new GuiasService(
    database as never,
    storage as never,
    {} as never,
    {} as never,
    logger as never,
  );
  return { state, service, storage, logger, database };
}

const input = {
  guiaId: GUIA_ID,
  userId: 'user-1',
  observation: 'Baixa confirmada',
  paidAtDate: '2026-10-20',
};

describe('GuiasService.confirmPayment', () => {
  it('preserva o fluxo sem vínculo fiscal e é idempotente no retry', async () => {
    const { state, service } = paymentStore();
    await expect(service.confirmPayment(input)).resolves.toEqual({ ok: true });
    await expect(service.confirmPayment(input)).resolves.toEqual({
      ok: false,
      code: 'ALREADY_PAID',
    });
    expect(state.status).toBe('PAGO');
    expect(state.events).toHaveLength(0);
    expect(state.audits).toHaveLength(1);
  });

  it('registra o valor do PDF mesmo com parcial ou estorno anterior e sem comprovante', async () => {
    const { state, service } = paymentStore({ linked: true });
    state.events.push({ tipo: 'PAGAMENTO_PARCIAL', valor: '30.00', sinal: 1 });
    state.events.push({ tipo: 'ESTORNO', valor: '10.00', sinal: -1 });
    await expect(service.confirmPayment(input)).resolves.toEqual({ ok: true });
    expect(state.events).toHaveLength(3);
    expect(state.events[2]).toMatchObject({
      clienteId: CLIENTE_ID,
      guiaId: FISCAL_ID,
      tipo: 'PAGAMENTO',
      origem: 'CONCILIACAO',
      valor: '100.00',
      sinal: 1,
      dataEvento: '2026-10-20',
      comprovanteKey: null,
      declaracaoManual: true,
      documentoExterno: `guia-upload:${GUIA_ID}`,
    });
    expect(state.fiscalStatus).toBe('PAGO');
    expect(state.audits).toHaveLength(1);
  });

  it('vincula o comprovante ao evento e remove upload de retry já pago', async () => {
    const { state, service, storage } = paymentStore({ linked: true });
    const receipt = {
      bytes: Buffer.from('receipt'),
      contentType: 'application/pdf',
      extension: 'pdf',
    };
    await expect(
      service.confirmPayment({ ...input, receipt }),
    ).resolves.toEqual({ ok: true });
    expect(state.events[0]).toMatchObject({
      comprovanteKey: 'receipts/test.pdf',
      declaracaoManual: false,
    });
    await expect(
      service.confirmPayment({ ...input, receipt }),
    ).resolves.toEqual({ ok: false, code: 'ALREADY_PAID' });
    expect(state.events).toHaveLength(1);
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it('não registra evento em vínculo fiscal cancelado', async () => {
    const { state, service } = paymentStore({ linked: true, cancelled: true });
    await expect(service.confirmPayment(input)).resolves.toEqual({ ok: true });
    expect(state.events).toHaveLength(0);
    expect(state.fiscalStatus).toBe('PENDENTE');
  });

  it('preserva status fiscal pendente quando o PDF deixa saldo residual', async () => {
    const { state, service } = paymentStore({
      linked: true,
      fiscalTotal: '100.02',
    });
    await expect(service.confirmPayment(input)).resolves.toEqual({ ok: true });
    expect(state.events[0]).toMatchObject({
      tipo: 'PAGAMENTO_PARCIAL',
      valor: '100.00',
    });
    expect(state.status).toBe('PAGO');
    expect(state.fiscalStatus).toBe('PENDENTE');
  });

  it('reverte guia e evento quando a auditoria falha, compensando o R2', async () => {
    const { state, service, storage } = paymentStore({
      linked: true,
      failOn: 'audit',
    });
    const receipt = {
      bytes: Buffer.from('receipt'),
      contentType: 'application/pdf',
      extension: 'pdf',
    };
    await expect(
      service.confirmPayment({ ...input, receipt }),
    ).resolves.toEqual({ ok: false, code: 'DATABASE_FAILED' });
    expect(state).toMatchObject({
      status: 'PENDENTE',
      fiscalStatus: 'PENDENTE',
      events: [],
      audits: [],
    });
    expect(storage.delete).toHaveBeenCalledWith('receipts/test.pdf');
  });

  it('reverte a baixa se o evento fiscal falhar', async () => {
    const { state, service } = paymentStore({ linked: true, failOn: 'event' });
    await expect(service.confirmPayment(input)).resolves.toEqual({
      ok: false,
      code: 'DATABASE_FAILED',
    });
    expect(state).toMatchObject({
      status: 'PENDENTE',
      fiscalStatus: 'PENDENTE',
      events: [],
      audits: [],
    });
  });

  it('não fabrica valor fiscal quando o PDF não informou valor', async () => {
    const { state, service } = paymentStore({ linked: true, value: null });
    await expect(service.confirmPayment(input)).resolves.toEqual({
      ok: false,
      code: 'DATABASE_FAILED',
    });
    expect(state.status).toBe('PENDENTE');
    expect(state.events).toHaveLength(0);
  });

  it('não altera o banco quando o upload do comprovante falha', async () => {
    const { state, service, storage, database } = paymentStore({
      linked: true,
    });
    storage.upload.mockRejectedValueOnce(new Error('R2 unavailable'));
    const receipt = {
      bytes: Buffer.from('receipt'),
      contentType: 'application/pdf',
      extension: 'pdf',
    };
    await expect(
      service.confirmPayment({ ...input, receipt }),
    ).resolves.toEqual({ ok: false, code: 'STORAGE_FAILED' });
    expect(state.status).toBe('PENDENTE');
    expect(database.db.transaction).not.toHaveBeenCalled();
  });
});
