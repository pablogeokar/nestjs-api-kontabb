import { CfopService } from './cfop.service';

describe('CfopService', () => {
  it.each([
    [
      'terceiro emitindo saída para o cliente',
      '98765432000110',
      '1',
      'ENTRADA',
    ],
    ['terceiro emitindo entrada', '98765432000110', '0', 'ENTRADA'],
    ['documento próprio de entrada', '12345678000195', '0', 'ENTRADA'],
    ['documento próprio de saída', '12345678000195', '1', 'SAIDA'],
  ])('classifica %s corretamente', (_scenario, emitente, tpNfXml, expected) => {
    const service = new CfopService({} as never, {} as never);

    expect(
      service.determinarTipoOperacaoEscriturada(
        '12.345.678/0001-95',
        emitente,
        tpNfXml,
      ),
    ).toBe(expected);
  });

  it('prioriza a equivalência customizada do cliente', async () => {
    const service = createServiceWithQueryResults([
      [{ cfopDestino: '1403' }],
      [{ codigo: '1403' }],
    ]);

    await expect(
      service.resolverCfopEquivalenteDetalhado({
        clienteId: 'cliente-1',
        cfopXml: '5405',
        tipoOperacaoEscriturada: 'ENTRADA',
      }),
    ).resolves.toEqual({
      cfop: '1403',
      revisaoNecessaria: false,
      origemResolucao: 'CLIENTE',
    });
  });

  it('usa a equivalência global quando não há regra do cliente', async () => {
    const service = createServiceWithQueryResults([
      [],
      [{ cfopDestino: '1102' }],
      [{ codigo: '1102' }],
    ]);

    await expect(
      service.resolverCfopEquivalenteDetalhado({
        clienteId: 'cliente-1',
        cfopXml: '5102',
        tipoOperacaoEscriturada: 'ENTRADA',
      }),
    ).resolves.toMatchObject({
      cfop: '1102',
      origemResolucao: 'GLOBAL',
    });
  });

  it.each([
    ['5102', '1102'],
    ['6102', '2102'],
  ])('converte %s para %s pelo algoritmo padrão', async (cfopXml, expected) => {
    const service = createServiceWithQueryResults([
      [],
      [],
      [{ codigo: expected }],
    ]);

    await expect(
      service.resolverCfopEquivalenteDetalhado({
        clienteId: 'cliente-1',
        cfopXml,
        tipoOperacaoEscriturada: 'ENTRADA',
      }),
    ).resolves.toEqual({
      cfop: expected,
      revisaoNecessaria: false,
      origemResolucao: 'ALGORITMO',
    });
  });

  it('usa fallback compatível com a abrangência e sinaliza revisão', async () => {
    const service = createServiceWithQueryResults([[], [], []]);

    await expect(
      service.resolverCfopEquivalenteDetalhado({
        clienteId: 'cliente-1',
        cfopXml: '6999',
        tipoOperacaoEscriturada: 'ENTRADA',
      }),
    ).resolves.toEqual({
      cfop: '2949',
      revisaoNecessaria: true,
      origemResolucao: 'FALLBACK',
      motivoRevisao: 'CFOP_DESTINO_NAO_CADASTRADO',
      cfopSugerido: '2999',
    });
  });

  it('devolve diagnóstico por item quando o CFOP de destino não está cadastrado', async () => {
    const service = createServiceWithQueryResults([[], [], []]);

    const result = await service.prepararItensEscrituracao({
      clienteId: 'cliente-1',
      clienteCnpjCpf: '12345678000195',
      emitenteCnpjCpf: '98765432000110',
      tpNfXml: '1',
      itens: [
        {
          numeroItem: 7,
          descricao: 'Brinde',
          cfop: '5910',
        },
      ],
    });

    expect(result.revisoes).toEqual([
      {
        numeroItem: 7,
        descricao: 'Brinde',
        cfopXml: '5910',
        cfopAplicado: '1949',
        cfopSugerido: '1910',
        motivo: 'CFOP_DESTINO_NAO_CADASTRADO',
      },
    ]);
  });

  it('mantém CFOP ativo que já corresponde ao sentido da escrituração', async () => {
    const service = createServiceWithQueryResults([[{ codigo: '1102' }]]);

    await expect(
      service.resolverCfopEquivalenteDetalhado({
        clienteId: 'cliente-1',
        cfopXml: '1102',
        tipoOperacaoEscriturada: 'ENTRADA',
      }),
    ).resolves.toEqual({
      cfop: '1102',
      revisaoNecessaria: false,
      origemResolucao: 'MANTIDO',
    });
  });
});

function createServiceWithQueryResults(results: unknown[][]) {
  const queue = [...results];
  const select = jest.fn().mockImplementation(() => ({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest
          .fn()
          .mockImplementation(() => Promise.resolve(queue.shift() ?? [])),
      }),
    }),
  }));
  // Motor de regras stub: sempre reporta PENDENTE_CLASSIFICACAO, forçando o
  // fluxo a recorrer à cascata legada (equivalências + algoritmo) que estes
  // testes cobrem. A resolução do motor tem cobertura própria em
  // fiscal-rule-engine.service.spec.ts.
  const ruleEngine = {
    evaluate: jest.fn().mockResolvedValue({
      cfopEscriturado: '',
      apropriaCreditoIcms: false,
      apropriaCreditoIpi: false,
      exigeCiap: false,
      exigeDifalEntrada: false,
      pendenteClassificacao: true,
      origemResolucao: 'PENDENTE_CLASSIFICACAO',
      motivoResolucao: 'stub',
    }),
  };
  return new CfopService({ db: { select } } as never, ruleEngine as never);
}
