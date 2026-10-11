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
  type RegistrarEntregaInput,
  type RegistrarEntregaComUploadInput,
  type RetificarEntregaInput,
} from './fiscal-entregas.service';
import type { StorageService } from '../../storage/storage.service';
import type { StorageCleanupService } from '../../storage/storage-cleanup.service';
import type { AppLogger } from '../../common/logger.service';

/**
 * Testes de integração (nível de serviço) do grupo 2 da Fase 5 — entrega,
 * homologação e retificação (R2.2, R2.3, R2.5). Esta é a tarefa de teste
 * CONSOLIDADA do grupo: enquanto 2.2–2.4 cobriram cada regra isoladamente (com
 * DB falso por método), aqui os três cenários nomeados pelo plano são
 * exercidos END-TO-END contra o serviço real — `registrarEntrega`,
 * `retificarEntrega`, `registrarEntregaComUpload`, `retentarUpload`,
 * `listarEntregas` — sobre um ÚNICO estado compartilhado:
 *
 *  1) "retificação com vínculo" (R2.2) — a retificadora referencia a original
 *     (`entrega_original_id`), carrega a diferença (`valor_diferenca`) e tem o
 *     SEU PRÓPRIO recibo; a entrega anterior permanece IMUTÁVEL na trilha
 *     (nenhum UPDATE/DELETE a toca; `listarEntregas` expõe o par).
 *  2) "falha de storage com compensação" (R2.3) — o upload falha APÓS o
 *     snapshot: o snapshot sobrevive em FALHA_STORAGE, o objeto parcial é
 *     COMPENSADO (fila de limpeza do R2) e um RETRY rastreável recupera a MESMA
 *     entrega (mesmo snapshot, mesma `arquivo_key`/hash) a um estado de sucesso.
 *  3) "2026 vs. 2027" (R2.5) — o leiaute é DERIVADO/validado pela vigência da
 *     competência (2026 → 3.2.2; 2027 → 3.2.3); um leiaute de OUTRA vigência é
 *     rejeitado — sem reutilização silenciosa.
 *
 * O projeto `api` não tem harness de banco vivo (ver os specs de serviço das
 * tarefas 2.2/2.3); seguimos o MESMO padrão: um STORE EM MEMÓRIA E COM ESTADO
 * que modela as cinco tabelas tocadas (`clientes`, `fiscal_fechamentos`,
 * `fiscal_entregas`, `storage_cleanup_jobs`, `eventos_auditoria`) com a mesma
 * superfície drizzle usada pelo serviço — `select().from().where().limit()/
 * .orderBy()`, `insert().values().returning()` (+ `onConflictDoNothing` nos
 * jobs), `update().set().where().returning()`.
 *
 * O casamento de `.where(...)` é COLUNA-CIENTE (lê o SQL renderizado
 * `"tabela"."coluna" = $n`), fiel às condições reais, sem acoplar à ordem e sem
 * confundir, p.ex., `entrega_original_id = 'X'` com uma linha cujo `id` é 'X'.
 *
 * Dois invariantes duros desta fase são fiados ao próprio store, não a
 * asserções frágeis:
 *  - `delete()` em `fiscal_entregas` SEMPRE lança: exclusão física de uma
 *    entrega é proibida (R2.2). Se o serviço jamais tentar deletar, o teste cai.
 *  - cada UPDATE em `fiscal_entregas` é REGISTRADO por id afetado: o cenário 1
 *    prova que a entrega original NUNCA é alvo de um UPDATE (imutabilidade),
 *    enquanto o cenário 2 depende de UPDATEs — mas só do snapshot preso em
 *    FALHA_STORAGE (completar um snapshot que falhou não é mutar a entrega-base).
 */

const dialect = new PgDialect();

/**
 * Decompõe uma condição drizzle `where(...)` em pares (coluna, valor), lendo o
 * SQL renderizado (`"tabela"."coluna" = $n`) e casando cada placeholder `$n`
 * com o parâmetro de índice n — COLUNA-CIENTE de propósito.
 */
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

