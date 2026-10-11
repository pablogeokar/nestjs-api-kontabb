import {
  FiscalGuiasService,
  type CriarGuiaInput,
} from './fiscal-guias.service';

// DB falso para criarGuia. `criarGuia` faz um ou dois selects
// select(...).from(...).where(...).limit(1):
//   1º) `assertCliente` → `clienteRows`;
//   2º) só para origem APURACAO, `resolverVinculoApuracao` busca o fechamento →
//       `fechamentoRows`.
// Cada `.limit()` consome o próximo item da fila na ordem; se a fila esgota,
// mantém o último valor (comportamento estável para os testes legados que só
// fazem o 1º select). O insert().values().returning() devolve `insertedRow`.
function createCriarGuiaDb(opts: {
  clienteRows?: unknown[];
  fechamentoRows?: unknown[];
  insertedRow?: Record<string, unknown>;
}) {
  const limitQueue: unknown[][] = [opts.clienteRows ?? [{ id: 'c1' }]];
  if (opts.fechamentoRows !== undefined) limitQueue.push(opts.fechamentoRows);
  const limit = jest.fn(() => {
    const next = limitQueue.length > 1 ? limitQueue.shift()! : limitQueue[0];
    return Promise.resolve(next);
  });
  const values = jest.fn().mockReturnValue({
    returning: jest
      .fn()
      .mockResolvedValue([opts.insertedRow ?? defaultGuiaRow()]),
  });
  return {
    limit,
    values,
    db: {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ limit }),
        }),
      }),
      insert: jest.fn().mockReturnValue({ values }),
    },
  };
}

function defaultGuiaRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'guia-1',
    clienteId: 'c1',
    competencia: '2026-08-01',
    tributo: 'ICMS_PROPRIO',
    ufFavorecida: 'SP',
    tipoGuia: 'DAE',
    codigoReceita: '046',
    dataVencimento: '2026-09-10',
    valorPrincipal: '100.00',
    valorMulta: '0',
    valorJuros: '0',
    valorTotal: '100.00',
    codigoBarras: null,
    linhaDigitavel: null,
    statusPagamento: 'PENDENTE',
    arquivoGuiaKey: null,
    origem: 'MANUAL',
    fechamentoId: null,
    divergenteObrigacao: false,
    valorObrigacao: null,
    cancelada: false,
    canceladaEm: null,
    motivoCancelamento: null,
    emitidaOrgao: false,
    emitidaOrgaoEm: null,
    idempotencyKey: null,
    criadoEm: new Date('2026-08-01T00:00:00Z'),
    atualizadoEm: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

// Linha de fechamento (versão de apuração) como a lida por `resolverVinculoApuracao`
// no caminho APURACAO: carrega os snapshots congelados (documentos/saldos/
// parametros) dos quais o total da obrigação é projetado (R1.2, tarefa 1.3).
// `saldos` monetários sempre como strings decimais (nunca Number).
function fechamentoRow(
  overrides: Partial<{
    id: string;
    saldos: Record<string, unknown>;
    documentos: Array<Record<string, unknown>>;
    parametros: Record<string, unknown>;
  }> = {},
): Record<string, unknown> {
  return {
    id: 'f1',
    clienteId: 'c1',
    obrigacao: 'EFD_ICMS_IPI',
    competencia: '2026-08-01',
    versao: 1,
    estado: 'FECHADO',
    corrente: true,
    motorVersao: 'test',
    hashEntradas: 'a'.repeat(64),
    aprovadoPor: null,
    fechadoEm: new Date('2026-08-01T00:00:00Z'),
    documentos: overrides.documentos ?? [],
    saldos: overrides.saldos ?? {},
    parametros: overrides.parametros ?? {},
  };
}

function baseInput(overrides: Partial<CriarGuiaInput> = {}): CriarGuiaInput {
  return {
    clienteId: 'c1',
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

describe('FiscalGuiasService — invariantes fora do HTTP (R6.4)', () => {
  it('cria a guia quando os valores são válidos (caminho feliz)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(baseInput());
    expect(guia.id).toBe('guia-1');
    expect(guia.valor_total).toBe('100.00');
    expect(db.db.insert).toHaveBeenCalledTimes(1);
  });

  it('R6.4/R6.3: rejeita valor principal negativo mesmo compensado por multa positiva', async () => {
    // Total = -100 + 150 = 50 (> 0). Sem a checagem POR COMPONENTE, passaria só
    // na validação do total. O serviço rejeita o principal negativo antes.
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(
        baseInput({ valorPrincipal: '-100.00', valorMulta: '150.00' }),
      ),
    ).rejects.toThrow('O valor principal da guia não pode ser negativo.');
    expect(db.db.insert).not.toHaveBeenCalled();
  });

  it('R6.4/R6.3: rejeita multa negativa (fora do HTTP)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(
        baseInput({ valorPrincipal: '100.00', valorMulta: '-10.00' }),
      ),
    ).rejects.toThrow('O valor multa da guia não pode ser negativo.');
    expect(db.db.insert).not.toHaveBeenCalled();
  });

  it('R6.4/R6.3: rejeita juros negativos (fora do HTTP)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(
        baseInput({ valorPrincipal: '100.00', valorJuros: '-5.00' }),
      ),
    ).rejects.toThrow('O valor juros da guia não pode ser negativo.');
    expect(db.db.insert).not.toHaveBeenCalled();
  });

  it('rejeita quando o valor total é zero (nenhum componente positivo)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(baseInput({ valorPrincipal: '0' })),
    ).rejects.toThrow('O valor total da guia deve ser maior que zero.');
    expect(db.db.insert).not.toHaveBeenCalled();
  });
});

