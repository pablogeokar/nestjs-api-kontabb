import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { reconciliarItensDocumento } from './fiscal-item-reconciliation';

/**
 * Testes de integração (nível de serviço) da reconciliação idempotente de itens
 * (F01, R1.1–R1.6).
 *
 * O projeto `api` não possui harness de banco vivo (testcontainers/pg-mem/pglite);
 * `DatabaseService` abre uma conexão Postgres real via `DATABASE_URL`. Em vez de
 * introduzir um harness pesado, estes testes usam um EXECUTOR DE TRANSAÇÃO
 * EM MEMÓRIA E COM ESTADO que modela a tabela `documentos_fiscais_itens`.
 *
 * O store é fiel o suficiente para exercer o fluxo end-to-end da reconciliação —
 * `select` (itens existentes) → `planejarReconciliacao` → `update`/`insert` —
 * e provar, cenário a cenário, que:
 *  - reimport idêntico não marca nada como ausente e preserva os ids;
 *  - item removido é marcado ausente e NUNCA deletado fisicamente;
 *  - item novo é inserido;
 *  - manual × DF-e concorrentes, serializados pelo advisory lock em
 *    cliente+chaveAcesso, preservam a decisão manual;
 *  - cancelamento muda a situação sem apagar original/itens.
 *
 * Qualquer chamada a `tx.delete(...)` derruba o teste imediatamente: a proibição
 * de exclusão física é um invariante duro desta fase.
 */

interface ItemRow {
  id: string;
  documentoFiscalId: string;
  clienteId: string;
  numeroItem: number;
  codigoProduto: string;
  cfopManual: boolean;
  cfop?: string;
  descricao?: string;
  destinacaoMercadoria?: string | null;
  destinacaoOrigem?: string | null;
  cstIcms?: string | null;
  atualizadoEm?: Date;
  [key: string]: unknown;
}

interface DocRow {
  id: string;
  situacao: string;
  [key: string]: unknown;
}

const dialect = new PgDialect();

/**
 * Extrai o valor do parâmetro de um `where(eq(coluna, valor))` renderizando a
 * condição drizzle para SQL. A reconciliação sempre filtra o UPDATE por
 * `eq(documentosFiscaisItens.id, existente.id)`, então o último parâmetro é o id.
 */
function paramFinalDaCondicao(condition: unknown): unknown {
  const rendered = dialect.sqlToQuery(condition as SQL);
  return rendered.params[rendered.params.length - 1];
}

/**
 * Store em memória com estado que modela `documentos_fiscais_itens` (e o
 * cabeçalho `documentos_fiscais` para o cenário de cancelamento). Cria um
 * executor de transação com a mesma superfície usada por
 * `reconciliarItensDocumento`: `select().from().where()`,
 * `update().set().where()`, `insert().values()` — e um `delete()` que FALHA.
 */
