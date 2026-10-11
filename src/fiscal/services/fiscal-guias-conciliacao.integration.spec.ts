import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import {
  clientes,
  fiscalApuracoesGuias,
  fiscalPagamentosEventos,
} from '../../database/schema';
import {
  FiscalGuiasService,
  type CriarGuiaInput,
} from './fiscal-guias.service';

/**
 * Testes de integração (nível de serviço) do grupo 1 da Fase 5 — guias
 * conciliadas com histórico (R1.2–R1.6). Esta é a tarefa de teste CONSOLIDADA do
 * grupo: enquanto 1.1–1.6 cobriram cada regra isoladamente (com DB falso por
 * método), aqui os dois cenários nomeados pelo plano são exercidos
 * END-TO-END contra o serviço real, atravessando `criarGuia`,
 * `registrarEventoPagamento`, `trilhaPagamentos`, `marcarPagamento` e
 * `cancelarGuia` sobre um ÚNICO estado compartilhado:
 *
 *  1) "guia duplicada por retry não duplica" — um retry que carrega a MESMA
 *     idempotency key não cria uma segunda guia, enquanto duas obrigações
 *     legítimas (chaves distintas, mesmo tributo/período/UF) ambas persistem.
 *  2) "pagamento parcial/cancelado preserva histórico" — pagamento parcial +
 *     estorno mantêm a trilha e o saldo é reconstruído corretamente; o
 *     cancelamento LÓGICO preserva a linha e sua trilha (nunca delete físico).
 *
 * O projeto `api` não tem harness de banco vivo (ver
 * `fiscal-item-reconciliation.integration.spec.ts`); seguimos o MESMO padrão:
 * um STORE EM MEMÓRIA E COM ESTADO que modela as três tabelas tocadas
 * (`clientes`, `fiscal_apuracoes_guias`, `fiscal_pagamentos_eventos`) com a
 * mesma superfície drizzle usada pelo serviço — `select().from().where()
 * .limit()/.orderBy()`, `insert().values().returning()`,
 * `update().set().where().returning()`.
 *
 * Dois invariantes duros desta fase são fiados ao próprio store, não a
 * asserções frágeis:
 *  - `delete()` SEMPRE lança: exclusão física é proibida (R1.4). Se o serviço
 *    jamais tentar deletar fisicamente, o teste cai na hora.
 *  - o store aplica o ÍNDICE ÚNICO PARCIAL `(cliente_id, idempotency_key)` do
 *    banco (migração 0024): um segundo insert com a mesma chave rejeita com
 *    SQLSTATE 23505 — a MESMA condição de corrida que o serviço resolve relendo.
 */

const dialect = new PgDialect();

/** Valores (parâmetros) de uma condição drizzle `where(...)`, na ordem. */
function paramsDaCondicao(condition: unknown): unknown[] {
  const rendered = dialect.sqlToQuery(condition as SQL);
  return rendered.params;
}