describe('FiscalGuiasService — DIFAL só vira guia quando CALCULADO (tarefa 2.3 / R1.2)', () => {
  it('cria guia de DIFAL_ENTRADA quando o cálculo é CALCULADO (regra homologada)', async () => {
    const db = createCriarGuiaDb({
      insertedRow: defaultGuiaRow({ tributo: 'DIFAL_ENTRADA' }),
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(
      baseInput({ tributo: 'DIFAL_ENTRADA', difalStatus: 'CALCULADO' }),
    );
    expect(guia.tributo).toBe('DIFAL_ENTRADA');
    expect(db.db.insert).toHaveBeenCalledTimes(1);
  });

  it('BLOQUEIA guia de DIFAL_ENTRADA em SIMULAÇÃO (regra vigente não aprovada) — nunca guia', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(
        baseInput({ tributo: 'DIFAL_ENTRADA', difalStatus: 'SIMULACAO' }),
      ),
    ).rejects.toThrow('SIMULAÇÃO');
    expect(db.db.insert).not.toHaveBeenCalled();
  });

  it('BLOQUEIA guia de DIFAL_SAIDA em PENDÊNCIA (sem regra homologada) — nunca guia', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(
        baseInput({ tributo: 'DIFAL_SAIDA', difalStatus: 'PENDENTE' }),
      ),
    ).rejects.toThrow('PENDÊNCIA');
    expect(db.db.insert).not.toHaveBeenCalled();
  });

  it('BLOQUEIA guia de DIFAL sem o estado do cálculo (não emite item não verificado)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(baseInput({ tributo: 'DIFAL_ENTRADA' })),
    ).rejects.toThrow('exige o estado do cálculo do DIFAL');
    expect(db.db.insert).not.toHaveBeenCalled();
  });

  it('tributo não-DIFAL ignora o estado do cálculo (campo não se aplica)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    // ICMS_PROPRIO não é DIFAL: cria mesmo sem difalStatus, caminho inalterado.
    const guia = await service.criarGuia(
      baseInput({ tributo: 'ICMS_PROPRIO' }),
    );
    expect(guia.id).toBe('guia-1');
    expect(db.db.insert).toHaveBeenCalledTimes(1);
  });
});

// DB falso para as mutações escopadas por (id, clienteId): marcarPagamento /
// marcarEmitidaNoOrgao / cancelarGuia. O serviço primeiro CARREGA a guia
// (select().from().where().limit()) e depois faz o update
// (update().set().where().returning()) ou delete (delete().where().returning()).
// `loadRows` alimenta o select de carga: por padrão espelha `returningRows[0]`
// (a mesma guia que a mutação devolve); passe `[]` para simular guia de outro
// cliente/inexistente (carregarGuia → NotFound, sem mutação). `orderByRows`
// alimenta o select da trilha de pagamentos (projetarSaldoDaTrilha) quando o
// status alvo é PAGO; vazio por padrão (trilha sem eventos).
function createMutacaoEscopadaDb(
  returningRows: unknown[],
  opts: { loadRows?: unknown[]; orderByRows?: unknown[] } = {},
) {
  const returning = jest.fn().mockResolvedValue(returningRows);
  const loadRows = opts.loadRows ?? returningRows.slice(0, 1);
  const limit = jest.fn().mockResolvedValue(loadRows);
  const orderBy = jest.fn().mockResolvedValue(opts.orderByRows ?? []);
  return {
    returning,
    limit,
    orderBy,
    db: {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ limit, orderBy }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ returning }),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ returning }),
      }),
    },
  };
}

describe('FiscalGuiasService — propriedade cliente↔guia (R6.2)', () => {
  it('marcarPagamento PENDENTE/VENCIDO não exige trilha e é escopado por cliente', async () => {
    // PENDENTE/VENCIDO não afirmam quitação: não exigem respaldo da trilha.
    // Carrega a guia (1 select) e faz o update escopado por (id, clienteId).
    const db = createMutacaoEscopadaDb([
      defaultGuiaRow({ statusPagamento: 'VENCIDO' }),
    ]);
    const service = new FiscalGuiasService(db as never);
    const guia = await service.marcarPagamento({
      clienteId: 'c1',
      guiaId: 'guia-1',
      statusPagamento: 'VENCIDO',
    });
    expect(guia.status_pagamento).toBe('VENCIDO');
    expect(db.db.update).toHaveBeenCalledTimes(1);
  });

  it('marcarPagamento de guia de outro cliente é rejeitado (carregarGuia → NotFound)', async () => {
    // A guia é carregada escopada por (id, clienteId) antes de qualquer update;
    // a de outro cliente não casa o WHERE e resulta em NotFound (indistinguível
    // de inexistente, R6.2). Nenhum update é disparado.
    const db = createMutacaoEscopadaDb([]);
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.marcarPagamento({
        clienteId: 'c1',
        guiaId: 'guia-de-outro-cliente',
        statusPagamento: 'VENCIDO',
      }),
    ).rejects.toThrow('Guia não encontrada.');
    expect(db.db.update).not.toHaveBeenCalled();
  });

  it('cancelarGuia de guia de outro cliente é rejeitado (WHERE por clienteId → NotFound)', async () => {
    // R1.4: cancelamento é um UPDATE escopado por (id, clienteId); guia de outro
    // cliente não casa o WHERE, o .returning() vem vazio e o serviço rejeita.
    const db = createMutacaoEscopadaDb([]);
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.cancelarGuia({
        clienteId: 'c1',
        guiaId: 'guia-de-outro-cliente',
      }),
    ).rejects.toThrow('Guia não encontrada.');
    expect(db.returning).toHaveBeenCalledTimes(1);
    // Cancelamento LÓGICO: nunca um delete físico (R1.4).
    expect(db.db.delete).not.toHaveBeenCalled();
    expect(db.db.update).toHaveBeenCalledTimes(1);
  });

  it('cancelarGuia marca a guia como cancelada preservando a linha (R1.4)', async () => {
    const db = createMutacaoEscopadaDb([
      defaultGuiaRow({
        cancelada: true,
        canceladaEm: new Date('2026-09-01T00:00:00Z'),
        motivoCancelamento: 'duplicada',
      }),
    ]);
    const service = new FiscalGuiasService(db as never);
    const guia = await service.cancelarGuia({
      clienteId: 'c1',
      guiaId: 'guia-1',
      motivo: 'duplicada',
    });
    expect(guia.cancelada).toBe(true);
    expect(guia.motivo_cancelamento).toBe('duplicada');
    expect(guia.cancelada_em).toBe('2026-09-01T00:00:00.000Z');
    // UPDATE lógico, nunca delete físico (R1.4).
    expect(db.db.update).toHaveBeenCalledTimes(1);
    expect(db.db.delete).not.toHaveBeenCalled();
  });
});