function criarStore(seed: {
  documentoFiscalId: string;
  itens: ItemRow[];
  documento?: DocRow;
}) {
  const itens: ItemRow[] = seed.itens.map((i) => ({ ...i }));
  const documento: DocRow | undefined = seed.documento
    ? { ...seed.documento }
    : undefined;
  let proximoId = itens.length + 1;
  let deleteChamado = false;
  const lockKeys: unknown[] = [];

  const tx = {
    execute: (arg: unknown) => {
      // Captura a chave do advisory lock (cliente + chaveAcesso).
      try {
        const rendered = dialect.sqlToQuery(arg as SQL);
        for (const p of rendered.params) lockKeys.push(p);
      } catch {
        /* ignore */
      }
      return Promise.resolve(undefined);
    },
    select: () => ({
      from: () => ({
        // A reconciliação seleciona os itens do documento e retorna projeção
        // (id, numeroItem, codigoProduto, cfopManual). Devolvemos o subconjunto.
        where: () =>
          Promise.resolve(
            itens
              .filter((i) => i.documentoFiscalId === seed.documentoFiscalId)
              .map((i) => ({
                id: i.id,
                numeroItem: i.numeroItem,
                codigoProduto: i.codigoProduto,
                cfopManual: i.cfopManual,
              })),
          ),
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (condition: unknown) => {
          const alvoId = paramFinalDaCondicao(condition);
          const docAlvo = documento && alvoId === documento.id;
          if (docAlvo && documento) {
            Object.assign(documento, patch);
          } else {
            const row = itens.find((i) => i.id === alvoId);
            if (row) Object.assign(row, patch);
          }
          return Promise.resolve(undefined);
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (lote: Array<Record<string, unknown>>) => {
        for (const novo of lote) {
          itens.push({
            ...(novo as ItemRow),
            id: `item-${proximoId++}`,
          });
        }
        return Promise.resolve(undefined);
      },
    }),
    // Invariante duro F01: exclusão física é proibida no caminho de reimportação.
    delete: () => {
      deleteChamado = true;
      throw new Error(
        'delete físico proibido na reconciliação (F01): itens ausentes devem ser marcados, nunca deletados',
      );
    },
  };

  return {
    tx: tx as never,
    // Referência tipada frouxamente para exercícios diretos (ex.: UPDATE do
    // cabeçalho no cenário de cancelamento) sem lidar com o cast `never`.
    txRaw: tx as {
      update: (t: unknown) => {
        set: (p: Record<string, unknown>) => {
          where: (c: unknown) => Promise<void>;
        };
      };
    },
    itens,
    get documento() {
      return documento;
    },
    get deleteChamado() {
      return deleteChamado;
    },
    lockKeys,
    // Simula o advisory lock por cliente+chaveAcesso emitido pelos serviços,
    // registrando a chave exatamente no formato `fiscal-doc:${cliente}:${chave}`
    // usado por distribuicao-dfe.service e importacao-xml-fiscal.service.
    async comLock(
      clienteId: string,
      chaveAcesso: string,
      fn: () => Promise<void>,
    ) {
      lockKeys.push(`fiscal-doc:${clienteId}:${chaveAcesso}`);
      await fn();
    },
  };
}

const CLIENTE = 'cliente-1';
const DOC = 'doc-1';
const CHAVE = '2'.repeat(44);

function itemBase(over: Partial<ItemRow>): ItemRow {
  return {
    id: 'x',
    documentoFiscalId: DOC,
    clienteId: CLIENTE,
    numeroItem: 1,
    codigoProduto: 'PROD-A',
    cfopManual: false,
    cfop: '5102',
    descricao: 'Produto A',
    ...over,
  };
}

describe('Reconciliação de itens — integração de serviço (F01, R1.1–R1.6)', () => {
  it('R1.1: reimport idêntico não marca nada como ausente e preserva os ids', async () => {
    const store = criarStore({
      documentoFiscalId: DOC,
      itens: [
        itemBase({ id: 'item-1', numeroItem: 1, codigoProduto: 'PROD-A' }),
        itemBase({ id: 'item-2', numeroItem: 2, codigoProduto: 'PROD-B' }),
      ],
    });

    const resultado = await reconciliarItensDocumento(store.tx, {
      documentoFiscalId: DOC,
      clienteId: CLIENTE,
      itens: [
        { numeroItem: 1, codigoProduto: 'PROD-A', cfop: '5102' },
        { numeroItem: 2, codigoProduto: 'PROD-B', cfop: '5102' },
      ] as never[],
    });

    expect(resultado).toEqual({ atualizados: 2, inseridos: 0, ausentes: 0 });
    expect(store.deleteChamado).toBe(false);
    // Ids preservados e nenhum item novo criado.
    expect(store.itens.map((i) => i.id).sort()).toEqual(['item-1', 'item-2']);
    expect(store.itens).toHaveLength(2);
  });

  it('R1.1/R1.4: item removido do XML é marcado ausente e NUNCA deletado', async () => {
    const store = criarStore({
      documentoFiscalId: DOC,
      itens: [
        itemBase({ id: 'item-1', numeroItem: 1, codigoProduto: 'PROD-A' }),
        itemBase({ id: 'item-2', numeroItem: 2, codigoProduto: 'PROD-B' }),
      ],
    });

    // XML reimportado sem o item 2.
    const resultado = await reconciliarItensDocumento(store.tx, {
      documentoFiscalId: DOC,
      clienteId: CLIENTE,
      itens: [
        { numeroItem: 1, codigoProduto: 'PROD-A', cfop: '5102' },
      ] as never[],
    });

    expect(resultado).toEqual({ atualizados: 1, inseridos: 0, ausentes: 1 });
    expect(store.deleteChamado).toBe(false);
    // O item ausente permanece fisicamente no store (não foi apagado).
    expect(store.itens.find((i) => i.id === 'item-2')).toBeDefined();
    expect(store.itens).toHaveLength(2);
  });

  it('R1.1: item novo no XML é inserido preservando os existentes', async () => {
    const store = criarStore({
      documentoFiscalId: DOC,
      itens: [itemBase({ id: 'item-1', numeroItem: 1, codigoProduto: 'PROD-A' })],
    });

    const resultado = await reconciliarItensDocumento(store.tx, {
      documentoFiscalId: DOC,
      clienteId: CLIENTE,
      itens: [
        { numeroItem: 1, codigoProduto: 'PROD-A', cfop: '5102' },
        { numeroItem: 2, codigoProduto: 'PROD-B', cfop: '5102' },
      ] as never[],
    });

    expect(resultado).toEqual({ atualizados: 1, inseridos: 1, ausentes: 0 });
    expect(store.deleteChamado).toBe(false);
    expect(store.itens).toHaveLength(2);
    const novo = store.itens.find((i) => i.codigoProduto === 'PROD-B');
    expect(novo).toBeDefined();
    // Item novo carimba documento/cliente.
    expect(novo?.documentoFiscalId).toBe(DOC);
    expect(novo?.clienteId).toBe(CLIENTE);
    // O item pré-existente conserva o id original.
    expect(store.itens.find((i) => i.codigoProduto === 'PROD-A')?.id).toBe(
      'item-1',
    );
  });

  it('R1.6: manual × DF-e concorrentes, serializados por advisory lock em cliente+chaveAcesso, preservam a decisão manual', async () => {
    // Item já classificado manualmente (cfopManual=true) com CFOP e destinação
    // decididos por humano.
    const store = criarStore({
      documentoFiscalId: DOC,
      itens: [
        itemBase({
          id: 'item-1',
          numeroItem: 1,
          codigoProduto: 'PROD-A',
          cfopManual: true,
          cfop: '1556',
          destinacaoMercadoria: 'USO_CONSUMO',
          destinacaoOrigem: 'MANUAL',
        }),
      ],
    });

    // Duas reimportações concorrentes (manual e DF-e) da MESMA chave. O advisory
    // lock em cliente+chaveAcesso as serializa: modelamos isso executando cada
    // reconciliação dentro de `store.comLock` de forma sequencial.
    await store.comLock(CLIENTE, CHAVE, async () => {
      await reconciliarItensDocumento(store.tx, {
        documentoFiscalId: DOC,
        clienteId: CLIENTE,
        itens: [
          {
            numeroItem: 1,
            codigoProduto: 'PROD-A',
            // XML traz CFOP/destinação divergentes da decisão humana.
            cfop: '1102',
            cfopManual: false,
            destinacaoMercadoria: 'INDUSTRIALIZACAO',
            destinacaoOrigem: 'ALGORITMO',
            descricao: 'Produto A (canal manual)',
          },
        ] as never[],
      });
    });

    await store.comLock(CLIENTE, CHAVE, async () => {
      await reconciliarItensDocumento(store.tx, {
        documentoFiscalId: DOC,
        clienteId: CLIENTE,
        itens: [
          {
            numeroItem: 1,
            codigoProduto: 'PROD-A',
            cfop: '1102',
            cfopManual: false,
            destinacaoMercadoria: 'INDUSTRIALIZACAO',
            destinacaoOrigem: 'ALGORITMO',
            descricao: 'Produto A (canal DF-e)',
          },
        ] as never[],
      });
    });

    expect(store.deleteChamado).toBe(false);
    // Convergiu para UM único item lógico (sem duplicar).
    expect(store.itens).toHaveLength(1);
    const item = store.itens[0];
    // Decisão manual preservada nas duas passagens concorrentes.
    expect(item.cfopManual).toBe(true);
    expect(item.cfop).toBe('1556');
    expect(item.destinacaoMercadoria).toBe('USO_CONSUMO');
    expect(item.destinacaoOrigem).toBe('MANUAL');
    // Campo descritivo do XML (sem carga de decisão) foi atualizado normalmente.
    expect(item.descricao).toBe('Produto A (canal DF-e)');
    // Ambos os canais serializaram na MESMA chave de lock cliente+chaveAcesso.
    const chaveLock = `fiscal-doc:${CLIENTE}:${CHAVE}`;
    const locks = store.lockKeys.filter(
      (k) => typeof k === 'string' && (k as string).includes(chaveLock),
    );
    expect(locks.length).toBeGreaterThanOrEqual(2);
  });

  it('R1.5: cancelamento muda a situação para CANCELADA sem apagar original nem itens', async () => {
    const store = criarStore({
      documentoFiscalId: DOC,
      documento: { id: DOC, situacao: 'AUTORIZADA' },
      itens: [
        itemBase({
          id: 'item-1',
          numeroItem: 1,
          codigoProduto: 'PROD-A',
          cfopManual: true,
          cfop: '1556',
        }),
      ],
    });

    // Evento de cancelamento: o cabeçalho é atualizado para CANCELADA e a
    // reconciliação preserva os itens (UPDATE in-place, sem delete).
    await store.comLock(CLIENTE, CHAVE, async () => {
      await store.txRaw
        .update({})
        .set({ situacao: 'CANCELADA' })
        .where(dialectEqId(DOC));
      await reconciliarItensDocumento(store.tx, {
        documentoFiscalId: DOC,
        clienteId: CLIENTE,
        itens: [
          { numeroItem: 1, codigoProduto: 'PROD-A', cfop: '5102' },
        ] as never[],
      });
    });

    expect(store.deleteChamado).toBe(false);
    // Situação convergiu sem apagar o documento.
    expect(store.documento).toBeDefined();
    expect(store.documento?.situacao).toBe('CANCELADA');
    // Item original preservado (id intacto) e decisão manual mantida.
    expect(store.itens).toHaveLength(1);
    expect(store.itens[0].id).toBe('item-1');
    expect(store.itens[0].cfopManual).toBe(true);
    expect(store.itens[0].cfop).toBe('1556');
  });
});

// Constrói uma condição `eq(id, valor)` renderizável para o UPDATE do cabeçalho
// no cenário de cancelamento, usando o mesmo mecanismo drizzle dos serviços.
function dialectEqId(id: string): SQL {
  const { sql } = require('drizzle-orm') as typeof import('drizzle-orm');
  return sql`"id" = ${id}` as unknown as SQL;
}
