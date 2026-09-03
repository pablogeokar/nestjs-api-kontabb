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
});