describe('FiscalGuiasService — vínculo guia ↔ versão de apuração (tarefa 1.2 / R1.1, R1.7)', () => {
  it('guia MANUAL (default) não exige fechamento e não faz lookup de apuração', async () => {
    // Sem `fechamentoRows` na fila: se o serviço tentasse buscar o fechamento,
    // consumiria o único select (cliente) e o teste quebraria. Guia manual não
    // dispara o 2º select.
    const db = createCriarGuiaDb({
      insertedRow: defaultGuiaRow({ origem: 'MANUAL', fechamentoId: null }),
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(baseInput());
    expect(guia.origem).toBe('MANUAL');
    expect(guia.fechamento_id).toBeNull();
    // Apenas o select do cliente roda (assertCliente); nenhum lookup de apuração.
    expect(db.limit).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledTimes(1);
  });

  it('R1.1: guia MANUAL com fechamentoId é rejeitada (não registra vínculo de apuração em guia manual)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(baseInput({ origem: 'MANUAL', fechamentoId: 'f1' })),
    ).rejects.toThrow('MANUAL não deve referenciar uma versão de apuração');
    expect(db.values).not.toHaveBeenCalled();
  });

  it('R1.7: guia APURACAO sem fechamentoId é rejeitada (guia calculada exige vínculo)', async () => {
    const db = createCriarGuiaDb({});
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(baseInput({ origem: 'APURACAO' })),
    ).rejects.toThrow('exige vínculo com a versão de apuração');
    expect(db.values).not.toHaveBeenCalled();
  });

  it('R1.7: guia APURACAO com fechamento inexistente/de outro cliente é rejeitada (NotFound)', async () => {
    // O 2º select (fechamento) resolve vazio: fechamento não é do cliente.
    const db = createCriarGuiaDb({ fechamentoRows: [] });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(
        baseInput({ origem: 'APURACAO', fechamentoId: 'f-de-outro' }),
      ),
    ).rejects.toThrow(
      'Versão de apuração (fechamento) não encontrada para esta empresa',
    );
    // Cliente + fechamento foram buscados (2 selects); nada foi inserido.
    expect(db.limit).toHaveBeenCalledTimes(2);
    expect(db.values).not.toHaveBeenCalled();
  });

  it('R1.7: guia APURACAO com fechamento válido do cliente é criada com o vínculo', async () => {
    const db = createCriarGuiaDb({
      // Fechamento cujo saldo apurado (obrigação) bate com a guia (100.00):
      // guia não divergente. Snapshot congelado é a fonte do total da obrigação.
      fechamentoRows: [fechamentoRow({ saldos: { icmsRecolher: '100.00' } })],
      insertedRow: defaultGuiaRow({ origem: 'APURACAO', fechamentoId: 'f1' }),
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(
      baseInput({ origem: 'APURACAO', fechamentoId: 'f1' }),
    );
    expect(guia.origem).toBe('APURACAO');
    expect(guia.fechamento_id).toBe('f1');
    // Dois selects (cliente, fechamento) e um insert.
    expect(db.limit).toHaveBeenCalledTimes(2);
    expect(db.values).toHaveBeenCalledTimes(1);
    // A guia emitida persiste o vínculo com a versão de apuração.
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ origem: 'APURACAO', fechamentoId: 'f1' }),
    );
  });

  it('empresa inexistente é rejeitada antes de qualquer lookup de apuração', async () => {
    // assertCliente roda primeiro: sem cliente, nem o fechamento é consultado.
    const db = createCriarGuiaDb({
      clienteRows: [],
      fechamentoRows: [fechamentoRow({ saldos: { icmsRecolher: '100.00' } })],
    });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(baseInput({ origem: 'APURACAO', fechamentoId: 'f1' })),
    ).rejects.toThrow('Empresa não encontrada.');
    expect(db.limit).toHaveBeenCalledTimes(1);
    expect(db.values).not.toHaveBeenCalled();
  });
});

