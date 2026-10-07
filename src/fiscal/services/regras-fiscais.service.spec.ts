import { NotFoundException } from '@nestjs/common';
import { RegrasFiscaisService } from './regras-fiscais.service';

// Double do FiscalClosingService (tarefas 3.4/3.5) para os caminhos de edição
// de regra/CFOP que participam do fechamento. `withEscopoLock` apenas executa a
// mutação dentro da transação (o advisory lock por escopo é testado no serviço
// de fechamento) e `sinalizarRevisaoPosFechamento` é um no-op aqui: estes
// testes cobrem a PARTICIPAÇÃO no lock (R1.6) e a sinalização de revisão, não a
// abertura concreta da versão de revisão (coberta no fiscal-closing.service).
function createClosingMock() {
  return {
    withEscopoLock: jest.fn(
      (_tx: unknown, _escopo: unknown, fn: () => Promise<unknown>) => fn(),
    ),
    sinalizarRevisaoPosFechamento: jest.fn().mockResolvedValue({
      fechado: false,
      fechamentoCorrenteId: null,
      revisaoNecessaria: false,
      revisaoId: null,
      revisaoVersao: null,
      revisaoAberta: false,
    }),
  };
}

describe('RegrasFiscaisService', () => {
  it('simular delega ao motor de regras', async () => {
    const evaluate = jest.fn().mockResolvedValue({
      cfopEscriturado: '1556',
      apropriaCreditoIcms: false,
      origemResolucao: 'DESTINACAO_NCM',
    });
    const service = new RegrasFiscaisService(
      {} as never,
      { evaluate } as never,
      {} as never,
      createClosingMock() as never,
    );
    const result = await service.simular({
      clienteId: 'c1',
      tipoOperacaoEscriturada: 'ENTRADA',
      cfopXml: '5102',
      destinacaoMercadoria: 'USO_CONSUMO',
    });
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        cfopXml: '5102',
        destinacaoMercadoria: 'USO_CONSUMO',
      }),
    );
    expect(result.origemResolucao).toBe('DESTINACAO_NCM');
  });

  it('definirDestinacaoItem re-resolve o CFOP e persiste a destinação', async () => {
    const item = {
      id: 'item-1',
      cfop: '1102',
      cfopXml: '5102',
      tipoOperacaoEscriturada: 'ENTRADA',
      ncm: '12345678',
      cstIcms: '00',
      csosnIcms: null,
    };
    const updatedRow = {
      id: 'item-1',
      cfop: '1556',
      cfopXml: '5102',
      destinacaoMercadoria: 'USO_CONSUMO',
      cfopRevisaoNecessaria: false,
    };
    const returning = jest.fn().mockResolvedValue([updatedRow]);
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  item,
                  emitenteCnpjCpf: '98765432000110',
                  dataEmissaoFiscal: '2026-09-15',
                  dataEmissao: new Date('2026-09-15T12:00:00Z'),
                },
              ]),
            }),
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ returning }),
        }),
      }),
    };
    const resolver = jest.fn().mockResolvedValue({
      cfop: '1556',
      revisaoNecessaria: false,
      origemResolucao: 'DESTINACAO_NCM',
      apropriaCreditoIcms: false,
      exigeCiap: false,
      exigeDifalEntrada: false,
    });
    const closing = createClosingMock();
    const service = new RegrasFiscaisService(
      { db: transactionalMock(db) } as never,
      {} as never,
      { resolverCfopEquivalenteDetalhado: resolver } as never,
      closing as never,
    );

    const result = await service.definirDestinacaoItem({
      clienteId: 'c1',
      itemId: 'item-1',
      destinacao: 'USO_CONSUMO',
    });

    expect(resolver).toHaveBeenCalledWith(
      expect.objectContaining({
        cfopXml: '5102',
        destinacaoMercadoria: 'USO_CONSUMO',
        tipoOperacaoEscriturada: 'ENTRADA',
      }),
    );
    expect(result.cfop).toBe('1556');
    expect(result.destinacao_mercadoria).toBe('USO_CONSUMO');
    expect(result.apropria_credito_icms).toBe(false);
    // R1.6: a edição participa do lock de escopo e sinaliza revisão, com a
    // competência derivada da data fiscal de emissão do documento.
    const escopoEsperado = {
      clienteId: 'c1',
      obrigacao: 'EFD_ICMS_IPI',
      competencia: '2026-09',
    };
    expect(closing.withEscopoLock).toHaveBeenCalledWith(
      expect.anything(),
      escopoEsperado,
      expect.any(Function),
    );
    expect(closing.sinalizarRevisaoPosFechamento).toHaveBeenCalledWith(
      expect.anything(),
      escopoEsperado,
    );
  });

  it("destinação 'AUTOMATICA' limpa o override (null) na re-resolução", async () => {
    const item = {
      id: 'item-1',
      cfop: '1556',
      cfopXml: '5102',
      tipoOperacaoEscriturada: 'ENTRADA',
      ncm: null,
      cstIcms: '00',
      csosnIcms: null,
    };
    const returning = jest.fn().mockResolvedValue([
      {
        id: 'item-1',
        cfop: '1102',
        cfopXml: '5102',
        destinacaoMercadoria: null,
        cfopRevisaoNecessaria: false,
      },
    ]);
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  item,
                  emitenteCnpjCpf: 'x',
                  dataEmissaoFiscal: '2026-09-15',
                  dataEmissao: new Date('2026-09-15T12:00:00Z'),
                },
              ]),
            }),
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ returning }),
        }),
      }),
    };
    const resolver = jest.fn().mockResolvedValue({
      cfop: '1102',
      revisaoNecessaria: false,
      origemResolucao: 'ALGORITMO',
    });
    const service = new RegrasFiscaisService(
      { db: transactionalMock(db) } as never,
      {} as never,
      { resolverCfopEquivalenteDetalhado: resolver } as never,
      createClosingMock() as never,
    );

    await service.definirDestinacaoItem({
      clienteId: 'c1',
      itemId: 'item-1',
      destinacao: 'AUTOMATICA',
    });

    expect(resolver).toHaveBeenCalledWith(
      expect.objectContaining({ destinacaoMercadoria: null }),
    );
  });

  it('definirDestinacaoItem lança NotFound para item de outro cliente', async () => {
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    };
    const closing = createClosingMock();
    const service = new RegrasFiscaisService(
      { db: transactionalMock(db) } as never,
      {} as never,
      {} as never,
      closing as never,
    );
    await expect(
      service.definirDestinacaoItem({
        clienteId: 'c1',
        itemId: 'item-x',
        destinacao: 'REVENDA',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Item inexistente: nada a bloquear/sinalizar — o lock nem é adquirido.
    expect(closing.withEscopoLock).not.toHaveBeenCalled();
  });

  it('editarCfopItem participa do lock de escopo e sinaliza revisão (R1.6)', async () => {
    const item = {
      id: 'item-1',
      clienteId: 'c1',
      cfop: '1102',
      cfopXml: '5102',
      documentoFiscalId: 'doc-1',
      tipoOperacaoEscriturada: 'ENTRADA',
    };
    const returning = jest.fn().mockResolvedValue([
      {
        id: 'item-1',
        documentoFiscalId: 'doc-1',
        cfop: '1556',
        cfopXml: '5102',
        cfopRevisaoNecessaria: false,
      },
    ]);
    const resolverCfopManual = jest.fn().mockResolvedValue({
      catalogo: { codigo: '1556' },
      efeitos: {
        apropriaCreditoIcms: true,
        apropriaCreditoIpi: false,
        exigeCiap: false,
        exigeDifalEntrada: false,
      },
    });
    const closing = createClosingMock();
    const service = new RegrasFiscaisService(
      { db: cfopItemTxMock(item, returning) } as never,
      {} as never,
      { resolverCfopManual } as never,
      closing as never,
    );

    const result = await service.editarCfopItem({
      itemId: 'item-1',
      cfop: '1556',
    });

    expect(result.cfop).toBe('1556');
    expect(result.cfop_anterior).toBe('1102');
    const escopoEsperado = {
      clienteId: 'c1',
      obrigacao: 'EFD_ICMS_IPI',
      competencia: '2026-09',
    };
    expect(closing.withEscopoLock).toHaveBeenCalledWith(
      expect.anything(),
      escopoEsperado,
      expect.any(Function),
    );
    expect(closing.sinalizarRevisaoPosFechamento).toHaveBeenCalledWith(
      expect.anything(),
      escopoEsperado,
    );
  });

  it('editarCfopCte participa do lock de escopo e sinaliza revisão (R1.6)', async () => {
    const cte = {
      id: 'cte-1',
      cfop: '1352',
      cfopXml: '1352',
      documentoFiscalId: 'doc-1',
      tipoOperacaoEscriturada: 'ENTRADA',
      revisaoNecessaria: false,
      cfopRevisaoNecessaria: true,
      escrituravel: true,
      valorIcmsCreditavel: '10.00',
    };
    const returning = jest.fn().mockResolvedValue([
      {
        id: 'cte-1',
        documentoFiscalId: 'doc-1',
        cfop: '1353',
        cfopXml: '1352',
        cfopRevisaoNecessaria: false,
        revisaoNecessaria: false,
      },
    ]);
    const resolverCfopManual = jest.fn().mockResolvedValue({
      catalogo: { codigo: '1353' },
      efeitos: {
        apropriaCreditoIcms: true,
        apropriaCreditoIpi: false,
        exigeCiap: false,
        exigeDifalEntrada: false,
      },
    });
    const closing = createClosingMock();
    const service = new RegrasFiscaisService(
      { db: cfopCteTxMock(cte, returning) } as never,
      {} as never,
      { resolverCfopManual } as never,
      closing as never,
    );

    const result = await service.editarCfopCte({
      documentoId: 'doc-1',
      cfop: '1353',
    });

    expect(result.cfop).toBe('1353');
    expect(result.cfop_anterior).toBe('1352');
    const escopoEsperado = {
      clienteId: 'c1',
      obrigacao: 'EFD_ICMS_IPI',
      competencia: '2026-09',
    };
    expect(closing.withEscopoLock).toHaveBeenCalledWith(
      expect.anything(),
      escopoEsperado,
      expect.any(Function),
    );
    expect(closing.sinalizarRevisaoPosFechamento).toHaveBeenCalledWith(
      expect.anything(),
      escopoEsperado,
    );
  });
});

