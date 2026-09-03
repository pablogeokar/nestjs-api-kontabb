import { CiapService } from './ciap.service';

// DB falso para apurarCompetencia:
//  1) coeficienteSaidasTributadas -> resolve por .where (retorna [{totais,tributadas}])
//  2) lista de bens -> resolve por .where().orderBy (retorna bens[])
function createApuracaoDb(
  coef: { totais: string; tributadas: string },
  bens: unknown[],
) {
  return {
    db: {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            // caminho do coeficiente (join itens->documentos, termina em where)
            where: jest.fn().mockResolvedValue([coef]),
          }),
          // caminho dos bens (sem join, where().orderBy())
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(bens),
          }),
        }),
      })),
    },
  };
}

describe('CiapService', () => {
  it('coeficiente 100% tributado: crédito = parcela cheia (1/48)', async () => {
    // Bem com ICMS total 4.800, 48 parcelas => parcela 100,00.
    // Saídas 100% tributadas => coeficiente 1 => crédito 100,00.
    const service = new CiapService(
      createApuracaoDb({ totais: '10000.00', tributadas: '10000.00' }, [
        {
          id: 'b1',
          codigoBem: 'BEM-1',
          identificacaoBem: 'Máquina',
          valorIcmsTotal: '4800.00',
          valorIcmsFrete: '0',
          valorIcmsDifal: '0',
          quantidadeParcelas: 48,
          parcelasApropriadas: 0,
          saldoCredorRestante: '4800.00',
          dataEntrada: '2026-01-10',
        },
      ]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.coeficiente_saidas_tributadas).toBe('1.0000');
    expect(result.total_parcela).toBe('100.00');
    expect(result.total_credito_apropriado).toBe('100.00');
  });

  it('coeficiente parcial reduz o crédito proporcionalmente', async () => {
    // Saídas tributadas 6.000 de 10.000 => coeficiente 0,6.
    // Parcela 100,00 * 0,6 = 60,00 de crédito.
    const service = new CiapService(
      createApuracaoDb({ totais: '10000.00', tributadas: '6000.00' }, [
        {
          id: 'b1',
          codigoBem: 'BEM-1',
          identificacaoBem: 'Máquina',
          valorIcmsTotal: '4800.00',
          valorIcmsFrete: '0',
          valorIcmsDifal: '0',
          quantidadeParcelas: 48,
          parcelasApropriadas: 0,
          saldoCredorRestante: '4800.00',
          dataEntrada: '2026-01-10',
        },
      ]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.coeficiente_saidas_tributadas).toBe('0.6000');
    expect(result.total_parcela).toBe('100.00');
    expect(result.total_credito_apropriado).toBe('60.00');
  });

  it('sem saídas no período assume coeficiente 1', async () => {
    const service = new CiapService(
      createApuracaoDb({ totais: '0', tributadas: '0' }, []) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.coeficiente_saidas_tributadas).toBe('1.0000');
    expect(result.quantidade_bens).toBe(0);
  });

  it('apropriarCompetencia gera ajuste E111 de crédito com código UF+02CIAP', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const bens = [
      {
        id: 'b1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Maquina',
        valorIcmsTotal: '4800.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 48,
        parcelasApropriadas: 0,
        saldoCredorRestante: '4800.00',
      },
    ];
    const tx = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(bens),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation((v: Record<string, unknown>) => {
          inserted.push(v);
          return Promise.resolve(undefined);
        }),
      }),
    };
    const db = {
      // coeficiente (join) e getUfCliente (limit) compartilham o select.
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if (selection && 'uf' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([{ uf: 'SP' }]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest
                  .fn()
                  .mockResolvedValue([
                    { totais: '10000.00', tributadas: '10000.00' },
                  ]),
              }),
            }),
          };
        }),
      transaction: jest
        .fn()
        .mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    };
    const service = new CiapService({ db } as never);

    const result = await service.apropriarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.total_credito_apropriado).toBe('100.00');
    expect(result.ajuste_e111_gerado).toBe('SP02CIAP');
    // Um E111 de crédito de 100,00 deve ter sido inserido.
    expect(inserted).toEqual([
      expect.objectContaining({
        registro: 'E111',
        codigoAjuste: 'SP02CIAP',
        indicador: 'CREDITO',
        valor: '100.00',
      }),
    ]);
  });
});