describe('FiscalGuiasService — guia divergente da obrigação sinalizada (tarefa 1.3 / R1.2)', () => {
  it('guia APURACAO cujo total BATE com a obrigação apurada NÃO é sinalizada', async () => {
    // Obrigação do fechamento = 100.00 (icmsRecolher); guia = 100.00 (principal).
    const db = createCriarGuiaDb({
      fechamentoRows: [fechamentoRow({ saldos: { icmsRecolher: '100.00' } })],
      insertedRow: defaultGuiaRow({
        origem: 'APURACAO',
        fechamentoId: 'f1',
        divergenteObrigacao: false,
        valorObrigacao: '100.00',
      }),
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(
      baseInput({
        origem: 'APURACAO',
        fechamentoId: 'f1',
        valorPrincipal: '100.00',
      }),
    );
    expect(guia.divergente_obrigacao).toBe(false);
    expect(guia.valor_obrigacao).toBe('100.00');
    // Persistiu o sinal (não divergente) e o valor da obrigação comparado.
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        divergenteObrigacao: false,
        valorObrigacao: '100.00',
      }),
    );
  });

  it('guia APURACAO cujo total DIVERGE da obrigação apurada é SINALIZADA (R1.2)', async () => {
    // Obrigação = 100.00; guia = 150.00 (principal) → divergente, Δ = +50.00.
    const db = createCriarGuiaDb({
      fechamentoRows: [fechamentoRow({ saldos: { icmsRecolher: '100.00' } })],
      insertedRow: defaultGuiaRow({
        origem: 'APURACAO',
        fechamentoId: 'f1',
        valorPrincipal: '150.00',
        valorTotal: '150.00',
        divergenteObrigacao: true,
        valorObrigacao: '100.00',
      }),
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(
      baseInput({
        origem: 'APURACAO',
        fechamentoId: 'f1',
        valorPrincipal: '150.00',
      }),
    );
    expect(guia.divergente_obrigacao).toBe(true);
    expect(guia.valor_obrigacao).toBe('100.00');
    // O serviço persiste a divergência comparando a guia com a obrigação do
    // fechamento (snapshot congelado), não um recálculo próprio.
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        divergenteObrigacao: true,
        valorObrigacao: '100.00',
      }),
    );
  });

  it('divergência considera multa/juros no total da guia (comparação pelo total emitido)', async () => {
    // Obrigação = 100.00; guia principal 100.00 + multa 5.00 = total 105.00 →
    // divergente (acima da tolerância de centavos). O total emitido é o que vale.
    const db = createCriarGuiaDb({
      fechamentoRows: [fechamentoRow({ saldos: { icmsRecolher: '100.00' } })],
      insertedRow: defaultGuiaRow({
        origem: 'APURACAO',
        fechamentoId: 'f1',
        valorTotal: '105.00',
        divergenteObrigacao: true,
        valorObrigacao: '100.00',
      }),
    });
    const service = new FiscalGuiasService(db as never);
    await service.criarGuia(
      baseInput({
        origem: 'APURACAO',
        fechamentoId: 'f1',
        valorPrincipal: '100.00',
        valorMulta: '5.00',
      }),
    );
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        valorTotal: '105.00',
        divergenteObrigacao: true,
        valorObrigacao: '100.00',
      }),
    );
  });

  it('guia MANUAL nunca é marcada divergente (sem obrigação apurada por trás)', async () => {
    const db = createCriarGuiaDb({
      insertedRow: defaultGuiaRow({ origem: 'MANUAL', fechamentoId: null }),
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(baseInput());
    expect(guia.divergente_obrigacao).toBe(false);
    expect(guia.valor_obrigacao).toBeNull();
    // Guia manual não computa obrigação: persiste false/null (invariante do banco).
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        divergenteObrigacao: false,
        valorObrigacao: null,
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Trilha de pagamentos/estornos e cancelamento lógico (tarefa 1.4 / R1.3, R1.4)
// ─────────────────────────────────────────────────────────────────────────────
//
// DB falso para o fluxo de eventos de pagamento. `registrarEventoPagamento` faz:
//   1) select(...).from(guias).where(...).limit(1)  → carrega a guia (fila: guia)
//   2) [só ESTORNO] select(...).from(eventos).where(...).limit(1) → evento alvo
//   3) insert(eventos).values(...).returning()      → o evento criado
// `trilhaPagamentos` faz:
//   1) select(...).from(guias).where(...).limit(1)  → carrega a guia (fila: guia)
//   2) select(...).from(eventos).where(...).orderBy(...) → eventos da trilha
// Cada `.limit()` consome o próximo item da fila; `.orderBy()` resolve a lista
// de eventos. `insert().values().returning()` devolve `insertedEvento`.
function createEventosDb(opts: {
  limitQueue?: unknown[][];
  orderByRows?: unknown[];
  insertedEvento?: Record<string, unknown>;
}) {
  const limitQueue = [...(opts.limitQueue ?? [])];
  const limit = jest.fn(() =>
    Promise.resolve(limitQueue.length > 0 ? limitQueue.shift()! : []),
  );
  const orderBy = jest.fn(() => Promise.resolve(opts.orderByRows ?? []));
  const values = jest.fn().mockReturnValue({
    returning: jest
      .fn()
      .mockResolvedValue([opts.insertedEvento ?? defaultEventoRow()]),
  });
  const where = jest.fn().mockReturnValue({ limit, orderBy });
  return {
    limit,
    orderBy,
    values,
    where,
    db: {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({ where }),
      }),
      insert: jest.fn().mockReturnValue({ values }),
    },
  };
}

function defaultEventoRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'ev-1',
    clienteId: 'c1',
    guiaId: 'guia-1',
    fechamentoId: null,
    tipo: 'PAGAMENTO',
    origem: 'MANUAL',
    valor: '100.00',
    sinal: 1,
    dataEvento: '2026-09-10',
    comprovanteKey: 'comprovantes/ev-1.pdf',
    declaracaoManual: false,
    documentoExterno: null,
    eventoEstornadoId: null,
    observacao: null,
    criadoEm: new Date('2026-09-10T00:00:00Z'),
    atualizadoEm: new Date('2026-09-10T00:00:00Z'),
    ...overrides,
  };
}

