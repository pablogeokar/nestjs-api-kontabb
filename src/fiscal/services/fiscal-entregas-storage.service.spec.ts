import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import {
  clientes,
  eventosAuditoria,
  fiscalEntregas,
  fiscalFechamentos,
  storageCleanupJobs,
} from '../../database/schema';
import {
  FiscalEntregasService,
  type RegistrarEntregaComUploadInput,
  type RetentarUploadEntregaInput,
} from './fiscal-entregas.service';
import type { StorageService } from '../../storage/storage.service';
import type { StorageCleanupService } from '../../storage/storage-cleanup.service';
import type { AppLogger } from '../../common/logger.service';

/**
 * Testes de serviço da tarefa 2.3 da Fase 5 — falha de storage após o snapshot
 * (R2.3). Cobrem os três invariantes nomeados pela tarefa:
 *
 *  1) FALHA DE STORAGE PÓS-SNAPSHOT: o snapshot da entrega COMMITA (ele usa o
 *     banco); o upload externo (R2) é FORA da transação. Quando o upload falha,
 *     a entrega fica em FALHA_STORAGE e o objeto parcial/órfão é COMPENSADO —
 *     enfileirado na fila de limpeza do R2 (`storage_cleanup_jobs`).
 *  2) RETRY RASTREÁVEL: o retry é amarrado ao MESMO snapshot (não cria entrega
 *     nova, não toca arquivo_key/hash); em sucesso, o status volta a um estado
 *     de sucesso, `tentativas_storage` sobe e a trilha fica em auditoria.
 *  3) SUCESSO DE PRIMEIRA: sem falha, nenhuma compensação é enfileirada e a
 *     entrega não vai a FALHA_STORAGE.
 *
 * O store em memória modela as tabelas tocadas e, diferente do store da tarefa
 * 2.2, PERMITE UPDATE de `fiscal_entregas` — porque o retry transiciona o status
 * no MESMO snapshot (a imutabilidade da 2.2 é da entrega íntegra/transmitida, não
 * de um snapshot preso em FALHA_STORAGE sendo completado).
 */

const dialect = new PgDialect();

function paresColunaValor(condition: unknown): Array<[string, unknown]> {
  const rendered = dialect.sqlToQuery(condition as SQL);
  const pares: Array<[string, unknown]> = [];
  const re = /"[a-z_]+"\."([a-z_]+)"\s*=\s*\$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rendered.sql)) !== null) {
    const coluna = snakeParaCamel(m[1]);
    const valor = rendered.params[Number(m[2]) - 1];
    pares.push([coluna, valor]);
  }
  return pares;
}

function snakeParaCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_all, c: string) => c.toUpperCase());
}

