import { DistribuicaoDfeService } from './distribuicao-dfe.service';

describe('DistribuicaoDfeService', () => {
  it('retorna o resumo completo de documentos separado por cliente', async () => {
    const orderBy = jest.fn().mockResolvedValue([
      {
        id: 'cliente-1',
        razaoSocial: 'ALFA COMERCIO LTDA',
        cnpj: '12345678000195',
        totalDocumentos: '105',
      },
      {
        id: 'cliente-2',
        razaoSocial: 'BETA INDUSTRIA LTDA',
        cnpj: '98765432000110',
        totalDocumentos: '8',
      },
    ]);
    const groupBy = jest.fn().mockReturnValue({ orderBy });
    const innerJoin = jest.fn().mockReturnValue({ groupBy });
    const from = jest.fn().mockReturnValue({ innerJoin });
    const select = jest.fn().mockReturnValue({ from });
    const service = new DistribuicaoDfeService(
      { db: { select } } as never,
      {} as never,
      {} as never,
    );

    const result = await service.listClientesComDocumentosFiscais();

    expect(result).toEqual([
      {
        id: 'cliente-1',
        razao_social: 'ALFA COMERCIO LTDA',
        cnpj: '12345678000195',
        total_documentos: 105,
      },
      {
        id: 'cliente-2',
        razao_social: 'BETA INDUSTRIA LTDA',
        cnpj: '98765432000110',
        total_documentos: 8,
      },
    ]);
    expect(select).toHaveBeenCalledTimes(1);
    expect(innerJoin).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
  });
});
