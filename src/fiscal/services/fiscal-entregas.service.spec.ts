import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import {
  clientes,
  fiscalEntregas,
  fiscalFechamentos,
} from '../../database/schema';
import {
  FiscalEntregasService,
  type RegistrarEntregaInput,
  type RetificarEntregaInput,
} from './fiscal-entregas.service';

/**
 * Testes de serviço da tarefa 2.2 da Fase 5 — entrega e retificação (R2.2/R2.4).
 *
 * Cobrem os dois invariantes nomeados pelo plano:
 *  1) a RETIFICAÇÃO cria uma entrega NOVA que referencia a original
 *     (`entrega_original_id`), carrega a DIFERENÇA (`valor_diferenca`) e tem o
 *     SEU PRÓPRIO recibo (`recibo_key`);
 *  2) a entrega ANTERIOR permanece IMUTÁVEL — a retificação só INSERE; nunca
 *     faz UPDATE/DELETE sobre a entrega-base.
 *
 * Também cobrem o vínculo recibo ↔ hash do fechamento (R2.4) e as rejeições
 * (original inexistente/de outro cliente; original já superada; retificar uma
 * retificadora encadeada).
 *
 * Seguindo o padrão de `fiscal-guias.service.spec.ts`, usamos um STORE EM
 * MEMÓRIA que modela as três tabelas tocadas. O casamento de `.where(...)` usa
 * os PARÂMETROS renderizados da condição (fiel às condições reais, sem acoplar à
 * ordem). O store PROÍBE `update()`/`delete()` sobre `fiscal_entregas`: se o
 * serviço jamais tentar mutar/apagar uma entrega existente, o teste cai na hora
 * — é a trava dura da imutabilidade da entrega anterior (R2.2).
 */

const dialect = new PgDialect();

/**
 * Decompõe uma condição drizzle `where(...)` em pares (coluna, valor), lendo o
 * SQL renderizado (`"tabela"."coluna" = $n`) e casando cada placeholder `$n`
 * com o parâmetro de índice n. É COLUNA-CIENTE de propósito: um matcher que só
 * olha "o valor aparece em alguma coluna da linha" confundiria, p.ex.,
 * `entrega_original_id = 'X'` com uma linha cujo `id` é 'X'. Aqui cada condição
 * é casada contra a coluna exata, fiel ao WHERE real.
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
  criadoEm: Date;
  atualizadoEm: Date;
}

interface FechamentoRow {
  id: string;
  clienteId: string;
  hashEntradas: string;
}

/**
 * Store com estado que modela `clientes`, `fiscal_fechamentos` e
 * `fiscal_entregas`. O despacho por tabela usa a IDENTIDADE do objeto drizzle
 * passado a `.from()`/`.insert()`. Uma linha casa um `.where(...)` quando TODOS
 * os parâmetros renderizados da condição aparecem como valores de colunas da
 * linha. `update`/`delete` sobre `fiscal_entregas` SEMPRE lançam (R2.2).
 */
function criarStore(seed: {
  clienteId: string;
  entregas?: EntregaRow[];
  fechamentos?: FechamentoRow[];
}) {
  const clienteIds = new Set([seed.clienteId]);
  const entregas: EntregaRow[] = [...(seed.entregas ?? [])];
  const fechamentos: FechamentoRow[] = [...(seed.fechamentos ?? [])];
  let proximaEntrega = entregas.length + 1;
  let updateChamado = false;
  let deleteChamado = false;

  // Casa a linha contra cada par (coluna, valor) do WHERE, pela coluna EXATA.
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
          limit: () => Promise.resolve(run()),
          orderBy: () => Promise.resolve(run()),
        };
      },
    };
  }

  const db = {
    select: () => ({
      from: (table: unknown) => selectFrom(table),
    }),
    insert: (table: unknown) => {
      if (table !== fiscalEntregas) {
        throw new Error('Insert inesperado numa tabela diferente de entregas.');
      }
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
              criadoEm: now,
              atualizadoEm: now,
            };
            entregas.push(row);
            return Promise.resolve([row]);
          },
        }),
      };
    },
    // R2.2: a entrega anterior é IMUTÁVEL. Qualquer tentativa de UPDATE/DELETE
    // sobre `fiscal_entregas` é um defeito — o store derruba o teste na hora.
    update: () => {
      updateChamado = true;
      throw new Error(
        'UPDATE em fiscal_entregas é proibido: a entrega anterior é imutável (R2.2).',
      );
    },
    delete: () => {
      deleteChamado = true;
      throw new Error(
        'DELETE em fiscal_entregas é proibido: a entrega anterior é imutável (R2.2).',
      );
    },
  };

  return {
    db,
    entregas,
    get updateChamado() {
      return updateChamado;
    },
    get deleteChamado() {
      return deleteChamado;
    },
  };
}

