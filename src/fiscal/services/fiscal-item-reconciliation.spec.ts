import {
  montarPatchAtualizacao,
  planejarReconciliacao,
} from './fiscal-item-reconciliation';

describe('planejarReconciliacao (F01)', () => {
  it('atualiza itens existentes por numeroItem preservando identidade', () => {
    const plano = planejarReconciliacao(
      [{ numeroItem: 1, cfop: '5102' }],
      [{ id: 'item-1', numeroItem: 1, cfopManual: false }],
    );
    expect(plano.atualizar).toHaveLength(1);
    expect(plano.atualizar[0].existente.id).toBe('item-1');
    expect(plano.inserir).toHaveLength(0);
    expect(plano.removerNumeros).toHaveLength(0);
  });

  it('insere itens novos que não existiam', () => {
    const plano = planejarReconciliacao(
      [
        { numeroItem: 1, cfop: '5102' },
        { numeroItem: 2, cfop: '5102' },
      ],
      [{ id: 'item-1', numeroItem: 1, cfopManual: false }],
    );
    expect(plano.atualizar).toHaveLength(1);
    expect(plano.inserir).toHaveLength(1);
    expect(plano.inserir[0].numeroItem).toBe(2);
    expect(plano.removerNumeros).toHaveLength(0);
  });

  it('remove apenas itens cujo numeroItem sumiu do XML', () => {
    const plano = planejarReconciliacao(
      [{ numeroItem: 1, cfop: '5102' }],
      [
        { id: 'item-1', numeroItem: 1, cfopManual: false },
        { id: 'item-2', numeroItem: 2, cfopManual: false },
      ],
    );
    expect(plano.atualizar).toHaveLength(1);
    expect(plano.removerNumeros).toEqual([2]);
  });

  it('reimportação idêntica não remove nada', () => {
    const plano = planejarReconciliacao(
      [
        { numeroItem: 1, cfop: '5102' },
        { numeroItem: 2, cfop: '5102' },
      ],
      [
        { id: 'item-1', numeroItem: 1, cfopManual: false },
        { id: 'item-2', numeroItem: 2, cfopManual: false },
      ],
    );
    expect(plano.atualizar).toHaveLength(2);
    expect(plano.inserir).toHaveLength(0);
    expect(plano.removerNumeros).toHaveLength(0);
  });
});

describe('montarPatchAtualizacao (F01)', () => {
  it('nunca sobrescreve identidade nem decisão humana explícita', () => {
    const patch = montarPatchAtualizacao(
      {
        numeroItem: 1,
        id: 'novo-id',
        documentoFiscalId: 'outro-doc',
        clienteId: 'outro-cliente',
        cfopManual: false,
        destinacaoMercadoria: 'REVENDA',
        destinacaoOrigem: 'MANUAL',
        cfop: '5102',
        descricao: 'PRODUTO',
      },
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
        cfop: '5102',
        cfopOrigemResolucao: 'ALGORITMO',
        cstIcms: '00',
        cstPis: '01',
        descricao: 'PRODUTO ATUALIZADO',
      },
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
});