describe('FiscalGuiasService — trilha de pagamentos (tarefa 1.4 / R1.3)', () => {
  it('registra PAGAMENTO com comprovante, acrescentando um evento (nunca sobrescreve)', async () => {
    const db = createEventosDb({
      limitQueue: [[defaultGuiaRow()]],
      insertedEvento: defaultEventoRow(),
    });
    const service = new FiscalGuiasService(db as never);
    const evento = await service.registrarEventoPagamento({
      clienteId: 'c1',
      guiaId: 'guia-1',
      tipo: 'PAGAMENTO',
      valor: '100.00',
      dataEvento: '2026-09-10',
      comprovanteKey: 'comprovantes/ev-1.pdf',
    });
    expect(evento.tipo).toBe('PAGAMENTO');
    expect(evento.sinal).toBe(1);
    // É um INSERT (append), nunca um update/overwrite de status.
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'PAGAMENTO',
        sinal: 1,
        valor: '100.00',
        comprovanteKey: 'comprovantes/ev-1.pdf',
      }),
    );
  });

  it('registra PAGAMENTO com declaração manual (sem comprovante) — R1.5', async () => {
    const db = createEventosDb({
      limitQueue: [[defaultGuiaRow()]],
      insertedEvento: defaultEventoRow({
        comprovanteKey: null,
        declaracaoManual: true,
      }),
    });
    const service = new FiscalGuiasService(db as never);
    const evento = await service.registrarEventoPagamento({
      clienteId: 'c1',
      guiaId: 'guia-1',
      tipo: 'PAGAMENTO',
      valor: '100.00',
      dataEvento: '2026-09-10',
      declaracaoManual: true,
    });
    expect(evento.declaracao_manual).toBe(true);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ declaracaoManual: true, comprovanteKey: null }),
    );
  });

  it('BLOQUEIA pagamento sem evidência nem declaração manual (R1.5)', async () => {
    const db = createEventosDb({ limitQueue: [[defaultGuiaRow()]] });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.registrarEventoPagamento({
        clienteId: 'c1',
        guiaId: 'guia-1',
        tipo: 'PAGAMENTO',
        valor: '100.00',
        dataEvento: '2026-09-10',
      }),
    ).rejects.toThrow('exige evidência');
    expect(db.values).not.toHaveBeenCalled();
  });

  it('BLOQUEIA evento com valor zero (a magnitude deve ser positiva)', async () => {
    const db = createEventosDb({ limitQueue: [[defaultGuiaRow()]] });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.registrarEventoPagamento({
        clienteId: 'c1',
        guiaId: 'guia-1',
        tipo: 'PAGAMENTO_PARCIAL',
        valor: '0',
        dataEvento: '2026-09-10',
        comprovanteKey: 'k',
      }),
    ).rejects.toThrow('maior que zero');
    expect(db.values).not.toHaveBeenCalled();
  });

  it('registra ESTORNO referenciando o pagamento revertido (par explícito, R1.3)', async () => {
    // Fila: 1) guia; 2) evento alvo do estorno (existe e é da mesma guia).
    const db = createEventosDb({
      limitQueue: [[defaultGuiaRow()], [{ id: 'ev-1' }]],
      insertedEvento: defaultEventoRow({
        id: 'ev-2',
        tipo: 'ESTORNO',
        sinal: -1,
        comprovanteKey: null,
        eventoEstornadoId: 'ev-1',
      }),
    });
    const service = new FiscalGuiasService(db as never);
    const evento = await service.registrarEventoPagamento({
      clienteId: 'c1',
      guiaId: 'guia-1',
      tipo: 'ESTORNO',
      valor: '100.00',
      dataEvento: '2026-09-11',
      eventoEstornadoId: 'ev-1',
    });
    expect(evento.tipo).toBe('ESTORNO');
    expect(evento.sinal).toBe(-1);
    expect(evento.evento_estornado_id).toBe('ev-1');
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'ESTORNO',
        sinal: -1,
        eventoEstornadoId: 'ev-1',
      }),
    );
  });

  it('BLOQUEIA estorno sem referência ao pagamento revertido', async () => {
    const db = createEventosDb({ limitQueue: [[defaultGuiaRow()]] });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.registrarEventoPagamento({
        clienteId: 'c1',
        guiaId: 'guia-1',
        tipo: 'ESTORNO',
        valor: '100.00',
        dataEvento: '2026-09-11',
      }),
    ).rejects.toThrow('exige a referência ao evento de pagamento revertido');
    expect(db.values).not.toHaveBeenCalled();
  });

  it('BLOQUEIA estorno cujo evento alvo não é da mesma guia', async () => {
    // Fila: 1) guia; 2) evento alvo não encontrado para a guia (vazio).
    const db = createEventosDb({ limitQueue: [[defaultGuiaRow()], []] });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.registrarEventoPagamento({
        clienteId: 'c1',
        guiaId: 'guia-1',
        tipo: 'ESTORNO',
        valor: '100.00',
        dataEvento: '2026-09-11',
        eventoEstornadoId: 'ev-de-outra-guia',
      }),
    ).rejects.toThrow('Evento de pagamento a estornar não encontrado');
    expect(db.values).not.toHaveBeenCalled();
  });

  it('guia inexistente/de outro cliente rejeita o evento antes de inserir (R6.2)', async () => {
    const db = createEventosDb({ limitQueue: [[]] });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.registrarEventoPagamento({
        clienteId: 'c1',
        guiaId: 'guia-de-outro',
        tipo: 'PAGAMENTO',
        valor: '100.00',
        dataEvento: '2026-09-10',
        comprovanteKey: 'k',
      }),
    ).rejects.toThrow('Guia não encontrada.');
    expect(db.values).not.toHaveBeenCalled();
  });

  it('guia CANCELADA não aceita novos eventos (R1.4 congela a obrigação)', async () => {
    const db = createEventosDb({
      limitQueue: [[defaultGuiaRow({ cancelada: true })]],
    });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.registrarEventoPagamento({
        clienteId: 'c1',
        guiaId: 'guia-1',
        tipo: 'PAGAMENTO',
        valor: '100.00',
        dataEvento: '2026-09-10',
        comprovanteKey: 'k',
      }),
    ).rejects.toThrow('Guia cancelada não aceita novos eventos');
    expect(db.values).not.toHaveBeenCalled();
  });

  it('trilhaPagamentos reconstrói o saldo da trilha (pagamento parcial + estorno)', async () => {
    // Guia de 100.00; eventos: parcial +70, estorno -30 → saldo 60.00.
    const db = createEventosDb({
      limitQueue: [[defaultGuiaRow({ valorTotal: '100.00' })]],
      orderByRows: [
        defaultEventoRow({
          tipo: 'PAGAMENTO_PARCIAL',
          valor: '70.00',
          sinal: 1,
        }),
        defaultEventoRow({
          id: 'ev-2',
          tipo: 'ESTORNO',
          valor: '30.00',
          sinal: -1,
          eventoEstornadoId: 'ev-1',
        }),
      ],
    });
    const service = new FiscalGuiasService(db as never);
    const trilha = await service.trilhaPagamentos({
      clienteId: 'c1',
      guiaId: 'guia-1',
    });
    expect(trilha.saldo.valorTotal).toBe('100.00');
    expect(trilha.saldo.totalPago).toBe('40.00');
    expect(trilha.saldo.saldo).toBe('60.00');
    expect(trilha.eventos).toHaveLength(2);
    expect(trilha.cancelada).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "PAGO" exige evidência/declaração via trilha; registrar ≠ emitida no órgão
// (tarefa 1.5 / R1.5)
// ─────────────────────────────────────────────────────────────────────────────
describe('FiscalGuiasService — "PAGO" exige respaldo da trilha (tarefa 1.5 / R1.5)', () => {
  it('BLOQUEIA marcar PAGO quando a trilha não tem pagamento (registrar ≠ pago)', async () => {
    // Guia carregada, mas sem nenhum evento na trilha: não há evidência nem
    // declaração manual por trás. Marcar PAGO é bloqueado e nenhum update roda.
    const db = createMutacaoEscopadaDb([defaultGuiaRow()], {
      loadRows: [defaultGuiaRow({ valorTotal: '100.00' })],
      orderByRows: [],
    });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.marcarPagamento({
        clienteId: 'c1',
        guiaId: 'guia-1',
        statusPagamento: 'PAGO',
      }),
    ).rejects.toThrow('respaldado por evidência ou declaração manual');
    expect(db.db.update).not.toHaveBeenCalled();
  });

  it('BLOQUEIA marcar PAGO quando a trilha não quita o saldo (pagamento parcial)', async () => {
    // Guia de 100.00 com apenas um pagamento parcial de 40.00 (com comprovante):
    // saldo remanescente 60.00 → não está paga. Marcar PAGO é bloqueado.
    const db = createMutacaoEscopadaDb([defaultGuiaRow()], {
      loadRows: [defaultGuiaRow({ valorTotal: '100.00' })],
      orderByRows: [
        defaultEventoRow({
          tipo: 'PAGAMENTO_PARCIAL',
          valor: '40.00',
          sinal: 1,
        }),
      ],
    });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.marcarPagamento({
        clienteId: 'c1',
        guiaId: 'guia-1',
        statusPagamento: 'PAGO',
      }),
    ).rejects.toThrow('saldo quitado');
    expect(db.db.update).not.toHaveBeenCalled();
  });

  it('PERMITE marcar PAGO quando a trilha quita o saldo (pagamento respaldado)', async () => {
    // Guia de 100.00 com pagamento de 100.00 (evento carrega comprovante por
    // construção, R1.5): saldo zero → quitada. O update de status roda.
    const db = createMutacaoEscopadaDb(
      [defaultGuiaRow({ statusPagamento: 'PAGO' })],
      {
        loadRows: [defaultGuiaRow({ valorTotal: '100.00' })],
        orderByRows: [
          defaultEventoRow({ tipo: 'PAGAMENTO', valor: '100.00', sinal: 1 }),
        ],
      },
    );
    const service = new FiscalGuiasService(db as never);
    const guia = await service.marcarPagamento({
      clienteId: 'c1',
      guiaId: 'guia-1',
      statusPagamento: 'PAGO',
    });
    expect(guia.status_pagamento).toBe('PAGO');
    expect(db.db.update).toHaveBeenCalledTimes(1);
  });

  it('BLOQUEIA marcar PAGO em guia cancelada (R1.4 congela a obrigação)', async () => {
    const db = createMutacaoEscopadaDb([defaultGuiaRow()], {
      loadRows: [defaultGuiaRow({ valorTotal: '100.00', cancelada: true })],
      orderByRows: [
        defaultEventoRow({ tipo: 'PAGAMENTO', valor: '100.00', sinal: 1 }),
      ],
    });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.marcarPagamento({
        clienteId: 'c1',
        guiaId: 'guia-1',
        statusPagamento: 'PAGO',
      }),
    ).rejects.toThrow('Guia cancelada não pode ser marcada como PAGO');
    expect(db.db.update).not.toHaveBeenCalled();
  });

  it('marcar PAGO em guia de outro cliente → NotFound antes de olhar a trilha', async () => {
    // carregarGuia escopado por (id, clienteId) resolve vazio: NotFound sem
    // consultar a trilha nem disparar update (R6.2).
    const db = createMutacaoEscopadaDb([], { loadRows: [] });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.marcarPagamento({
        clienteId: 'c1',
        guiaId: 'guia-de-outro',
        statusPagamento: 'PAGO',
      }),
    ).rejects.toThrow('Guia não encontrada.');
    expect(db.orderBy).not.toHaveBeenCalled();
    expect(db.db.update).not.toHaveBeenCalled();
  });
});

