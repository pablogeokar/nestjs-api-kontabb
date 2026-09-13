import {
  chaveIdentidadeItem,
  montarPatchAtualizacao,
  planejarReconciliacao,
  reconciliarItensDocumento,
} from './fiscal-item-reconciliation';

describe('chaveIdentidadeItem (F01)', () => {
  it('deriva a identidade do par numeroItem + codigoProduto', () => {
    expect(
      chaveIdentidadeItem({ numeroItem: 1, codigoProduto: 'PROD-A' }),
    ).toBe('1::PROD-A');
  });

  it('itens com mesmo numeroItem mas produtos diferentes têm identidades distintas', () => {
    const a = chaveIdentidadeItem({ numeroItem: 1, codigoProduto: 'PROD-A' });
    const b = chaveIdentidadeItem({ numeroItem: 1, codigoProduto: 'PROD-B' });
    expect(a).not.toBe(b);
  });

  it('retorna null quando falta parte da identidade', () => {
    expect(chaveIdentidadeItem({ numeroItem: 1 })).toBeNull();
    expect(chaveIdentidadeItem({ codigoProduto: 'PROD-A' })).toBeNull();
    expect(
      chaveIdentidadeItem({ numeroItem: 1, codigoProduto: '' }),
    ).toBeNull();
  });
});

describe('planejarReconciliacao (F01)', () => {
  it('MANTÉM itens existentes por (numeroItem + codigoProduto) preservando identidade', () => {
    const plano = planejarReconciliacao(
      [{ numeroItem: 1, codigoProduto: 'PROD-A', cfop: '5102' }],
      [
        {
          id: 'item-1',
          numeroItem: 1,
          codigoProduto: 'PROD-A',
          cfopManual: false,
        },
      ],
    );
    expect(plano.atualizar).toHaveLength(1);
    expect(plano.atualizar[0].existente.id).toBe('item-1');
    expect(plano.inserir).toHaveLength(0);
    expect(plano.ausentes).toHaveLength(0);
  });

  it('INSERE itens novos que não existiam', () => {
    const plano = planejarReconciliacao(
      [
        { numeroItem: 1, codigoProduto: 'PROD-A', cfop: '5102' },
        { numeroItem: 2, codigoProduto: 'PROD-B', cfop: '5102' },
      ],
      [
        {
          id: 'item-1',
          numeroItem: 1,
          codigoProduto: 'PROD-A',
          cfopManual: false,
        },
      ],
    );
    expect(plano.atualizar).toHaveLength(1);
    expect(plano.inserir).toHaveLength(1);
    expect(plano.inserir[0].codigoProduto).toBe('PROD-B');
    expect(plano.ausentes).toHaveLength(0);
  });

  it('MARCA como ausente (nunca deleta) itens cuja identidade sumiu do XML', () => {
    const plano = planejarReconciliacao(
      [{ numeroItem: 1, codigoProduto: 'PROD-A', cfop: '5102' }],
      [
        {
          id: 'item-1',
          numeroItem: 1,
          codigoProduto: 'PROD-A',
          cfopManual: false,
        },
        {
          id: 'item-2',
          numeroItem: 2,
          codigoProduto: 'PROD-B',
          cfopManual: false,
        },
      ],
    );
    expect(plano.atualizar).toHaveLength(1);
    expect(plano.ausentes).toHaveLength(1);
    expect(plano.ausentes[0].id).toBe('item-2');
    // O plano nunca expõe uma instrução de exclusão.
    expect(plano).not.toHaveProperty('removerNumeros');
    expect(plano).not.toHaveProperty('deletar');
  });

  it('trata mesma posição com produto diferente como novo item + ausente, não como update', () => {
    // numeroItem 1 permanece, mas o produto na posição mudou de A para C.
    const plano = planejarReconciliacao(
      [{ numeroItem: 1, codigoProduto: 'PROD-C', cfop: '5102' }],
      [
        {
          id: 'item-1',
          numeroItem: 1,
          codigoProduto: 'PROD-A',
          cfopManual: false,
        },
      ],
    );
    // Não herda a decisão humana do produto antigo.
    expect(plano.atualizar).toHaveLength(0);
    expect(plano.inserir).toHaveLength(1);
    expect(plano.inserir[0].codigoProduto).toBe('PROD-C');
    expect(plano.ausentes).toHaveLength(1);
    expect(plano.ausentes[0].id).toBe('item-1');
  });

  it('reimportação idêntica não marca nada como ausente', () => {
    const plano = planejarReconciliacao(
      [
        { numeroItem: 1, codigoProduto: 'PROD-A', cfop: '5102' },
        { numeroItem: 2, codigoProduto: 'PROD-B', cfop: '5102' },
      ],
      [
        {
          id: 'item-1',
          numeroItem: 1,
          codigoProduto: 'PROD-A',
          cfopManual: false,
        },
        {
          id: 'item-2',
          numeroItem: 2,
          codigoProduto: 'PROD-B',
          cfopManual: false,
        },
      ],
    );
    expect(plano.atualizar).toHaveLength(2);
    expect(plano.inserir).toHaveLength(0);
    expect(plano.ausentes).toHaveLength(0);
  });

  it('item novo sem identidade estável é inserido, não atualiza existente', () => {
    const plano = planejarReconciliacao(
      [{ codigoProduto: 'PROD-A', cfop: '5102' }],
      [
        {
          id: 'item-1',
          numeroItem: 1,
          codigoProduto: 'PROD-A',
          cfopManual: false,
        },
      ],
    );
    expect(plano.inserir).toHaveLength(1);
    expect(plano.atualizar).toHaveLength(0);
    // O existente com identidade válida vira ausente (não é deletado).
    expect(plano.ausentes).toHaveLength(1);
  });
});

