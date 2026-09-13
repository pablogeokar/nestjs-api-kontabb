import { FiscalGuiasService, type CriarGuiaInput } from './fiscal-guias.service';

// DB falso para criarGuia. `assertCliente` roda primeiro e faz um
// select(...).from(...).where(...).limit(1); a fila `clienteRows` fornece o
// resultado desse limit(). O insert().values().returning() devolve `insertedRow`.
function createCriarGuiaDb(opts: {
  clienteRows?: unknown[];
  insertedRow?: Record<string, unknown>;
}) {
  return {
    db: {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue(opts.clienteRows ?? [{ id: 'c1' }]),
          }),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest
            .fn()
            .mockResolvedValue([opts.insertedRow ?? defaultGuiaRow()]),
        }),
      }),
    },
  };
}

function defaultGuiaRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'guia-1',
    clienteId: 'c1',
    competencia: '2026-08-01',
    tributo: 'ICMS_PROPRIO',
    ufFavorecida: 'SP',
    tipoGuia: 'DAE',
    codigoReceita: '046',
    dataVencimento: '2026-09-10',
    valorPrincipal: '100.00',
    valorMulta: '0',
    valorJuros: '0',
    valorTotal: '100.00',
    codigoBarras: null,
    linhaDigitavel: null,
    statusPagamento: 'PENDENTE',
    arquivoGuiaKey: null,
    criadoEm: new Date('2026-08-01T00:00:00Z'),
    atualizadoEm: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

function baseInput(overrides: Partial<CriarGuiaInput> = {}): CriarGuiaInput {
  return {
    clienteId: 'c1',
    competencia: '2026-08',
    tributo: 'ICMS_PROPRIO',
    ufFavorecida: 'SP',
    tipoGuia: 'DAE',
    codigoReceita: '046',
    dataVencimento: '2026-09-10',
    valorPrincipal: '100.00',
    ...overrides,
  };
}

describe('FiscalGuiasService — invariantes fora do HTTP (R6.4)', () => {
  it('cria a guia quando os valores são válidos (caminho feliz)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(baseInput());
    expect(guia.id).toBe('guia-1');
    expect(guia.valor_total).toBe('100.00');
    expect(db.db.insert).toHaveBeenCalledTimes(1);
  });

  it('R6.4/R6.3: rejeita valor principal negativo mesmo compensado por multa positiva', async () => {
    // Total = -100 + 150 = 50 (> 0). Sem a checagem POR COMPONENTE, passaria só
    // na validação do total. O serviço rejeita o principal negativo antes.
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(
        baseInput({ valorPrincipal: '-100.00', valorMulta: '150.00' }),
      ),
    ).rejects.toThrow('O valor principal da guia não pode ser negativo.');
    expect(db.db.insert).not.toHaveBeenCalled();
  });

  it('R6.4/R6.3: rejeita multa negativa (fora do HTTP)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(
        baseInput({ valorPrincipal: '100.00', valorMulta: '-10.00' }),
      ),
    ).rejects.toThrow('O valor multa da guia não pode ser negativo.');
    expect(db.db.insert).not.toHaveBeenCalled();
  });

  it('R6.4/R6.3: rejeita juros negativos (fora do HTTP)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(
        baseInput({ valorPrincipal: '100.00', valorJuros: '-5.00' }),
      ),
    ).rejects.toThrow('O valor juros da guia não pode ser negativo.');
    expect(db.db.insert).not.toHaveBeenCalled();
  });

  it('rejeita quando o valor total é zero (nenhum componente positivo)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(baseInput({ valorPrincipal: '0' })),
    ).rejects.toThrow('O valor total da guia deve ser maior que zero.');
    expect(db.db.insert).not.toHaveBeenCalled();
  });
});

// DB falso para as mutações escopadas por (id, clienteId): marcarPagamento
// (update().set().where().returning()) e removerGuia
// (delete().where().returning()). Quando o WHERE por clienteId não casa (guia
// de outro cliente), o .returning() resolve vazio e o serviço rejeita.
function createMutacaoEscopadaDb(returningRows: unknown[]) {
  const returning = jest.fn().mockResolvedValue(returningRows);
  return {
    returning,
    db: {
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ returning }),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ returning }),
      }),
    },
  };
}

describe('FiscalGuiasService — propriedade cliente↔guia (R6.2)', () => {
  it('marcarPagamento de guia de outro cliente é rejeitado (WHERE por clienteId → NotFound)', async () => {
    // O update é escopado por (id, clienteId); a guia de outro cliente não casa
    // o WHERE, o .returning() vem vazio e o serviço rejeita como "não
    // encontrada" (objeto de outro cliente indistinguível de inexistente).
    const db = createMutacaoEscopadaDb([]);
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.marcarPagamento({
        clienteId: 'c1',
        guiaId: 'guia-de-outro-cliente',
        statusPagamento: 'PAGO',
      }),
    ).rejects.toThrow('Guia não encontrada.');
    expect(db.returning).toHaveBeenCalledTimes(1);
  });

  it('marcarPagamento atualiza a guia do próprio cliente (caminho feliz)', async () => {
    const db = createMutacaoEscopadaDb([
      defaultGuiaRow({ statusPagamento: 'PAGO' }),
    ]);
    const service = new FiscalGuiasService(db as never);
    const guia = await service.marcarPagamento({
      clienteId: 'c1',
      guiaId: 'guia-1',
      statusPagamento: 'PAGO',
    });
    expect(guia.status_pagamento).toBe('PAGO');
  });

  it('removerGuia de guia de outro cliente é rejeitado (WHERE por clienteId → NotFound)', async () => {
    const db = createMutacaoEscopadaDb([]);
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.removerGuia({
        clienteId: 'c1',
        guiaId: 'guia-de-outro-cliente',
      }),
    ).rejects.toThrow('Guia não encontrada.');
    expect(db.returning).toHaveBeenCalledTimes(1);
  });
});
