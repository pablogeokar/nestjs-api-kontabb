import { DifalEntradaService } from './difal-entrada.service';

// DB falso: getCliente resolve por .limit; a busca de itens resolve por .where.
function createDb(uf: string, itens: unknown[]) {
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('uf' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([{ id: 'c1', uf }]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue(itens),
              }),
            }),
          };
        }),
    },
  };
}

describe('DifalEntradaService', () => {
  it('calcula DIFAL = base * (interna - interestadual) para uso/consumo', () => {
    // UF SP (interna 18%), item 2556, base 1.000, interestadual 12%.
    // DIFAL = 1000 * (18 - 12)/100 = 60,00.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
        },
      ]) as never,
    );
    return service
      .apurarCompetencia({ clienteId: 'c1', competencia: '2026-09' })
      .then((result) => {
        expect(result.uf_adquirente).toBe('SP');
        expect(result.aliquota_interna_uf).toBe('18');
        expect(result.total_difal_recolher).toBe('60.00');
        expect(result.itens[0].valor_difal).toBe('60.00');
      });
  });

  it('usa 12% de interestadual quando a alíquota do item está ausente', async () => {
    // UF RS (interna 17%), ativo 2551, base 2.000, sem alíquota => presume 12.
    // DIFAL = 2000 * (17 - 12)/100 = 100,00.
    const service = new DifalEntradaService(
      createDb('RS', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2551',
          valorBcIcms: '0.00',
          valorBrutoProduto: '2000.00',
          aliquotaIcms: null,
        },
      ]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.total_difal_recolher).toBe('100.00');
  });

  it('não gera DIFAL negativo quando interestadual >= interna', async () => {
    // UF SC (interna 17%), interestadual 17% => diferença zero.
    const service = new DifalEntradaService(
      createDb('SC', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '17.0000',
        },
      ]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.total_difal_recolher).toBe('0.00');
  });

  it('rejeita competência inválida', async () => {
    const service = new DifalEntradaService(createDb('SP', []) as never);
    await expect(
      service.apurarCompetencia({ clienteId: 'c1', competencia: '2026-13' }),
    ).rejects.toThrow('Competência inválida');
  });
});