interface GuiaRow {
  id: string;
  clienteId: string;
  competencia: string;
  tributo: string;
  ufFavorecida: string;
  tipoGuia: string;
  codigoReceita: string;
  dataVencimento: string;
  valorPrincipal: string;
  valorMulta: string;
  valorJuros: string;
  valorTotal: string;
  codigoBarras: string | null;
  linhaDigitavel: string | null;
  statusPagamento: string;
  arquivoGuiaKey: string | null;
  origem: string;
  fechamentoId: string | null;
  divergenteObrigacao: boolean;
  valorObrigacao: string | null;
  cancelada: boolean;
  canceladaEm: Date | null;
  motivoCancelamento: string | null;
  emitidaOrgao: boolean;
  emitidaOrgaoEm: Date | null;
  idempotencyKey: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

interface EventoRow {
  id: string;
  clienteId: string;
  guiaId: string;
  fechamentoId: string | null;
  tipo: string;
  origem: string;
  valor: string;
  sinal: number;
  dataEvento: string;
  comprovanteKey: string | null;
  declaracaoManual: boolean;
  documentoExterno: string | null;
  eventoEstornadoId: string | null;
  observacao: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

/**
 * Store com estado que modela `clientes`, `fiscal_apuracoes_guias` e
 * `fiscal_pagamentos_eventos`. O despacho por tabela usa a IDENTIDADE do objeto
 * drizzle que o serviço passa a `.from()`/`.insert()`/`.update()` — o mesmo
 * objeto importado do schema. O casamento de linhas num `.where(...)` usa os
 * PARÂMETROS renderizados da condição: uma linha casa quando TODOS os parâmetros
 * da condição aparecem como valores de colunas da linha (fiel às condições reais
 * `and(eq(id,…), eq(clienteId,…))`, `eq(guiaId,…)` etc., sem acoplar à ordem).
 */
function criarStore(seed: { clienteId: string }) {
  const guias: GuiaRow[] = [];
  const eventos: EventoRow[] = [];
  const clienteIds = new Set([seed.clienteId]);
  let proximaGuia = 1;
  let proximoEvento = 1;
  let deleteChamado = false;

  // Valores "escaláveis" de uma linha de guia que participam de um WHERE.
  function valoresGuia(row: GuiaRow): unknown[] {
    return [row.id, row.clienteId, row.idempotencyKey];
  }
  function valoresEvento(row: EventoRow): unknown[] {
    return [row.id, row.guiaId, row.clienteId, row.eventoEstornadoId];
  }

  function casa(valores: unknown[], params: unknown[]): boolean {
    // Casa quando todo parâmetro não-nulo da condição está entre os valores da
    // linha. Parâmetros nulos (ex.: chave ausente) nunca casam — espelha o
    // `IS NOT NULL` do índice parcial e o comportamento de `eq` com NULL.
    return params.every((p) => p != null && valores.some((v) => v === p));
  }

  function selectFrom(table: unknown) {
    const isGuias = table === fiscalApuracoesGuias;
    const isEventos = table === fiscalPagamentosEventos;
    const isClientes = table === clientes;
    return {
      where: (condition: unknown) => {
        const params = paramsDaCondicao(condition);
        if (isClientes) {
          const ok = params.some((p) => clienteIds.has(p as string));
          const rows = ok ? [{ id: seed.clienteId }] : [];
          return finalizarSelect(rows);
        }
        if (isGuias) {
          const rows = guias.filter((g) => casa(valoresGuia(g), params));
          return finalizarSelect(rows);
        }
        if (isEventos) {
          const rows = eventos.filter((e) => casa(valoresEvento(e), params));
          return finalizarSelect(rows);
        }
        throw new Error('tabela não modelada no select');
      },
    };
  }

  // Um select pode terminar em `.limit(n)` (carga pontual) ou `.orderBy(...)`
  // (trilha). Ambos resolvem a mesma lista; a ordenação real por data/criadoEm
  // é preservada ao inserir em ordem cronológica nos testes.
  function finalizarSelect(rows: unknown[]) {
    return {
      limit: () => Promise.resolve(rows.slice()),
      orderBy: () => Promise.resolve(rows.slice()),
    };
  }

  const db = {
    select: () => ({ from: (table: unknown) => selectFrom(table) }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => ({
        returning: () => {
          if (table === fiscalApuracoesGuias) {
            const key = (vals.idempotencyKey as string | null) ?? null;
            // ÍNDICE ÚNICO PARCIAL (cliente_id, idempotency_key) WHERE key IS NOT
            // NULL: um segundo insert com a mesma chave colide (23505).
            if (
              key != null &&
              guias.some(
                (g) =>
                  g.clienteId === vals.clienteId && g.idempotencyKey === key,
              )
            ) {
              return Promise.reject({ code: '23505' });
            }
            const row = novaGuia(vals);
            guias.push(row);
            return Promise.resolve([row]);
          }
          if (table === fiscalPagamentosEventos) {
            const row = novoEvento(vals);
            eventos.push(row);
            return Promise.resolve([row]);
          }
          throw new Error('tabela não modelada no insert');
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (condition: unknown) => ({
          returning: () => {
            const params = paramsDaCondicao(condition);
            if (table === fiscalApuracoesGuias) {
              const row = guias.find((g) => casa(valoresGuia(g), params));
              if (!row) return Promise.resolve([]);
              Object.assign(row, patch);
              return Promise.resolve([row]);
            }
            throw new Error('tabela não modelada no update');
          },
        }),
      }),
    }),
    // Invariante duro R1.4: exclusão física é proibida no caminho de guias.
    delete: () => {
      deleteChamado = true;
      throw new Error(
        'delete físico proibido (R1.4): guias/eventos são cancelados ' +
          'logicamente e preservados, nunca deletados',
      );
    },
  };

  function novaGuia(vals: Record<string, unknown>): GuiaRow {
    const agora = new Date('2026-09-01T00:00:00Z');
    return {
      id: `guia-${proximaGuia++}`,
      clienteId: vals.clienteId as string,
      competencia: vals.competencia as string,
      tributo: vals.tributo as string,
      ufFavorecida: vals.ufFavorecida as string,
      tipoGuia: vals.tipoGuia as string,
      codigoReceita: vals.codigoReceita as string,
      dataVencimento: vals.dataVencimento as string,
      valorPrincipal: vals.valorPrincipal as string,
      valorMulta: (vals.valorMulta as string) ?? '0',
      valorJuros: (vals.valorJuros as string) ?? '0',
      valorTotal: vals.valorTotal as string,
      codigoBarras: null,
      linhaDigitavel: null,
      statusPagamento: (vals.statusPagamento as string) ?? 'PENDENTE',
      arquivoGuiaKey: null,
      origem: (vals.origem as string) ?? 'MANUAL',
      fechamentoId: (vals.fechamentoId as string | null) ?? null,
      divergenteObrigacao: (vals.divergenteObrigacao as boolean) ?? false,
      valorObrigacao: (vals.valorObrigacao as string | null) ?? null,
      cancelada: false,
      canceladaEm: null,
      motivoCancelamento: null,
      emitidaOrgao: false,
      emitidaOrgaoEm: null,
      idempotencyKey: (vals.idempotencyKey as string | null) ?? null,
      criadoEm: agora,
      atualizadoEm: agora,
    };
  }

  function novoEvento(vals: Record<string, unknown>): EventoRow {
    const agora = new Date('2026-09-10T00:00:00Z');
    return {
      id: `ev-${proximoEvento++}`,
      clienteId: vals.clienteId as string,
      guiaId: vals.guiaId as string,
      fechamentoId: (vals.fechamentoId as string | null) ?? null,
      tipo: vals.tipo as string,
      origem: (vals.origem as string) ?? 'MANUAL',
      valor: vals.valor as string,
      sinal: vals.sinal as number,
      dataEvento: vals.dataEvento as string,
      comprovanteKey: (vals.comprovanteKey as string | null) ?? null,
      declaracaoManual: (vals.declaracaoManual as boolean) ?? false,
      documentoExterno: (vals.documentoExterno as string | null) ?? null,
      eventoEstornadoId: (vals.eventoEstornadoId as string | null) ?? null,
      observacao: (vals.observacao as string | null) ?? null,
      criadoEm: agora,
      atualizadoEm: agora,
    };
  }

  return {
    service: new FiscalGuiasService({ db } as never),
    guias,
    eventos,
    get deleteChamado() {
      return deleteChamado;
    },
  };
}

const CLIENTE = '11111111-1111-1111-1111-111111111111';

function baseInput(overrides: Partial<CriarGuiaInput> = {}): CriarGuiaInput {
  return {
    clienteId: CLIENTE,
    competencia: '2026-08',
    tributo: 'ICMS_PROPRIO',
    ufFavorecida: 'SP',
    tipoGuia: 'DAE',
    codigoReceita: '046',
    dataVencimento: '2026-09-10',
    valorPrincipal: '100.00',
    ...overrides,
  };
}

describe('Fase 5 · grupo 1 — guia duplicada por retry não duplica (R1.6, integração)', () => {
  it('o RETRY sequencial com a mesma chave retorna a mesma guia e NÃO cria uma segunda linha', async () => {
    const store = criarStore({ clienteId: CLIENTE });

    const primeira = await store.service.criarGuia(
      baseInput({ idempotencyKey: 'req-retry' }),
    );
    // Mesmo request reenviado (retry): mesma chave de idempotência.
    const segunda = await store.service.criarGuia(
      baseInput({ idempotencyKey: 'req-retry' }),
    );

    // Deduplicação: a segunda chamada devolve a guia já criada, não uma nova.
    expect(segunda.id).toBe(primeira.id);
    // Uma ÚNICA linha persistida de fato (retry não duplicou).
    expect(store.guias).toHaveLength(1);
    expect(store.guias[0].idempotencyKey).toBe('req-retry');
    expect(store.deleteChamado).toBe(false);
  });

  it('a CORRIDA (ambas escapam ao lookup) colide no índice único e o serviço resolve sem duplicar', async () => {
    // Modela duas requisições simultâneas com a MESMA chave: emitimos os dois
    // criarGuia em paralelo. Uma vence o insert; a outra bate no índice único
    // parcial do store (23505) e o serviço relê, devolvendo a vencedora. Em
    // nenhum caso há duas linhas.
    const store = criarStore({ clienteId: CLIENTE });
    const [a, b] = await Promise.all([
      store.service.criarGuia(baseInput({ idempotencyKey: 'req-corrida' })),
      store.service.criarGuia(baseInput({ idempotencyKey: 'req-corrida' })),
    ]);

    expect(a.id).toBe(b.id);
    expect(store.guias).toHaveLength(1);
    expect(store.guias[0].idempotencyKey).toBe('req-corrida');
    expect(store.deleteChamado).toBe(false);
  });

  it('DUAS obrigações legítimas do mesmo tributo/período/UF (chaves distintas) coexistem', async () => {
    // A chave é a fronteira de dedupe, NÃO uma unicidade por tributo/período/UF:
    // duas guias legítimas do mesmo (tributo, competência, UF) com chaves
    // distintas devem ambas persistir.
    const store = criarStore({ clienteId: CLIENTE });
    const base = baseInput({
      tributo: 'ICMS_PROPRIO',
      competencia: '2026-08',
      ufFavorecida: 'SP',
    });

    const guiaA = await store.service.criarGuia({
      ...base,
      idempotencyKey: 'req-A',
    });
    const guiaB = await store.service.criarGuia({
      ...base,
      idempotencyKey: 'req-B',
    });

    expect(guiaA.id).not.toBe(guiaB.id);
    expect(store.guias).toHaveLength(2);
    expect(store.guias.map((g) => g.idempotencyKey).sort()).toEqual([
      'req-A',
      'req-B',
    ]);
    expect(store.deleteChamado).toBe(false);
  });

  it('obrigações legítimas SEM chave também coexistem (nenhuma participa do índice único)', async () => {
    const store = criarStore({ clienteId: CLIENTE });
    await store.service.criarGuia(baseInput());
    await store.service.criarGuia(baseInput());
    // Sem chave, nenhuma entra no índice único parcial: ambas persistem.
    expect(store.guias).toHaveLength(2);
    expect(store.guias.every((g) => g.idempotencyKey === null)).toBe(true);
  });
});

describe('Fase 5 · grupo 1 — pagamento parcial/cancelado preserva histórico (R1.2–R1.5, integração)', () => {
  it('pagamento parcial + estorno mantêm a trilha e o saldo é reconstruído corretamente', async () => {
    const store = criarStore({ clienteId: CLIENTE });

    // Guia de 100,00 (manual).
    const guia = await store.service.criarGuia(
      baseInput({ valorPrincipal: '100.00' }),
    );

    // Pagamento parcial de 70,00 (com comprovante — R1.5).
    const parcial = await store.service.registrarEventoPagamento({
      clienteId: CLIENTE,
      guiaId: guia.id,
      tipo: 'PAGAMENTO_PARCIAL',
      valor: '70.00',
      dataEvento: '2026-09-10',
      comprovanteKey: 'comprovantes/parcial.pdf',
    });

    // Estorno de 30,00 referenciando o parcial (par original/reversão — R1.3).
    await store.service.registrarEventoPagamento({
      clienteId: CLIENTE,
      guiaId: guia.id,
      tipo: 'ESTORNO',
      valor: '30.00',
      dataEvento: '2026-09-11',
      eventoEstornadoId: parcial.id,
    });

    const trilha = await store.service.trilhaPagamentos({
      clienteId: CLIENTE,
      guiaId: guia.id,
    });

    // Saldo = 100 − (70 − 30) = 60,00; nada sobrescrito, dois eventos preservados.
    expect(trilha.saldo.valorTotal).toBe('100.00');
    expect(trilha.saldo.totalPago).toBe('40.00');
    expect(trilha.saldo.saldo).toBe('60.00');
    expect(trilha.saldo.quitada).toBe(false);
    expect(trilha.eventos).toHaveLength(2);
    // A trilha preserva AMBOS os eventos (parcial e estorno), em ordem.
    expect(trilha.eventos.map((e) => e.tipo)).toEqual([
      'PAGAMENTO_PARCIAL',
      'ESTORNO',
    ]);
    // Nenhum delete físico em nenhum ponto do fluxo.
    expect(store.deleteChamado).toBe(false);
    expect(store.eventos).toHaveLength(2);
  });

  it('"PAGO" exige a trilha quitada: bloqueia com saldo em aberto, permite depois de quitar', async () => {
    const store = criarStore({ clienteId: CLIENTE });
    const guia = await store.service.criarGuia(
      baseInput({ valorPrincipal: '100.00' }),
    );

    // Só um parcial de 40,00: saldo 60,00 em aberto → marcar PAGO é bloqueado.
    await store.service.registrarEventoPagamento({
      clienteId: CLIENTE,
      guiaId: guia.id,
      tipo: 'PAGAMENTO_PARCIAL',
      valor: '40.00',
      dataEvento: '2026-09-10',
      comprovanteKey: 'comprovantes/p1.pdf',
    });
    await expect(
      store.service.marcarPagamento({
        clienteId: CLIENTE,
        guiaId: guia.id,
        statusPagamento: 'PAGO',
      }),
    ).rejects.toThrow('saldo quitado');

    // Quita o restante (60,00): agora a trilha respalda PAGO.
    await store.service.registrarEventoPagamento({
      clienteId: CLIENTE,
      guiaId: guia.id,
      tipo: 'PAGAMENTO_PARCIAL',
      valor: '60.00',
      dataEvento: '2026-09-12',
      comprovanteKey: 'comprovantes/p2.pdf',
    });
    const paga = await store.service.marcarPagamento({
      clienteId: CLIENTE,
      guiaId: guia.id,
      statusPagamento: 'PAGO',
    });
    expect(paga.status_pagamento).toBe('PAGO');
    // Os dois pagamentos permanecem na trilha (histórico íntegro).
    expect(store.eventos).toHaveLength(2);
    expect(store.deleteChamado).toBe(false);
  });

  it('cancelamento LÓGICO preserva a linha e toda a trilha (nunca delete físico, R1.4)', async () => {
    const store = criarStore({ clienteId: CLIENTE });
    const guia = await store.service.criarGuia(
      baseInput({ valorPrincipal: '100.00' }),
    );

    // Trilha com um pagamento parcial antes do cancelamento.
    await store.service.registrarEventoPagamento({
      clienteId: CLIENTE,
      guiaId: guia.id,
      tipo: 'PAGAMENTO_PARCIAL',
      valor: '40.00',
      dataEvento: '2026-09-10',
      comprovanteKey: 'comprovantes/p1.pdf',
    });

    const cancelada = await store.service.cancelarGuia({
      clienteId: CLIENTE,
      guiaId: guia.id,
      motivo: 'duplicada',
    });

    // Cancelamento é um UPDATE lógico: a linha permanece, marcada.
    expect(cancelada.cancelada).toBe(true);
    expect(cancelada.motivo_cancelamento).toBe('duplicada');
    expect(store.guias).toHaveLength(1);
    expect(store.guias[0].cancelada).toBe(true);
    // Jamais um delete físico (invariante duro do store).
    expect(store.deleteChamado).toBe(false);

    // Histórico preservado: a trilha do evento continua recuperável e o saldo
    // reconstruído reflete o estado congelado no cancelamento.
    const trilha = await store.service.trilhaPagamentos({
      clienteId: CLIENTE,
      guiaId: guia.id,
    });
    expect(trilha.cancelada).toBe(true);
    expect(trilha.eventos).toHaveLength(1);
    expect(trilha.saldo.saldo).toBe('60.00');
    expect(store.eventos).toHaveLength(1);
  });

  it('guia cancelada NÃO aceita novos eventos (congela a obrigação, mas preserva o histórico — R1.4)', async () => {
    const store = criarStore({ clienteId: CLIENTE });
    const guia = await store.service.criarGuia(
      baseInput({ valorPrincipal: '100.00' }),
    );
    await store.service.registrarEventoPagamento({
      clienteId: CLIENTE,
      guiaId: guia.id,
      tipo: 'PAGAMENTO_PARCIAL',
      valor: '40.00',
      dataEvento: '2026-09-10',
      comprovanteKey: 'comprovantes/p1.pdf',
    });
    await store.service.cancelarGuia({ clienteId: CLIENTE, guiaId: guia.id });

    await expect(
      store.service.registrarEventoPagamento({
        clienteId: CLIENTE,
        guiaId: guia.id,
        tipo: 'PAGAMENTO_PARCIAL',
        valor: '60.00',
        dataEvento: '2026-09-12',
        comprovanteKey: 'comprovantes/p2.pdf',
      }),
    ).rejects.toThrow('Guia cancelada não aceita novos eventos');

    // O evento pré-cancelamento permanece intacto (histórico preservado).
    expect(store.eventos).toHaveLength(1);
    expect(store.deleteChamado).toBe(false);
  });
});