describe('FiscalGuiasService — registrar ≠ emitida no órgão (tarefa 1.5 / R1.5)', () => {
  it('guia recém-criada NÃO está emitida no órgão (registrar ≠ emitir)', async () => {
    // O default do flag é false: registrar a guia no sistema não a emite no
    // órgão arrecadador. A resposta expõe o fato explicitamente.
    const db = createCriarGuiaDb({
      insertedRow: defaultGuiaRow({
        emitidaOrgao: false,
        emitidaOrgaoEm: null,
      }),
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(baseInput());
    expect(guia.emitida_orgao).toBe(false);
    expect(guia.emitida_orgao_em).toBeNull();
  });

  it('marcarEmitidaNoOrgao marca o fato distinto, com data e sem alterar pagamento', async () => {
    const emitidaEm = new Date('2026-09-05T12:00:00Z');
    const db = createMutacaoEscopadaDb(
      [
        defaultGuiaRow({
          emitidaOrgao: true,
          emitidaOrgaoEm: emitidaEm,
          statusPagamento: 'PENDENTE',
        }),
      ],
      { loadRows: [defaultGuiaRow()] },
    );
    const service = new FiscalGuiasService(db as never);
    const guia = await service.marcarEmitidaNoOrgao({
      clienteId: 'c1',
      guiaId: 'guia-1',
    });
    expect(guia.emitida_orgao).toBe(true);
    expect(guia.emitida_orgao_em).toBe('2026-09-05T12:00:00.000Z');
    // Emitir no órgão NÃO quita a guia: o pagamento permanece como estava.
    expect(guia.status_pagamento).toBe('PENDENTE');
    expect(db.db.update).toHaveBeenCalledTimes(1);
  });

  it('BLOQUEIA emitir no órgão guia cancelada (R1.4 congela a guia)', async () => {
    const db = createMutacaoEscopadaDb([defaultGuiaRow()], {
      loadRows: [defaultGuiaRow({ cancelada: true })],
    });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.marcarEmitidaNoOrgao({ clienteId: 'c1', guiaId: 'guia-1' }),
    ).rejects.toThrow('Guia cancelada não pode ser emitida no órgão');
    expect(db.db.update).not.toHaveBeenCalled();
  });

  it('marcarEmitidaNoOrgao de guia de outro cliente → NotFound (R6.2)', async () => {
    const db = createMutacaoEscopadaDb([], { loadRows: [] });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.marcarEmitidaNoOrgao({
        clienteId: 'c1',
        guiaId: 'guia-de-outro',
      }),
    ).rejects.toThrow('Guia não encontrada.');
    expect(db.db.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency key: retry não duplica; múltiplas obrigações legítimas permitidas
// (tarefa 1.6 / R1.6)
// ─────────────────────────────────────────────────────────────────────────────
//
// DB falso para o caminho de idempotência de `criarGuia`. A sequência de selects
// `.limit(1)` passa a ser:
//   1) assertCliente                               → cliente
//   2) [só com chave] buscarPorIdempotencyKey      → guia existente OU []
//   3) [só origem APURACAO] resolverVinculoApuracao → fechamento
// `limitQueue` enfileira essas respostas NA ORDEM; esgotada, resolve `[]`.
// `insertErro`, quando presente, faz `insert().values().returning()` REJEITAR
// (simula a corrida que colide no índice único parcial do banco).
function createIdempotencyDb(opts: {
  limitQueue: unknown[][];
  insertedRow?: Record<string, unknown>;
  insertErro?: unknown;
}) {
  const limitQueue = [...opts.limitQueue];
  const limit = jest.fn(() =>
    Promise.resolve(limitQueue.length > 0 ? limitQueue.shift()! : []),
  );
  const returning = jest.fn(() =>
    opts.insertErro !== undefined
      ? Promise.reject(opts.insertErro)
      : Promise.resolve([opts.insertedRow ?? defaultGuiaRow()]),
  );
  const values = jest.fn().mockReturnValue({ returning });
  return {
    limit,
    values,
    returning,
    db: {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ limit }),
        }),
      }),
      insert: jest.fn().mockReturnValue({ values }),
    },
  };
}

