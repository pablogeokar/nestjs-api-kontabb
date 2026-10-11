/**
 * Tipos de conveniência (TEST-ONLY) para os mocks de query do drizzle usados
 * nas specs de fechamento fiscal. Modelam APENAS os métodos que os serviços
 * realmente invocam sobre a transação/consulta encadeável, de modo que os
 * stubs deixem de ser `any` (silenciando as regras `no-unsafe-*`) sem alterar
 * nenhum valor de retorno dos mocks.
 *
 * Nada aqui é usado em runtime de produção: é só a forma estática que os stubs
 * precisam expor para o compilador.
 */

type QueryRow = Record<string, unknown>;

/**
 * Builder encadeável de `select(...).from(...).where(...)[.orderBy(...)].limit()`.
 * Cada passo intermediário devolve o próprio builder; `limit()` resolve as
 * linhas. Alguns fluxos terminam em `.for(...)` (SELECT ... FOR UPDATE).
 */
export interface QueryChain {
  from: () => QueryChain;
  where: () => QueryChain;
  orderBy?: () => QueryChain;
  limit: () => Promise<QueryRow[]>;
  for?: () => Promise<QueryRow[]>;
}

/** `insert(...).values(...).returning()` (opcionalmente com onConflict). */
export interface InsertChain {
  values: (v: QueryRow) => {
    returning: () => Promise<QueryRow[]>;
    onConflictDoNothing?: () => { returning: () => Promise<QueryRow[]> };
  };
}

/** `update(...).set(...).where(...).returning()`. */
export interface UpdateChain {
  set: (v: QueryRow) => {
    where: () => { returning: () => Promise<QueryRow[]> };
  };
}

/**
 * Superfície de transação que os serviços de fechamento consomem. Métodos de
 * escrita são opcionais porque nem todo fluxo os exercita.
 */
export interface TxMock {
  execute: (...args: unknown[]) => Promise<unknown>;
  select: () => QueryChain;
  insert?: () => InsertChain;
  update?: () => UpdateChain;
}

/** `db` com `transaction(cb)` que executa o callback com o `tx` mockado. */
export interface DbMock {
  transaction: <T>(cb: (tx: TxMock) => T) => T;
}