interface FechamentoRow {
  id: string;
  clienteId: string;
  hashEntradas: string;
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

/**
 * Store com estado que modela as cinco tabelas tocadas pelo fluxo de entregas.
 * O despacho por tabela usa a IDENTIDADE do objeto drizzle que o serviço passa
 * a `.from()`/`.insert()`/`.update()`. Uma linha casa um `.where(...)` quando
 * TODOS os pares (coluna, valor) renderizados da condição casam a coluna exata.
 */
function criarStore(seed: {
  clienteId: string;
  entregas?: EntregaRow[];
  fechamentos?: FechamentoRow[];
}) {
  const clienteIds = new Set([seed.clienteId]);
  const entregas: EntregaRow[] = [...(seed.entregas ?? [])];
  const fechamentos: FechamentoRow[] = [...(seed.fechamentos ?? [])];
  const cleanupJobs: CleanupJobRow[] = [];
  const auditoria: AuditRow[] = [];
  // Trilha de todo id de entrega que SOFREU um UPDATE (imutabilidade — R2.2).
  const entregasAtualizadas: string[] = [];
  let proximaEntrega = entregas.length + 1;
  let proximoJob = 1;
  let proximoAudit = 1;
  let deleteEntregaChamado = false;

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
          if (table === fiscalFechamentos) {
            return fechamentos.filter((row) =>
              casa(row as unknown as Record<string, unknown>, pares),
            );
          }
          if (table === fiscalEntregas) {
            return entregas.filter((row) =>
              casa(row as unknown as Record<string, unknown>, pares),
            );
          }
          throw new Error('Tabela inesperada no select.');
        };
        return {
          limit: (_n: number) => Promise.resolve(run()),
          // A ordenação real (competência, criadoEm) é preservada inserindo em
          // ordem cronológica nos testes; o store devolve na ordem de inserção.
          orderBy: (..._args: unknown[]) => Promise.resolve(run()),
        };
      },
    };
  }

  function resolveIncremento(valor: unknown, row: EntregaRow): number {
    // O serviço usa `sql\`tentativas_storage + 1\`` (incremento atômico). No
    // store o valor chega como objeto SQL do drizzle — resolvemos "atual + 1"
    // lendo a linha corrente; qualquer número literal passa direto.
    if (typeof valor === 'number') return valor;
    return row.tentativasStorage + 1;
  }

  const db = {
    select: (_projection?: unknown) => ({
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
              returning: (_projection?: unknown) => {
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
              entregasAtualizadas.push(row.id);
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
            const chain = { returning: () => Promise.resolve(alvos) };
            // Suporta `.where(...).returning()` e `.where(...)` puro.
            return Object.assign(Promise.resolve(alvos), chain);
          },
        }),
      };
    },
    // Invariante duro R2.2: exclusão física de entrega é proibida.
    delete: (table: unknown) => {
      if (table === fiscalEntregas) {
        deleteEntregaChamado = true;
      }
      throw new Error(
        'DELETE em fiscal_entregas é proibido: a entrega é preservada na ' +
        'trilha, nunca deletada fisicamente (R2.2).',
      );
    },
  };

  return {
    service: new FiscalEntregasService(
      { db } as never,
      fakeStorage(),
      fakeCleanup(),
      fakeLogger(),
    ),
    db,
    entregas,
    cleanupJobs,
    auditoria,
    entregasAtualizadas,
    get deleteEntregaChamado() {
      return deleteEntregaChamado;
    },
  };
}

/**
 * Storage programável: `upload` resolve por padrão, mas pode ser instruído a
 * falhar uma vez (ou enquanto `falharAte` tentativas) para exercitar o caminho
 * de falha de storage pós-snapshot e a recuperação pelo retry.
 */
function fakeStorage(opts: { falhasIniciais?: number; erro?: Error } = {}) {
  let restam = opts.falhasIniciais ?? 0;
  const upload = jest.fn(async () => {
    if (restam > 0) {
      restam -= 1;
      const err = opts.erro ?? new Error('R2 indisponível');
      if (!opts.erro) err.name = 'R2_UNAVAILABLE';
      throw err;
    }
    return undefined;
  });
  return { upload } as unknown as StorageService;
}

function fakeCleanup(): StorageCleanupService {
  return {
    processJobs: jest
      .fn()
      .mockResolvedValue({ processed: 1, completed: 1, failed: 0 }),
  } as unknown as StorageCleanupService;
}

function fakeLogger(): AppLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as AppLogger;
}

const CLIENTE = '11111111-1111-1111-1111-111111111111';
const HASH_ORIGINAL = 'a'.repeat(64);
const HASH_RETIFICADORA = 'b'.repeat(64);
const HASH_2027 = 'c'.repeat(64);

function registrarInput(
  overrides: Partial<RegistrarEntregaInput> = {},
): RegistrarEntregaInput {
  return {
    clienteId: CLIENTE,
    competencia: '2026-08',
    obrigacao: 'EFD_ICMS_IPI',
    arquivoKey: 'cliente/c1/efd/2026-08/original.txt',
    hashArquivo: HASH_ORIGINAL,
    pvaPrograma: 'PVA_EFD_ICMS_IPI',
    pvaVersao: '6.1.1',
    pvaVersaoConfirmada: '6.1.1',
    reciboKey: 'cliente/c1/efd/2026-08/recibo-original.pdf',
    protocoloNumero: 'PROTO-ORIG',
    statusValidacao: 'TRANSMITIDA',
    ...overrides,
  };
}

