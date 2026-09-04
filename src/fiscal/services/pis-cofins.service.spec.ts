import { PisCofinsService } from './pis-cofins.service';

// DB falso: a primeira consulta (getCliente) resolve por .limit; as demais
// (somarPorSegmento) resolvem por .where. Usamos uma fila de resultados.
function createDb(
  cliente: { regimeTributario: string | null },
  segmentos: unknown[][],
) {
  const queue = [...segmentos];
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('regimeTributario' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest
                    .fn()
                    .mockResolvedValue([{ id: 'c1', ...cliente }]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue(queue.shift() ?? [{}]),
              }),
            }),
          };
        }),
    },
  };
}

describe('PisCofinsService', () => {
  it('Simples Nacional: sem apuração destacada (via DAS)', async () => {
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'SIMPLES_NACIONAL' }, []) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.regime_apuracao).toBe('DAS');
    expect(result.pis.saldo_a_recolher).toBe('0.00');
    expect(result.cofins.saldo_a_recolher).toBe('0.00');
  });

  it('Lucro Presumido: cumulativo 0,65%/3% sobre base tributada, sem crédito', async () => {
    // Saídas: base tributada 10.000, sem valor destacado (calcula por alíquota).
    const saidas = [
      {
        pis_base_tributada: '10000.00',
        pis_valor_destacado: '0.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        cofins_base_tributada: '10000.00',
        cofins_valor_destacado: '0.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_PRESUMIDO' }, [saidas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.regime_apuracao).toBe('CUMULATIVO');
    // PIS 0,65% de 10.000 = 65,00 ; COFINS 3% = 300,00. Sem crédito.
    expect(result.pis.debito).toBe('65.00');
    expect(result.pis.credito).toBe('0.00');
    expect(result.pis.saldo_a_recolher).toBe('65.00');
    expect(result.cofins.debito).toBe('300.00');
    expect(result.cofins.saldo_a_recolher).toBe('300.00');
  });

  it('Lucro Real: não-cumulativo com crédito das entradas', async () => {
    const saidas = [
      {
        pis_base_tributada: '10000.00',
        pis_valor_destacado: '0.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        cofins_base_tributada: '10000.00',
        cofins_valor_destacado: '0.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
      },
    ];
    const entradas = [
      {
        pis_base_tributada: '0.00',
        pis_valor_destacado: '0.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '4000.00',
        cofins_base_tributada: '0.00',
        cofins_valor_destacado: '0.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '4000.00',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_REAL' }, [saidas, entradas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.regime_apuracao).toBe('NAO_CUMULATIVO');
    // PIS: débito 1,65% de 10.000 = 165 ; crédito 1,65% de 4.000 = 66 ; saldo 99.
    expect(result.pis.debito).toBe('165.00');
    expect(result.pis.credito).toBe('66.00');
    expect(result.pis.saldo_a_recolher).toBe('99.00');
    // COFINS: débito 7,6% de 10.000 = 760 ; crédito 7,6% de 4.000 = 304 ; saldo 456.
    expect(result.cofins.debito).toBe('760.00');
    expect(result.cofins.credito).toBe('304.00');
    expect(result.cofins.saldo_a_recolher).toBe('456.00');
  });

  it('não tributa receita monofásica/ST (sem débito próprio)', async () => {
    const saidas = [
      {
        pis_base_tributada: '0.00',
        pis_valor_destacado: '0.00',
        pis_base_sem_debito: '5000.00',
        pis_base_credito: '0.00',
        cofins_base_tributada: '0.00',
        cofins_valor_destacado: '0.00',
        cofins_base_sem_debito: '5000.00',
        cofins_base_credito: '0.00',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_PRESUMIDO' }, [saidas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.pis.debito).toBe('0.00');
    expect(result.pis.base_monofasica_st).toBe('5000.00');
    expect(result.cofins.debito).toBe('0.00');
  });
});