interface EntregaRow {
  id: string;
  clienteId: string;
  fechamentoId: string | null;
  obrigacao: string;
  competencia: string;
  arquivoKey: string;
  hashArquivo: string;
  pvaPrograma: string;
  pvaVersao: string;
  statusValidacao: string;
  validacaoResultado: Record<string, unknown>;
  assinaturaTitular: string | null;
  assinaturaEm: Date | null;
  protocoloNumero: string | null;
  reciboKey: string | null;
  entregaOriginalId: string | null;
  valorDiferenca: string | null;
  leiauteVersao: string;
  transmitidaEm: Date | null;
  tentativasStorage: number;
  ultimoErroStorage: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

interface CleanupJobRow {
  id: string;
  objectKey: string;
  entidadeTipo: string;
  entidadeId: string;
  status: string;
}

interface AuditRow {
  id: string;
  atorUserId: string | null;
  acao: string;
  entidadeTipo: string;
  entidadeId: string;
  dados: Record<string, unknown>;
}

function criarStore(seed: { clienteId: string; entregas?: EntregaRow[] }) {
  const clienteIds = new Set([seed.clienteId]);
  const entregas: EntregaRow[] = [...(seed.entregas ?? [])];
  const cleanupJobs: CleanupJobRow[] = [];
  const auditoria: AuditRow[] = [];
  let proximaEntrega = entregas.length + 1;
  let proximoJob = 1;
  let proximoAudit = 1;

  function casa(
    row: Record<string, unknown>,
    pares: Array<[string, unknown]>,
  ): boolean {
    return pares.every(([coluna, valor]) => row[coluna] === valor);
  }

  function selectFrom(table: unknown) {
    return {
      where(condition: unknown) {
        const pares = paresColunaValor(condition);
        const run = () => {
          if (table === clientes) {
            return [...clienteIds]
              .map((id) => ({ id }))
              .filter((row) => casa(row, pares));
          }
          if (table === fiscalFechamentos) return [];
          if (table === fiscalEntregas) {
            return entregas.filter((row) =>
              casa(row as unknown as Record<string, unknown>, pares),
            );
          }
          throw new Error('Tabela inesperada no select.');
        };
        return {
          limit: () => Promise.resolve(run()),
          orderBy: () => Promise.resolve(run()),
        };
      },
    };
  }

  function resolveIncremento(valor: unknown, row: EntregaRow): number {
    // O serviço usa `sql\`tentativas_storage + 1\`` (incremento atômico). No
    // store o valor chega como objeto SQL do drizzle — resolvemos a semântica
    // "atual + 1" lendo a linha corrente; qualquer número literal passa direto.
    if (typeof valor === 'number') return valor;
    return row.tentativasStorage + 1;
  }

  const db = {
    select: () => ({
      from: (table: unknown) => selectFrom(table),
    }),
    insert: (table: unknown) => {
      if (table === fiscalEntregas) {
        return {
          values: (values: Partial<EntregaRow>) => ({
            returning: () => {
              const now = new Date('2026-09-01T00:00:00Z');
              const row: EntregaRow = {
                id: `entrega-${proximaEntrega++}`,
                clienteId: values.clienteId!,
                fechamentoId: values.fechamentoId ?? null,
                obrigacao: values.obrigacao!,
                competencia: values.competencia!,
                arquivoKey: values.arquivoKey!,
                hashArquivo: values.hashArquivo!,
                pvaPrograma: values.pvaPrograma!,
                pvaVersao: values.pvaVersao!,
                statusValidacao: values.statusValidacao ?? 'PENDENTE',
                validacaoResultado: values.validacaoResultado ?? {},
                assinaturaTitular: values.assinaturaTitular ?? null,
                assinaturaEm: values.assinaturaEm ?? null,
                protocoloNumero: values.protocoloNumero ?? null,
                reciboKey: values.reciboKey ?? null,
                entregaOriginalId: values.entregaOriginalId ?? null,
                valorDiferenca: values.valorDiferenca ?? null,
                leiauteVersao: values.leiauteVersao!,
                transmitidaEm: values.transmitidaEm ?? null,
                tentativasStorage: values.tentativasStorage ?? 0,
                ultimoErroStorage: values.ultimoErroStorage ?? null,
                criadoEm: now,
                atualizadoEm: now,
              };
              entregas.push(row);
              return Promise.resolve([row]);
            },
          }),
        };
      }
      if (table === storageCleanupJobs) {
        return {
          values: (values: Partial<CleanupJobRow>) => ({
            onConflictDoNothing: () => ({
              returning: () => {
                // Idempotência por object_key: não re-enfileira a mesma key.
                const existente = cleanupJobs.find(
                  (j) => j.objectKey === values.objectKey,
                );
                if (existente) return Promise.resolve([]);
                const row: CleanupJobRow = {
                  id: `job-${proximoJob++}`,
                  objectKey: values.objectKey!,
                  entidadeTipo: values.entidadeTipo!,
                  entidadeId: values.entidadeId!,
                  status: 'PENDENTE',
                };
                cleanupJobs.push(row);
                return Promise.resolve([{ id: row.id }]);
              },
            }),
          }),
        };
      }
      if (table === eventosAuditoria) {
        return {
          values: (values: Partial<AuditRow>) => {
            const row: AuditRow = {
              id: `audit-${proximoAudit++}`,
              atorUserId: values.atorUserId ?? null,
              acao: values.acao!,
              entidadeTipo: values.entidadeTipo!,
              entidadeId: values.entidadeId!,
              dados: values.dados ?? {},
            };
            auditoria.push(row);
            return Promise.resolve(undefined);
          },
        };
      }
      throw new Error('Insert em tabela inesperada.');
    },
    update: (table: unknown) => {
      if (table !== fiscalEntregas) {
        throw new Error('Update em tabela inesperada.');
      }
      return {
        set: (patch: Partial<EntregaRow>) => ({
          where: (condition: unknown) => {
            const pares = paresColunaValor(condition);
            const alvos = entregas.filter((row) =>
              casa(row as unknown as Record<string, unknown>, pares),
            );
            for (const row of alvos) {
              if (patch.statusValidacao !== undefined) {
                row.statusValidacao = patch.statusValidacao;
              }
              if (patch.ultimoErroStorage !== undefined) {
                row.ultimoErroStorage = patch.ultimoErroStorage;
              }
              if (patch.tentativasStorage !== undefined) {
                row.tentativasStorage = resolveIncremento(
                  patch.tentativasStorage,
                  row,
                );
              }
              row.atualizadoEm = new Date('2026-09-02T00:00:00Z');
            }
            const chain = {
              returning: () => Promise.resolve(alvos),
            };
            // Suporta tanto `.where(...).returning()` quanto `.where(...)` puro.
            return Object.assign(Promise.resolve(alvos), chain);
          },
        }),
      };
    },
  };

  return { db, entregas, cleanupJobs, auditoria };
}

const HASH_A = 'a'.repeat(64);

function baseUpload(
  overrides: Partial<RegistrarEntregaComUploadInput> = {},
): RegistrarEntregaComUploadInput {
  return {
    clienteId: 'c1',
    competencia: '2026-08',
    obrigacao: 'EFD_ICMS_IPI',
    arquivoKey: 'cliente/c1/efd/2026-08/original.txt',
    hashArquivo: HASH_A,
    pvaPrograma: 'PVA_EFD_ICMS_IPI',
    pvaVersao: '6.1.1',
    pvaVersaoConfirmada: '6.1.1',
    leiauteVersao: '3.2.2',
    actorUserId: 'user-1',
    upload: {
      arquivoKey: 'cliente/c1/efd/2026-08/original.txt',
      conteudo: Buffer.from('ARQUIVO SPED'),
      contentType: 'text/plain; charset=ISO-8859-1',
    },
    ...overrides,
  };
}

function entregaFalhaStorageRow(
  overrides: Partial<EntregaRow> = {},
): EntregaRow {
  return {
    id: 'entrega-falha',
    clienteId: 'c1',
    fechamentoId: null,
    obrigacao: 'EFD_ICMS_IPI',
    competencia: '2026-08-01',
    arquivoKey: 'cliente/c1/efd/2026-08/original.txt',
    hashArquivo: HASH_A,
    pvaPrograma: 'PVA_EFD_ICMS_IPI',
    pvaVersao: '6.1.1',
    statusValidacao: 'FALHA_STORAGE',
    validacaoResultado: {},
    assinaturaTitular: null,
    assinaturaEm: null,
    protocoloNumero: null,
    reciboKey: null,
    entregaOriginalId: null,
    valorDiferenca: null,
    leiauteVersao: '3.2.2',
    transmitidaEm: null,
    tentativasStorage: 1,
    ultimoErroStorage: 'UPLOAD_ERROR',
    criadoEm: new Date('2026-08-15T00:00:00Z'),
    atualizadoEm: new Date('2026-08-15T00:00:00Z'),
    ...overrides,
  };
}

function fakeLogger(): AppLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as AppLogger;
}

