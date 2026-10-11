import { ConflictException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import {
  FISCAL_CLOSING_MOTOR_VERSAO,
  FiscalClosingService,
  canonicalJsonStringify,
  type EstadoFechamento,
  type FechamentoEntradas,
  type FechamentoEscopo,
} from './fiscal-closing.service';
import { FiscalPeriodSelectionService } from './fiscal-period-selection.service';
import type { DbMock, QueryChain, TxMock } from '../testing/drizzle-query-mock';

/**
 * Tipo da transação que os métodos de `FiscalClosingService` recebem
 * (`FechamentoTx`, não exportado) — derivado do próprio método. Os stubs de
 * `tx` são `TxMock`; convertemos para este tipo no limite da chamada ao serviço
 * via `as unknown as`, sem alterar o valor passado em runtime.
 */
type FechamentoTxArg = Parameters<
  FiscalClosingService['sinalizarRevisaoPosFechamento']
>[0];

/** Entradas de exemplo com valores monetários sempre como STRINGS decimais. */
function entradas(
  overrides: Partial<FechamentoEntradas> = {},
): FechamentoEntradas {
  return {
    documentos: [
      { chave: 'A', valorTotal: '100.00' },
      { chave: 'B', valorTotal: '250.50' },
    ],
    decisoes: [{ item: 'A', credito: '17.00' }],
    regras: [{ id: 'R1', versao: 3 }],
    parametros: { perfil: 'A', finalidade: '0' },
    saldos: { credorAnterior: '0.00' },
    ...overrides,
  };
}

describe('FiscalClosingService', () => {
  describe('canonicalJsonStringify (base da reprodutibilidade do hash)', () => {
    it('ordena chaves de objeto lexicograficamente (ordem de inserção não importa)', () => {
      const a = canonicalJsonStringify({ b: '1', a: '2', c: '3' });
      const b = canonicalJsonStringify({ c: '3', a: '2', b: '1' });
      expect(a).toBe(b);
      expect(a).toBe('{"a":"2","b":"1","c":"3"}');
    });

    it('descarta chaves com valor undefined, mas preserva null', () => {
      expect(canonicalJsonStringify({ a: undefined, b: null })).toBe(
        '{"b":null}',
      );
    });

    it('serializa inteiros seguros, mas rejeita number decimal (deve ser string)', () => {
      expect(canonicalJsonStringify({ n: 3 })).toBe('{"n":3}');
      expect(() => canonicalJsonStringify({ n: 3.5 })).toThrow(
        /decimais DEVEM ser strings/i,
      );
    });

    it('serializa arrays preservando a ordem', () => {
      expect(canonicalJsonStringify(['b', 'a'])).toBe('["b","a"]');
    });
  });

  describe('calcularHashEntradas (R1.2 — mesmas entradas → mesmo hash)', () => {
    it('é determinístico e no formato SHA-256 hex (64 chars minúsculos)', () => {
      const h1 = FiscalClosingService.calcularHashEntradas(
        'EFD_ICMS_IPI',
        '2026-09-01',
        entradas(),
      );
      const h2 = FiscalClosingService.calcularHashEntradas(
        'EFD_ICMS_IPI',
        '2026-09-01',
        entradas(),
      );
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('independe da ordem de inserção das chaves dentro dos documentos', () => {
      const original = FiscalClosingService.calcularHashEntradas(
        'EFD_ICMS_IPI',
        '2026-09-01',
        entradas({
          documentos: [{ chave: 'A', valorTotal: '100.00' }],
        }),
      );
      const reordenado = FiscalClosingService.calcularHashEntradas(
        'EFD_ICMS_IPI',
        '2026-09-01',
        entradas({
          documentos: [{ valorTotal: '100.00', chave: 'A' }],
        }),
      );
      expect(reordenado).toBe(original);
    });

    it('muda quando qualquer entrada muda (valor, obrigação ou competência)', () => {
      const base = FiscalClosingService.calcularHashEntradas(
        'EFD_ICMS_IPI',
        '2026-09-01',
        entradas(),
      );
      const valorDiferente = FiscalClosingService.calcularHashEntradas(
        'EFD_ICMS_IPI',
        '2026-09-01',
        entradas({ documentos: [{ chave: 'A', valorTotal: '100.01' }] }),
      );
      const obrigacaoDiferente = FiscalClosingService.calcularHashEntradas(
        'GIA',
        '2026-09-01',
        entradas(),
      );
      const competenciaDiferente = FiscalClosingService.calcularHashEntradas(
        'EFD_ICMS_IPI',
        '2026-10-01',
        entradas(),
      );
      expect(valorDiferente).not.toBe(base);
      expect(obrigacaoDiferente).not.toBe(base);
      expect(competenciaDiferente).not.toBe(base);
    });

    it('congelarEntradas produz cópias independentes do original', () => {
      const original = entradas();
      const congeladas = FiscalClosingService.congelarEntradas(original);
      congeladas.documentos[0].valorTotal = 'ADULTERADO';
      expect(original.documentos[0].valorTotal).toBe('100.00');
    });
  });

  describe('máquina de estados RASCUNHO → PENDENTE → REVISADO → FECHADO', () => {
    it('aceita cada avanço de uma casa', () => {
      expect(() =>
        FiscalClosingService.assertTransicao('RASCUNHO', 'PENDENTE'),
      ).not.toThrow();
      expect(() =>
        FiscalClosingService.assertTransicao('PENDENTE', 'REVISADO'),
      ).not.toThrow();
      expect(() =>
        FiscalClosingService.assertTransicao('REVISADO', 'FECHADO'),
      ).not.toThrow();
    });

    it('rejeita salto de etapas (RASCUNHO → FECHADO)', () => {
      expect(() =>
        FiscalClosingService.assertTransicao('RASCUNHO', 'FECHADO'),
      ).toThrow(ConflictException);
    });

    it('rejeita retrocesso (uma versão não volta de estado)', () => {
      const retrocessos: Array<[EstadoFechamento, EstadoFechamento]> = [
        ['PENDENTE', 'RASCUNHO'],
        ['REVISADO', 'PENDENTE'],
        ['FECHADO', 'REVISADO'],
      ];
      for (const [origem, destino] of retrocessos) {
        expect(() =>
          FiscalClosingService.assertTransicao(origem, destino),
        ).toThrow(ConflictException);
      }
    });

    it('FECHADO é terminal: nenhuma transição parte dele', () => {
      const estados: EstadoFechamento[] = [
        'RASCUNHO',
        'PENDENTE',
        'REVISADO',
        'FECHADO',
      ];
      for (const destino of estados) {
        expect(() =>
          FiscalClosingService.assertTransicao('FECHADO', destino),
        ).toThrow(ConflictException);
      }
    });
  });

  describe('fechar (R1.1 — exatamente uma versão corrente)', () => {
    it('desmarca a corrente anterior do escopo antes de promover a nova', async () => {
      const linha = {
        id: 'f2',
        clienteId: 'c1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09-01',
        versao: 2,
        estado: 'REVISADO' as const,
        corrente: false,
        motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
        hashEntradas: 'a'.repeat(64),
        aprovadoPor: null,
        fechadoEm: null,
      };
      const updateCalls: Array<Record<string, unknown>> = [];
      const tx = {
        execute: jest.fn().mockResolvedValue(undefined),
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([linha]),
            }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockImplementation((v: Record<string, unknown>) => {
            updateCalls.push(v);
            return {
              where: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([{ ...linha, ...v }]),
              }),
            };
          }),
        }),
      };
      const db = {
        transaction: jest
          .fn()
          .mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
      };
      const service = new FiscalClosingService(
        { db } as never,
        new FiscalPeriodSelectionService(),
      );

      const resultado = await service.fechar({
        fechamentoId: 'f2',
        aprovadoPor: 'u1',
      });

      // Duas escritas: (1) desmarcar corrente anterior, (2) promover esta.
      expect(updateCalls).toHaveLength(2);
      expect(updateCalls[0]).toMatchObject({ corrente: false });
      expect(updateCalls[1]).toMatchObject({
        estado: 'FECHADO',
        corrente: true,
        aprovadoPor: 'u1',
      });
      expect(updateCalls[1].fechadoEm).toBeInstanceOf(Date);
      expect(resultado.estado).toBe('FECHADO');
      expect(resultado.corrente).toBe(true);
    });

    it('rejeita fechar uma versão que não está em REVISADO', async () => {
      const linha = {
        id: 'f1',
        clienteId: 'c1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09-01',
        versao: 1,
        estado: 'RASCUNHO' as const,
        corrente: false,
        motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
        hashEntradas: 'a'.repeat(64),
        aprovadoPor: null,
        fechadoEm: null,
      };
      const tx = {
        execute: jest.fn().mockResolvedValue(undefined),
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([linha]),
            }),
          }),
        }),
        update: jest.fn(),
      };
      const db = {
        transaction: jest
          .fn()
          .mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
      };
      const service = new FiscalClosingService(
        { db } as never,
        new FiscalPeriodSelectionService(),
      );

      await expect(
        service.fechar({ fechamentoId: 'f1', aprovadoPor: 'u1' }),
      ).rejects.toThrow(ConflictException);
      expect(tx.update).not.toHaveBeenCalled();
    });
  });

  describe('abrir (R1.1 — versão sequencial, snapshots congelados, selo)', () => {
    it('abre a próxima versão em RASCUNHO com motorVersao e hash das entradas', async () => {
      const inserts: Array<Record<string, unknown>> = [];
      const tx = {
        execute: jest.fn().mockResolvedValue(undefined),
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                // Já existe a versão 1 do escopo → próxima é 2.
                limit: jest.fn().mockResolvedValue([{ versao: 1 }]),
              }),
            }),
          }),
        }),
        insert: jest.fn().mockReturnValue({
          values: jest.fn().mockImplementation((v: Record<string, unknown>) => {
            inserts.push(v);
            return {
              returning: jest.fn().mockResolvedValue([
                {
                  id: 'novo',
                  aprovadoPor: null,
                  fechadoEm: null,
                  ...v,
                },
              ]),
            };
          }),
        }),
      };
      const db = {
        transaction: jest
          .fn()
          .mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
      };
      const service = new FiscalClosingService(
        { db } as never,
        new FiscalPeriodSelectionService(),
      );

      const registro = await service.abrir({
        clienteId: 'c1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09',
        entradas: entradas(),
      });

      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({
        clienteId: 'c1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09-01',
        versao: 2,
        estado: 'RASCUNHO',
        corrente: false,
        motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
      });
      // O hash gravado é exatamente o calculado para as mesmas entradas.
      expect(inserts[0].hashEntradas).toBe(
        FiscalClosingService.calcularHashEntradas(
          'EFD_ICMS_IPI',
          '2026-09-01',
          entradas(),
        ),
      );
      expect(registro.versao).toBe(2);
      expect(registro.estado).toBe('RASCUNHO');
    });
  });

  describe('projetarApuracao (Tarefa 3.3 — ResultadoApuracao do snapshot)', () => {
    function serviceComLinha(linha: Record<string, unknown> | undefined) {
      const db = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(linha ? [linha] : []),
            }),
          }),
        }),
      };
      return new FiscalClosingService(
        { db } as never,
        new FiscalPeriodSelectionService(),
      );
    }

    const linhaFechada = {
      id: 'f1',
      clienteId: 'c1',
      obrigacao: 'EFD_ICMS_IPI',
      competencia: '2026-09-01',
      versao: 2,
      estado: 'FECHADO',
      corrente: true,
      motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
      hashEntradas: 'a'.repeat(64),
      aprovadoPor: 'u1',
      fechadoEm: new Date('2026-10-01T00:00:00Z'),
      documentos: [
        { chave: 'A', valorContabil: '100.00', valorIcms: '18.00' },
        { chave: 'B', valorContabil: '250.50', valorIcms: '45.09' },
      ],
      decisoes: [],
      regras: [],
      parametros: {},
      saldos: { debitos: '45.09', creditos: '18.00', saldoApurado: '27.09' },
    };

    it('projeta a ResultadoApuracao com totais e detalhamento paginado', async () => {
      const service = serviceComLinha(linhaFechada);
      const r = await service.projetarApuracao('f1', {
        pagination: { offset: 0, limit: 1 },
      });
      expect(r.clienteId).toBe('c1');
      expect(r.versao).toBe(2);
      expect(r.totais.debitos).toBe('45.09');
      expect(r.detalhamento.items).toHaveLength(1);
      expect(r.detalhamento.pagination).toEqual({
        total: 2,
        limit: 1,
        offset: 0,
      });
      expect(r.detalhamento.items[0].chave).toBe('A');
    });

    it('lança 404 quando o fechamento não existe', async () => {
      const service = serviceComLinha(undefined);
      await expect(service.projetarApuracao('inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('sinalizarRevisaoPosFechamento / editar (Tarefa 3.5 — R1.3/R1.4)', () => {
    const ESCOPO: FechamentoEscopo = {
      clienteId: 'c1',
      obrigacao: 'EFD_ICMS_IPI',
      competencia: '2026-09',
    };

    const correnteFechada = {
      id: 'f1',
      clienteId: 'c1',
      obrigacao: 'EFD_ICMS_IPI',
      competencia: '2026-09-01',
      versao: 1,
      estado: 'FECHADO' as const,
      corrente: true,
      motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
      hashEntradas: 'a'.repeat(64),
      aprovadoPor: 'u1',
      fechadoEm: new Date('2026-10-01T00:00:00Z'),
      documentos: [{ chave: 'A', valorTotal: '100.00' }],
      decisoes: [],
      regras: [],
      parametros: {},
      saldos: { saldoApurado: '10.00' },
    };

    /**
     * Monta um `tx` que entrega os resultados de `select` na ORDEM em que o
     * serviço os consome (mesmo padrão de stub dos testes de `fechar`/`abrir`
     * acima) e captura o que for inserido. `selectQueue` é consumida a cada
     * `select().from().where()[.orderBy()].limit()`.
     */
    function makeTx(selectQueue: Array<Array<Record<string, unknown>>>) {
      const inserts: Array<Record<string, unknown>> = [];
      const next = () => Promise.resolve(selectQueue.shift() ?? []);
      const chain = (): QueryChain => {
        const api: QueryChain = {
          from: () => api,
          where: () => api,
          orderBy: () => api,
          limit: () => next(),
        };
        return api;
      };
      const tx: TxMock = {
        execute: jest.fn().mockResolvedValue(undefined),
        select: () => chain(),
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            inserts.push(v);
            return {
              returning: () =>
                Promise.resolve([
                  { id: 'novo', aprovadoPor: null, fechadoEm: null, ...v },
                ]),
            };
          },
        }),
      };
      const db: DbMock = {
        transaction: (cb) => cb(tx),
      };
      return { tx, db, inserts };
    }

    function serviceComDb(db: unknown) {
      return new FiscalClosingService(
        { db } as never,
        new FiscalPeriodSelectionService(),
      );
    }

    it('sem corrente fechada: não abre revisão (nada a preservar)', async () => {
      // 1) carregarCorrenteFechada → vazio.
      const { tx, db, inserts } = makeTx([[]]);
      const svc = serviceComDb(db);
      const r = await db.transaction(() =>
        svc.sinalizarRevisaoPosFechamento(
          tx as unknown as FechamentoTxArg,
          ESCOPO,
        ),
      );
      expect(r.fechado).toBe(false);
      expect(r.revisaoNecessaria).toBe(false);
      expect(r.revisaoId).toBeNull();
      expect(inserts).toHaveLength(0);
    });

    it('com corrente fechada e sem revisão aberta: abre versão 2 RASCUNHO carregando snapshots', async () => {
      const { tx, db, inserts } = makeTx([
        [correnteFechada], // carregarCorrenteFechada
        [], // carregarRevisaoAberta → nenhuma
        [{ versao: 1 }], // proximaVersao → próxima é 2
      ]);
      const svc = serviceComDb(db);
      const r = await db.transaction(() =>
        svc.sinalizarRevisaoPosFechamento(
          tx as unknown as FechamentoTxArg,
          ESCOPO,
        ),
      );

      expect(r.fechado).toBe(true);
      expect(r.fechamentoCorrenteId).toBe('f1');
      expect(r.revisaoNecessaria).toBe(true);
      expect(r.revisaoAberta).toBe(true);
      expect(r.revisaoVersao).toBe(2);

      // Exatamente uma inserção: a versão de revisão. A entrega fechada (f1)
      // nunca é tocada — não há update sobre ela.
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({
        clienteId: 'c1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09-01',
        versao: 2,
        estado: 'RASCUNHO',
        corrente: false,
        motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
      });
      // A revisão carrega adiante os snapshots da corrente fechada.
      expect(inserts[0].documentos).toEqual(correnteFechada.documentos);
      expect(inserts[0].saldos).toEqual(correnteFechada.saldos);
    });

    it('é idempotente: reutiliza a revisão já aberta em vez de abrir outra', async () => {
      const { tx, db, inserts } = makeTx([
        [correnteFechada], // carregarCorrenteFechada
        [{ id: 'f2', versao: 2 }], // carregarRevisaoAberta → já existe
      ]);
      const svc = serviceComDb(db);
      const r = await db.transaction(() =>
        svc.sinalizarRevisaoPosFechamento(
          tx as unknown as FechamentoTxArg,
          ESCOPO,
        ),
      );
      expect(r.revisaoNecessaria).toBe(true);
      expect(r.revisaoAberta).toBe(false);
      expect(r.revisaoId).toBe('f2');
      expect(r.revisaoVersao).toBe(2);
      // Nenhum rascunho novo é aberto.
      expect(inserts).toHaveLength(0);
    });

    it('editar cria uma NOVA versão (sequencial) deixando a anterior intacta (R1.4)', async () => {
      // abrir/editar: lockEscopo (execute) → proximaVersao (select) → insert.
      const { tx, db, inserts } = makeTx([[{ versao: 1 }]]);
      void tx;
      const svc = serviceComDb(db);
      const registro = await svc.editar({ ...ESCOPO, entradas: entradas() });
      expect(registro.versao).toBe(2);
      expect(registro.estado).toBe('RASCUNHO');
      expect(registro.corrente).toBe(false);
      // Uma única inserção (a nova versão); nenhuma escrita sobre versões antigas.
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({ versao: 2, estado: 'RASCUNHO' });
    });
  });

  describe('retificar / diferencaRetificacao (Tarefa 3.6 — R1.5)', () => {
    const originalFechada = {
      id: 'orig',
      clienteId: 'c1',
      obrigacao: 'EFD_ICMS_IPI',
      competencia: '2026-09-01',
      versao: 1,
      estado: 'FECHADO' as const,
      corrente: true,
      motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
      hashEntradas: 'a'.repeat(64),
      aprovadoPor: 'u1',
      fechadoEm: new Date('2026-10-01T00:00:00Z'),
      documentos: [{ chave: 'A', valorTotal: '100.00' }],
      decisoes: [],
      regras: [],
      parametros: { perfil: 'A' },
      saldos: { debitos: '100.00' },
    };

    /** `tx` que entrega `selectQueue` na ordem de consumo e captura inserts. */
    function makeTx(selectQueue: Array<Array<Record<string, unknown>>>) {
      const inserts: Array<Record<string, unknown>> = [];
      const updates: Array<Record<string, unknown>> = [];
      const next = () => Promise.resolve(selectQueue.shift() ?? []);
      const chain = (): QueryChain => {
        const api: QueryChain = {
          from: () => api,
          where: () => api,
          orderBy: () => api,
          limit: () => next(),
        };
        return api;
      };
      const tx: TxMock = {
        execute: jest.fn().mockResolvedValue(undefined),
        select: () => chain(),
        update: () => ({
          set: (v: Record<string, unknown>) => {
            updates.push(v);
            return {
              where: () => ({ returning: () => Promise.resolve([v]) }),
            };
          },
        }),
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            inserts.push(v);
            return {
              returning: () =>
                Promise.resolve([
                  { id: 'retif', aprovadoPor: null, fechadoEm: null, ...v },
                ]),
            };
          },
        }),
      };
      const db: DbMock = {
        transaction: (cb) => cb(tx),
      };
      return { tx, db, inserts, updates };
    }

    function serviceComDb(db: unknown) {
      return new FiscalClosingService(
        { db } as never,
        new FiscalPeriodSelectionService(),
      );
    }

    it('abre nova versão apontando o original nos parâmetros, sem tocar a entrega', async () => {
      const { db, inserts, updates } = makeTx([
        [originalFechada], // carregarParaAtualizacao(original)
        [{ versao: 1 }], // proximaVersao → próxima é 2
      ]);
      const svc = serviceComDb(db);

      const registro = await svc.retificar({
        originalFechamentoId: 'orig',
        entradas: entradas({ parametros: { perfil: 'A' } }),
      });

      expect(registro.versao).toBe(2);
      expect(registro.estado).toBe('RASCUNHO');
      expect(registro.corrente).toBe(false);
      // Exatamente uma inserção (a retificadora); a entrega original não é
      // atualizada (R1.4).
      expect(inserts).toHaveLength(1);
      expect(updates).toHaveLength(0);
      // Aponta o original de forma aditiva (preserva `perfil`).
      const params = inserts[0].parametros as Record<string, unknown>;
      expect(params.perfil).toBe('A');
      expect(params.retificacao).toEqual({
        originalFechamentoId: 'orig',
        originalVersao: 1,
        originalHashEntradas: 'a'.repeat(64),
      });
    });

    it('rejeita retificar uma versão que não está FECHADA', async () => {
      const rascunho = { ...originalFechada, estado: 'RASCUNHO' as const };
      const { db, inserts } = makeTx([[rascunho]]);
      const svc = serviceComDb(db);
      await expect(
        svc.retificar({
          originalFechamentoId: 'orig',
          entradas: entradas(),
        }),
      ).rejects.toThrow(ConflictException);
      expect(inserts).toHaveLength(0);
    });

    it('diferencaRetificacao aponta o original e expõe a diferença dos totais', async () => {
      const retificadora = {
        id: 'retif',
        clienteId: 'c1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09-01',
        versao: 2,
        estado: 'RASCUNHO',
        corrente: false,
        motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
        hashEntradas: 'b'.repeat(64),
        aprovadoPor: null,
        fechadoEm: null,
        documentos: [],
        decisoes: [],
        regras: [],
        parametros: {
          perfil: 'A',
          retificacao: {
            originalFechamentoId: 'orig',
            originalVersao: 1,
            originalHashEntradas: 'a'.repeat(64),
          },
        },
        saldos: { debitos: '150.00' },
      };
      // `carregarLinha` usa db.select direto (não dentro de transação): primeiro
      // a retificadora, depois a original.
      const queue: Array<Array<Record<string, unknown>>> = [
        [retificadora],
        [originalFechada],
      ];
      const db = {
        select: (): QueryChain => {
          const api: QueryChain = {
            from: () => api,
            where: () => api,
            limit: () => Promise.resolve(queue.shift() ?? []),
          };
          return api;
        },
      };
      const svc = serviceComDb(db);

      const r = await svc.diferencaRetificacao('retif');
      expect(r.original.fechamentoId).toBe('orig');
      expect(r.original.versao).toBe(1);
      expect(r.retificadora.fechamentoId).toBe('retif');
      const debitos = r.diferencas.find((d) => d.codigo === 'debitos')!;
      expect(debitos.delta).toBe('50.00');
      expect(r.houveAlteracao).toBe(true);
      // Seam do recibo (Fase 5): vinculado ao hash da retificadora, recibo null.
      expect(r.recibo.hashVinculado).toBe('b'.repeat(64));
      expect(r.recibo.recibo).toBeNull();
    });

    it('diferencaRetificacao rejeita um fechamento que não é retificação', async () => {
      const naoRetificadora = {
        ...originalFechada,
        id: 'x',
        parametros: { perfil: 'A' },
      };
      const db = {
        select: (): QueryChain => {
          const api: QueryChain = {
            from: () => api,
            where: () => api,
            limit: () => Promise.resolve([naoRetificadora]),
          };
          return api;
        },
      };
      const svc = serviceComDb(db);
      await expect(svc.diferencaRetificacao('x')).rejects.toThrow(
        /não é uma retificação/i,
      );
    });

    it('diferencaRetificacao lança 404 quando a retificadora não existe', async () => {
      const db = {
        select: (): QueryChain => {
          const api: QueryChain = {
            from: () => api,
            where: () => api,
            limit: () => Promise.resolve([]),
          };
          return api;
        },
      };
      const svc = serviceComDb(db);
      await expect(svc.diferencaRetificacao('inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ------------------------------------------------------------------
  // Tarefa 3.7 — critérios de aceitação verificados sem ambiguidade.
  //
  // R1.2: uma versão FECHADA é REPRODUTÍVEL — as mesmas entradas produzem o
  //       mesmo `hashEntradas`, o selo sobrevive intacto ao ciclo de vida até
  //       FECHADO, e o snapshot congelado projeta sempre o MESMO
  //       `ResultadoApuracao` (livro/TXT reproduzíveis).
  // R1.4: uma edição APÓS o fechamento cria uma NOVA versão; a entrega anterior
  //       (a FECHADA) permanece INTACTA — nunca é mutada.
  // ------------------------------------------------------------------
  describe('Tarefa 3.7 — versão fechada reproduzível (R1.2) e edição → nova versão (R1.4)', () => {
    const ESCOPO: FechamentoEscopo = {
      clienteId: 'c1',
      obrigacao: 'EFD_ICMS_IPI',
      competencia: '2026-09',
    };

    /**
     * `tx`/`db` que entregam `selectQueue` na ordem de consumo do serviço e
     * capturam `inserts`/`updates` — mesmo padrão de stub dos blocos acima.
     */
    function makeTx(selectQueue: Array<Array<Record<string, unknown>>>) {
      const inserts: Array<Record<string, unknown>> = [];
      const updates: Array<Record<string, unknown>> = [];
      // Última linha lida por `select` — o `returning` de um UPDATE devolve a
      // linha COMPLETA já com o `set` aplicado (como o banco faz), de modo que a
      // projeção (`toRegistro`) enxergue os campos congelados, não só o payload.
      let ultimaLinha: Record<string, unknown> = {};
      const next = () => {
        const linhas = selectQueue.shift() ?? [];
        if (linhas[0]) ultimaLinha = linhas[0];
        return Promise.resolve(linhas);
      };
      const chain = (): QueryChain => {
        const api: QueryChain = {
          from: () => api,
          where: () => api,
          orderBy: () => api,
          limit: () => next(),
        };
        return api;
      };
      const tx: TxMock = {
        execute: jest.fn().mockResolvedValue(undefined),
        select: () => chain(),
        update: () => ({
          set: (v: Record<string, unknown>) => {
            updates.push(v);
            return {
              where: () => ({
                returning: () => Promise.resolve([{ ...ultimaLinha, ...v }]),
              }),
            };
          },
        }),
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            inserts.push(v);
            return {
              returning: () =>
                Promise.resolve([
                  { id: 'novo', aprovadoPor: null, fechadoEm: null, ...v },
                ]),
            };
          },
        }),
      };
      const db: DbMock = { transaction: (cb) => cb(tx) };
      return { tx, db, inserts, updates };
    }

    function serviceComDb(db: unknown) {
      return new FiscalClosingService(
        { db } as never,
        new FiscalPeriodSelectionService(),
      );
    }

    /** Service cujo `db.select` entrega `linha` (ou vazio) — para projeção. */
    function serviceComLinha(linha: Record<string, unknown> | undefined) {
      const db = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(linha ? [linha] : []),
            }),
          }),
        }),
      };
      return new FiscalClosingService(
        { db } as never,
        new FiscalPeriodSelectionService(),
      );
    }

    describe('R1.2 — versão fechada reproduzível (mesmas entradas → mesmo hash/resultado)', () => {
      it('mesmas entradas produzem o mesmo hashEntradas em dois fechamentos independentes', () => {
        // Dois escopos/execuções distintos, entradas idênticas → mesmo selo:
        // a reprodutibilidade não depende de estado externo, só das entradas.
        const h1 = FiscalClosingService.calcularHashEntradas(
          'EFD_ICMS_IPI',
          '2026-09-01',
          entradas(),
        );
        const h2 = FiscalClosingService.calcularHashEntradas(
          'EFD_ICMS_IPI',
          '2026-09-01',
          entradas(),
        );
        expect(h2).toBe(h1);
      });

      it('o hashEntradas selado em abrir sobrevive INTACTO ao ciclo até FECHADO', async () => {
        // 1) abrir sela o hash sobre as entradas; 2) o fluxo PENDENTE→REVISADO
        //    →FECHADO nunca recomputa nem reescreve o selo. Confirma que o livro
        //    /TXT gerado da versão fechada usa EXATAMENTE o hash das entradas
        //    congeladas na abertura (R1.2).
        const hashEsperado = FiscalClosingService.calcularHashEntradas(
          'EFD_ICMS_IPI',
          '2026-09-01',
          entradas(),
        );

        // abrir: proximaVersao (nenhuma anterior → 1) → insert.
        const aberto = makeTx([[]]);
        const svcAbrir = serviceComDb(aberto.db);
        const rascunho = await svcAbrir.abrir({
          ...ESCOPO,
          entradas: entradas(),
        });
        expect(aberto.inserts).toHaveLength(1);
        expect(aberto.inserts[0].hashEntradas).toBe(hashEsperado);
        expect(rascunho.hashEntradas).toBe(hashEsperado);

        // A linha congelada tal como ficaria no banco após a abertura.
        const congeladas = FiscalClosingService.congelarEntradas(entradas());
        let linha: Record<string, unknown> = {
          id: 'f1',
          clienteId: 'c1',
          obrigacao: 'EFD_ICMS_IPI',
          competencia: '2026-09-01',
          versao: 1,
          estado: 'RASCUNHO',
          corrente: false,
          motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
          hashEntradas: hashEsperado,
          aprovadoPor: null,
          fechadoEm: null,
          ...congeladas,
        };

        // PENDENTE → REVISADO: cada transição relê a linha e só muda o estado;
        // o hash nunca aparece no `set`.
        for (const destino of ['PENDENTE', 'REVISADO'] as const) {
          const t = makeTx([[linha]]);
          const svc = serviceComDb(t.db);
          const r = await svc.transicionar('f1', destino);
          for (const u of t.updates) {
            expect(u).not.toHaveProperty('hashEntradas');
          }
          expect(r.hashEntradas).toBe(hashEsperado);
          linha = { ...linha, estado: destino };
        }

        // REVISADO → FECHADO: fechar relê a linha, desmarca corrente anterior e
        // promove esta; nenhum dos `set` toca o hash.
        const fech = makeTx([[linha]]);
        const svcFechar = serviceComDb(fech.db);
        const fechado = await svcFechar.fechar({
          fechamentoId: 'f1',
          aprovadoPor: 'u1',
        });
        for (const u of fech.updates) {
          expect(u).not.toHaveProperty('hashEntradas');
        }
        expect(fechado.estado).toBe('FECHADO');
        expect(fechado.hashEntradas).toBe(hashEsperado);
      });

      it('re-projetar a MESMA versão fechada produz um ResultadoApuracao idêntico', async () => {
        // O snapshot congelado é a única fonte: duas projeções da mesma versão
        // fechada (mesma janela) são byte-a-byte iguais — livro/TXT reproduzíveis.
        const linhaFechada = {
          id: 'f1',
          clienteId: 'c1',
          obrigacao: 'EFD_ICMS_IPI',
          competencia: '2026-09-01',
          versao: 2,
          estado: 'FECHADO',
          corrente: true,
          motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
          hashEntradas: 'a'.repeat(64),
          aprovadoPor: 'u1',
          fechadoEm: new Date('2026-10-01T00:00:00Z'),
          documentos: [
            { chave: 'A', valorContabil: '100.00', valorIcms: '18.00' },
            { chave: 'B', valorContabil: '250.50', valorIcms: '45.09' },
          ],
          decisoes: [],
          regras: [],
          parametros: {},
          saldos: {
            debitos: '45.09',
            creditos: '18.00',
            saldoApurado: '27.09',
          },
        };
        const svc = serviceComLinha(linhaFechada);
        const projecao1 = await svc.projetarApuracao('f1');
        const projecao2 = await svc.projetarApuracao('f1');
        // Igualdade estrutural total: totais, memórias, inconsistências e
        // detalhamento — nada depende da execução, só do snapshot congelado.
        expect(projecao2).toEqual(projecao1);
        expect(projecao2.hashEntradas).toBe('a'.repeat(64));
      });

      it('entradas idênticas em versões distintas projetam os MESMOS totais e detalhamento', async () => {
        // Mesmo que a identidade da versão difira (id/versão), o resultado
        // projetado de entradas idênticas é o mesmo — reprodutibilidade entre
        // execuções/versões, não só entre chamadas de uma mesma linha.
        const saldos = {
          debitos: '45.09',
          creditos: '18.00',
          saldoApurado: '27.09',
        };
        const documentos = [
          { chave: 'A', valorContabil: '100.00', valorIcms: '18.00' },
          { chave: 'B', valorContabil: '250.50', valorIcms: '45.09' },
        ];
        const base = {
          clienteId: 'c1',
          obrigacao: 'EFD_ICMS_IPI',
          competencia: '2026-09-01',
          estado: 'FECHADO',
          corrente: true,
          motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
          aprovadoPor: 'u1',
          fechadoEm: new Date('2026-10-01T00:00:00Z'),
          decisoes: [],
          regras: [],
          parametros: {},
          documentos,
          saldos,
        };
        const svcV1 = serviceComLinha({
          ...base,
          id: 'f1',
          versao: 1,
          hashEntradas: 'a'.repeat(64),
        });
        const svcV2 = serviceComLinha({
          ...base,
          id: 'f2',
          versao: 2,
          hashEntradas: 'a'.repeat(64),
        });
        const r1 = await svcV1.projetarApuracao('f1');
        const r2 = await svcV2.projetarApuracao('f2');
        // A identidade da versão difere; a MEMÓRIA DE CÁLCULO não.
        expect(r2.totais).toEqual(r1.totais);
        expect(r2.memorias).toEqual(r1.memorias);
        expect(r2.detalhamento).toEqual(r1.detalhamento);
      });
    });

    describe('R1.4 — edição após fechamento cria nova versão; a anterior fica intacta', () => {
      const correnteFechada = {
        id: 'f1',
        clienteId: 'c1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09-01',
        versao: 1,
        estado: 'FECHADO' as const,
        corrente: true,
        motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
        hashEntradas: 'a'.repeat(64),
        aprovadoPor: 'u1',
        fechadoEm: new Date('2026-10-01T00:00:00Z'),
        documentos: [{ chave: 'A', valorTotal: '100.00' }],
        decisoes: [],
        regras: [],
        parametros: {},
        saldos: { saldoApurado: '10.00' },
      };

      it('editar após o fechamento cria a próxima versão em RASCUNHO sem escrever na entrega anterior', async () => {
        // editar = abrir com rótulo semântico: proximaVersao vê a versão 1
        // FECHADA → nova é 2; apenas UMA inserção; NENHUM update (a entrega
        // FECHADA nunca é tocada).
        const { db, inserts, updates } = makeTx([[{ versao: 1 }]]);
        const svc = serviceComDb(db);

        const nova = await svc.editar({
          ...ESCOPO,
          entradas: entradas({
            documentos: [{ chave: 'A', valorTotal: '123.45' }],
          }),
        });

        expect(nova.versao).toBe(2);
        expect(nova.estado).toBe('RASCUNHO');
        expect(nova.corrente).toBe(false);
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({
          versao: 2,
          estado: 'RASCUNHO',
          corrente: false,
        });
        // A invariante central do R1.4: a versão anterior não recebe NENHUMA
        // escrita durante a edição.
        expect(updates).toHaveLength(0);
      });

      it('a nova versão da edição sela o hash das NOVAS entradas, distinto do hash da entrega anterior', async () => {
        const entradasEditadas = entradas({
          documentos: [{ chave: 'A', valorTotal: '123.45' }],
        });
        const hashEditado = FiscalClosingService.calcularHashEntradas(
          'EFD_ICMS_IPI',
          '2026-09-01',
          entradasEditadas,
        );
        const { db, inserts } = makeTx([[{ versao: 1 }]]);
        const svc = serviceComDb(db);

        await svc.editar({ ...ESCOPO, entradas: entradasEditadas });

        expect(inserts[0].hashEntradas).toBe(hashEditado);
        // A edição mudou as entradas → o selo diverge do da entrega anterior.
        expect(inserts[0].hashEntradas).not.toBe(correnteFechada.hashEntradas);
      });

      it('sinalizarRevisaoPosFechamento abre a revisão sem tocar a entrega FECHADA (R1.3/R1.4)', async () => {
        // Caminho dos ESCRITORES (importação/baixa de bem/edição de regra): a
        // competência fechada passa a ter uma revisão RASCUNHO em aberto, mas a
        // entrega congelada (f1) não recebe nenhuma escrita.
        const { tx, db, inserts, updates } = makeTx([
          [correnteFechada], // carregarCorrenteFechada
          [], // carregarRevisaoAberta → nenhuma
          [{ versao: 1 }], // proximaVersao → próxima é 2
        ]);
        const svc = serviceComDb(db);
        const r = await db.transaction(() =>
          svc.sinalizarRevisaoPosFechamento(tx, ESCOPO),
        );

        expect(r.revisaoNecessaria).toBe(true);
        expect(r.revisaoAberta).toBe(true);
        expect(r.revisaoVersao).toBe(2);
        // A entrega fechada nunca é atualizada; só nasce a revisão.
        expect(updates).toHaveLength(0);
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({
          versao: 2,
          estado: 'RASCUNHO',
          corrente: false,
        });
        // A revisão herda os snapshots da entrega fechada (ponto de partida),
        // sem alterá-la.
        expect(inserts[0].documentos).toEqual(correnteFechada.documentos);
      });
    });
  });
});