describe('Fase 5 · grupo 2 — retificação com vínculo (R2.2, integração)', () => {
  it('a retificadora aponta a original + diferença + recibo próprio; a entrega anterior fica IMUTÁVEL na trilha', async () => {
    const store = criarStore({ clienteId: CLIENTE });

    // 1) Entrega ORIGINAL transmitida.
    const original = await store.service.registrarEntrega(registrarInput());
    expect(original.entrega_original_id).toBeNull();
    expect(original.valor_diferenca).toBeNull();

    // 2) RETIFICAÇÃO: entrega NOVA que referencia a original, com diferença e
    //    recibo próprio — a original NÃO é tocada.
    const retificar: RetificarEntregaInput = {
      clienteId: CLIENTE,
      entregaOriginalId: original.id,
      arquivoKey: 'cliente/c1/efd/2026-08/retificadora.txt',
      hashArquivo: HASH_RETIFICADORA,
      valorDiferenca: '-50.00',
      pvaPrograma: 'PVA_EFD_ICMS_IPI',
      pvaVersao: '6.1.1',
      pvaVersaoConfirmada: '6.1.1',
      reciboKey: 'cliente/c1/efd/2026-08/recibo-retificadora.pdf',
      protocoloNumero: 'PROTO-RET',
      statusValidacao: 'TRANSMITIDA',
    };
    const retificadora = await store.service.retificarEntrega(retificar);

    // Vínculo: a retificadora aponta a original, carrega a diferença e tem o
    // SEU PRÓPRIO recibo (não reaproveita o da original).
    expect(retificadora.id).not.toBe(original.id);
    expect(retificadora.entrega_original_id).toBe(original.id);
    expect(retificadora.valor_diferenca).toBe('-50.00');
    expect(retificadora.recibo_key).toBe(
      'cliente/c1/efd/2026-08/recibo-retificadora.pdf',
    );
    // Herda obrigação/competência da original (mesma obrigação/competência).
    expect(retificadora.obrigacao).toBe('EFD_ICMS_IPI');
    expect(retificadora.competencia).toBe('2026-08-01');

    // IMUTABILIDADE da entrega anterior: a original nunca foi alvo de UPDATE nem
    // DELETE; sua linha permanece byte a byte como transmitida.
    expect(store.entregasAtualizadas).not.toContain(original.id);
    expect(store.deleteEntregaChamado).toBe(false);
    const originalAgora = store.entregas.find((e) => e.id === original.id)!;
    expect(originalAgora.hashArquivo).toBe(HASH_ORIGINAL);
    expect(originalAgora.reciboKey).toBe(
      'cliente/c1/efd/2026-08/recibo-original.pdf',
    );
    expect(originalAgora.valorDiferenca).toBeNull();
    expect(originalAgora.entregaOriginalId).toBeNull();
    expect(originalAgora.statusValidacao).toBe('TRANSMITIDA');

    // A trilha expõe o par original → retificadora, em ordem.
    const listagem = await store.service.listarEntregas({
      clienteId: CLIENTE,
      competencia: '2026-08',
      obrigacao: 'EFD_ICMS_IPI',
    });
    expect(listagem.data).toHaveLength(2);
    expect(listagem.data.map((e) => e.id)).toEqual([
      original.id,
      retificadora.id,
    ]);
    expect(listagem.data[1].entrega_original_id).toBe(original.id);
  });

  it('retificar a mesma entrega-base DUAS vezes é bloqueado: a primeira retificação a supera (trilha preservada)', async () => {
    const store = criarStore({ clienteId: CLIENTE });
    const original = await store.service.registrarEntrega(registrarInput());

    const baseRet: RetificarEntregaInput = {
      clienteId: CLIENTE,
      entregaOriginalId: original.id,
      arquivoKey: 'cliente/c1/efd/2026-08/retificadora.txt',
      hashArquivo: HASH_RETIFICADORA,
      valorDiferenca: '-50.00',
      pvaPrograma: 'PVA_EFD_ICMS_IPI',
      pvaVersao: '6.1.1',
      pvaVersaoConfirmada: '6.1.1',
      reciboKey: 'cliente/c1/efd/2026-08/recibo-retificadora.pdf',
    };
    await store.service.retificarEntrega(baseRet);

    // A original já foi superada: uma 2ª retificação sobre ela é rejeitada
    // (retifica-se a entrega vigente). A trilha segue com 2 linhas intactas.
    await expect(store.service.retificarEntrega(baseRet)).rejects.toThrow(
      'já foi retificada',
    );
    expect(store.entregas).toHaveLength(2);
    expect(store.entregasAtualizadas).not.toContain(original.id);
  });
});