describe('montarPatchAtualizacao (F01)', () => {
  it('nunca sobrescreve identidade nem decisão humana explícita', () => {
    const patch = montarPatchAtualizacao(
      {
        numeroItem: 1,
        codigoProduto: 'PROD-A',
        id: 'novo-id',
        documentoFiscalId: 'outro-doc',
        clienteId: 'outro-cliente',
        cfopManual: false,
        destinacaoMercadoria: 'REVENDA',
        destinacaoOrigem: 'MANUAL',
        cfop: '5102',
        descricao: 'PRODUTO',
      } as Record<string, unknown>,
      { cfopManual: false },
    );
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('documentoFiscalId');
    expect(patch).not.toHaveProperty('clienteId');
    expect(patch).not.toHaveProperty('cfopManual');
    expect(patch).not.toHaveProperty('destinacaoMercadoria');
    expect(patch).not.toHaveProperty('destinacaoOrigem');
    // Campos derivados do XML seguem atualizáveis quando não é manual.
    expect(patch.cfop).toBe('5102');
    expect(patch.descricao).toBe('PRODUTO');
  });

  it('preserva cfop e classificação quando o item é manual', () => {
    const patch = montarPatchAtualizacao(
      {
        numeroItem: 1,
        codigoProduto: 'PROD-A',
        cfop: '5102',
        cfopOrigemResolucao: 'ALGORITMO',
        cstIcms: '00',
        cstPis: '01',
        descricao: 'PRODUTO ATUALIZADO',
      } as Record<string, unknown>,
      { cfopManual: true },
    );
    // Decisão manual prevalece: cfop e CST não são sobrescritos.
    expect(patch).not.toHaveProperty('cfop');
    expect(patch).not.toHaveProperty('cfopOrigemResolucao');
    expect(patch).not.toHaveProperty('cstIcms');
    expect(patch).not.toHaveProperty('cstPis');
    // Campo puramente descritivo do XML ainda atualiza.
    expect(patch.descricao).toBe('PRODUTO ATUALIZADO');
  });

  // R1.3 — reimportação/ressincronização com valores de XML DIFERENTES não pode
  // sobrescrever overrides manuais nem os marcadores de origem manual.
  it('R1.3: valores de CFOP/destinação diferentes vindos do XML não sobrescrevem override manual', () => {
    // Estado atual do item (decisão humana confirmada): cfop 1556 (uso/consumo),
    // destinação REVENDA marcada manualmente.
    // XML reimportado traz valores diferentes (cfop 1102, destinação diversa).
    const patch = montarPatchAtualizacao(
      {
        numeroItem: 1,
        codigoProduto: 'PROD-A',
        // valores diferentes trazidos pela reimportação
        cfop: '1102',
        cfopManual: false,
        cfopOrigemResolucao: 'ALGORITMO',
        cfopMotivoResolucao: 'reprocessado',
        destinacaoMercadoria: 'INDUSTRIALIZACAO',
        destinacaoInferida: 'INDUSTRIALIZACAO',
        destinacaoOrigem: 'ALGORITMO',
        destinacaoConfianca: '0.900',
        destinacaoJustificativa: 'reinterpretado pelo motor',
        cstIcms: '00',
        csosnIcms: null,
        cstPis: '01',
        cstCofins: '01',
        // valor legítimo do XML (não é decisão humana)
        descricao: 'PRODUTO REEMITIDO',
        valorBrutoProduto: '199.90',
      } as Record<string, unknown>,
      { cfopManual: true },
    );

    // Marcadores de origem/override manual: SEMPRE preservados.
    expect(patch).not.toHaveProperty('cfopManual');
    expect(patch).not.toHaveProperty('destinacaoMercadoria');
    expect(patch).not.toHaveProperty('destinacaoOrigem');
    // Campos de decisão manual: preservados porque cfopManual === true.
    expect(patch).not.toHaveProperty('cfop');
    expect(patch).not.toHaveProperty('cfopOrigemResolucao');
    expect(patch).not.toHaveProperty('cfopMotivoResolucao');
    expect(patch).not.toHaveProperty('destinacaoInferida');
    expect(patch).not.toHaveProperty('destinacaoConfianca');
    expect(patch).not.toHaveProperty('destinacaoJustificativa');
    expect(patch).not.toHaveProperty('cstIcms');
    expect(patch).not.toHaveProperty('csosnIcms');
    expect(patch).not.toHaveProperty('cstPis');
    expect(patch).not.toHaveProperty('cstCofins');
    // Campos derivados do XML sem carga de decisão continuam atualizando.
    expect(patch.descricao).toBe('PRODUTO REEMITIDO');
    expect(patch.valorBrutoProduto).toBe('199.90');
  });

  // R1.3 — os marcadores de origem manual (destinacaoMercadoria/destinacaoOrigem)
  // são preservados mesmo quando cfopManual é false, garantindo que a destinação
  // confirmada manualmente não seja perdida por reimportação.
  it('R1.3: marcadores de destinação manual são preservados mesmo com cfopManual = false', () => {
    const patch = montarPatchAtualizacao(
      {
        numeroItem: 1,
        codigoProduto: 'PROD-A',
        destinacaoMercadoria: 'ATIVO_IMOBILIZADO',
        destinacaoOrigem: 'MANUAL',
        descricao: 'PRODUTO',
      } as Record<string, unknown>,
      { cfopManual: false },
    );
    expect(patch).not.toHaveProperty('destinacaoMercadoria');
    expect(patch).not.toHaveProperty('destinacaoOrigem');
    expect(patch.descricao).toBe('PRODUTO');
  });
});

