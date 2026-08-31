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
            return Promise.resolve();
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
    expect(updates[0].table).toBe(documentosFiscais);
    expect(updates[0].values).toMatchObject({
      tpNfXml: '1',
      tipoOperacaoEscriturada: 'ENTRADA',
      escrituracaoStatus: 'PENDENTE_REVISAO',
      integridadeConferida: false,
      integridadeStatus: 'NAO_CONFERIDA',
    });
    expect(updates[1].table).toBe(documentosFiscaisItens);
    expect(updates[1].values).toMatchObject({
      cfopXml: '5102',
      cfop: '1102',
      tipoOperacaoEscriturada: 'ENTRADA',
      cfopRevisaoNecessaria: false,
    });
    expect(storage.download).toHaveBeenCalledWith('documento.xml');
  });
});