function serviceComStore(store: ReturnType<typeof criarStore>) {
  return new FiscalEntregasService(
    store as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function entregaOriginalRow(overrides: Partial<EntregaRow> = {}): EntregaRow {
  return {
    id: 'entrega-orig',
    clienteId: 'c1',
    fechamentoId: null,
    obrigacao: 'EFD_ICMS_IPI',
    competencia: '2026-08-01',
    arquivoKey: 'cliente/c1/efd/2026-08/original.txt',
    hashArquivo: HASH_A,
    pvaPrograma: 'PVA_EFD_ICMS_IPI',
    pvaVersao: '6.1.1',
    statusValidacao: 'TRANSMITIDA',
    validacaoResultado: {},
    assinaturaTitular: 'TITULAR LTDA',
    assinaturaEm: new Date('2026-08-15T00:00:00Z'),
    protocoloNumero: 'PROTO-ORIG',
    reciboKey: 'cliente/c1/efd/2026-08/recibo-original.pdf',
    entregaOriginalId: null,
    valorDiferenca: null,
    leiauteVersao: '3.2.2',
    transmitidaEm: new Date('2026-08-15T00:00:00Z'),
    criadoEm: new Date('2026-08-15T00:00:00Z'),
    atualizadoEm: new Date('2026-08-15T00:00:00Z'),
    ...overrides,
  };
}

function baseRetificar(
  overrides: Partial<RetificarEntregaInput> = {},
): RetificarEntregaInput {
  return {
    clienteId: 'c1',
    entregaOriginalId: 'entrega-orig',
    arquivoKey: 'cliente/c1/efd/2026-08/retificadora.txt',
    hashArquivo: HASH_B,
    valorDiferenca: '-50.00',
    pvaPrograma: 'PVA_EFD_ICMS_IPI',
    pvaVersao: '6.1.1',
    pvaVersaoConfirmada: '6.1.1',
    reciboKey: 'cliente/c1/efd/2026-08/recibo-retificadora.pdf',
    ...overrides,
  };
}

function baseRegistrar(
  overrides: Partial<RegistrarEntregaInput> = {},
): RegistrarEntregaInput {
  return {
    clienteId: 'c1',
    competencia: '2026-08',
    obrigacao: 'EFD_ICMS_IPI',
    arquivoKey: 'cliente/c1/efd/2026-08/original.txt',
    hashArquivo: HASH_A,
    pvaPrograma: 'PVA_EFD_ICMS_IPI',
    pvaVersao: '6.1.1',
    pvaVersaoConfirmada: '6.1.1',
    reciboKey: 'cliente/c1/efd/2026-08/recibo-original.pdf',
    ...overrides,
  };
}

describe('FiscalEntregasService — registrarEntrega (R2.1/R2.4)', () => {
  it('registra uma entrega ORIGINAL (sem vínculo de retificação nem diferença)', async () => {
    const store = criarStore({ clienteId: 'c1' });
    const service = serviceComStore(store);

    const entrega = await service.registrarEntrega(baseRegistrar());

    expect(entrega.entrega_original_id).toBeNull();
    expect(entrega.valor_diferenca).toBeNull();
    expect(entrega.arquivo_key).toBe('cliente/c1/efd/2026-08/original.txt');
    expect(entrega.recibo_key).toBe(
      'cliente/c1/efd/2026-08/recibo-original.pdf',
    );
    // Competência normalizada para o 1º dia do mês.
    expect(entrega.competencia).toBe('2026-08-01');
  });

  it('R2.4: amarra o recibo ao hash do fechamento — hash do arquivo = hash_entradas', async () => {
    const store = criarStore({
      clienteId: 'c1',
      fechamentos: [{ id: 'f1', clienteId: 'c1', hashEntradas: HASH_A }],
    });
    const service = serviceComStore(store);

    const entrega = await service.registrarEntrega(
      baseRegistrar({ fechamentoId: 'f1', hashArquivo: HASH_A }),
    );
    expect(entrega.fechamento_id).toBe('f1');
    expect(entrega.hash_arquivo).toBe(HASH_A);
  });

  it('R2.4: rejeita quando o hash do arquivo diverge do hash do fechamento', async () => {
    const store = criarStore({
      clienteId: 'c1',
      fechamentos: [{ id: 'f1', clienteId: 'c1', hashEntradas: HASH_A }],
    });
    const service = serviceComStore(store);

    await expect(
      service.registrarEntrega(
        baseRegistrar({ fechamentoId: 'f1', hashArquivo: HASH_B }),
      ),
    ).rejects.toThrow('hash do fechamento');
  });

  it('R2.4: fechamento de outro cliente é tratado como inexistente', async () => {
    const store = criarStore({
      clienteId: 'c1',
      fechamentos: [{ id: 'f-outro', clienteId: 'c2', hashEntradas: HASH_A }],
    });
    const service = serviceComStore(store);

    await expect(
      service.registrarEntrega(
        baseRegistrar({ fechamentoId: 'f-outro', hashArquivo: HASH_A }),
      ),
    ).rejects.toThrow('não encontrada');
  });
});

describe('FiscalEntregasService — retificarEntrega (R2.2)', () => {
  it('cria entrega NOVA vinculada à original, com diferença e recibo próprio', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [entregaOriginalRow()],
    });
    const service = serviceComStore(store);

    const retificadora = await service.retificarEntrega(baseRetificar());

    // Referencia a original, carrega a diferença e tem o SEU PRÓPRIO recibo.
    expect(retificadora.id).not.toBe('entrega-orig');
    expect(retificadora.entrega_original_id).toBe('entrega-orig');
    expect(retificadora.valor_diferenca).toBe('-50.00');
    expect(retificadora.recibo_key).toBe(
      'cliente/c1/efd/2026-08/recibo-retificadora.pdf',
    );
    // Herda obrigação/competência da original.
    expect(retificadora.obrigacao).toBe('EFD_ICMS_IPI');
    expect(retificadora.competencia).toBe('2026-08-01');
  });

  it('a entrega ANTERIOR permanece imutável (nenhum UPDATE/DELETE; original intacta)', async () => {
    const original = entregaOriginalRow();
    const store = criarStore({ clienteId: 'c1', entregas: [original] });
    const service = serviceComStore(store);

    await service.retificarEntrega(baseRetificar());

    // Nunca mutou/apagou (o store lançaria); a trilha ganhou uma 2ª linha.
    expect(store.updateChamado).toBe(false);
    expect(store.deleteChamado).toBe(false);
    expect(store.entregas).toHaveLength(2);
    // A linha original está byte a byte como antes (recibo/hash/diferença).
    const originalAgora = store.entregas.find((e) => e.id === 'entrega-orig')!;
    expect(originalAgora.reciboKey).toBe(
      'cliente/c1/efd/2026-08/recibo-original.pdf',
    );
    expect(originalAgora.hashArquivo).toBe(HASH_A);
    expect(originalAgora.valorDiferenca).toBeNull();
    expect(originalAgora.entregaOriginalId).toBeNull();
  });

  it('a retificadora herda o fechamento da original e valida o hash (R2.4)', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [
        entregaOriginalRow({ fechamentoId: 'f1', hashArquivo: HASH_A }),
      ],
      fechamentos: [{ id: 'f1', clienteId: 'c1', hashEntradas: HASH_B }],
    });
    const service = serviceComStore(store);

    // A retificadora usa HASH_B (= hash_entradas de f1) e herda o fechamento.
    const retificadora = await service.retificarEntrega(
      baseRetificar({ hashArquivo: HASH_B }),
    );
    expect(retificadora.fechamento_id).toBe('f1');
  });

  it('rejeita retificar entrega inexistente ou de OUTRO cliente (NotFound)', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [entregaOriginalRow({ clienteId: 'c2' })],
    });
    const service = serviceComStore(store);

    await expect(service.retificarEntrega(baseRetificar())).rejects.toThrow(
      'Entrega não encontrada',
    );
    expect(store.entregas).toHaveLength(1);
  });

  it('rejeita retificar uma entrega JÁ SUPERADA (já retificada antes)', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [
        entregaOriginalRow(),
        entregaOriginalRow({
          id: 'entrega-ret-1',
          entregaOriginalId: 'entrega-orig',
          valorDiferenca: '-10.00',
          hashArquivo: HASH_B,
        }),
      ],
    });
    const service = serviceComStore(store);

    await expect(service.retificarEntrega(baseRetificar())).rejects.toThrow(
      'já foi retificada',
    );
    expect(store.entregas).toHaveLength(2);
  });

  it('rejeita retificar uma RETIFICADORA (encadeamento); a trilha aponta a base', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [
        entregaOriginalRow({
          id: 'entrega-ret-1',
          entregaOriginalId: 'entrega-base',
          valorDiferenca: '-10.00',
        }),
      ],
    });
    const service = serviceComStore(store);

    await expect(
      service.retificarEntrega(
        baseRetificar({ entregaOriginalId: 'entrega-ret-1' }),
      ),
    ).rejects.toThrow('já é uma retificação');
  });

  it('rejeita diferença inválida (não decimal)', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [entregaOriginalRow()],
    });
    const service = serviceComStore(store);

    await expect(
      service.retificarEntrega(baseRetificar({ valorDiferenca: 'abc' })),
    ).rejects.toThrow('diferença inválido');
  });

  it('rejeita hash do arquivo malformado (reforço do CHECK fora do HTTP)', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [entregaOriginalRow()],
    });
    const service = serviceComStore(store);

    await expect(
      service.retificarEntrega(baseRetificar({ hashArquivo: 'XYZ' })),
    ).rejects.toThrow('Hash do arquivo inválido');
  });
});

