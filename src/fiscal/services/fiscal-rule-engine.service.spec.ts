import { FiscalRuleEngineService } from './fiscal-rule-engine.service';
import {
  CFOP_FINAIS_VEDA_CREDITO,
  cfopVedaCreditoIcms,
} from './decisao-credito';

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
      [{ codigo: '1556' }], // isCfopAtivo(1556) -> ativo
      [
        {
          codigo: '1556',
          ativo: true,
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
      cfopXml: '5102',
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
          ativo: true,
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

describe('resolução contextual segura', () => {
  it.each([
    ['REVENDA', '5102', '60', '1403'],
    ['INDUSTRIALIZACAO', '6101', '10', '2401'],
    ['USO_CONSUMO', '5102', '30', '1407'],
    ['ATIVO_IMOBILIZADO', '6102', '70', '2406'],
    ['REVENDA', '7102', '00', '3102'],
    ['INDUSTRIALIZACAO', '7101', '00', '3101'],
  ])(
    'resolve %s a partir de %s CST %s como %s',
    async (destinacao, cfopXml, cst, esperado) => {
      const engine = createEngine([
        [{ codigo: esperado }],
        [
          {
            codigo: esperado,
            ativo: true,
            categoriaFiscal:
              destinacao === 'ATIVO_IMOBILIZADO'
                ? 'ATIVO_IMOBILIZADO'
                : 'COMPRA_REVENDA',
            geraCreditoIcmsPadrao: true,
          },
        ],
      ]);
      const result = await engine.evaluate({
        clienteId: 'c1',
        tipoOperacaoEscriturada: 'ENTRADA',
        cfopXml,
        cstIcmsXml: cst,
        destinacaoMercadoria: destinacao as 'REVENDA',
      });
      expect(result.cfopEscriturado).toBe(esperado);
      if (cst !== '00') expect(result.apropriaCreditoIcms).toBe(false);
      if (destinacao === 'ATIVO_IMOBILIZADO')
        expect(result.exigeCiap).toBe(true);
      expect(result.classificacao?.origem).toBe('MANUAL');
    },
  );
  it.each(['5910', '5901', '5202', '5152', '5656'])(
    'não transforma operação especial %s em compra',
    async (cfopXml) => {
      const result = await createEngine([]).evaluate({
        clienteId: 'c1',
        cfopXml,
        tipoOperacaoEscriturada: 'ENTRADA',
        destinacaoMercadoria: 'REVENDA',
      });
      expect(result).toMatchObject({
        cfopEscriturado: cfopXml,
        pendenteClassificacao: true,
        bloqueiaFallback: true,
      });
    },
  );
  it('não converte ST em uma importação genérica sem revisão', async () => {
    expect(
      await createEngine([]).evaluate({
        clienteId: 'c1',
        cfopXml: '7102',
        tipoOperacaoEscriturada: 'ENTRADA',
        destinacaoMercadoria: 'REVENDA',
        csosnXml: '500',
      }),
    ).toMatchObject({
      pendenteClassificacao: true,
      apropriaCreditoIcms: false,
    });
  });
  it('impede regra com destino inativo', async () => {
    const engine = createEngine([
      [{ clienteId: 'c1', cfopDestino: '1102', prioridade: 1 }],
      [{ codigo: '1102', ativo: false }],
    ]);
    expect(
      await engine.evaluate({
        clienteId: 'c1',
        cfopXml: '5102',
        tipoOperacaoEscriturada: 'ENTRADA',
      }),
    ).toMatchObject({ bloqueiaFallback: true, pendenteClassificacao: true });
  });
  it('mantém baixa confiança pendente apesar da equivalência linear existir', async () => {
    const classify = jest.fn().mockResolvedValue({
      destinacao: 'REVENDA',
      confianca: 0.65,
      origem: 'NCM_PERFIL',
      justificativa: 'Confirmar uso',
      requerConfirmacao: true,
    });
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }),
      }),
    };
    const engine = new FiscalRuleEngineService(
      { db } as never,
      { classificar: classify } as never,
    );
    expect(
      await engine.evaluate({
        clienteId: 'c1',
        cfopXml: '5102',
        tipoOperacaoEscriturada: 'ENTRADA',
      }),
    ).toMatchObject({
      pendenteClassificacao: true,
      classificacao: { confianca: 0.65 },
    });
  });
});

