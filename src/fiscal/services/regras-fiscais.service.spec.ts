import { NotFoundException } from '@nestjs/common';
import { RegrasFiscaisService } from './regras-fiscais.service';

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
              limit: jest
                .fn()
                .mockResolvedValue([
                  { item, emitenteCnpjCpf: '98765432000110' },
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
    const service = new RegrasFiscaisService(
      { db } as never,
      {} as never,
      { resolverCfopEquivalenteDetalhado: resolver } as never,
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
              limit: jest
                .fn()
                .mockResolvedValue([{ item, emitenteCnpjCpf: 'x' }]),
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
      { db } as never,
      {} as never,
      { resolverCfopEquivalenteDetalhado: resolver } as never,
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
    const service = new RegrasFiscaisService(
      { db } as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.definirDestinacaoItem({
        clienteId: 'c1',
        itemId: 'item-x',
        destinacao: 'REVENDA',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