describe('FiscalEntregasService — leiaute por vigência e PVA confirmado (R2.5, tarefa 2.4)', () => {
  it('deriva o leiaute 3.2.2 para competência de 2026 quando não informado', async () => {
    const store = criarStore({ clienteId: 'c1' });
    const service = serviceComStore(store);

    const entrega = await service.registrarEntrega(
      baseRegistrar({ competencia: '2026-08', leiauteVersao: undefined }),
    );
    expect(entrega.leiaute_versao).toBe('3.2.2');
  });

  it('deriva o leiaute 3.2.3 para competência de 2027 quando não informado', async () => {
    const store = criarStore({ clienteId: 'c1' });
    const service = serviceComStore(store);

    const entrega = await service.registrarEntrega(
      baseRegistrar({ competencia: '2027-03', leiauteVersao: undefined }),
    );
    expect(entrega.leiaute_versao).toBe('3.2.3');
  });

  it('aceita o leiaute informado quando casa a vigência da competência', async () => {
    const store = criarStore({ clienteId: 'c1' });
    const service = serviceComStore(store);

    const entrega = await service.registrarEntrega(
      baseRegistrar({ competencia: '2027-03', leiauteVersao: '3.2.3' }),
    );
    expect(entrega.leiaute_versao).toBe('3.2.3');
  });

  it('REJEITA leiaute de outra vigência (3.2.2 numa competência de 2027) — sem reutilização silenciosa', async () => {
    const store = criarStore({ clienteId: 'c1' });
    const service = serviceComStore(store);

    await expect(
      service.registrarEntrega(
        baseRegistrar({ competencia: '2027-03', leiauteVersao: '3.2.2' }),
      ),
    ).rejects.toThrow('não corresponde à vigência');
    // Nenhuma entrega foi gravada com o leiaute errado.
    expect(store.entregas).toHaveLength(0);
  });

  it('REJEITA a entrega quando a versão do PVA não é confirmada (N05)', async () => {
    const store = criarStore({ clienteId: 'c1' });
    const service = serviceComStore(store);

    await expect(
      service.registrarEntrega(
        baseRegistrar({ pvaVersao: '6.1.1', pvaVersaoConfirmada: '' }),
      ),
    ).rejects.toThrow('confirmada explicitamente');
    expect(store.entregas).toHaveLength(0);
  });

  it('REJEITA quando a confirmação do PVA não casa a versão informada (N05)', async () => {
    const store = criarStore({ clienteId: 'c1' });
    const service = serviceComStore(store);

    await expect(
      service.registrarEntrega(
        baseRegistrar({ pvaVersao: '6.1.1', pvaVersaoConfirmada: '6.1.0' }),
      ),
    ).rejects.toThrow('não corresponde à versão informada');
    expect(store.entregas).toHaveLength(0);
  });

  it('a retificação deriva o leiaute pela vigência da competência da original', async () => {
    // Original em 2027 → vigência 3.2.3; a retificadora herda a competência.
    const store = criarStore({
      clienteId: 'c1',
      entregas: [
        entregaOriginalRow({
          competencia: '2027-03-01',
          leiauteVersao: '3.2.3',
        }),
      ],
    });
    const service = serviceComStore(store);

    const retificadora = await service.retificarEntrega(
      baseRetificar({ leiauteVersao: undefined }),
    );
    expect(retificadora.leiaute_versao).toBe('3.2.3');
  });

  it('a retificação REJEITA leiaute que não casa a vigência da original', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [
        entregaOriginalRow({
          competencia: '2027-03-01',
          leiauteVersao: '3.2.3',
        }),
      ],
    });
    const service = serviceComStore(store);

    await expect(
      service.retificarEntrega(baseRetificar({ leiauteVersao: '3.2.2' })),
    ).rejects.toThrow('não corresponde à vigência');
  });

  it('a retificação REJEITA quando a versão do PVA não é confirmada (N05)', async () => {
    const store = criarStore({
      clienteId: 'c1',
      entregas: [entregaOriginalRow()],
    });
    const service = serviceComStore(store);

    await expect(
      service.retificarEntrega(baseRetificar({ pvaVersaoConfirmada: '' })),
    ).rejects.toThrow('confirmada explicitamente');
  });
});
