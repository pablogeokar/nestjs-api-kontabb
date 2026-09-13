import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { CiapService } from './ciap.service';

// Verifica que uma das chamadas a tx.execute renderiza um
// pg_advisory_xact_lock cuja chave é derivada de cliente + competência (F06).
function expectAdvisoryLockAcquired(
  execute: jest.Mock,
  clienteId: string,
  competencia: string,
): void {
  const dialect = new PgDialect();
  const expectedKey = `ciap-apropriacao:${clienteId}:${competencia}`;
  const acquired = execute.mock.calls.some(([arg]) => {
    if (!arg || typeof arg !== 'object') {
      return false;
    }
    let rendered: { sql: string; params: unknown[] };
    try {
      rendered = dialect.sqlToQuery(arg as SQL);
    } catch {
      return false;
    }
    return (
      rendered.sql.includes('pg_advisory_xact_lock') &&
      rendered.params.includes(expectedKey)
    );
  });
  expect(acquired).toBe(true);
}

// Constrói um mock de transação (tx) para apropriarCompetencia. Os selects
// dentro da transação são consumidos, EM ORDEM:
//   1) bens ativos                         -> .where() (await)
//   2) competências já apropriadas         -> .where() (await)
//   3) contagem por bem na razão auxiliar  -> .where().groupBy() (await)
//   4) ajuste E111 existente               -> .where() (await)
// O objeto retornado por .where() é ao mesmo tempo "thenable" (resolve o
// próximo valor da fila) e expõe .groupBy() (resolve o MESMO valor), de modo
// que cada select consome exatamente um item da fila.
function createTxMock(opts: {
  bens: unknown[];
  jaApropriadosNaCompetencia: unknown[];
  ledgerPorBem: unknown[];
  e111Existente: unknown[];
  inserted?: Array<Record<string, unknown>>;
  updates?: unknown[];
}) {
  const queue: unknown[][] = [
    opts.bens,
    opts.jaApropriadosNaCompetencia,
    opts.ledgerPorBem,
    opts.e111Existente,
  ];
  const nextResult = () => Promise.resolve(queue.shift() ?? []);
  return {
    execute: jest.fn().mockResolvedValue(undefined),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockImplementation(() => {
          const result = nextResult();
          return {
            then: (
              onFulfilled: (v: unknown) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) => result.then(onFulfilled, onRejected),
            groupBy: jest.fn().mockReturnValue(result),
          };
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockImplementation((v: unknown) => {
        opts.updates?.push(v);
        return { where: jest.fn().mockResolvedValue(undefined) };
      }),
    }),
    delete: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockImplementation((v: Record<string, unknown>) => {
        opts.inserted?.push(v);
        return Promise.resolve(undefined);
      }),
    }),
  };
}

// Mock do db raiz: coeficiente (join) e getUfCliente (limit) usam db.select
// fora da transação; a transação delega para o tx fornecido.
function createRootDbMock(tx: unknown) {
  return {
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
}

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

// DB falso para registrarBem (R6.2). Os selects de checagem de propriedade
// (documento e item) terminam em .limit(); a fila `ownershipRows` fornece o
// resultado de cada limit() na ordem em que registrarBem os executa:
//   1) documento fiscal (se documentoFiscalId informado)
//   2) item do documento (se documentoFiscalItemId informado)
// O insert().values().onConflictDoUpdate().returning() devolve `insertedRow`.
function createRegistrarBemDb(opts: {
  ownershipRows: unknown[][];
  insertedRow?: Record<string, unknown>;
}) {
  const queue = [...opts.ownershipRows];
  return {
    db: {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockImplementation(() => Promise.resolve(queue.shift() ?? [])),
          }),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockResolvedValue([
                opts.insertedRow ?? defaultBemRow(),
              ]),
          }),
        }),
      }),
    },
  };
}

function defaultBemRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'bem-1',
    clienteId: 'c1',
    documentoFiscalId: null,
    documentoFiscalItemId: null,
    codigoBem: 'BEM-1',
    identificacaoBem: 'Máquina',
    dataEntrada: '2026-01-10',
    valorIcmsTotal: '4800.00',
    valorIcmsFrete: '0',
    valorIcmsDifal: '0',
    quantidadeParcelas: 48,
    parcelasApropriadas: 0,
    saldoCredorRestante: '4800.00',
    status: 'ATIVO',
    dataBaixa: null,
    motivoBaixa: null,
    criadoEm: new Date('2026-01-10T00:00:00Z'),
    atualizadoEm: new Date('2026-01-10T00:00:00Z'),
    ...overrides,
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
    // Fila de resultados de select dentro da transação, na ordem em que
    // apropriarCompetencia os executa: (1) bens ativos, (2) competências já
    // apropriadas na competência, (3) contagem por bem na razão (groupBy),
    // (4) ajuste E111 existente.
    const tx = createTxMock({
      bens,
      jaApropriadosNaCompetencia: [],
      ledgerPorBem: [],
      e111Existente: [],
      inserted,
    });
    const db = createRootDbMock(tx);
    const service = new CiapService({ db } as never);

    const result = await service.apropriarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.total_credito_apropriado).toBe('100.00');
    expect(result.ajuste_e111_gerado).toBe('SP02CIAP');
    // Adquiriu o lock de idempotência da competência (F06).
    expect(tx.execute).toHaveBeenCalledTimes(1);
    // O lock consultivo usa a chave cliente + competência (F06 / R2.2).
    expectAdvisoryLockAcquired(tx.execute, 'c1', '2026-09-01');
    // Registrou a competência apropriada para o bem (marcador de idempotência).
    expect(inserted).toContainEqual(
      expect.objectContaining({ bemId: 'b1', competencia: '2026-09-01' }),
    );
    // Um E111 de crédito de 100,00 deve ter sido inserido.
    expect(inserted).toContainEqual(
      expect.objectContaining({
        registro: 'E111',
        codigoAjuste: 'SP02CIAP',
        indicador: 'CREDITO',
        valor: '100.00',
      }),
    );
  });

  it('R2.2: adquire o pg_advisory_xact_lock por cliente/competência ANTES de ler os bens', async () => {
    // Registra a ordem das operações da transação para provar que o lock
    // consultivo é o primeiro comando (serializa apropriações concorrentes
    // do mesmo cliente/competência antes de qualquer leitura dos bens).
    const callOrder: string[] = [];
    const tx = {
      execute: jest.fn().mockImplementation(() => {
        callOrder.push('lock');
        return Promise.resolve(undefined);
      }),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockImplementation(() => {
            callOrder.push('select');
            const result = Promise.resolve([]);
            return {
              then: (
                onFulfilled: (v: unknown) => unknown,
                onRejected?: (e: unknown) => unknown,
              ) => result.then(onFulfilled, onRejected),
              groupBy: jest.fn().mockReturnValue(result),
            };
          }),
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
        values: jest.fn().mockResolvedValue(undefined),
      }),
    };
    const db = createRootDbMock(tx);
    const service = new CiapService({ db } as never);

    await service.apropriarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    // Chave do lock = cliente + competência.
    expectAdvisoryLockAcquired(tx.execute, 'c1', '2026-09-01');
    // O lock é adquirido antes da primeira leitura de bens.
    expect(callOrder[0]).toBe('lock');
    expect(callOrder.indexOf('lock')).toBeLessThan(callOrder.indexOf('select'));
  });

  it('F06: reexecução da mesma competência não consome parcela de novo', async () => {
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
        parcelasApropriadas: 1,
        saldoCredorRestante: '4700.00',
      },
    ];
    // Bem b1 já consta como apropriado nesta competência (razão com 1 registro).
    const updates: unknown[] = [];
    const tx = createTxMock({
      bens,
      jaApropriadosNaCompetencia: [{ bemId: 'b1' }],
      ledgerPorBem: [{ bemId: 'b1', total: 1 }],
      e111Existente: [],
      inserted,
      updates,
    });
    const db = createRootDbMock(tx);
    const service = new CiapService({ db } as never);

    const result = await service.apropriarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    // Nenhum bem apropriado de novo; nenhuma parcela consumida.
    expect(result.bens_apropriados).toBe(0);
    expect(result.total_credito_apropriado).toBe('0.00');
    expect(updates).toHaveLength(0);
    // Não reinsere marcador de competência nem E111.
    expect(inserted).toHaveLength(0);
  });

  it('R2.1/R2.4: 10 retries da mesma competência resultam em 1 apropriação e parcela derivada da razão', async () => {
    // Estado simulado de PERSISTÊNCIA: a razão auxiliar acumula competências
    // registradas para o bem; o unique (cliente, competencia, bem) garante que
    // reinserções da MESMA competência são no-op.
    const bem = {
      id: 'b1',
      codigoBem: 'BEM-1',
      identificacaoBem: 'Maquina',
      valorIcmsTotal: '4800.00',
      valorIcmsFrete: '0',
      valorIcmsDifal: '0',
      quantidadeParcelas: 48,
      // Contador armazenado "sujo": propositalmente divergente da razão para
      // provar que o incremento NÃO se apoia nele (deriva da razão).
      parcelasApropriadas: 7,
      saldoCredorRestante: '4800.00',
    };
    const competenciaDate = '2026-09-01';
    // Razão: competências já registradas para o bem (fonte de verdade).
    const razao: Array<{ bemId: string; competencia: string }> = [];

    // Saldo credor PERSISTIDO entre retries: o update grava um novo saldo, e o
    // próximo retry lê esse valor. Se cada retry consumisse a parcela, o saldo
    // sofreria drift (4800 -> 4700 -> 4600 ...). Com a guarda de idempotência,
    // apenas UMA apropriação deve decrementar o saldo em UMA parcela.
    const parcelaValor = 100; // 4800 / 48
    let saldoPersistido = 4800;

    let ultimaParcelaGravada: number | undefined;
    const marcadoresCompetenciaInseridos: Array<Record<string, unknown>> = [];

    for (let tentativa = 0; tentativa < 10; tentativa += 1) {
      // Cada retry lê o estado persistido (saldo atual) do bem.
      bem.saldoCredorRestante = saldoPersistido.toFixed(2);
      const inserted: Array<Record<string, unknown>> = [];
      const updates: Array<Record<string, unknown>> = [];
      const jaNaCompetencia = razao.filter(
        (r) => r.competencia === competenciaDate,
      );
      const ledgerPorBem =
        razao.length > 0 ? [{ bemId: 'b1', total: razao.length }] : [];

      const tx = createTxMock({
        bens: [bem],
        jaApropriadosNaCompetencia: jaNaCompetencia,
        ledgerPorBem,
        e111Existente: [],
        inserted: inserted,
        updates: updates,
      });
      // Aplica o efeito do insert do marcador na razão simulada, respeitando o
      // unique (no-op quando a competência já existe para o bem).
      tx.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation((v: Record<string, unknown>) => {
          inserted.push(v);
          if (v.bemId === 'b1' && v.competencia === competenciaDate) {
            marcadoresCompetenciaInseridos.push(v);
            const exists = razao.some(
              (r) => r.bemId === 'b1' && r.competencia === competenciaDate,
            );
            // Unique (cliente, competencia, bem): reinserção da MESMA
            // competência é no-op; apenas a primeira efetiva.
            if (!exists) {
              razao.push({ bemId: 'b1', competencia: competenciaDate });
            }
          }
          return Promise.resolve(undefined);
        }),
      }) as never;

      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);
      await service.apropriarCompetencia({
        clienteId: 'c1',
        competencia: '2026-09',
      });

      const bemUpdate = updates.find((u) => 'parcelasApropriadas' in u);
      if (bemUpdate) {
        ultimaParcelaGravada = bemUpdate.parcelasApropriadas as number;
        // Persiste o saldo gravado para o próximo retry ler.
        saldoPersistido = Number(bemUpdate.saldoCredorRestante);
      }
    }

    // Após 10 retries, apenas 1 competência foi registrada para o bem
    // (o marcador foi tentado apenas na 1ª apropriação; retries são no-op).
    expect(razao).toHaveLength(1);
    // Exatamente uma inserção do marcador da competência foi efetivada
    // (os demais retries nem chegam a inserir por já constar na razão).
    expect(marcadoresCompetenciaInseridos).toHaveLength(1);
    // A parcela gravada foi derivada da razão (0 anteriores + 1 = 1),
    // NÃO um incremento cego sobre o contador sujo (que daria 8).
    expect(ultimaParcelaGravada).toBe(1);
    // Sem drift de saldo: exatamente UMA parcela consumida ao longo dos 10
    // retries (4800 - 100 = 4700), não 10 parcelas (que dariam 3800).
    expect(saldoPersistido).toBe(4800 - parcelaValor);
  });

  it('R2.1/R2.4: o incremento é derivado da contagem na razão, não bem.parcelasApropriadas + 1', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const bens = [
      {
        id: 'b1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Maquina',
        valorIcmsTotal: '4800.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 48,
        // Contador armazenado divergente da razão (drift): +1 cego daria 41.
        parcelasApropriadas: 40,
        saldoCredorRestante: '1000.00',
      },
    ];
    // A razão registra 3 competências anteriores para o bem (competências
    // DIFERENTES da atual, portanto não estão em jaApropriadosNaCompetencia).
    const tx = createTxMock({
      bens,
      jaApropriadosNaCompetencia: [],
      ledgerPorBem: [{ bemId: 'b1', total: 3 }],
      e111Existente: [],
      inserted,
      updates: updates,
    });
    const db = createRootDbMock(tx);
    const service = new CiapService({ db } as never);

    const result = await service.apropriarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    // Apropriou 1 bem nesta competência.
    expect(result.bens_apropriados).toBe(1);
    const bemUpdate = updates.find((u) => 'parcelasApropriadas' in u);
    expect(bemUpdate).toBeDefined();
    // Derivado da razão: 3 anteriores + 1 = 4. NÃO 40 + 1 = 41.
    expect(bemUpdate?.parcelasApropriadas).toBe(4);
    // Marcador da competência atual inserido na razão.
    expect(inserted).toContainEqual(
      expect.objectContaining({ bemId: 'b1', competencia: '2026-09-01' }),
    );
  });

  it('R2.2: chamadas concorrentes para o mesmo cliente/competência preservam o saldo (apenas 1 apropriação)', async () => {
    // Duas invocações sobrepostas de apropriarCompetencia disputam o mesmo
    // (cliente, competência, bem). A serialização é modelada pela combinação
    // de:
    //   - pg_advisory_xact_lock (serializa a região crítica read-modify-write);
    //   - unique (cliente, competencia, bem) na razão auxiliar (o 2º insert do
    //     mesmo trio é no-op).
    // Efeito esperado: o saldo credor cai por EXATAMENTE UMA parcela (não duas)
    // e a razão fica com EXATAMENTE UMA linha para (cliente, competência, bem).
    const competenciaDate = '2026-09-01';
    const parcelaValor = 100; // 4800 / 48
    const saldoInicial = 4800;

    // Estado compartilhado entre as duas chamadas (persistência simulada).
    const razao: Array<{ bemId: string; competencia: string }> = [];
    const marcadoresInseridos: Array<Record<string, unknown>> = [];
    const e111Inseridos: Array<Record<string, unknown>> = [];
    const saldosGravados: number[] = [];
    let saldoPersistido = saldoInicial;

    // Constrói o tx de uma invocação lendo o estado compartilhado ATUAL. Como
    // o advisory lock serializa a região crítica, cada invocação lê o estado
    // deixado pela anterior (não há leitura "obsoleta" concorrente).
    const buildTx = () => {
      const bem = {
        id: 'b1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Maquina',
        valorIcmsTotal: '4800.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 48,
        parcelasApropriadas: razao.length,
        saldoCredorRestante: saldoPersistido.toFixed(2),
      };
      const jaNaCompetencia = razao.filter(
        (r) => r.competencia === competenciaDate,
      );
      const ledgerPorBem =
        razao.length > 0 ? [{ bemId: 'b1', total: razao.length }] : [];

      const tx = createTxMock({
        bens: [bem],
        jaApropriadosNaCompetencia: jaNaCompetencia,
        ledgerPorBem,
        e111Existente: [],
      });

      // Update grava o saldo no estado compartilhado.
      tx.update = jest.fn().mockReturnValue({
        set: jest.fn().mockImplementation((v: Record<string, unknown>) => {
          if ('saldoCredorRestante' in v) {
            saldoPersistido = Number(v.saldoCredorRestante);
            saldosGravados.push(saldoPersistido);
          }
          return { where: jest.fn().mockResolvedValue(undefined) };
        }),
      }) as never;

      // Insert respeita o unique da razão (2º insert do mesmo trio = no-op).
      tx.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation((v: Record<string, unknown>) => {
          if (v.registro === 'E111') {
            e111Inseridos.push(v);
          } else if (v.bemId === 'b1' && v.competencia === competenciaDate) {
            marcadoresInseridos.push(v);
            const exists = razao.some(
              (r) => r.bemId === 'b1' && r.competencia === competenciaDate,
            );
            if (!exists) {
              razao.push({ bemId: 'b1', competencia: competenciaDate });
            }
          }
          return Promise.resolve(undefined);
        }),
      }) as never;

      return tx;
    };

    const runInvocation = () => {
      const tx = buildTx();
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);
      return service.apropriarCompetencia({
        clienteId: 'c1',
        competencia: '2026-09',
      });
    };

    // Duas chamadas concorrentes serializadas pelo lock: a região crítica de
    // cada uma executa por completo antes da outra (read-modify-write atômico).
    // O pg_advisory_xact_lock garante que a 2ª só entra na seção crítica após
    // a 1ª efetivar (commit), então modelamos a serialização executando-as em
    // ordem — cada uma lê o estado deixado pela anterior.
    const primeira = await runInvocation();
    const segunda = await runInvocation();

    // Exatamente UMA das chamadas apropriou o bem; a outra é no-op.
    const apropriacoes = [primeira, segunda].map((r) => r.bens_apropriados);
    expect(apropriacoes.filter((n) => n === 1)).toHaveLength(1);
    expect(apropriacoes.filter((n) => n === 0)).toHaveLength(1);

    // A razão tem EXATAMENTE UMA linha para (cliente, competência, bem).
    expect(razao).toHaveLength(1);

    // O marcador da competência foi efetivado uma única vez na razão (o 2º
    // insert do mesmo trio é no-op pelo unique constraint).
    const trioMarcadores = marcadoresInseridos.filter(
      (v) => v.bemId === 'b1' && v.competencia === competenciaDate,
    );
    // Apenas a apropriação vencedora tenta inserir o marcador; a perdedora
    // sequer chega ao insert por já constar na razão.
    expect(trioMarcadores).toHaveLength(1);

    // O saldo caiu por EXATAMENTE UMA parcela (não duas).
    expect(saldoPersistido).toBe(saldoInicial - parcelaValor);
    // Somente uma gravação de saldo ocorreu (a vencedora); a perdedora não
    // reduz o saldo.
    expect(saldosGravados).toEqual([saldoInicial - parcelaValor]);

    // Apenas um E111 de crédito foi inserido (o total apropriado da
    // competência), refletindo o saldo real sem parcela dobrada (R2.4).
    expect(e111Inseridos).toHaveLength(1);
    expect(e111Inseridos[0]).toEqual(
      expect.objectContaining({
        registro: 'E111',
        codigoAjuste: 'SP02CIAP',
        indicador: 'CREDITO',
        valor: '100.00',
      }),
    );
  });

  describe('registrarBem — propriedade cliente↔documento (R6.2)', () => {
    it('rejeita registro quando o documento fiscal pertence a outro cliente', async () => {
      // WHERE por (id, clienteId) do cliente dono não retorna linha ->
      // documento de outro cliente é indistinguível de inexistente -> rejeita.
      const service = new CiapService(
        createRegistrarBemDb({ ownershipRows: [[]] }) as never,
      );
      await expect(
        service.registrarBem({
          clienteId: 'c1',
          documentoFiscalId: 'doc-de-outro-cliente',
          codigoBem: 'BEM-1',
          identificacaoBem: 'Máquina',
          dataEntrada: '2026-01-10',
          valorIcmsTotal: '4800.00',
        }),
      ).rejects.toThrow('Documento fiscal não encontrado.');
    });

    it('rejeita registro quando o item de documento pertence a outro cliente', async () => {
      // Item scoped por clienteId não retorna linha -> rejeita.
      const service = new CiapService(
        createRegistrarBemDb({ ownershipRows: [[]] }) as never,
      );
      await expect(
        service.registrarBem({
          clienteId: 'c1',
          documentoFiscalItemId: 'item-de-outro-cliente',
          codigoBem: 'BEM-1',
          identificacaoBem: 'Máquina',
          dataEntrada: '2026-01-10',
          valorIcmsTotal: '4800.00',
        }),
      ).rejects.toThrow('Item do documento fiscal não encontrado.');
    });

    it('registra quando documento e item pertencem ao próprio cliente', async () => {
      // Fila: (1) documento do cliente encontrado, (2) item do cliente
      // encontrado e coerente com o documento informado.
      const db = createRegistrarBemDb({
        ownershipRows: [
          [{ id: 'doc-1' }],
          [{ id: 'item-1', documentoFiscalId: 'doc-1' }],
        ],
        insertedRow: defaultBemRow({
          id: 'bem-1',
          documentoFiscalId: 'doc-1',
          documentoFiscalItemId: 'item-1',
        }),
      });
      const service = new CiapService(db as never);
      const bem = await service.registrarBem({
        clienteId: 'c1',
        documentoFiscalId: 'doc-1',
        documentoFiscalItemId: 'item-1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Máquina',
        dataEntrada: '2026-01-10',
        valorIcmsTotal: '4800.00',
      });
      expect(bem.documento_fiscal_id).toBe('doc-1');
      expect(bem.documento_fiscal_item_id).toBe('item-1');
      expect(db.db.insert).toHaveBeenCalledTimes(1);
    });

    it('registra sem referências de documento/item (nenhuma checagem de propriedade)', async () => {
      const db = createRegistrarBemDb({ ownershipRows: [] });
      const service = new CiapService(db as never);
      const bem = await service.registrarBem({
        clienteId: 'c1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Máquina',
        dataEntrada: '2026-01-10',
        valorIcmsTotal: '4800.00',
      });
      expect(bem.id).toBe('bem-1');
      // Nenhum select de propriedade foi necessário.
      expect(db.db.select).not.toHaveBeenCalled();
      expect(db.db.insert).toHaveBeenCalledTimes(1);
    });

    it('R6.4: rejeita quantidade de parcelas acima de 48 chamando o serviço direto (fora do HTTP)', async () => {
      // O DTO impõe @Max(48) na fronteira HTTP; aqui provamos que o serviço
      // rejeita o mesmo limite sem depender do ValidationPipe. Falha ANTES de
      // qualquer acesso ao banco.
      const db = createRegistrarBemDb({ ownershipRows: [] });
      const service = new CiapService(db as never);
      await expect(
        service.registrarBem({
          clienteId: 'c1',
          codigoBem: 'BEM-1',
          identificacaoBem: 'Máquina',
          dataEntrada: '2026-01-10',
          valorIcmsTotal: '4800.00',
          quantidadeParcelas: 49,
        }),
      ).rejects.toThrow('Quantidade de parcelas deve estar entre 1 e 48.');
      expect(db.db.insert).not.toHaveBeenCalled();
    });

    it('R6.4: rejeita quantidade de parcelas zero/negativa (fora do HTTP)', async () => {
      const db = createRegistrarBemDb({ ownershipRows: [] });
      const service = new CiapService(db as never);
      await expect(
        service.registrarBem({
          clienteId: 'c1',
          codigoBem: 'BEM-1',
          identificacaoBem: 'Máquina',
          dataEntrada: '2026-01-10',
          valorIcmsTotal: '4800.00',
          quantidadeParcelas: 0,
        }),
      ).rejects.toThrow('Quantidade de parcelas deve estar entre 1 e 48.');
      expect(db.db.insert).not.toHaveBeenCalled();
    });

    it('R6.4/R6.3: rejeita valor de ICMS total negativo (fora do HTTP)', async () => {
      // O DTO impõe não-negatividade via regex; o serviço reforça o mesmo para
      // impedir base de apropriação negativa vinda de um chamador não-HTTP.
      const db = createRegistrarBemDb({ ownershipRows: [] });
      const service = new CiapService(db as never);
      await expect(
        service.registrarBem({
          clienteId: 'c1',
          codigoBem: 'BEM-1',
          identificacaoBem: 'Máquina',
          dataEntrada: '2026-01-10',
          valorIcmsTotal: '-100.00',
        }),
      ).rejects.toThrow('O valor de ICMS total não pode ser negativo.');
      expect(db.db.insert).not.toHaveBeenCalled();
    });

    it('R6.4/R6.3: rejeita valor de frete/DIFAL negativo (fora do HTTP)', async () => {
      const db = createRegistrarBemDb({ ownershipRows: [] });
      const service = new CiapService(db as never);
      await expect(
        service.registrarBem({
          clienteId: 'c1',
          codigoBem: 'BEM-1',
          identificacaoBem: 'Máquina',
          dataEntrada: '2026-01-10',
          valorIcmsTotal: '100.00',
          valorIcmsDifal: '-1.00',
        }),
      ).rejects.toThrow('O valor de DIFAL não pode ser negativo.');
      expect(db.db.insert).not.toHaveBeenCalled();
    });

    it('R6.2: baixarBem de bem de outro cliente é rejeitado (WHERE por clienteId → NotFound)', async () => {
      // O update é escopado por (id, clienteId); um bem de outro cliente não
      // casa o WHERE, o .returning() vem vazio e o serviço rejeita como
      // "não encontrado" (objeto de outro cliente indistinguível de inexistente).
      const returning = jest.fn().mockResolvedValue([]);
      const db = {
        db: {
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({ returning }),
            }),
          }),
        },
      };
      const service = new CiapService(db as never);
      await expect(
        service.baixarBem({
          clienteId: 'c1',
          bemId: 'bem-de-outro-cliente',
          dataBaixa: '2026-08-31',
          motivoBaixa: '01',
        }),
      ).rejects.toThrow('Bem do CIAP não encontrado.');
      // A tentativa foi feita, mas nenhuma linha do cliente foi afetada.
      expect(returning).toHaveBeenCalledTimes(1);
    });

    it('rejeita quando o item informado não pertence ao documento informado (mesmo cliente)', async () => {
      // Documento e item do cliente existem, mas o item aponta para OUTRO
      // documento -> inconsistência de referência -> BadRequest.
      const db = createRegistrarBemDb({
        ownershipRows: [
          [{ id: 'doc-1' }],
          [{ id: 'item-1', documentoFiscalId: 'doc-OUTRO' }],
        ],
      });
      const service = new CiapService(db as never);
      await expect(
        service.registrarBem({
          clienteId: 'c1',
          documentoFiscalId: 'doc-1',
          documentoFiscalItemId: 'item-1',
          codigoBem: 'BEM-1',
          identificacaoBem: 'Máquina',
          dataEntrada: '2026-01-10',
          valorIcmsTotal: '4800.00',
        }),
      ).rejects.toThrow(
        'O item informado não pertence ao documento fiscal informado.',
      );
    });
  });
});