// Cria um executor de transação falso que captura os SET emitidos pelos UPDATEs
// e devolve `existentes` no SELECT. Permite provar, sem banco, que a
// reconciliação end-to-end preserva a decisão humana (R1.3) e nunca deleta.
function criarTxFalso(existentes: Array<Record<string, unknown>>) {
  const updatesEmitidos: Array<{ patch: Record<string, unknown> }> = [];
  const inserts: unknown[][] = [];
  let deleteChamado = false;

  const tx = {
    select: () => ({
      from: () => ({
        where: async () => existentes,
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          updatesEmitidos.push({ patch });
        },
      }),
    }),
    insert: () => ({
      values: async (lote: unknown[]) => {
        inserts.push(lote);
      },
    }),
    delete: () => {
      deleteChamado = true;
      return { where: async () => undefined };
    },
  };

  return {
    tx: tx as never,
    updatesEmitidos,
    inserts,
    get deleteChamado() {
      return deleteChamado;
    },
  };
}

describe('reconciliarItensDocumento (F01, R1.3)', () => {
  it('atualiza item manual sem sobrescrever CFOP/destinação e nunca deleta', async () => {
    const harness = criarTxFalso([
      {
        id: 'item-1',
        numeroItem: 1,
        codigoProduto: 'PROD-A',
        cfopManual: true,
      },
    ]);

    const resultado = await reconciliarItensDocumento(harness.tx, {
      documentoFiscalId: 'doc-1',
      clienteId: 'cliente-1',
      itens: [
        {
          numeroItem: 1,
          codigoProduto: 'PROD-A',
          // XML reimportado com valores diferentes da decisão humana
          cfop: '1102',
          cfopManual: false,
          destinacaoMercadoria: 'INDUSTRIALIZACAO',
          destinacaoOrigem: 'ALGORITMO',
          cstIcms: '00',
          cstPis: '01',
          descricao: 'DESC NOVA',
        },
      ] as never[],
    });

    expect(resultado).toEqual({ atualizados: 1, inseridos: 0, ausentes: 0 });
    expect(harness.deleteChamado).toBe(false);
    expect(harness.inserts).toHaveLength(0);
    expect(harness.updatesEmitidos).toHaveLength(1);

    const patch = harness.updatesEmitidos[0].patch;
    // Decisão humana preservada.
    expect(patch).not.toHaveProperty('cfop');
    expect(patch).not.toHaveProperty('cfopManual');
    expect(patch).not.toHaveProperty('destinacaoMercadoria');
    expect(patch).not.toHaveProperty('destinacaoOrigem');
    expect(patch).not.toHaveProperty('cstIcms');
    expect(patch).not.toHaveProperty('cstPis');
    // Campo do XML sem decisão continua atualizando + carimbo de atualização.
    expect(patch.descricao).toBe('DESC NOVA');
    expect(patch.atualizadoEm).toBeInstanceOf(Date);
    // Identidade nunca vai para o SET.
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('documentoFiscalId');
    expect(patch).not.toHaveProperty('clienteId');
  });

  it('reimportação idêntica de item não-manual atualiza o CFOP do XML e não deleta', async () => {
    const harness = criarTxFalso([
      {
        id: 'item-1',
        numeroItem: 1,
        codigoProduto: 'PROD-A',
        cfopManual: false,
      },
    ]);

    await reconciliarItensDocumento(harness.tx, {
      documentoFiscalId: 'doc-1',
      clienteId: 'cliente-1',
      itens: [
        { numeroItem: 1, codigoProduto: 'PROD-A', cfop: '5102' },
      ] as never[],
    });

    expect(harness.deleteChamado).toBe(false);
    expect(harness.updatesEmitidos).toHaveLength(1);
    // Sem override manual, o CFOP derivado do XML é atualizado normalmente.
    expect(harness.updatesEmitidos[0].patch.cfop).toBe('5102');
  });

  it('item ausente do XML não gera delete (nunca deleta) e é contado como ausente', async () => {
    const harness = criarTxFalso([
      {
        id: 'item-1',
        numeroItem: 1,
        codigoProduto: 'PROD-A',
        cfopManual: true,
      },
      {
        id: 'item-2',
        numeroItem: 2,
        codigoProduto: 'PROD-B',
        cfopManual: false,
      },
    ]);

    const resultado = await reconciliarItensDocumento(harness.tx, {
      documentoFiscalId: 'doc-1',
      clienteId: 'cliente-1',
      itens: [
        { numeroItem: 1, codigoProduto: 'PROD-A', cfop: '5102' },
      ] as never[],
    });

    expect(resultado.ausentes).toBe(1);
    expect(harness.deleteChamado).toBe(false);
  });
});
