import {
  documentosFiscais,
  documentosFiscaisItens,
} from '../../database/schema';
import { EscrituracaoFiscalService } from './escrituracao-fiscal.service';

describe('EscrituracaoFiscalService', () => {
  it('reprocessa cabeçalho e itens preservando CFOP XML e gravando o equivalente', async () => {
    const queryResults = [
      [{ id: 'cliente-1', cnpj: '12345678000195' }],
      [
        {
          id: 'doc-1',
          emitenteCnpjCpf: '98765432000110',
          modelo: '55',
          situacao: 'AUTORIZADA',
          tpNfXml: '1',
          xmlKey: 'documento.xml',
        },
      ],
      [
        {
          id: 'item-1',
          documentoFiscalId: 'doc-1',
          numeroItem: 1,
          cfop: '5102',
          cfopXml: '5102',
        },
      ],
    ];
    let queryIndex = 0;
    const select = jest.fn().mockImplementation(() => ({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockImplementation(() => {
          const result = queryResults[queryIndex++] ?? [];
          return queryIndex === 1
            ? { limit: jest.fn().mockResolvedValue(result) }
            : Promise.resolve(result);
        }),
      }),
    }));
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> =
      [];
    const tx = {
      update: jest.fn((table: unknown) => ({
        set: jest.fn((values: Record<string, unknown>) => ({
          where: jest.fn().mockImplementation(() => {
            updates.push({ table, values });
            return {
              returning: jest.fn().mockResolvedValue([{ id: 'item-1' }]),
            };
          }),
        })),
      })),
    };
    const transaction = jest.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const cfopService = {
      determinarTipoOperacaoEscriturada: jest.fn().mockReturnValue('ENTRADA'),
      resolverCfopEquivalenteDetalhado: jest.fn().mockResolvedValue({
        cfop: '1102',
        revisaoNecessaria: false,
        origemResolucao: 'GLOBAL',
      }),
    };
    const storage = { download: jest.fn() };
    const service = new EscrituracaoFiscalService(
      { db: { select, transaction } } as never,
      storage as never,
      cfopService as never,
      {} as never,
    );

    await expect(
      service.reprocessar({ clienteId: 'cliente-1' }),
    ).resolves.toEqual({
      documentosProcessados: 1,
      itensAtualizados: 1,
      itensParaRevisao: 0,
      documentosComTpNfInferido: 0,
      documentosComFalhaIntegridade: 1,
      ctesAtualizados: 0,
      ctesComFalha: 0,
      sucesso: true,
    });
    expect(updates).toHaveLength(2);
    expect(updates[1].table).toBe(documentosFiscais);
    expect(updates[1].values).toMatchObject({
      tpNfXml: '1',
      tipoOperacaoEscriturada: 'ENTRADA',
      escrituracaoStatus: 'PENDENTE_REVISAO',
      integridadeConferida: false,
      integridadeStatus: 'NAO_CONFERIDA',
    });
    expect(updates[0].table).toBe(documentosFiscaisItens);
    expect(updates[0].values).toMatchObject({
      cfopXml: '5102',
      cfop: '1102',
      tipoOperacaoEscriturada: 'ENTRADA',
      cfopRevisaoNecessaria: false,
    });
    expect(storage.download).toHaveBeenCalledWith('documento.xml');
  });
});

describe('preservação de decisões no reprocessamento', () => {
  it('preserva CFOP manual sem chamar a classificação automática', async () => {
    const { service, cfop, updates } = reprocessFixture({
      cfopManual: true,
      cfop: '1556',
    });
    await service.reprocessar({ clienteId: 'c1' });
    expect(cfop.resolverCfopEquivalenteDetalhado).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({
      cfop: '1556',
      cfopOrigemResolucao: 'MANUAL',
    });
    expect(updates[0]).not.toHaveProperty('destinacaoMercadoria');
    expect(updates[0]).not.toHaveProperty('destinacaoInferida');
  });
  it('envia destinação manual e fornecedor à resolução e não sobrescreve o campo manual', async () => {
    const { service, cfop, updates } = reprocessFixture({
      destinacaoMercadoria: 'USO_CONSUMO',
    });
    await service.reprocessar({ clienteId: 'c1' });
    expect(cfop.resolverCfopEquivalenteDetalhado).toHaveBeenCalledWith(
      expect.objectContaining({
        destinacaoMercadoria: 'USO_CONSUMO',
        emitenteCnpjCpf: 'fornecedor-a',
        codigoProduto: 'A',
      }),
    );
    expect(updates[0]).not.toHaveProperty('destinacaoMercadoria');
  });
  it('aborta quando a versão do item mudou enquanto o XML era processado', async () => {
    const { service, updates } = reprocessFixture({}, false);
    await expect(service.reprocessar({ clienteId: 'c1' })).rejects.toThrow(
      'alterado durante o reprocessamento',
    );
    expect(updates).toHaveLength(1);
  });
});
function reprocessFixture(
  override: Record<string, unknown>,
  updateSucceeds = true,
) {
  const queue = [
    [{ id: 'c1', cnpj: 'cliente' }],
    [
      {
        id: 'd1',
        emitenteCnpjCpf: 'fornecedor-a',
        modelo: '55',
        situacao: 'AUTORIZADA',
        tpNfXml: '1',
        xmlKey: 'xml',
      },
    ],
    [
      {
        id: 'i1',
        documentoFiscalId: 'd1',
        numeroItem: 1,
        cfop: '1102',
        cfopXml: '5102',
        codigoProduto: 'A',
        revisao: '2026-09-01 12:00:00.123456',
        ...override,
      },
    ],
  ];
  let index = 0;
  const select = jest.fn(() => ({
    from: () => ({
      where: () => {
        const result = queue[index++];
        return index === 1
          ? { limit: () => Promise.resolve(result) }
          : Promise.resolve(result);
      },
    }),
  }));
  const updates: Record<string, unknown>[] = [];
  const tx = {
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updates.push(value);
        return {
          where: () => ({
            returning: () =>
              Promise.resolve(updateSucceeds ? [{ id: 'i1' }] : []),
          }),
        };
      },
    }),
  };
  const cfop = {
    determinarTipoOperacaoEscriturada: jest.fn().mockReturnValue('ENTRADA'),
    resolverCfopEquivalenteDetalhado: jest.fn().mockResolvedValue({
      cfop: '1556',
      revisaoNecessaria: false,
      origemResolucao: 'DESTINACAO_NCM',
    }),
    resolverCfopManual: jest
      .fn()
      .mockResolvedValue({ catalogo: { codigo: '1556' } }),
  };
  return {
    service: new EscrituracaoFiscalService(
      {
        db: {
          select,
          transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
        },
      } as never,
      {
        download: jest.fn().mockRejectedValue(new Error('XML indisponível')),
      } as never,
      cfop as never,
      {} as never,
    ),
    cfop,
    updates,
  };
}