describe('FiscalEntregasService — falha de storage pós-snapshot (R2.3)', () => {
  it('upload falha → entrega em FALHA_STORAGE + compensação enfileirada', async () => {
    const store = criarStore({ clienteId: 'c1' });
    const uploadErr = new Error('R2 indisponível');
    uploadErr.name = 'R2_UNAVAILABLE';
    const processJobs = jest
      .fn()
      .mockResolvedValue({ processed: 1, completed: 1, failed: 0 });
    const storage = {
      upload: jest.fn().mockRejectedValue(uploadErr),
    } as unknown as StorageService;
    const cleanup = {
      processJobs,
    } as unknown as StorageCleanupService;
    const service = new FiscalEntregasService(
      store as never,
      storage,
      cleanup,
      fakeLogger(),
    );

    await expect(
      service.registrarEntregaComUpload(baseUpload()),
    ).rejects.toThrow('status de falha de storage');

    // O SNAPSHOT sobreviveu (foi gravado antes do upload) e ficou FALHA_STORAGE.
    expect(store.entregas).toHaveLength(1);
    const snapshot = store.entregas[0];
    expect(snapshot.statusValidacao).toBe('FALHA_STORAGE');
    expect(snapshot.ultimoErroStorage).toBe('R2_UNAVAILABLE');

    // COMPENSAÇÃO: o objeto parcial foi enfileirado na fila de limpeza do R2.
    expect(store.cleanupJobs).toHaveLength(1);
    expect(store.cleanupJobs[0].objectKey).toBe(
      'cliente/c1/efd/2026-08/original.txt',
    );
    expect(store.cleanupJobs[0].entidadeTipo).toBe('FISCAL_ENTREGA');
    expect(store.cleanupJobs[0].entidadeId).toBe(snapshot.id);
    // Limpeza tentada já na requisição (best-effort).
    expect(processJobs).toHaveBeenCalled();

    // Trilha de auditoria da falha + compensação.
    const evento = store.auditoria.find(
      (a) => a.acao === 'FISCAL_ENTREGA_STORAGE_FALHA',
    );
    expect(evento).toBeDefined();
    expect(evento!.dados.compensacaoEnfileirada).toBe(true);
  });

  it('upload OK → sem compensação; entrega não vai a FALHA_STORAGE', async () => {
    const store = criarStore({ clienteId: 'c1' });
    const processJobs = jest.fn();
    const storage = {
      upload: jest.fn().mockResolvedValue(undefined),
    } as unknown as StorageService;
    const cleanup = {
      processJobs,
    } as unknown as StorageCleanupService;
    const service = new FiscalEntregasService(
      store as never,
      storage,
      cleanup,
      fakeLogger(),
    );

    const entrega = await service.registrarEntregaComUpload(baseUpload());

    expect(entrega.status_validacao).toBe('PENDENTE');
    expect(entrega.tentativas_storage).toBe(1);
    expect(store.cleanupJobs).toHaveLength(0);
    expect(processJobs).not.toHaveBeenCalled();
    expect(
      store.auditoria.some((a) => a.acao === 'FISCAL_ENTREGA_STORAGE_OK'),
    ).toBe(true);
  });

  it('rejeita quando a key do upload diverge da arquivoKey do snapshot', async () => {
    const store = criarStore({ clienteId: 'c1' });
    const upload = jest.fn();
    const storage = { upload } as unknown as StorageService;
    const cleanup = {
      processJobs: jest.fn(),
    } as unknown as StorageCleanupService;
    const service = new FiscalEntregasService(
      store as never,
      storage,
      cleanup,
      fakeLogger(),
    );

    await expect(
      service.registrarEntregaComUpload(
        baseUpload({
          upload: {
            arquivoKey: 'cliente/c1/efd/2026-08/OUTRA.txt',
            conteudo: Buffer.from('x'),
            contentType: 'text/plain',
          },
        }),
      ),
    ).rejects.toThrow('mesma `arquivoKey`');
    // Falhou antes de qualquer snapshot/upload.
    expect(store.entregas).toHaveLength(0);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('FiscalEntregasService — retry rastreável (R2.3)', () => {
  function baseRetry(
    overrides: Partial<RetentarUploadEntregaInput> = {},
  ): RetentarUploadEntregaInput {
    return {
      clienteId: 'c1',
      entregaId: 'entrega-falha',
      conteudo: Buffer.from('ARQUIVO SPED'),
      contentType: 'text/plain; charset=ISO-8859-1',
      actorUserId: 'user-1',
      ...overrides,
    };
  }

  it('retry OK → MESMO snapshot volta a status de sucesso; tentativas sobe', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [entregaFalhaStorageRow()],
    });
    const upload = jest.fn().mockResolvedValue(undefined);
    const storage = {
      upload,
    } as unknown as StorageService;
    const cleanup = {
      processJobs: jest.fn(),
    } as unknown as StorageCleanupService;
    const service = new FiscalEntregasService(
      store as never,
      storage,
      cleanup,
      fakeLogger(),
    );

    const resultado = await service.retentarUpload(baseRetry());

    // Mesmo snapshot (mesmo id), status de volta a sucesso, sem erro residual.
    expect(resultado.id).toBe('entrega-falha');
    expect(resultado.status_validacao).toBe('PENDENTE');
    expect(resultado.ultimo_erro_storage).toBeNull();
    expect(resultado.tentativas_storage).toBe(2);
    // Reenviou à MESMA key selada no snapshot (não duplicou snapshot).
    expect(upload).toHaveBeenCalledWith(
      'cliente/c1/efd/2026-08/original.txt',
      expect.anything(),
      'text/plain; charset=ISO-8859-1',
    );
    expect(store.entregas).toHaveLength(1);
    // Trilha de auditoria do retry bem-sucedido.
    expect(
      store.auditoria.some((a) => a.acao === 'FISCAL_ENTREGA_STORAGE_RETRY_OK'),
    ).toBe(true);
  });

  it('retry falha de novo → permanece FALHA_STORAGE; tentativas sobe; re-compensa', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [entregaFalhaStorageRow()],
    });
    const err = new Error('ainda indisponível');
    err.name = 'R2_STILL_DOWN';
    const storage = {
      upload: jest.fn().mockRejectedValue(err),
    } as unknown as StorageService;
    const cleanup = {
      processJobs: jest
        .fn()
        .mockResolvedValue({ processed: 1, completed: 1, failed: 0 }),
    } as unknown as StorageCleanupService;
    const service = new FiscalEntregasService(
      store as never,
      storage,
      cleanup,
      fakeLogger(),
    );

    await expect(service.retentarUpload(baseRetry())).rejects.toThrow(
      'falhou novamente',
    );

    const snapshot = store.entregas[0];
    expect(snapshot.statusValidacao).toBe('FALHA_STORAGE');
    expect(snapshot.ultimoErroStorage).toBe('R2_STILL_DOWN');
    expect(snapshot.tentativasStorage).toBe(2);
    expect(store.cleanupJobs).toHaveLength(1);
  });

  it('rejeita retry de entrega que NÃO está em FALHA_STORAGE', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [entregaFalhaStorageRow({ statusValidacao: 'TRANSMITIDA' })],
    });
    const upload = jest.fn();
    const storage = { upload } as unknown as StorageService;
    const cleanup = {
      processJobs: jest.fn(),
    } as unknown as StorageCleanupService;
    const service = new FiscalEntregasService(
      store as never,
      storage,
      cleanup,
      fakeLogger(),
    );

    await expect(service.retentarUpload(baseRetry())).rejects.toThrow(
      'FALHA_STORAGE',
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejeita retry de entrega inexistente/de outro cliente (NotFound)', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [entregaFalhaStorageRow({ clienteId: 'c2' })],
    });
    const storage = { upload: jest.fn() } as unknown as StorageService;
    const cleanup = {
      processJobs: jest.fn(),
    } as unknown as StorageCleanupService;
    const service = new FiscalEntregasService(
      store as never,
      storage,
      cleanup,
      fakeLogger(),
    );

    await expect(service.retentarUpload(baseRetry())).rejects.toThrow(
      'não encontrada',
    );
  });
});