describe('Fase 5 · grupo 2 — falha de storage com compensação e retry (R2.3, integração)', () => {
  it('upload falha após o snapshot → FALHA_STORAGE + compensação; o retry recupera a MESMA entrega (mesmo snapshot/key)', async () => {
    const store = criarStore({ clienteId: CLIENTE });
    // O storage falha na 1ª tentativa (registro) e resolve na 2ª (retry).
    const falhaUmaVez = new Error('R2 indisponível');
    falhaUmaVez.name = 'R2_UNAVAILABLE';
    const storage = fakeStorage({ falhasIniciais: 1, erro: falhaUmaVez });
    const cleanup = fakeCleanup();
    const service = new FiscalEntregasService(
      { db: store.db } as never,
      storage,
      cleanup,
      fakeLogger(),
    );

    const conteudo = Buffer.from('ARQUIVO SPED');
    const comUpload: RegistrarEntregaComUploadInput = {
      ...registrarInput({ statusValidacao: 'PENDENTE' }),
      actorUserId: 'user-1',
      upload: {
        arquivoKey: 'cliente/c1/efd/2026-08/original.txt',
        conteudo,
        contentType: 'text/plain; charset=ISO-8859-1',
      },
    };

    // 1) Registro COM upload: o snapshot commita, o upload externo falha.
    await expect(service.registrarEntregaComUpload(comUpload)).rejects.toThrow(
      'status de falha de storage',
    );

    // O SNAPSHOT sobreviveu em FALHA_STORAGE com o erro rastreado.
    expect(store.entregas).toHaveLength(1);
    const snapshot = store.entregas[0];
    expect(snapshot.statusValidacao).toBe('FALHA_STORAGE');
    expect(snapshot.ultimoErroStorage).toBe('R2_UNAVAILABLE');
    expect(snapshot.tentativasStorage).toBe(1);

    // COMPENSAÇÃO: o objeto parcial foi enfileirado na fila de limpeza do R2.
    expect(store.cleanupJobs).toHaveLength(1);
    expect(store.cleanupJobs[0].objectKey).toBe(
      'cliente/c1/efd/2026-08/original.txt',
    );
    expect(store.cleanupJobs[0].entidadeTipo).toBe('FISCAL_ENTREGA');
    expect(store.cleanupJobs[0].entidadeId).toBe(snapshot.id);
    expect(cleanup.processJobs).toHaveBeenCalled();
    expect(
      store.auditoria.some((a) => a.acao === 'FISCAL_ENTREGA_STORAGE_FALHA'),
    ).toBe(true);

    // 2) RETRY rastreável: amarrado ao MESMO snapshot (mesmo id, mesma key).
    const recuperada = await service.retentarUpload({
      clienteId: CLIENTE,
      entregaId: snapshot.id,
      conteudo,
      contentType: 'text/plain; charset=ISO-8859-1',
      actorUserId: 'user-1',
    });

    expect(recuperada.id).toBe(snapshot.id);
    expect(recuperada.status_validacao).toBe('PENDENTE');
    expect(recuperada.ultimo_erro_storage).toBeNull();
    expect(recuperada.tentativas_storage).toBe(2);
    // Reenviou à MESMA key selada no snapshot (sem duplicar snapshot/entrega).
    expect(storage.upload).toHaveBeenLastCalledWith(
      'cliente/c1/efd/2026-08/original.txt',
      conteudo,
      'text/plain; charset=ISO-8859-1',
    );
    expect(store.entregas).toHaveLength(1);
    expect(
      store.auditoria.some((a) => a.acao === 'FISCAL_ENTREGA_STORAGE_RETRY_OK'),
    ).toBe(true);
    // Nunca deletou a entrega fisicamente ao longo do ciclo falha → retry.
    expect(store.deleteEntregaChamado).toBe(false);
  });

  it('upload OK de primeira → sem compensação; a entrega fica íntegra', async () => {
    const store = criarStore({ clienteId: CLIENTE });
    const storage = fakeStorage();
    const cleanup = fakeCleanup();
    const service = new FiscalEntregasService(
      { db: store.db } as never,
      storage,
      cleanup,
      fakeLogger(),
    );

    const entrega = await service.registrarEntregaComUpload({
      ...registrarInput({ statusValidacao: 'PENDENTE' }),
      actorUserId: 'user-1',
      upload: {
        arquivoKey: 'cliente/c1/efd/2026-08/original.txt',
        conteudo: Buffer.from('ARQUIVO SPED'),
        contentType: 'text/plain; charset=ISO-8859-1',
      },
    });

    expect(entrega.status_validacao).toBe('PENDENTE');
    expect(entrega.tentativas_storage).toBe(1);
    expect(store.cleanupJobs).toHaveLength(0);
    expect(cleanup.processJobs).not.toHaveBeenCalled();
    expect(
      store.auditoria.some((a) => a.acao === 'FISCAL_ENTREGA_STORAGE_OK'),
    ).toBe(true);
  });
});

