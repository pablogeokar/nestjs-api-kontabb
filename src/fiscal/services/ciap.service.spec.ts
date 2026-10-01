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
//   1) bens ativos elegíveis (dataEntrada <= fim)  -> .where() (await)
//   2) apropriações ativas já existentes na comp.  -> .where() (await)
//   3) soma da razão: SUM(parcelaAdmitida) ativas  -> .where() (await)
// O 3º select é a REGRAVAÇÃO DO E111 A PARTIR DA RAZÃO (tarefa 2.2): o ajuste é
// recalculado como a soma das parcelas admitidas ativas da competência, não
// mutado incrementalmente. `razaoTotal` modela o valor que esse SUM retornaria
// APÓS os inserts deste run (a razão persistida). Quando omitido, assume '0'
// (nenhuma apropriação ativa → nenhum E111).
// O objeto retornado por .where() é ao mesmo tempo "thenable" (resolve o
// próximo valor da fila) e expõe .groupBy() (resolve o MESMO valor), de modo
// que cada select consome exatamente um item da fila.
function createTxMock(opts: {
  bens: unknown[];
  jaApropriadosNaCompetencia: unknown[];
  razaoTotal?: string;
  // Código estadual de ajuste E111 resolvido do catálogo (R2.6, tarefa 3.4). A
  // regravação do E111 agora valida o código+vigência em `fiscal_catalogos_versoes`
  // via resolverCodigoAjusteE111 (select ... where ... orderBy ... limit). Quando
  // definido como `null`, o catálogo não devolve linha e a geração do ajuste é
  // bloqueada (inconsistência). Default: 'SP02CIAP' (UF SP dos cenários dos testes).
  codigoCatalogo?: string | null;
  inserted?: Array<Record<string, unknown>>;
  updates?: unknown[];
}) {
  const queue: unknown[][] = [
    opts.bens,
    opts.jaApropriadosNaCompetencia,
    [{ total: opts.razaoTotal ?? '0' }],
  ];
  const nextResult = () => Promise.resolve(queue.shift() ?? []);
  // Linha do catálogo de código de ajuste (R2.6). `undefined` → default SP02CIAP;
  // `null` explícito → catálogo vazio (código não cadastrado/vigente).
  const catalogoRows =
    opts.codigoCatalogo === null
      ? []
      : [{ codigo: opts.codigoCatalogo ?? 'SP02CIAP', fonte: 'teste' }];
  return {
    execute: jest.fn().mockResolvedValue(undefined),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockImplementation(() => {
          // A fila só é consumida nos caminhos AWAITED (then/groupBy) — bens,
          // jaApropriados e razão. O caminho do catálogo (orderBy().limit())
          // NÃO consome a fila, de modo que a ordem bens → jaApropriados →
          // razão permanece intacta mesmo com o select de catálogo no meio.
          return {
            then: (
              onFulfilled: (v: unknown) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) => nextResult().then(onFulfilled, onRejected),
            groupBy: jest.fn().mockImplementation(() => nextResult()),
            // Caminho do catálogo (resolverCodigoAjusteE111, R2.6): resolve a
            // linha de catálogo diretamente, sem tocar a fila.
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(catalogoRows),
            }),
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
              where: jest.fn().mockResolvedValue([
                {
                  total_saidas: '10000.00',
                  saidas_tributadas: '10000.00',
                  exportacoes: '0',
                  saidas_equiparadas: '0',
                },
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
//  1) calcularCoeficiente -> resolve por .where (retorna [agregados de saídas])
//  2) lista de bens -> resolve por .where().orderBy (retorna bens[])
// Os agregados espelham as colunas de calcularCoeficiente: total_saidas,
// saidas_tributadas, exportacoes, saidas_equiparadas. Para conveniência dos
// testes de apuração legados (que só exercitam tributadas/total), os campos de
// exportação/equiparação assumem '0' quando omitidos.
function createApuracaoDb(
  coef: {
    total_saidas: string;
    saidas_tributadas: string;
    exportacoes?: string;
    saidas_equiparadas?: string;
  },
  bens: unknown[],
) {
  const agregados = {
    total_saidas: coef.total_saidas,
    saidas_tributadas: coef.saidas_tributadas,
    exportacoes: coef.exportacoes ?? '0',
    saidas_equiparadas: coef.saidas_equiparadas ?? '0',
  };
  return {
    db: {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            // caminho do coeficiente (join itens->documentos, termina em where)
            where: jest.fn().mockResolvedValue([agregados]),
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
              .mockResolvedValue([opts.insertedRow ?? defaultBemRow()]),
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
      createApuracaoDb(
        { total_saidas: '10000.00', saidas_tributadas: '10000.00' },
        [
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
        ],
      ) as never,
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
      createApuracaoDb(
        { total_saidas: '10000.00', saidas_tributadas: '6000.00' },
        [
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
        ],
      ) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.coeficiente_saidas_tributadas).toBe('0.6000');
    expect(result.total_parcela).toBe('100.00');
    expect(result.total_credito_apropriado).toBe('60.00');
  });

  // R2.4: a apuração de uma competência sem saídas propaga a regra explícita
  // do coeficiente (0.0000), não mais o 1.0000 silencioso.
  it('sem saídas no período aplica coeficiente explícito 0 (R2.4)', async () => {
    const service = new CiapService(
      createApuracaoDb(
        { total_saidas: '0', saidas_tributadas: '0' },
        [],
      ) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.coeficiente_saidas_tributadas).toBe('0.0000');
    expect(result.quantidade_bens).toBe(0);
  });

  // DB falso para calcularCoeficiente: a função executa UM select agregado que
  // termina em .innerJoin().where() e devolve uma linha com os quatro
  // agregados de saídas. Campos de exportação/equiparação assumem '0' quando
  // omitidos.
  function createCoeficienteDb(agregado: {
    total_saidas: string;
    saidas_tributadas: string;
    exportacoes?: string;
    saidas_equiparadas?: string;
  }) {
    const linha = {
      total_saidas: agregado.total_saidas,
      saidas_tributadas: agregado.saidas_tributadas,
      exportacoes: agregado.exportacoes ?? '0',
      saidas_equiparadas: agregado.saidas_equiparadas ?? '0',
    };
    return {
      db: {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([linha]),
            }),
          }),
        }),
      },
    };
  }

  const cenario = {
    clienteId: 'c1',
    inicio: new Date('2026-09-01T00:00:00Z'),
    fim: new Date('2026-09-30T23:59:59Z'),
  };

  describe('calcularCoeficiente (R2.3)', () => {
    it('100% tributado: numerador = denominador = total; coeficiente 1', async () => {
      const service = new CiapService(
        createCoeficienteDb({
          total_saidas: '10000.00',
          saidas_tributadas: '10000.00',
        }) as never,
      );
      const r = await service.calcularCoeficiente(cenario);
      expect(r.coeficiente).toBe('1.0000');
      expect(r.fonte).toBe('saidas_tributadas');
      expect(r.numerador).toBe('10000.00');
      expect(r.denominador).toBe('10000.00');
      expect(r.sem_saidas).toBe(false);
    });

    it('parcial: coeficiente = tributadas / total', async () => {
      const service = new CiapService(
        createCoeficienteDb({
          total_saidas: '10000.00',
          saidas_tributadas: '6000.00',
        }) as never,
      );
      const r = await service.calcularCoeficiente(cenario);
      expect(r.coeficiente).toBe('0.6000');
      expect(r.numerador).toBe('6000.00');
      expect(r.denominador).toBe('10000.00');
    });

    it('exportação entra no numerador como tributada (R2.3)', async () => {
      // 6.000 tributadas + 2.000 de exportação (sem ICMS destacado) = 8.000 no
      // numerador; total 10.000 => coeficiente 0,8. Sem o tratamento da
      // exportação, a regra antiga daria 0,6 (excluiria a exportação).
      const service = new CiapService(
        createCoeficienteDb({
          total_saidas: '10000.00',
          saidas_tributadas: '6000.00',
          exportacoes: '2000.00',
        }) as never,
      );
      const r = await service.calcularCoeficiente(cenario);
      expect(r.componentes.exportacoes).toBe('2000.00');
      expect(r.numerador).toBe('8000.00');
      expect(r.denominador).toBe('10000.00');
      expect(r.coeficiente).toBe('0.8000');
    });

    it('saídas equiparadas entram no numerador (R2.3)', async () => {
      // 5.000 tributadas + 1.000 exportação + 1.000 equiparadas = 7.000 no
      // numerador; total 10.000 => 0,7.
      const service = new CiapService(
        createCoeficienteDb({
          total_saidas: '10000.00',
          saidas_tributadas: '5000.00',
          exportacoes: '1000.00',
          saidas_equiparadas: '1000.00',
        }) as never,
      );
      const r = await service.calcularCoeficiente(cenario);
      expect(r.componentes.saidas_equiparadas).toBe('1000.00');
      expect(r.numerador).toBe('7000.00');
      expect(r.coeficiente).toBe('0.7000');
    });

    it('saídas não tributadas (nem export, nem equiparada) ficam fora do numerador', async () => {
      // Só 4.000 tributadas de 10.000; o restante é saída isenta comum (não
      // export, não equiparada) => coeficiente 0,4.
      const service = new CiapService(
        createCoeficienteDb({
          total_saidas: '10000.00',
          saidas_tributadas: '4000.00',
        }) as never,
      );
      const r = await service.calcularCoeficiente(cenario);
      expect(r.numerador).toBe('4000.00');
      expect(r.coeficiente).toBe('0.4000');
    });

    // R2.4: sem saídas no período aplica a regra EXPLÍCITA (coeficiente
    // 0.0000) — NÃO presume mais 1.0000 silenciosamente. O crédito
    // deliberadamente não é apropriado; `fonte: 'sem_saidas'` + `sem_saidas`
    // permitem ao chamador distinguir o caso.
    it('sem saídas: coeficiente 0.0000 (regra explícita R2.4), fonte "sem_saidas" e sem_saidas = true', async () => {
      const service = new CiapService(
        createCoeficienteDb({
          total_saidas: '0',
          saidas_tributadas: '0',
        }) as never,
      );
      const r = await service.calcularCoeficiente(cenario);
      expect(r.coeficiente).toBe('0.0000');
      expect(r.fonte).toBe('sem_saidas');
      expect(r.numerador).toBe('0.00');
      expect(r.denominador).toBe('0.00');
      expect(r.sem_saidas).toBe(true);
    });

    // R2.4: a política "sem saídas" é DELIBERADA e documentada — nunca o
    // 1.0000 silencioso que presumiria 100% de crédito sem fundamento.
    it('sem saídas NÃO presume coeficiente 1.0000 (R2.4)', async () => {
      const service = new CiapService(
        createCoeficienteDb({
          total_saidas: '0',
          saidas_tributadas: '0',
        }) as never,
      );
      const r = await service.calcularCoeficiente(cenario);
      expect(r.coeficiente).not.toBe('1.0000');
    });
  });

  it('apropriarCompetencia gera ajuste E111 de crédito com código UF+02CIAP', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const bens = [
      {
        id: 'b1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Maquina',
        // Entrada em jan/2026; competência set/2026 => parcela de calendário 9.
        dataEntrada: '2026-01-10',
        valorIcmsTotal: '4800.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 48,
        parcelasApropriadas: 0,
        saldoCredorRestante: '4800.00',
      },
    ];
    // Fila de resultados de select dentro da transação, na ordem em que
    // apropriarCompetencia os executa: (1) bens ativos elegíveis,
    // (2) apropriações ativas já existentes na competência, (3) soma da razão
    // (SUM parcelaAdmitida ativas) usada para regravar o E111. Após inserir a
    // apropriação deste bem (admitida 100,00), a razão da competência soma
    // 100,00.
    const tx = createTxMock({
      bens,
      jaApropriadosNaCompetencia: [],
      razaoTotal: '100.00',
      inserted,
    });
    const db = createRootDbMock(tx);
    const service = new CiapService({ db } as never);

    const result = await service.apropriarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.total_credito_apropriado).toBe('100.00');
    // R2.6: o E111 é regravado a partir da razão (soma das admitidas ativas).
    expect(result.total_credito_razao).toBe('100.00');
    expect(result.ajuste_e111_gerado).toBe('SP02CIAP');
    // Adquiriu o lock de idempotência da competência (R1.2).
    expect(tx.execute).toHaveBeenCalledTimes(1);
    // O lock consultivo usa a chave cliente + competência (R1.2).
    expectAdvisoryLockAcquired(tx.execute, 'c1', '2026-09-01');
    // R1.4: gravou a apropriação versionada com a parcela de CALENDÁRIO (9),
    // não parcelasApropriadas + 1.
    expect(inserted).toContainEqual(
      expect.objectContaining({
        bemId: 'b1',
        competencia: '2026-09-01',
        versao: 1,
        ativa: true,
        numeroParcela: 9,
      }),
    );
    // Marcador de competência da Fase 0 mantido em sincronia (transição aditiva).
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
              // Catálogo de código de ajuste E111 (R2.6): devolve o código
              // vigente para a UF sem afetar a ordem das leituras.
              orderBy: jest.fn().mockReturnValue({
                limit: jest
                  .fn()
                  .mockResolvedValue([{ codigo: 'SP02CIAP', fonte: 'teste' }]),
              }),
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

  it('R1.1/R1.5: reexecução da mesma competência não consome parcela de novo', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const bens = [
      {
        id: 'b1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Maquina',
        dataEntrada: '2026-01-10',
        valorIcmsTotal: '4800.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 48,
        parcelasApropriadas: 1,
        saldoCredorRestante: '4700.00',
      },
    ];
    // Bem b1 já tem apropriação ATIVA nesta competência (ciap_apropriacoes),
    // com admitida 100,00 — a razão da competência já soma 100,00.
    const updates: unknown[] = [];
    const tx = createTxMock({
      bens,
      jaApropriadosNaCompetencia: [{ bemId: 'b1' }],
      razaoTotal: '100.00',
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
    // Não grava nova apropriação versionada nem marcador de competência: o bem
    // já consta na razão (idempotência R1.1/R1.5).
    expect(
      inserted.filter((v) => 'numeroParcela' in v || 'bemId' in v),
    ).toHaveLength(0);
    // R1.5/R2.6: o E111 é REGRAVADO A PARTIR DA RAZÃO mesmo num reprocesso sem
    // nova apropriação — o valor é o mesmo da razão existente (100,00), não
    // zero nem acumulado. Reprocessar devolve o mesmo resultado.
    expect(result.total_credito_razao).toBe('100.00');
    expect(result.ajuste_e111_gerado).toBe('SP02CIAP');
    expect(inserted).toContainEqual(
      expect.objectContaining({
        registro: 'E111',
        codigoAjuste: 'SP02CIAP',
        indicador: 'CREDITO',
        valor: '100.00',
      }),
    );
  });

  it('R2.6: o E111 é regravado a partir da razão (soma das admitidas ativas), não do delta deste run', async () => {
    // Cenário incremental: a competência JÁ tem um bem apropriado (b1, admitida
    // 100,00) e um novo bem (b2, admitida 100,00) é apropriado NESTE run. O
    // crédito deste run é 100,00 (só b2), mas o E111 deve ser REGRAVADO com o
    // total da razão (b1 + b2 = 200,00), não com o delta de 100,00. Isso prova
    // que o ajuste deriva do estado da razão, não da parcela mutada no run.
    const inserted: Array<Record<string, unknown>> = [];
    const bens = [
      {
        id: 'b1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Maquina 1',
        dataEntrada: '2026-01-10',
        valorIcmsTotal: '4800.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 48,
        parcelasApropriadas: 9,
        saldoCredorRestante: '3900.00',
      },
      {
        id: 'b2',
        codigoBem: 'BEM-2',
        identificacaoBem: 'Maquina 2',
        dataEntrada: '2026-01-10',
        valorIcmsTotal: '4800.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 48,
        parcelasApropriadas: 0,
        saldoCredorRestante: '4800.00',
      },
    ];
    // b1 já consta na razão ativa da competência (no-op); só b2 é novo.
    // A razão da competência, após inserir b2, soma 100,00 (b1) + 100,00 (b2).
    const tx = createTxMock({
      bens,
      jaApropriadosNaCompetencia: [{ bemId: 'b1' }],
      razaoTotal: '200.00',
      inserted,
    });
    const db = createRootDbMock(tx);
    const service = new CiapService({ db } as never);

    const result = await service.apropriarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    // Apenas b2 foi apropriado neste run.
    expect(result.bens_apropriados).toBe(1);
    // O crédito deste run (delta) é a parcela de b2.
    expect(result.total_credito_apropriado).toBe('100.00');
    // Mas o E111 regravado reflete o TOTAL DA RAZÃO (b1 + b2), não o delta.
    expect(result.total_credito_razao).toBe('200.00');
    expect(result.ajuste_e111_gerado).toBe('SP02CIAP');
    const e111 = inserted.filter((v) => v.registro === 'E111');
    expect(e111).toHaveLength(1);
    expect(e111[0]).toEqual(
      expect.objectContaining({ indicador: 'CREDITO', valor: '200.00' }),
    );
    // Só b2 gerou nova apropriação versionada (b1 é no-op idempotente).
    const apropriacoes = inserted.filter((v) => 'numeroParcela' in v);
    expect(apropriacoes).toHaveLength(1);
    expect(apropriacoes[0]).toEqual(expect.objectContaining({ bemId: 'b2' }));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R2.6 — Código estadual de ajuste E111 validado por CATÁLOGO + VIGÊNCIA
  // (Fase 2 / tarefa 3.4). O código não é mais fabricado em código
  // (`${uf}02CIAP`); vem de `fiscal_catalogos_versoes`, validando que existe
  // para a UF e está vigente na competência. Sem código válido → inconsistência
  // clara, nunca um código fabricado.
  // ───────────────────────────────────────────────────────────────────────────
  describe('ajuste E111 do catálogo (3.4, R2.6)', () => {
    const bensPadrao = () => [
      {
        id: 'b1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Maquina',
        dataEntrada: '2026-01-10',
        valorIcmsTotal: '4800.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 48,
        parcelasApropriadas: 0,
        saldoCredorRestante: '4800.00',
      },
    ];

    it('usa o código ESTADUAL resolvido do catálogo (não o fabricado em código)', async () => {
      // O catálogo devolve um código oficial distinto do default histórico; o
      // E111 emitido deve ser EXATAMENTE o código catalogado, provando que a
      // fonte do código é o catálogo e não a montagem `${uf}02CIAP`.
      const inserted: Array<Record<string, unknown>> = [];
      const tx = createTxMock({
        bens: bensPadrao(),
        jaApropriadosNaCompetencia: [],
        razaoTotal: '100.00',
        codigoCatalogo: 'SP02AP01',
        inserted,
      });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      const result = await service.apropriarCompetencia({
        clienteId: 'c1',
        competencia: '2026-09',
      });

      expect(result.ajuste_e111_gerado).toBe('SP02AP01');
      const e111 = inserted.filter((v) => v.registro === 'E111');
      expect(e111).toHaveLength(1);
      expect(e111[0]).toEqual(
        expect.objectContaining({
          codigoAjuste: 'SP02AP01',
          indicador: 'CREDITO',
          valor: '100.00',
        }),
      );
    });

    it('BLOQUEIA a apropriação quando NÃO há código catalogado válido para a UF/competência', async () => {
      // Catálogo vazio (código não cadastrado ou fora de vigência): a geração
      // do ajuste é bloqueada com inconsistência clara — nunca emite código
      // fabricado só para passar no check (R2.6).
      const tx = createTxMock({
        bens: bensPadrao(),
        jaApropriadosNaCompetencia: [],
        razaoTotal: '100.00',
        codigoCatalogo: null,
      });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      await expect(
        service.apropriarCompetencia({
          clienteId: 'c1',
          competencia: '2026-09',
        }),
      ).rejects.toThrow(/c[óo]digo estadual de ajuste E111/i);
    });

    it('a mensagem de inconsistência cita a UF e a competência', async () => {
      const tx = createTxMock({
        bens: bensPadrao(),
        jaApropriadosNaCompetencia: [],
        razaoTotal: '100.00',
        codigoCatalogo: null,
      });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      // getUfCliente devolve 'SP' no createRootDbMock; a competência normalizada
      // é 2026-09-01. A mensagem deve nomear ambos para orientar o cadastro.
      await expect(
        service.apropriarCompetencia({
          clienteId: 'c1',
          competencia: '2026-09',
        }),
      ).rejects.toThrow(/SP.*2026-09-01|2026-09-01.*SP/s);
    });
  });

  it('R1.1/R1.4: 10 retries da mesma competência resultam em 1 apropriação com parcela de calendário', async () => {
    // Estado simulado de PERSISTÊNCIA: ciap_apropriacoes acumula a razão
    // versionada; o unique parcial (bem, competencia, ativa) garante que
    // reinserções da MESMA competência são no-op.
    const bem = {
      id: 'b1',
      codigoBem: 'BEM-1',
      identificacaoBem: 'Maquina',
      // Entrada em jan/2026; competência set/2026 => parcela de calendário 9.
      dataEntrada: '2026-01-10',
      valorIcmsTotal: '4800.00',
      valorIcmsFrete: '0',
      valorIcmsDifal: '0',
      quantidadeParcelas: 48,
      // Contador armazenado "sujo": irrelevante para o cálculo (a parcela vem
      // do calendário, não deste contador).
      parcelasApropriadas: 7,
      saldoCredorRestante: '4800.00',
    };
    const competenciaDate = '2026-09-01';
    const parcelaCalendario = 9; // meses de jan→set + 1
    // Razão versionada ATIVA já existente para o bem (fonte de idempotência).
    const apropriacoesAtivas: Array<{ bemId: string; competencia: string }> =
      [];

    // Saldo credor PERSISTIDO entre retries: o update grava um novo saldo, e o
    // próximo retry lê esse valor. Se cada retry consumisse a parcela, o saldo
    // sofreria drift (4800 -> 4700 -> 4600 ...). Com a guarda de idempotência,
    // apenas UMA apropriação deve decrementar o saldo em UMA parcela.
    const parcelaValor = 100; // 4800 / 48
    let saldoPersistido = 4800;

    let ultimaParcelaGravada: number | undefined;
    const apropriacoesInseridas: Array<Record<string, unknown>> = [];

    for (let tentativa = 0; tentativa < 10; tentativa += 1) {
      // Cada retry lê o estado persistido (saldo atual) do bem.
      bem.saldoCredorRestante = saldoPersistido.toFixed(2);
      const inserted: Array<Record<string, unknown>> = [];
      const updates: Array<Record<string, unknown>> = [];
      const jaNaCompetencia = apropriacoesAtivas.filter(
        (r) => r.competencia === competenciaDate,
      );

      const tx = createTxMock({
        bens: [bem],
        jaApropriadosNaCompetencia: jaNaCompetencia,
        inserted: inserted,
        updates: updates,
      });
      // Aplica o efeito do insert da apropriação versionada na razão simulada,
      // respeitando o unique parcial (no-op quando já existe linha ativa).
      tx.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation((v: Record<string, unknown>) => {
          inserted.push(v);
          // Linha de ciap_apropriacoes (tem numeroParcela/versao).
          if (
            v.bemId === 'b1' &&
            v.competencia === competenciaDate &&
            'numeroParcela' in v
          ) {
            apropriacoesInseridas.push(v);
            const exists = apropriacoesAtivas.some(
              (r) => r.bemId === 'b1' && r.competencia === competenciaDate,
            );
            // Unique parcial (bem, competencia, ativa): reinserção da MESMA
            // competência ativa é no-op; apenas a primeira efetiva.
            if (!exists) {
              apropriacoesAtivas.push({
                bemId: 'b1',
                competencia: competenciaDate,
              });
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

    // Após 10 retries, apenas 1 apropriação ativa foi registrada para o bem
    // (os demais retries são no-op por já constar linha ativa).
    expect(apropriacoesAtivas).toHaveLength(1);
    // Exatamente uma inserção da apropriação versionada foi efetivada.
    expect(apropriacoesInseridas).toHaveLength(1);
    // R1.4: a parcela gravada foi derivada do CALENDÁRIO (9), não de um
    // contador de chamadas nem de parcelasApropriadas + 1.
    expect(ultimaParcelaGravada).toBe(parcelaCalendario);
    expect(apropriacoesInseridas[0]).toEqual(
      expect.objectContaining({ numeroParcela: parcelaCalendario }),
    );
    // Sem drift de saldo: exatamente UMA parcela consumida ao longo dos 10
    // retries (4800 - 100 = 4700), não 10 parcelas (que dariam 3800).
    expect(saldoPersistido).toBe(4800 - parcelaValor);
  });

  it('R1.4: o número da parcela vem do calendário, não de bem.parcelasApropriadas + 1', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const bens = [
      {
        id: 'b1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Maquina',
        // Entrada em jun/2026; competência set/2026 => parcela de calendário 4.
        dataEntrada: '2026-06-15',
        valorIcmsTotal: '4800.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 48,
        // Contador armazenado divergente do calendário: +1 cego daria 41.
        parcelasApropriadas: 40,
        saldoCredorRestante: '1000.00',
      },
    ];
    const tx = createTxMock({
      bens,
      jaApropriadosNaCompetencia: [],
      razaoTotal: '100.00',
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
    // R1.4: derivado do calendário (jun→set = 3 meses + 1 = 4), NÃO 40 + 1 = 41.
    expect(bemUpdate?.parcelasApropriadas).toBe(4);
    // A apropriação versionada gravada carrega a parcela de calendário.
    expect(inserted).toContainEqual(
      expect.objectContaining({
        bemId: 'b1',
        competencia: '2026-09-01',
        numeroParcela: 4,
      }),
    );
  });

  it('R1.3: bem adquirido após o período NÃO é incluído em competência anterior à entrada', async () => {
    // A elegibilidade é por dataEntrada <= fim da competência (filtro no WHERE).
    // Em produção o próprio SELECT já exclui o bem futuro; aqui simulamos esse
    // filtro devolvendo lista vazia de bens elegíveis e provamos que nada é
    // apropriado (nenhuma parcela, nenhum ajuste E111).
    const inserted: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const tx = createTxMock({
      bens: [], // bem com dataEntrada futura não casa o filtro do WHERE
      jaApropriadosNaCompetencia: [],
      inserted,
      updates,
    });
    const db = createRootDbMock(tx);
    const service = new CiapService({ db } as never);

    const result = await service.apropriarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.bens_apropriados).toBe(0);
    expect(result.total_credito_apropriado).toBe('0.00');
    expect(result.ajuste_e111_gerado).toBeNull();
    expect(updates).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it('R1.4: bem além do cronograma de parcelas não é apropriado (parcela de calendário > quantidadeParcelas)', async () => {
    // Entrada em jan/2026, apenas 4 parcelas: a última parcela é abr/2026.
    // Em set/2026 a parcela de calendário seria 9 > 4 => fora do cronograma.
    const inserted: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const bens = [
      {
        id: 'b1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Maquina',
        dataEntrada: '2026-01-10',
        valorIcmsTotal: '400.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 4,
        parcelasApropriadas: 4,
        saldoCredorRestante: '0.00',
      },
    ];
    const tx = createTxMock({
      bens,
      jaApropriadosNaCompetencia: [],
      inserted,
      updates,
    });
    const db = createRootDbMock(tx);
    const service = new CiapService({ db } as never);

    const result = await service.apropriarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    // Nada apropriado: o cronograma de 4 parcelas já se esgotou em abr/2026.
    expect(result.bens_apropriados).toBe(0);
    expect(result.total_credito_apropriado).toBe('0.00');
    expect(updates).toHaveLength(0);
    expect(inserted).toHaveLength(0);
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
        // Entrada em jan/2026; competência set/2026 => parcela de calendário 9.
        dataEntrada: '2026-01-10',
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

      const tx = createTxMock({
        bens: [bem],
        jaApropriadosNaCompetencia: jaNaCompetencia,
        // Após a apropriação do bem (admitida 100,00), a razão da competência
        // soma 100,00 — e permanece 100,00 no run perdedor (idempotência). O
        // E111 é regravado a partir desse total em AMBAS as invocações.
        razaoTotal: '100.00',
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

      // Insert respeita o unique parcial da razão versionada (2ª apropriação
      // ativa do mesmo bem/competência = no-op). Apenas a linha de
      // ciap_apropriacoes (com numeroParcela) alimenta a razão compartilhada.
      tx.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation((v: Record<string, unknown>) => {
          if (v.registro === 'E111') {
            e111Inseridos.push(v);
          } else if (
            v.bemId === 'b1' &&
            v.competencia === competenciaDate &&
            'numeroParcela' in v
          ) {
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

    // R1.5/R2.6: o E111 é REGRAVADO A PARTIR DA RAZÃO em toda invocação (o
    // delete-then-insert deixa sempre UMA linha no banco). O que importa é que
    // TODA regravação carrega o total da razão (100,00) — nunca uma parcela
    // dobrada. Como as duas invocações regravam, há dois inserts, ambos com o
    // MESMO valor idempotente (não 200,00).
    expect(e111Inseridos.length).toBeGreaterThanOrEqual(1);
    for (const e111 of e111Inseridos) {
      expect(e111).toEqual(
        expect.objectContaining({
          registro: 'E111',
          codigoAjuste: 'SP02CIAP',
          indicador: 'CREDITO',
          valor: '100.00',
        }),
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Tarefa 2.5 — Suíte do motor idempotente/temporal (R1.1–R1.5).
  //
  // Consolida os quatro cenários de verificação do design (§Verificação) com
  // asserções explícitas. Três deles já têm cobertura dedicada acima e são
  // referenciados aqui para manter a suíte legível como um todo:
  //
  //   • R1.1 — 10 retries da mesma competência → EXATAMENTE 1 apropriação:
  //       "R1.1/R1.4: 10 retries da mesma competência resultam em 1 apropriação
  //        com parcela de calendário".
  //   • R1.2 — concorrência preserva o saldo (apenas 1 parcela consumida):
  //       "R2.2: chamadas concorrentes para o mesmo cliente/competência
  //        preservam o saldo (apenas 1 apropriação)".
  //   • R1.3 — bem com entrada futura fica FORA de competência anterior:
  //       "R1.3: bem adquirido após o período NÃO é incluído em competência
  //        anterior à entrada".
  //
  // O quarto cenário — R1.5, "repetir mês fechado devolve a MESMA versão" — é
  // coberto explicitamente abaixo: o foco é a IDENTIDADE DA VERSÃO (nenhuma v2
  // é criada no reprocesso), não apenas a ausência de nova parcela.
  // ---------------------------------------------------------------------------
  describe('motor idempotente/temporal — suíte 2.5 (R1.1–R1.5)', () => {
    it('R1.5: reprocessar um mês já apropriado devolve a MESMA versão (nenhuma v2 é criada)', async () => {
      // PERSISTÊNCIA simulada da razão versionada: a competência já foi fechada
      // com UMA apropriação ativa (versão 1). Reprocessá-la não pode criar uma
      // nova versão nem uma segunda parcela — deve devolver a mesma versão 1.
      const competenciaDate = '2026-09-01';
      const bem = {
        id: 'b1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Maquina',
        // Entrada jan/2026; competência set/2026 → parcela de calendário 9.
        dataEntrada: '2026-01-10',
        valorIcmsTotal: '4800.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 48,
        // Já apropriado na 1ª passagem (parcela de calendário 9).
        parcelasApropriadas: 9,
        saldoCredorRestante: '4700.00',
      };
      // Razão versionada ATIVA já existente para o bem/competência: versão 1.
      // É a FONTE da idempotência consultada por apropriarCompetencia.
      const razaoAtiva = [
        { bemId: 'b1', competencia: competenciaDate, versao: 1, ativa: true },
      ];

      const inserted: Array<Record<string, unknown>> = [];
      const updates: Array<Record<string, unknown>> = [];
      const tx = createTxMock({
        bens: [bem],
        // O bem JÁ consta como apropriado ativo nesta competência (no-op).
        jaApropriadosNaCompetencia: razaoAtiva.map((r) => ({ bemId: r.bemId })),
        // A razão da competência (soma das admitidas ativas) permanece 100,00:
        // o reprocesso regrava o E111 com o MESMO total, sem dobrar.
        razaoTotal: '100.00',
        inserted,
        updates,
      });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      const result = await service.apropriarCompetencia({
        clienteId: 'c1',
        competencia: '2026-09',
      });

      // Serializou pelo lock da competência (R1.2) mesmo no reprocesso.
      expectAdvisoryLockAcquired(tx.execute, 'c1', competenciaDate);

      // R1.5: nenhum bem reapropriado — a competência fechada é no-op.
      expect(result.bens_apropriados).toBe(0);
      expect(result.total_credito_apropriado).toBe('0.00');

      // R1.5 (IDENTIDADE DA VERSÃO): nenhuma linha nova de ciap_apropriacoes é
      // inserida — logo NÃO há v2. A versão ativa continua sendo a v1 original.
      const novasApropriacoes = inserted.filter((v) => 'numeroParcela' in v);
      expect(novasApropriacoes).toHaveLength(0);
      // Também não há criação de versão alguma (nenhum campo `versao` inserido).
      expect(inserted.filter((v) => 'versao' in v)).toHaveLength(0);
      // Nem marcador de competência duplicado (bemId sem numeroParcela).
      expect(
        inserted.filter((v) => 'bemId' in v && !('numeroParcela' in v)),
      ).toHaveLength(0);
      // Nenhum update de bem: saldo e contador de parcela ficam intactos.
      expect(updates.filter((u) => 'parcelasApropriadas' in u)).toHaveLength(0);

      // A versão ativa persistida permanece ÚNICA (v1) após o reprocesso.
      const ativas = razaoAtiva.filter((r) => r.ativa);
      expect(ativas).toHaveLength(1);
      expect(ativas[0].versao).toBe(1);

      // R1.5/R2.6: o E111 é REGRAVADO a partir da razão e reproduz o MESMO
      // valor da 1ª passagem (100,00) — reprocessar devolve o mesmo resultado.
      expect(result.total_credito_razao).toBe('100.00');
      expect(result.ajuste_e111_gerado).toBe('SP02CIAP');
      const e111 = inserted.filter((v) => v.registro === 'E111');
      expect(e111).toHaveLength(1);
      expect(e111[0]).toEqual(
        expect.objectContaining({
          registro: 'E111',
          codigoAjuste: 'SP02CIAP',
          indicador: 'CREDITO',
          valor: '100.00',
        }),
      );
    });

    it('R1.5: duas reexecuções consecutivas do mês fechado são estáveis (mesma versão, mesmo crédito)', async () => {
      // Reforça a estabilidade: repetir o reprocesso N vezes não cria versões
      // nem muda o crédito. Cada passagem lê a MESMA razão ativa (v1) e é no-op.
      const competenciaDate = '2026-09-01';
      const razaoAtiva = [
        { bemId: 'b1', competencia: competenciaDate, versao: 1, ativa: true },
      ];
      const bem = {
        id: 'b1',
        codigoBem: 'BEM-1',
        identificacaoBem: 'Maquina',
        dataEntrada: '2026-01-10',
        valorIcmsTotal: '4800.00',
        valorIcmsFrete: '0',
        valorIcmsDifal: '0',
        quantidadeParcelas: 48,
        parcelasApropriadas: 9,
        saldoCredorRestante: '4700.00',
      };

      const run = async () => {
        const inserted: Array<Record<string, unknown>> = [];
        const updates: Array<Record<string, unknown>> = [];
        const tx = createTxMock({
          bens: [bem],
          jaApropriadosNaCompetencia: razaoAtiva.map((r) => ({
            bemId: r.bemId,
          })),
          razaoTotal: '100.00',
          inserted,
          updates,
        });
        const db = createRootDbMock(tx);
        const service = new CiapService({ db } as never);
        const result = await service.apropriarCompetencia({
          clienteId: 'c1',
          competencia: '2026-09',
        });
        return { result, inserted, updates };
      };

      const primeira = await run();
      const segunda = await run();

      // Nenhuma passagem apropria de novo; o crédito da razão é idêntico.
      for (const passagem of [primeira, segunda]) {
        expect(passagem.result.bens_apropriados).toBe(0);
        expect(passagem.result.total_credito_apropriado).toBe('0.00');
        expect(passagem.result.total_credito_razao).toBe('100.00');
        // Nenhuma nova versão criada em passagem alguma.
        expect(
          passagem.inserted.filter((v) => 'numeroParcela' in v),
        ).toHaveLength(0);
        expect(
          passagem.updates.filter((u) => 'parcelasApropriadas' in u),
        ).toHaveLength(0);
      }

      // A razão permanece com UMA versão ativa (v1) após as duas passagens.
      expect(razaoAtiva.filter((r) => r.ativa)).toHaveLength(1);
      expect(razaoAtiva[0].versao).toBe(1);
    });
  });

  // Mock de transação para corrigirApropriacao (tarefa 2.3). Os selects dentro
  // da transação são consumidos, EM ORDEM:
  //   1) apropriação ATIVA corrente de (bem, competência) -> .where() (await)
  //   2) soma da razão (SUM parcelaAdmitida ativas) p/ regravar o E111 -> .where()
  // `insert` distingue a tabela pela forma dos valores: a linha de
  // ciap_movimentos termina em .returning() (devolve o id do movimento de
  // correção); as demais (ciap_apropriacoes nova versão, E111) resolvem direto.
  function createCorrecaoTxMock(opts: {
    ativas: unknown[];
    razaoTotal?: string;
    movimentoId?: string;
    // Código estadual de ajuste E111 resolvido do catálogo (R2.6). Default
    // 'SP02CIAP'; `null` simula código não cadastrado/vigente (bloqueio).
    codigoCatalogo?: string | null;
    inserted?: Array<Record<string, unknown>>;
    updates?: Array<Record<string, unknown>>;
  }) {
    const queue: unknown[][] = [
      opts.ativas,
      [{ total: opts.razaoTotal ?? '0' }],
    ];
    const nextResult = () => Promise.resolve(queue.shift() ?? []);
    const catalogoRows =
      opts.codigoCatalogo === null
        ? []
        : [{ codigo: opts.codigoCatalogo ?? 'SP02CIAP', fonte: 'teste' }];
    return {
      execute: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockImplementation(() => {
            // A fila só é consumida nos caminhos awaited (then/groupBy): ativas
            // e razão. O catálogo (orderBy().limit(), R2.6) não toca a fila.
            return {
              then: (
                onFulfilled: (v: unknown) => unknown,
                onRejected?: (e: unknown) => unknown,
              ) => nextResult().then(onFulfilled, onRejected),
              groupBy: jest.fn().mockImplementation(() => nextResult()),
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue(catalogoRows),
              }),
            };
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockImplementation((v: Record<string, unknown>) => {
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
          // ciap_movimentos: a inserção do movimento termina em .returning().
          return {
            returning: jest
              .fn()
              .mockResolvedValue([
                { id: opts.movimentoId ?? 'mov-correcao-1' },
              ]),
            then: (
              onFulfilled: (v: unknown) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) => Promise.resolve(undefined).then(onFulfilled, onRejected),
          };
        }),
      }),
    };
  }

  describe('corrigirApropriacao (2.3, R1.6/R1.7)', () => {
    const apropriacaoAtiva = (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      id: 'aprop-1',
      clienteId: 'c1',
      bemId: 'b1',
      competencia: '2026-09-01',
      versao: 1,
      ativa: true,
      numeroParcela: 9,
      baseControle: '4800.00',
      parcelaPassivel: '100.00',
      coeficiente: '1.0000',
      coeficienteFonte: 'saidas_tributadas',
      parcelaAdmitida: '100.00',
      parcelaVedada: '0.00',
      movimentoId: 'mov-aquisicao-1',
      ...overrides,
    });

    it('R1.6: cria nova versão ativa e desativa a anterior, sem sobrescrever', async () => {
      const inserted: Array<Record<string, unknown>> = [];
      const updates: Array<Record<string, unknown>> = [];
      // Corrige o coeficiente de 1.0 para 0.6: admitida 100,00 -> 60,00.
      const tx = createCorrecaoTxMock({
        ativas: [apropriacaoAtiva()],
        razaoTotal: '60.00',
        inserted,
        updates,
      });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      const result = await service.corrigirApropriacao({
        clienteId: 'c1',
        bemId: 'b1',
        competencia: '2026-09',
        coeficiente: '0.6000',
        coeficienteFonte: 'exportacao',
      });

      // Adquiriu o lock de idempotência da competência (R1.2).
      expectAdvisoryLockAcquired(tx.execute, 'c1', '2026-09-01');

      // R1.6: a versão anterior foi DESATIVADA (não apagada/sobrescrita).
      const desativacao = updates.find((u) => u.ativa === false);
      expect(desativacao).toBeDefined();

      // R1.6: nova versão ativa inserida (versao 2) com a admitida corrigida.
      const novaVersao = inserted.find((v) => 'numeroParcela' in v);
      expect(novaVersao).toEqual(
        expect.objectContaining({
          bemId: 'b1',
          competencia: '2026-09-01',
          versao: 2,
          ativa: true,
          numeroParcela: 9,
          // Base/passível preservados; só o rateio muda.
          parcelaPassivel: '100.00',
          coeficiente: '0.6000',
          coeficienteFonte: 'exportacao',
          parcelaAdmitida: '60.00',
          parcelaVedada: '40.00',
          // Vinculada ao movimento de correção gerado nesta transação.
          movimentoId: 'mov-correcao-1',
        }),
      );

      expect(result.versao_anterior).toBe(1);
      expect(result.versao_nova).toBe(2);
      expect(result.parcela_admitida_anterior).toBe('100.00');
      expect(result.parcela_admitida_corrigida).toBe('60.00');
      // Estorno do crédito: 60 - 100 = -40,00.
      expect(result.delta_credito).toBe('-40.00');
    });

    it('R1.6/R1.7: registra movimento tipo=correcao com movimentoAnteriorId e delta do crédito', async () => {
      const inserted: Array<Record<string, unknown>> = [];
      const tx = createCorrecaoTxMock({
        ativas: [apropriacaoAtiva({ movimentoId: 'mov-aquisicao-1' })],
        razaoTotal: '60.00',
        inserted,
      });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      await service.corrigirApropriacao({
        clienteId: 'c1',
        bemId: 'b1',
        competencia: '2026-09',
        coeficiente: '0.6000',
        coeficienteFonte: 'exportacao',
        motivo: 'Reclassificação de saída.',
      });

      // R1.6/R1.7: movimento de correção aponta para o fato substituído e o
      // valorIcmsPassivel é o DELTA do crédito admitido (-40,00 = estorno).
      const movimento = inserted.find((v) => v.tipo === 'correcao');
      expect(movimento).toEqual(
        expect.objectContaining({
          clienteId: 'c1',
          bemId: 'b1',
          tipo: 'correcao',
          movimentoAnteriorId: 'mov-aquisicao-1',
          valorIcmsPassivel: '-40.00',
          observacao: 'Reclassificação de saída.',
        }),
      );
    });

    it('R1.6: o E111 é regravado a partir da razão e reflete a nova versão ativa', async () => {
      const inserted: Array<Record<string, unknown>> = [];
      const tx = createCorrecaoTxMock({
        ativas: [apropriacaoAtiva()],
        // Após desativar a v1 (100,00) e ativar a v2 (60,00), a razão da
        // competência soma 60,00 — o E111 regravado reflete esse total.
        razaoTotal: '60.00',
        inserted,
      });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      const result = await service.corrigirApropriacao({
        clienteId: 'c1',
        bemId: 'b1',
        competencia: '2026-09',
        coeficiente: '0.6000',
        coeficienteFonte: 'exportacao',
      });

      expect(result.total_credito_razao).toBe('60.00');
      expect(result.ajuste_e111_gerado).toBe('SP02CIAP');
      const e111 = inserted.filter((v) => v.registro === 'E111');
      expect(e111).toHaveLength(1);
      expect(e111[0]).toEqual(
        expect.objectContaining({
          registro: 'E111',
          codigoAjuste: 'SP02CIAP',
          indicador: 'CREDITO',
          valor: '60.00',
        }),
      );
    });

    it('correção para coeficiente 0 zera o crédito e remove o E111 (razão zerada)', async () => {
      const inserted: Array<Record<string, unknown>> = [];
      const tx = createCorrecaoTxMock({
        ativas: [apropriacaoAtiva()],
        // Única apropriação da competência zerada -> razão soma 0 -> sem E111.
        razaoTotal: '0',
        inserted,
      });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      const result = await service.corrigirApropriacao({
        clienteId: 'c1',
        bemId: 'b1',
        competencia: '2026-09',
        coeficiente: '0',
        coeficienteFonte: 'sem_saidas',
      });

      expect(result.parcela_admitida_corrigida).toBe('0.00');
      expect(result.delta_credito).toBe('-100.00');
      expect(result.total_credito_razao).toBe('0.00');
      // Sem crédito a lançar: nenhum E111 reinserido (o delete fica sozinho).
      expect(result.ajuste_e111_gerado).toBeNull();
      expect(inserted.filter((v) => v.registro === 'E111')).toHaveLength(0);
    });

    it('rejeita correção quando não há apropriação ativa na competência', async () => {
      const tx = createCorrecaoTxMock({ ativas: [] });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      await expect(
        service.corrigirApropriacao({
          clienteId: 'c1',
          bemId: 'b1',
          competencia: '2026-09',
          coeficiente: '0.6000',
          coeficienteFonte: 'exportacao',
        }),
      ).rejects.toThrow(
        'Não há apropriação ativa para corrigir nesta competência.',
      );
    });

    it('rejeita coeficiente fora de [0, 1]', async () => {
      const tx = createCorrecaoTxMock({ ativas: [apropriacaoAtiva()] });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      await expect(
        service.corrigirApropriacao({
          clienteId: 'c1',
          bemId: 'b1',
          competencia: '2026-09',
          coeficiente: '1.5',
          coeficienteFonte: 'exportacao',
        }),
      ).rejects.toThrow('O coeficiente deve estar entre 0 e 1');
    });

    it('correção sem movimento de origem (apropriação legada): movimentoAnteriorId nulo', async () => {
      const inserted: Array<Record<string, unknown>> = [];
      const tx = createCorrecaoTxMock({
        ativas: [apropriacaoAtiva({ movimentoId: null })],
        razaoTotal: '60.00',
        inserted,
      });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      const result = await service.corrigirApropriacao({
        clienteId: 'c1',
        bemId: 'b1',
        competencia: '2026-09',
        coeficiente: '0.6000',
        coeficienteFonte: 'exportacao',
      });

      const movimento = inserted.find((v) => v.tipo === 'correcao');
      // Sem fato de origem a referenciar; o check chk_ciap_mov_correcao aceita
      // NULL para tipo=correcao.
      expect(movimento?.movimentoAnteriorId).toBeNull();
      expect(result.movimento_anterior_id).toBeNull();
    });
  });

  describe('baixarBem — baixa respeita a data do fato (2.4, R1.3/R1.7)', () => {
    // Mock de transação para baixarBem. O update().set().where().returning()
    // devolve a linha baixada (`bem`); os inserts (ciap_movimentos) são
    // capturados em `inserted`.
    function createBaixaTxMock(opts: {
      bem?: Record<string, unknown> | null;
      inserted?: Array<Record<string, unknown>>;
    }) {
      const row = opts.bem === undefined ? defaultBemRow() : opts.bem;
      const tx = {
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockImplementation((v: Record<string, unknown>) => ({
            where: jest.fn().mockReturnValue({
              returning: jest
                .fn()
                .mockResolvedValue(row ? [{ ...row, ...v }] : []),
            }),
          })),
        }),
        insert: jest.fn().mockReturnValue({
          values: jest.fn().mockImplementation((v: Record<string, unknown>) => {
            opts.inserted?.push(v);
            return Promise.resolve(undefined);
          }),
        }),
      };
      return tx;
    }

    function createBaixaDb(tx: unknown) {
      return {
        db: {
          transaction: jest
            .fn()
            .mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
        },
      };
    }

    it('R1.7: registra um fato ciap_movimentos tipo=baixa com a data do fato e o motivo', async () => {
      const inserted: Array<Record<string, unknown>> = [];
      const tx = createBaixaTxMock({
        bem: defaultBemRow({
          id: 'b1',
          saldoCredorRestante: '3900.00',
          status: 'ATIVO',
        }),
        inserted,
      });
      const service = new CiapService(createBaixaDb(tx) as never);

      const result = await service.baixarBem({
        clienteId: 'c1',
        bemId: 'b1',
        dataBaixa: '2026-05-31',
        motivoBaixa: '02',
      });

      // O bem é marcado BAIXADO com a data/motivo do fato.
      expect(result.status).toBe('BAIXADO');
      expect(result.data_baixa).toBe('2026-05-31');
      expect(result.motivo_baixa).toBe('02');

      // R1.7: o fato de baixa fica no histórico patrimonial, na DATA DO FATO,
      // com o motivo e o cancelamento residual (saldo credor restante como
      // valor negativo — saída da razão de saldo passível de controle).
      const movimento = inserted.find((v) => v.tipo === 'baixa');
      expect(movimento).toEqual(
        expect.objectContaining({
          clienteId: 'c1',
          bemId: 'b1',
          tipo: 'baixa',
          dataMovimento: '2026-05-31',
          motivoBaixa: '02',
          valorIcmsPassivel: '-3900.00',
        }),
      );
    });

    it('R1.7: cancelamento residual zero quando o bem já não tem saldo credor', async () => {
      const inserted: Array<Record<string, unknown>> = [];
      const tx = createBaixaTxMock({
        bem: defaultBemRow({ id: 'b1', saldoCredorRestante: '0.00' }),
        inserted,
      });
      const service = new CiapService(createBaixaDb(tx) as never);

      await service.baixarBem({
        clienteId: 'c1',
        bemId: 'b1',
        dataBaixa: '2026-05-31',
        motivoBaixa: '01',
      });

      const movimento = inserted.find((v) => v.tipo === 'baixa');
      expect(movimento?.valorIcmsPassivel).toBe('0.00');
    });

    it('R1.3/R1.7: bem baixado em mai/2026 NÃO é elegível em set/2026 (competência >= baixa)', async () => {
      // Em produção, o WHERE de apropriarCompetencia filtra por
      // (dataBaixa IS NULL OR dataBaixa > fim da competência). Um bem baixado
      // em 2026-05-31 não casa o filtro para set/2026 (fim 2026-09-30), então
      // o SELECT devolve lista vazia — nada é apropriado.
      const inserted: Array<Record<string, unknown>> = [];
      const updates: unknown[] = [];
      const tx = createTxMock({
        bens: [], // o bem baixado não casa o filtro de data do fato
        jaApropriadosNaCompetencia: [],
        inserted,
        updates,
      });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      const result = await service.apropriarCompetencia({
        clienteId: 'c1',
        competencia: '2026-09',
      });

      expect(result.bens_apropriados).toBe(0);
      expect(result.total_credito_apropriado).toBe('0.00');
      expect(updates).toHaveLength(0);
    });

    it('R1.7: reprocesso retroativo de competência ANTERIOR à baixa aproveita o bem e preserva o status BAIXADO', async () => {
      // Bem entrou em jan/2026 e foi baixado em mai/2026. Reprocessar fev/2026
      // (anterior à baixa) deve apropriar a parcela de calendário (fev = 2) e
      // NÃO sobrescrever o status BAIXADO do bem — a baixa é um fato posterior.
      const inserted: Array<Record<string, unknown>> = [];
      const updates: Array<Record<string, unknown>> = [];
      const bens = [
        {
          id: 'b1',
          codigoBem: 'BEM-1',
          identificacaoBem: 'Maquina',
          dataEntrada: '2026-01-10',
          valorIcmsTotal: '4800.00',
          valorIcmsFrete: '0',
          valorIcmsDifal: '0',
          quantidadeParcelas: 48,
          parcelasApropriadas: 1,
          saldoCredorRestante: '4700.00',
          // Já baixado (fato posterior a fev/2026). O WHERE da apropriação, em
          // produção, inclui o bem para competências anteriores à baixa.
          status: 'BAIXADO',
          dataBaixa: '2026-05-31',
        },
      ];
      const tx = createTxMock({
        bens,
        jaApropriadosNaCompetencia: [],
        razaoTotal: '100.00',
        inserted,
        updates,
      });
      const db = createRootDbMock(tx);
      const service = new CiapService({ db } as never);

      const result = await service.apropriarCompetencia({
        clienteId: 'c1',
        competencia: '2026-02',
      });

      // A competência anterior à baixa é apropriada normalmente.
      expect(result.bens_apropriados).toBe(1);
      // R1.4: parcela de calendário de fev/2026 = 2 (jan→fev + 1).
      expect(inserted).toContainEqual(
        expect.objectContaining({
          bemId: 'b1',
          competencia: '2026-02-01',
          numeroParcela: 2,
        }),
      );
      // R1.7: o status BAIXADO NÃO é sobrescrito pela apropriação retroativa.
      const bemUpdate = updates.find((u) => 'status' in u);
      expect(bemUpdate?.status).toBe('BAIXADO');
    });
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
      const insert = jest.fn();
      const tx = {
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({ returning }),
          }),
        }),
        insert,
      };
      const db = {
        db: {
          transaction: jest
            .fn()
            .mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
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
      // A tentativa foi feita, mas nenhuma linha do cliente foi afetada e
      // nenhum fato de baixa foi registrado (bem inexistente/alheio).
      expect(returning).toHaveBeenCalledTimes(1);
      expect(insert).not.toHaveBeenCalled();
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

  // DB falso para diagnosticarFichas (READ-ONLY). Os três selects são
  // distinguidos pela forma da seleção/encadeamento, na ordem em que o método
  // os executa:
  //   1) assertCliente        -> select({id}).from().where().limit()
  //   2) fichas CIAP          -> select().from().where().orderBy()
  //   3) itens de ativo (SKU) -> select({...codigoProduto}).from().innerJoin().where()
  function createDiagnosticoDb(opts: {
    cliente?: unknown[];
    fichas: unknown[];
    itens: unknown[];
  }) {
    const mutations: string[] = [];
    const guardMutation = (op: string) => () => {
      mutations.push(op);
      throw new Error(`diagnosticarFichas não deve ${op} (read-only)`);
    };
    return {
      mutations,
      db: {
        select: jest
          .fn()
          .mockImplementation((selection?: Record<string, unknown>) => {
            // assertCliente: seleção { id } -> termina em .limit()
            if (
              selection &&
              'id' in selection &&
              !('codigoProduto' in selection)
            ) {
              return {
                from: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue({
                    limit: jest
                      .fn()
                      .mockResolvedValue(opts.cliente ?? [{ id: 'c1' }]),
                  }),
                }),
              };
            }
            // itens de ativo: seleção com codigoProduto -> innerJoin().where()
            if (selection && 'codigoProduto' in selection) {
              return {
                from: jest.fn().mockReturnValue({
                  innerJoin: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue(opts.itens),
                  }),
                }),
              };
            }
            // fichas CIAP: select() sem seleção -> where().orderBy()
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue(opts.fichas),
                }),
              }),
            };
          }),
        insert: jest.fn().mockImplementation(guardMutation('insert')),
        update: jest.fn().mockImplementation(guardMutation('update')),
        delete: jest.fn().mockImplementation(guardMutation('delete')),
      },
    };
  }

  describe('diagnosticarFichas (read-only, R2.1/R2.5)', () => {
    it('R2.1: sinaliza SKU com mais de uma aquisição escriturada', async () => {
      // Uma ficha com codigoBem derivado do SKU "SKU-A"; o SKU aparece em duas
      // aquisições (itens de documentos distintos) -> identidade atual encobre
      // duas aquisições.
      const db = createDiagnosticoDb({
        fichas: [
          {
            id: 'bem-1',
            codigoBem: 'SKU-A',
            identificacaoBem: 'Torno',
            status: 'ATIVO',
            parcelasApropriadas: 3,
            dataBaixa: null,
            motivoBaixa: null,
          },
        ],
        itens: [
          {
            documentoFiscalItemId: 'it-1',
            codigoProduto: 'SKU-A',
            cfop: '1551',
          },
          {
            documentoFiscalItemId: 'it-2',
            codigoProduto: 'SKU-A',
            cfop: '2551',
          },
        ],
      });
      const service = new CiapService(db as never);

      const result = await service.diagnosticarFichas({ clienteId: 'c1' });

      expect(result.total_fichas).toBe(1);
      expect(result.skus_com_multiplas_aquisicoes).toBe(1);
      expect(result.fichas_sku_multiplas_aquisicoes).toEqual([
        {
          id: 'bem-1',
          codigo_bem: 'SKU-A',
          identificacao_bem: 'Torno',
          aquisicoes_escrituradas: 2,
          parcelas_apropriadas: 3,
        },
      ]);
      // READ-ONLY: nenhuma mutação foi tentada.
      expect(db.mutations).toEqual([]);
    });

    it('R2.5: lista fichas baixadas/concluídas como risco de reemissão', async () => {
      const db = createDiagnosticoDb({
        fichas: [
          {
            id: 'bem-baixado',
            codigoBem: 'SKU-B',
            identificacaoBem: 'Prensa',
            status: 'BAIXADO',
            parcelasApropriadas: 10,
            dataBaixa: '2026-05-31',
            motivoBaixa: '01',
          },
          {
            id: 'bem-ativo',
            codigoBem: 'SKU-C',
            identificacaoBem: 'Esteira',
            status: 'ATIVO',
            parcelasApropriadas: 1,
            dataBaixa: null,
            motivoBaixa: null,
          },
        ],
        itens: [],
      });
      const service = new CiapService(db as never);

      const result = await service.diagnosticarFichas({ clienteId: 'c1' });

      expect(result.fichas_baixadas_ou_concluidas).toBe(1);
      expect(result.fichas_risco_reemissao_apos_baixa).toEqual([
        {
          id: 'bem-baixado',
          codigo_bem: 'SKU-B',
          identificacao_bem: 'Prensa',
          status: 'BAIXADO',
          data_baixa: '2026-05-31',
          motivo_baixa: '01',
        },
      ]);
      expect(result.por_status).toEqual({ BAIXADO: 1, ATIVO: 1 });
      expect(db.mutations).toEqual([]);
    });

    it('base saudável: SKU único por aquisição e sem baixas → sem apontamentos', async () => {
      const db = createDiagnosticoDb({
        fichas: [
          {
            id: 'bem-1',
            codigoBem: 'SKU-X',
            identificacaoBem: 'Máquina',
            status: 'ATIVO',
            parcelasApropriadas: 0,
            dataBaixa: null,
            motivoBaixa: null,
          },
        ],
        itens: [
          {
            documentoFiscalItemId: 'it-1',
            codigoProduto: 'SKU-X',
            cfop: '1551',
          },
        ],
      });
      const service = new CiapService(db as never);

      const result = await service.diagnosticarFichas({ clienteId: 'c1' });

      expect(result.skus_com_multiplas_aquisicoes).toBe(0);
      expect(result.fichas_baixadas_ou_concluidas).toBe(0);
      expect(result.fichas_sku_multiplas_aquisicoes).toEqual([]);
      expect(result.fichas_risco_reemissao_apos_baixa).toEqual([]);
    });

    it('rejeita cliente inexistente', async () => {
      const db = createDiagnosticoDb({ cliente: [], fichas: [], itens: [] });
      const service = new CiapService(db as never);
      await expect(
        service.diagnosticarFichas({ clienteId: 'inexistente' }),
      ).rejects.toThrow('Empresa não encontrada.');
    });
  });

  // DB falso para migrarIdentidadePorAquisicao (Fase 2 / 1.4, R2.1/R2.2).
  // A rotina executa, em ordem:
  //   assertCliente        -> select({id}).from().where().limit()      (x2: migrar + diagnóstico)
  //   diagnóstico: fichas  -> select().from().where().orderBy()
  //   diagnóstico: itens   -> select({codigoProduto}).from().innerJoin().where()
  //   pendentes            -> select().from().where().orderBy()
  //   por ficha: update().set({...}).where()
  // Captura as cláusulas `set` dos updates para asserção.
  function createMigracaoDb(opts: {
    cliente?: unknown[];
    fichasDiagnostico: unknown[];
    itens: unknown[];
    fichasPendentes: unknown[];
  }) {
    const updates: Array<Record<string, unknown>> = [];
    // As fichas são lidas duas vezes com o mesmo encadeamento
    // (where().orderBy()): primeiro pelo diagnóstico, depois como pendentes.
    const fichasQueue = [opts.fichasDiagnostico, opts.fichasPendentes];
    return {
      updates,
      db: {
        select: jest
          .fn()
          .mockImplementation((selection?: Record<string, unknown>) => {
            if (
              selection &&
              'id' in selection &&
              !('codigoProduto' in selection)
            ) {
              // assertCliente
              return {
                from: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue({
                    limit: jest
                      .fn()
                      .mockResolvedValue(opts.cliente ?? [{ id: 'c1' }]),
                  }),
                }),
              };
            }
            if (selection && 'codigoProduto' in selection) {
              // itens de ativo (diagnóstico)
              return {
                from: jest.fn().mockReturnValue({
                  innerJoin: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue(opts.itens),
                  }),
                }),
              };
            }
            // fichas (diagnóstico) e, na 2ª vez, pendentes
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  orderBy: jest
                    .fn()
                    .mockImplementation(() =>
                      Promise.resolve(fichasQueue.shift() ?? []),
                    ),
                }),
              }),
            };
          }),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockImplementation((v: Record<string, unknown>) => {
            updates.push(v);
            return { where: jest.fn().mockResolvedValue(undefined) };
          }),
        }),
      },
    };
  }

  describe('migrarIdentidadePorAquisicao (1.4, R2.1/R2.2)', () => {
    it('R2.1: duas aquisições do mesmo SKU com lastro recebem chaves distintas (comprovadas)', async () => {
      // Duas fichas do mesmo SKU "SKU-A", cada uma com documento+item próprio.
      // A identidade por aquisição (documento:item) as separa em dois bens.
      const fichas = [
        {
          id: 'bem-1',
          codigoBem: 'SKU-A',
          identificacaoBem: 'Torno',
          status: 'ATIVO',
          parcelasApropriadas: 2,
          dataBaixa: null,
          motivoBaixa: null,
          documentoFiscalId: 'doc-1',
          documentoFiscalItemId: 'item-1',
        },
        {
          id: 'bem-2',
          codigoBem: 'SKU-A',
          identificacaoBem: 'Torno',
          status: 'ATIVO',
          parcelasApropriadas: 0,
          dataBaixa: null,
          motivoBaixa: null,
          documentoFiscalId: 'doc-2',
          documentoFiscalItemId: 'item-2',
        },
      ];
      const db = createMigracaoDb({
        fichasDiagnostico: fichas,
        // SKU-A aparece em duas aquisições escrituradas (saneamento pendente).
        itens: [
          {
            documentoFiscalItemId: 'item-1',
            codigoProduto: 'SKU-A',
            cfop: '1551',
          },
          {
            documentoFiscalItemId: 'item-2',
            codigoProduto: 'SKU-A',
            cfop: '1551',
          },
        ],
        fichasPendentes: fichas,
      });
      const service = new CiapService(db as never);

      const result = await service.migrarIdentidadePorAquisicao({
        clienteId: 'c1',
      });

      expect(result.fichas_migradas).toBe(2);
      expect(result.identidades_comprovadas).toBe(2);
      expect(result.identidades_reconstruidas_nao_comprovadas).toBe(0);
      // Ambas marcadas para saneamento (SKU com múltiplas aquisições).
      expect(result.fichas_marcadas_saneamento).toBe(2);

      // Chaves distintas por aquisição (documento:item) → duas identidades.
      expect(db.updates[0]).toEqual(
        expect.objectContaining({
          chaveAquisicao: 'doc-1:item-1',
          origemIdentidade: 'aquisicao',
          saneamentoPendente: true,
        }),
      );
      expect(db.updates[1]).toEqual(
        expect.objectContaining({
          chaveAquisicao: 'doc-2:item-2',
          origemIdentidade: 'aquisicao',
          saneamentoPendente: true,
        }),
      );
    });

    it('ficha legada sem item: identidade reconstruída (não comprovada) usa o próprio UUID', async () => {
      const fichas = [
        {
          id: 'bem-legado',
          codigoBem: 'SKU-X',
          identificacaoBem: 'Prensa',
          status: 'ATIVO',
          parcelasApropriadas: 5,
          dataBaixa: null,
          motivoBaixa: null,
          documentoFiscalId: null,
          documentoFiscalItemId: null,
        },
      ];
      const db = createMigracaoDb({
        fichasDiagnostico: fichas,
        itens: [],
        fichasPendentes: fichas,
      });
      const service = new CiapService(db as never);

      const result = await service.migrarIdentidadePorAquisicao({
        clienteId: 'c1',
      });

      expect(result.identidades_reconstruidas_nao_comprovadas).toBe(1);
      expect(result.identidades_comprovadas).toBe(0);
      expect(result.fichas_marcadas_saneamento).toBe(0);
      expect(db.updates[0]).toEqual(
        expect.objectContaining({
          chaveAquisicao: 'bem-legado',
          origemIdentidade: 'reconstruido_nao_comprovado',
          saneamentoPendente: false,
        }),
      );
      // Não inventa histórico: o update não mexe em parcelas/saldo/status.
      expect(db.updates[0]).not.toHaveProperty('parcelasApropriadas');
      expect(db.updates[0]).not.toHaveProperty('saldoCredorRestante');
      expect(db.updates[0]).not.toHaveProperty('status');
    });

    it('idempotente: sem fichas pendentes, nada é migrado', async () => {
      const db = createMigracaoDb({
        fichasDiagnostico: [],
        itens: [],
        fichasPendentes: [],
      });
      const service = new CiapService(db as never);

      const result = await service.migrarIdentidadePorAquisicao({
        clienteId: 'c1',
      });

      expect(result.fichas_migradas).toBe(0);
      expect(db.updates).toHaveLength(0);
      expect(db.db.update).not.toHaveBeenCalled();
    });

    it('rejeita cliente inexistente', async () => {
      const db = createMigracaoDb({
        cliente: [],
        fichasDiagnostico: [],
        itens: [],
        fichasPendentes: [],
      });
      const service = new CiapService(db as never);
      await expect(
        service.migrarIdentidadePorAquisicao({ clienteId: 'inexistente' }),
      ).rejects.toThrow('Empresa não encontrada.');
    });
  });

  // ===========================================================================
  // Tarefa 3.5 — Suíte do coeficiente por cenário (R2.1, R2.3, R2.4).
  //
  // Consolida, com asserções EXPLÍCITAS, os três cenários de verificação do
  // design (§Verificação: "dois SKUs iguais = dois bens; exportação com
  // coeficiente fundamentado; sem saídas com regra explícita"):
  //
  //   • R2.1 — duas aquisições do MESMO SKU ⇒ DUAS identidades patrimoniais
  //       distintas (identidade por aquisição, não por SKU). Cobre o ângulo
  //       de REGISTRO (registrarBem) — complementar ao diagnóstico/migração já
  //       exercitados em "diagnosticarFichas"/"migrarIdentidadePorAquisicao".
  //   • R2.3 — vendas de EXPORTAÇÃO produzem coeficiente FUNDAMENTADO (a
  //       exportação entra no numerador), exercitando calcularCoeficiente.
  //   • R2.4 — "sem saídas" aplica a regra EXPLÍCITA (coeficiente 0.0000,
  //       sinalizado), nunca o 1.0000 silencioso.
  // ===========================================================================
  describe('coeficiente por cenário — suíte 3.5 (R2.1, R2.3, R2.4)', () => {
    // DB falso para registrarBem que devolve a linha inserida refletindo os
    // VALORES realmente passados ao insert (codigoBem, documento, item, data),
    // atribuindo um id de bem distinto a cada chamada. Isso permite provar que
    // duas aquisições do mesmo SKU geram DUAS identidades patrimoniais, cada
    // uma com seu próprio id e sua própria aquisição (documento:item).
    function createRegistroIdentidadeDb() {
      let seq = 0;
      const inseridos: Array<Record<string, unknown>> = [];
      return {
        inseridos,
        db: {
          // Documento e item do próprio cliente sempre existem e são coerentes
          // (a propriedade cliente↔documento já é coberta em registrarBem/R6.2).
          select: jest.fn().mockImplementation(() => ({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockImplementation(() =>
                  // Devolve tanto a linha de documento quanto a de item; a de
                  // item carrega o documentoFiscalId coerente consultado.
                  Promise.resolve([
                    { id: 'doc', documentoFiscalId: 'doc' },
                  ]),
                ),
              }),
            }),
          })),
          insert: jest.fn().mockReturnValue({
            values: jest
              .fn()
              .mockImplementation((v: Record<string, unknown>) => {
                seq += 1;
                const id = `bem-${seq}`;
                inseridos.push({ id, ...v });
                return {
                  onConflictDoUpdate: jest.fn().mockReturnValue({
                    returning: jest.fn().mockResolvedValue([
                      defaultBemRow({
                        id,
                        codigoBem: v.codigoBem,
                        documentoFiscalId: v.documentoFiscalId ?? null,
                        documentoFiscalItemId: v.documentoFiscalItemId ?? null,
                        dataEntrada: v.dataEntrada,
                        valorIcmsTotal: v.valorIcmsTotal,
                      }),
                    ]),
                  }),
                };
              }),
          }),
        },
      };
    }

    it('R2.1: duas aquisições do MESMO SKU geram DOIS bens (identidades patrimoniais distintas)', async () => {
      // Mesmo código de produto (SKU-A), porém duas aquisições reais com
      // documento+item próprios. Cada registro deve resultar num bem distinto
      // — o SKU NÃO funde as duas aquisições numa só ficha.
      const database = createRegistroIdentidadeDb();
      const service = new CiapService(database as never);

      const bem1 = await service.registrarBem({
        clienteId: 'c1',
        documentoFiscalId: 'doc',
        documentoFiscalItemId: 'item-1',
        codigoBem: 'SKU-A',
        identificacaoBem: 'Torno',
        dataEntrada: '2026-01-10',
        valorIcmsTotal: '4800.00',
      });
      const bem2 = await service.registrarBem({
        clienteId: 'c1',
        documentoFiscalId: 'doc',
        documentoFiscalItemId: 'item-2',
        codigoBem: 'SKU-A',
        identificacaoBem: 'Torno',
        dataEntrada: '2026-03-20',
        valorIcmsTotal: '4800.00',
      });

      // Mesmo SKU em ambos os bens...
      expect(bem1.codigo_bem).toBe('SKU-A');
      expect(bem2.codigo_bem).toBe('SKU-A');
      // ...mas DUAS identidades patrimoniais distintas (ids diferentes).
      expect(bem1.id).not.toBe(bem2.id);
      // Cada bem conserva sua própria aquisição (item distinto do documento).
      expect(bem1.documento_fiscal_item_id).toBe('item-1');
      expect(bem2.documento_fiscal_item_id).toBe('item-2');
      // Dois inserts efetivados — nenhuma fusão por SKU.
      expect(database.inseridos).toHaveLength(2);
      expect(database.db.insert).toHaveBeenCalledTimes(2);
    });

    it('R2.3: exportação produz coeficiente FUNDAMENTADO (entra no numerador)', async () => {
      // 6.000 tributadas + 2.000 de exportação (CFOP 7xxx, sem ICMS destacado)
      // sobre total 10.000 ⇒ numerador 8.000 ⇒ coeficiente 0,8000. Sem o
      // tratamento da exportação a regra antiga daria 0,6000 (excluiria a
      // exportação), o que seria um coeficiente SEM fundamento legal.
      const service = new CiapService(
        createCoeficienteDb({
          total_saidas: '10000.00',
          saidas_tributadas: '6000.00',
          exportacoes: '2000.00',
        }) as never,
      );
      const r = await service.calcularCoeficiente(cenario);

      // A exportação é fundamentada no numerador (R2.3), não presumida pelo
      // mero ICMS destacado > 0.
      expect(r.componentes.exportacoes).toBe('2000.00');
      expect(r.numerador).toBe('8000.00');
      expect(r.denominador).toBe('10000.00');
      expect(r.coeficiente).toBe('0.8000');
      expect(r.fonte).toBe('saidas_tributadas');
      expect(r.sem_saidas).toBe(false);
    });

    it('R2.4: sem saídas aplica a regra EXPLÍCITA (coeficiente 0.0000, sinalizado)', async () => {
      // Período sem saídas: NÃO presume 1.0000 silencioso; aplica a regra
      // explícita (coeficiente 0.0000) e sinaliza o caso para o chamador.
      const service = new CiapService(
        createCoeficienteDb({
          total_saidas: '0',
          saidas_tributadas: '0',
        }) as never,
      );
      const r = await service.calcularCoeficiente(cenario);

      expect(r.coeficiente).toBe('0.0000');
      // Regra explícita e sinalizada: fonte dedicada + flag sem_saidas.
      expect(r.fonte).toBe('sem_saidas');
      expect(r.sem_saidas).toBe(true);
      // Jamais o 1.0000 silencioso.
      expect(r.coeficiente).not.toBe('1.0000');
    });
  });
});
