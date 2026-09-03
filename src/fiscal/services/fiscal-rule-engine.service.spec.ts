import { FiscalRuleEngineService } from './fiscal-rule-engine.service';

// Monta um DatabaseService falso cujo select() responde em fila.
// Ordem esperada das consultas no evaluate():
//   1) findMatchingRule  -> lista de regras (order by prioridade)
//   2..n) isCfopAtivo / getCfop -> conforme o caminho tomado
function createEngine(queue: unknown[][]) {
  const q = [...queue];
  const select = jest.fn().mockImplementation(() => {
    const result = q.shift() ?? [];
    // Suporta tanto .where().orderBy() (regras) quanto .where().limit() (cfop).
    const chain = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockResolvedValue(result),
          limit: jest.fn().mockResolvedValue(result),
        }),
      }),
    };
    return chain;
  });
  return new FiscalRuleEngineService({ db: { select } } as never);
}

describe('FiscalRuleEngineService', () => {
  it('não aplica crédito de ICMS em compra de uso/consumo por destinação', async () => {
    const engine = createEngine([
      [], // sem regras cadastradas
      [{ codigo: '1556' }], // isCfopAtivo(1556) -> ativo
      [
        {
          codigo: '1556',
          categoriaFiscal: 'USO_CONSUMO',
          geraCreditoIcmsPadrao: false,
        },
      ], // getCfop(1556)
    ]);

    const result = await engine.evaluate({
      clienteId: 'c1',
      tipoOperacaoEscriturada: 'ENTRADA',
      cfopXml: '5102',
      destinacaoMercadoria: 'USO_CONSUMO',
    });

    expect(result.cfopEscriturado).toBe('1556');
    expect(result.apropriaCreditoIcms).toBe(false);
    expect(result.origemResolucao).toBe('DESTINACAO_NCM');
  });

  it('marca CIAP e DIFAL em compra interestadual de ativo imobilizado', async () => {
    const engine = createEngine([
      [],
      [{ codigo: '2551' }],
      [
        {
          codigo: '2551',
          categoriaFiscal: 'ATIVO_IMOBILIZADO',
          geraCreditoIcmsPadrao: false,
        },
      ],
    ]);

    const result = await engine.evaluate({
      clienteId: 'c1',
      tipoOperacaoEscriturada: 'ENTRADA',
      cfopXml: '6551',
      destinacaoMercadoria: 'ATIVO_IMOBILIZADO',
    });

    expect(result.cfopEscriturado).toBe('2551');
    expect(result.apropriaCreditoIcms).toBe(false);
    expect(result.exigeCiap).toBe(true);
    expect(result.exigeDifalEntrada).toBe(true);
  });

  it('credita ICMS em compra para revenda por destinação', async () => {
    const engine = createEngine([
      [],
      [{ codigo: '1102' }],
      [
        {
          codigo: '1102',
          categoriaFiscal: 'COMPRA_REVENDA',
          geraCreditoIcmsPadrao: true,
        },
      ],
    ]);

    const result = await engine.evaluate({
      clienteId: 'c1',
      tipoOperacaoEscriturada: 'ENTRADA',
      cfopXml: '5405',
      destinacaoMercadoria: 'REVENDA',
    });

    expect(result.cfopEscriturado).toBe('1102');
    expect(result.apropriaCreditoIcms).toBe(true);
  });

  it('aplica regra do cliente com prioridade sobre a global', async () => {
    const engine = createEngine([
      [
        {
          id: 'g1',
          clienteId: null,
          prioridade: 10,
          nomeRegra: 'Global',
          cfopOrigem: '5102',
          cfopDestino: '1102',
          apropriaCreditoIcms: true,
          apropriaCreditoIpi: false,
          exigeCiap: false,
          exigeDifalEntrada: false,
        },
        {
          id: 'c1r',
          clienteId: 'c1',
          prioridade: 50,
          nomeRegra: 'Cliente X - tudo uso/consumo',
          cfopOrigem: '5102',
          cfopDestino: '1556',
          apropriaCreditoIcms: false,
          apropriaCreditoIpi: false,
          exigeCiap: false,
          exigeDifalEntrada: false,
        },
      ],
      // getCfop(1556) do buildFromRule
      [
        {
          codigo: '1556',
          categoriaFiscal: 'USO_CONSUMO',
          geraCreditoIcmsPadrao: false,
        },
      ],
    ]);

    const result = await engine.evaluate({
      clienteId: 'c1',
      tipoOperacaoEscriturada: 'ENTRADA',
      cfopXml: '5102',
    });

    expect(result.regraAplicadaId).toBe('c1r');
    expect(result.cfopEscriturado).toBe('1556');
    expect(result.apropriaCreditoIcms).toBe(false);
    expect(result.origemResolucao).toBe('REGRA_CLIENTE');
  });

  it('sinaliza PENDENTE_CLASSIFICACAO quando não há correspondência segura', async () => {
    const engine = createEngine([
      [], // sem regras
      [], // isCfopAtivo(cfopXml) -> inativo/inexistente
      [], // isCfopAtivo(convertido) -> inexistente
    ]);

    const result = await engine.evaluate({
      clienteId: 'c1',
      tipoOperacaoEscriturada: 'ENTRADA',
      cfopXml: '5999',
    });

    expect(result.pendenteClassificacao).toBe(true);
    expect(result.origemResolucao).toBe('PENDENTE_CLASSIFICACAO');
    expect(result.cfopEscriturado).toBe('1949');
    expect(result.cfopSugerido).toBe('1999');
  });
});