describe('FiscalGuiasService — idempotency key (tarefa 1.6 / R1.6)', () => {
  it('sem chave: cria normalmente e não faz lookup de idempotência (comportamento legado)', async () => {
    // Fila: só o cliente (assertCliente). Sem chave, não há 2º select de lookup.
    const db = createIdempotencyDb({
      limitQueue: [[{ id: 'c1' }]],
      insertedRow: defaultGuiaRow({ idempotencyKey: null }),
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(baseInput());
    expect(guia.id).toBe('guia-1');
    expect(guia.idempotency_key).toBeNull();
    // Apenas o select do cliente roda; nenhum lookup por chave.
    expect(db.limit).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledTimes(1);
  });

  it('primeira chamada com chave: nenhuma guia existente → cria e persiste a chave', async () => {
    // Fila: 1) cliente; 2) lookup por chave → vazio (nada criado ainda).
    const db = createIdempotencyDb({
      limitQueue: [[{ id: 'c1' }], []],
      insertedRow: defaultGuiaRow({ idempotencyKey: 'req-abc' }),
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(
      baseInput({ idempotencyKey: 'req-abc' }),
    );
    expect(guia.id).toBe('guia-1');
    expect(guia.idempotency_key).toBe('req-abc');
    // Cliente + lookup (2 selects) e um insert que carrega a chave.
    expect(db.limit).toHaveBeenCalledTimes(2);
    expect(db.values).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'req-abc' }),
    );
  });

  it('RETRY com a MESMA chave NÃO cria duplicata — retorna a guia já criada (R1.6)', async () => {
    // Fila: 1) cliente; 2) lookup por chave → a guia já existente. O serviço
    // retorna a existente SEM inserir: um retry nunca duplica.
    const jaExistente = defaultGuiaRow({
      id: 'guia-original',
      idempotencyKey: 'req-abc',
    });
    const db = createIdempotencyDb({
      limitQueue: [[{ id: 'c1' }], [jaExistente]],
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(
      baseInput({ idempotencyKey: 'req-abc' }),
    );
    expect(guia.id).toBe('guia-original');
    expect(guia.idempotency_key).toBe('req-abc');
    // Deduplicação: NENHUM insert disparado no retry.
    expect(db.values).not.toHaveBeenCalled();
  });

  it('DUAS obrigações LEGÍTIMAS do mesmo tributo/período/UF (chaves distintas) são ambas criadas (R1.6)', async () => {
    // A chave é a fronteira de dedupe, NÃO uma unicidade por tributo/período/UF.
    // Duas chamadas com o mesmo (tributo, competência, UF) mas chaves distintas,
    // cada uma sem guia prévia para a sua chave → ambas criam.
    const base = baseInput({
      tributo: 'ICMS_PROPRIO',
      competencia: '2026-08',
      ufFavorecida: 'SP',
    });

    const db1 = createIdempotencyDb({
      limitQueue: [[{ id: 'c1' }], []],
      insertedRow: defaultGuiaRow({ id: 'guia-A', idempotencyKey: 'req-A' }),
    });
    const service1 = new FiscalGuiasService(db1 as never);
    const guiaA = await service1.criarGuia({
      ...base,
      idempotencyKey: 'req-A',
    });

    const db2 = createIdempotencyDb({
      limitQueue: [[{ id: 'c1' }], []],
      insertedRow: defaultGuiaRow({ id: 'guia-B', idempotencyKey: 'req-B' }),
    });
    const service2 = new FiscalGuiasService(db2 as never);
    const guiaB = await service2.criarGuia({
      ...base,
      idempotencyKey: 'req-B',
    });

    // Mesmo tributo/período/UF, guias DISTINTAS: nenhuma deduplicação indevida.
    expect(guiaA.id).toBe('guia-A');
    expect(guiaB.id).toBe('guia-B');
    expect(guiaA.id).not.toBe(guiaB.id);
    expect(db1.values).toHaveBeenCalledTimes(1);
    expect(db2.values).toHaveBeenCalledTimes(1);
  });

  it('duas obrigações legítimas SEM chave também coexistem (sem dedupe) para o mesmo tributo/período/UF', async () => {
    // Sem chave, nenhuma participa do índice único parcial: ambas criam.
    const base = baseInput();
    const db1 = createIdempotencyDb({
      limitQueue: [[{ id: 'c1' }]],
      insertedRow: defaultGuiaRow({ id: 'guia-1', idempotencyKey: null }),
    });
    const db2 = createIdempotencyDb({
      limitQueue: [[{ id: 'c1' }]],
      insertedRow: defaultGuiaRow({ id: 'guia-2', idempotencyKey: null }),
    });
    const g1 = await new FiscalGuiasService(db1 as never).criarGuia(base);
    const g2 = await new FiscalGuiasService(db2 as never).criarGuia(base);
    expect(g1.id).toBe('guia-1');
    expect(g2.id).toBe('guia-2');
    expect(db1.values).toHaveBeenCalledTimes(1);
    expect(db2.values).toHaveBeenCalledTimes(1);
  });

  it('chave em branco/whitespace é tratada como SEM chave (não deduplica)', async () => {
    // "   ".trim() === "" → null: não há 2º select de lookup e a guia é criada
    // sem chave (fora do índice único parcial).
    const db = createIdempotencyDb({
      limitQueue: [[{ id: 'c1' }]],
      insertedRow: defaultGuiaRow({ idempotencyKey: null }),
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(baseInput({ idempotencyKey: '   ' }));
    expect(guia.idempotency_key).toBeNull();
    // Sem lookup de idempotência: só o select do cliente.
    expect(db.limit).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: null }),
    );
  });

  it('CORRIDA: insert colide no índice único (23505) → relê e retorna a existente, sem duplicar (R1.6)', async () => {
    // Dois requests simultâneos com a mesma chave escapam ao lookup inicial
    // (ambos veem vazio). Um vence o insert; o outro colide no índice único
    // parcial do banco (SQLSTATE 23505). O serviço resolve como retry: relê e
    // devolve a guia que de fato foi criada — nunca propaga erro nem duplica.
    const jaExistente = defaultGuiaRow({
      id: 'guia-vencedora',
      idempotencyKey: 'req-corrida',
    });
    const db = createIdempotencyDb({
      // Fila: 1) cliente; 2) lookup inicial → vazio (corrida); 3) relê pós-23505
      // → a guia vencedora.
      limitQueue: [[{ id: 'c1' }], [], [jaExistente]],
      insertErro: { code: '23505' },
    });
    const service = new FiscalGuiasService(db as never);
    const guia = await service.criarGuia(
      baseInput({ idempotencyKey: 'req-corrida' }),
    );
    expect(guia.id).toBe('guia-vencedora');
    expect(guia.idempotency_key).toBe('req-corrida');
    // Tentou inserir (perdeu a corrida) e releu a existente (3 selects no total).
    expect(db.values).toHaveBeenCalledTimes(1);
    expect(db.limit).toHaveBeenCalledTimes(3);
  });

  it('erro NÃO relacionado à unicidade é propagado (não mascara falhas reais)', async () => {
    // Um erro de banco que não é 23505 não deve ser silenciado como "retry".
    const db = createIdempotencyDb({
      limitQueue: [[{ id: 'c1' }], []],
      insertErro: { code: '23502', message: 'not-null violation' },
    });
    const service = new FiscalGuiasService(db as never);
    await expect(
      service.criarGuia(baseInput({ idempotencyKey: 'req-x' })),
    ).rejects.toEqual({ code: '23502', message: 'not-null violation' });
  });
});