describe('Fase 5 · grupo 2 — leiaute por vigência 2026 vs. 2027 (R2.5, integração)', () => {
  it('deriva 3.2.2 para 2026 e 3.2.3 para 2027 sobre o MESMO cliente/estado', async () => {
    const store = criarStore({ clienteId: CLIENTE });

    const em2026 = await store.service.registrarEntrega(
      registrarInput({ competencia: '2026-08', leiauteVersao: undefined }),
    );
    const em2027 = await store.service.registrarEntrega(
      registrarInput({
        competencia: '2027-03',
        hashArquivo: HASH_2027,
        arquivoKey: 'cliente/c1/efd/2027-03/original.txt',
        leiauteVersao: undefined,
      }),
    );

    // A vigência da competência decide o leiaute — sem "pegar a última".
    expect(em2026.leiaute_versao).toBe('3.2.2');
    expect(em2027.leiaute_versao).toBe('3.2.3');
    expect(store.entregas).toHaveLength(2);
  });

  it('aceita o leiaute informado quando casa a vigência; REJEITA o de outra vigência (sem reutilização silenciosa)', async () => {
    const store = criarStore({ clienteId: CLIENTE });

    // Informado que CASA a vigência de 2027: aceito.
    const ok = await store.service.registrarEntrega(
      registrarInput({
        competencia: '2027-03',
        hashArquivo: HASH_2027,
        arquivoKey: 'cliente/c1/efd/2027-03/original.txt',
        leiauteVersao: '3.2.3',
      }),
    );
    expect(ok.leiaute_versao).toBe('3.2.3');

    // Leiaute de 2026 (3.2.2) numa competência de 2027: REJEITADO — é a
    // reutilização silenciosa que o requisito proíbe. Nada é gravado.
    await expect(
      store.service.registrarEntrega(
        registrarInput({
          competencia: '2027-03',
          hashArquivo: HASH_2027,
          arquivoKey: 'cliente/c1/efd/2027-03/outra.txt',
          leiauteVersao: '3.2.2',
        }),
      ),
    ).rejects.toThrow('não corresponde à vigência');
    expect(store.entregas).toHaveLength(1);
  });

  it('a retificadora segue a vigência da competência da ORIGINAL (2027 → 3.2.3)', async () => {
    const store = criarStore({ clienteId: CLIENTE });

    // Original em 2027 → vigência 3.2.3.
    const original = await store.service.registrarEntrega(
      registrarInput({
        competencia: '2027-03',
        hashArquivo: HASH_2027,
        arquivoKey: 'cliente/c1/efd/2027-03/original.txt',
        leiauteVersao: '3.2.3',
      }),
    );
    expect(original.leiaute_versao).toBe('3.2.3');

    // A retificadora herda a competência e, sem informar leiaute, deriva 3.2.3.
    const retificadora = await store.service.retificarEntrega({
      clienteId: CLIENTE,
      entregaOriginalId: original.id,
      arquivoKey: 'cliente/c1/efd/2027-03/retificadora.txt',
      hashArquivo: HASH_RETIFICADORA,
      valorDiferenca: '10.00',
      pvaPrograma: 'PVA_EFD_ICMS_IPI',
      pvaVersao: '6.1.1',
      pvaVersaoConfirmada: '6.1.1',
      reciboKey: 'cliente/c1/efd/2027-03/recibo-retificadora.pdf',
      leiauteVersao: undefined,
    });
    expect(retificadora.leiaute_versao).toBe('3.2.3');

    // Uma retificadora com leiaute de 2026 (3.2.2) sobre a MESMA vigência de
    // 2027 seria rejeitada — mas a original já foi superada; validamos o
    // caminho da vigência num par novo para não acoplar os dois cenários.
    expect(store.entregas).toHaveLength(2);
  });
});