// Forma mínima da cadeia de query do mock, para evitar acessos em `any`.
interface MockQueryChain {
  from: () => {
    innerJoin: () => { where: () => { limit: () => unknown } };
    [key: string]: unknown;
  };
}

function transactionalMock(db: { select: jest.Mock; update?: jest.Mock }) {
  const original = db.select as unknown as () => MockQueryChain;
  const tx = {
    ...db,
    select: jest.fn().mockImplementation(() => {
      const query = original();
      const from = query.from();
      const limit = from.innerJoin().where().limit;
      return {
        from: () => ({
          ...from,
          where: jest.fn().mockResolvedValue([]),
          innerJoin: () => ({
            where: () => ({ limit: () => ({ for: () => limit() }) }),
          }),
        }),
      };
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockResolvedValue([]),
      }),
    }),
    delete: jest
      .fn()
      .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
  };
  return {
    ...tx,
    transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
  };
}

// Mock de transação para `editarCfopItem`: o primeiro `select` lê o item + a
// data fiscal de emissão (para o escopo do lock), o segundo conta pendências de
// revisão. O `update` encadeia `.returning()` com a linha atualizada.
function cfopItemTxMock(item: Record<string, unknown>, returning: jest.Mock) {
  const tx = {
    select: jest.fn().mockImplementation(() => ({
      from: () => ({
        // 1ª leitura: item + situação/integridade + data fiscal de emissão.
        innerJoin: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  item,
                  situacao: 'AUTORIZADA',
                  integridadeStatus: 'OK',
                  dataEmissaoFiscal: '2026-09-15',
                  dataEmissao: new Date('2026-09-15T12:00:00Z'),
                },
              ]),
          }),
        }),
        // 2ª leitura: contagem de pendências de revisão (sem innerJoin).
        where: () => Promise.resolve([{ total: 0 }]),
      }),
    })),
    // Um update grava o item com `.returning()`; o outro grava o documento e é
    // apenas aguardado — o thenable cobre os dois estilos.
    update: jest.fn().mockImplementation(() => ({
      set: () => ({
        where: () => thenableWithReturning(returning),
      }),
    })),
  };
  return {
    ...tx,
    transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
  };
}