// O simulador (RegrasFiscaisService.simular → FiscalRuleEngineService.evaluate)
// e a apuração/builder DEVEM vedar crédito pelos MESMOS CFOPs (R3.3, R7.1). Esta
// suíte prova que o motor de regras deriva a vedação da fonte única
// `cfopVedaCreditoIcms` (decisao-credito.ts), sem regex privada duplicada.
describe('vedação de crédito por CFOP compartilhada simulador ↔ apuração (R3.3)', () => {
  it.each(CFOP_FINAIS_VEDA_CREDITO.map((final) => `1${final}`))(
    'não credita ICMS via regra quando o CFOP de destino %s veda crédito',
    async (cfopDestino) => {
      // Sanidade: a fonte única realmente veda esse CFOP.
      expect(cfopVedaCreditoIcms(cfopDestino)).toBe(true);

      const engine = createEngine([
        [
          {
            id: 'r1',
            clienteId: 'c1',
            prioridade: 10,
            nomeRegra: 'Regra que aponta CFOP vedado',
            cfopOrigem: '5102',
            cfopDestino,
            // Regra tenta apropriar; a vedação por CFOP tem de prevalecer,
            // exatamente como no builder/apuração.
            apropriaCreditoIcms: true,
            apropriaCreditoIpi: false,
            exigeCiap: false,
            exigeDifalEntrada: false,
          },
        ],
        [
          {
            codigo: cfopDestino,
            ativo: true,
            categoriaFiscal: 'USO_CONSUMO',
            // Mesmo com o catálogo permitindo crédito, o CFOP vedado corta.
            geraCreditoIcmsPadrao: true,
          },
        ],
      ]);

      const result = await engine.evaluate({
        clienteId: 'c1',
        tipoOperacaoEscriturada: 'ENTRADA',
        cfopXml: '5102',
      });

      expect(result.cfopEscriturado).toBe(cfopDestino);
      expect(result.apropriaCreditoIcms).toBe(false);
    },
  );

  it.each(CFOP_FINAIS_VEDA_CREDITO.map((final) => `1${final}`))(
    'não credita ICMS via catálogo (MANTIDO) quando o CFOP %s veda crédito',
    async (cfop) => {
      expect(cfopVedaCreditoIcms(cfop)).toBe(true);

      const engine = createEngine([
        [], // sem regras
        [{ codigo: cfop }], // isCfopAtivo(cfop) -> ativo
        [
          {
            codigo: cfop,
            ativo: true,
            categoriaFiscal: 'USO_CONSUMO',
            geraCreditoIcmsPadrao: true,
          },
        ], // getCfop(cfop)
      ]);

      const result = await engine.evaluate({
        clienteId: 'c1',
        tipoOperacaoEscriturada: 'ENTRADA',
        cfopXml: cfop,
      });

      expect(result.origemResolucao).toBe('MANTIDO');
      expect(result.cfopEscriturado).toBe(cfop);
      expect(result.apropriaCreditoIcms).toBe(false);
    },
  );

  it('credita ICMS quando o CFOP NÃO é vedado pela fonte única (1102)', async () => {
    // Espelha o caso positivo do builder/decisão pura (1102 credita).
    expect(cfopVedaCreditoIcms('1102')).toBe(false);

    const engine = createEngine([
      [], // sem regras
      [{ codigo: '1102' }],
      [
        {
          codigo: '1102',
          ativo: true,
          categoriaFiscal: 'COMPRA_REVENDA',
          geraCreditoIcmsPadrao: true,
        },
      ],
    ]);

    const result = await engine.evaluate({
      clienteId: 'c1',
      tipoOperacaoEscriturada: 'ENTRADA',
      cfopXml: '1102',
    });

    expect(result.apropriaCreditoIcms).toBe(true);
  });
});