// Mock de transação para `editarCfopCte`: o primeiro `select` lê o CT-e +
// cliente + data fiscal (para o escopo); o `update` do CT-e usa `.returning()`
// e o `update` do documento é aguardado como promise.
function cfopCteTxMock(cte: Record<string, unknown>, returning: jest.Mock) {
  const tx = {
    select: jest.fn().mockImplementation(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  cte,
                  situacao: 'AUTORIZADA',
                  integridadeStatus: 'OK',
                  clienteId: 'c1',
                  dataEmissaoFiscal: '2026-09-15',
                  dataEmissao: new Date('2026-09-15T12:00:00Z'),
                },
              ]),
          }),
        }),
      }),
    })),
    update: jest.fn().mockImplementation(() => ({
      set: () => ({
        where: () => thenableWithReturning(returning),
      }),
    })),
  };
  return {
    ...tx,
    transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
  };
}

// Objeto que é tanto aguardável (`await update(...).set(...).where(...)`) quanto
// encadeável com `.returning()` — cobre os dois estilos de update usados pelos
// serviços de edição de CFOP (um grava o item/CT-e com returning, outro grava o
// documento e é apenas aguardado).
function thenableWithReturning(returning: jest.Mock) {
  const base = Promise.resolve([]) as unknown as Promise<unknown[]> & {
    returning: jest.Mock;
  };
  base.returning = returning;
  return base;
}
