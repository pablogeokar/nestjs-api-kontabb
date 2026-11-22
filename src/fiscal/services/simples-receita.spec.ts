import {
  CFOPS_DEVOLUCAO_VENDA,
  classificarOperacaoSimples,
  consolidarReceitaMensal,
  decidirReceitaDoMes,
  distribuirDevolucoesSimples,
  regimeCompetenciaParaApuracao,
  somarReceitaSimples,
  valorReceitaSimples,
} from './simples-receita';

describe('receita documental do Simples Nacional', () => {
  it('usa caixa apenas nos períodos permitidos e mantém competência a partir de 2027', () => {
    expect(regimeCompetenciaParaApuracao('2026-12', false)).toBe(false);
    expect(regimeCompetenciaParaApuracao('2026-12', true)).toBe(true);
    expect(regimeCompetenciaParaApuracao('2027-01', false)).toBe(true);
  });
  it.each(['5910', '6910', '5911', '6911', '5901', '5152'])(
    'não transforma a saída %s em receita de venda',
    (cfop) =>
      expect(classificarOperacaoSimples('NFE', cfop)).toBe('NAO_RECEITA'),
  );

  it.each(['5101', '5102', '5405', '5651', '6102', '7101'])(
    'mantém a venda %s na base',
    (cfop) => expect(classificarOperacaoSimples('NFE', cfop)).toBe('RECEITA'),
  );

  it('exige revisão para CFOP sem enquadramento seguro', () => {
    expect(classificarOperacaoSimples('NFE', '5922')).toBe('REVISAR');
    expect(classificarOperacaoSimples('NFE', '5949')).toBe('REVISAR');
    expect(classificarOperacaoSimples('NFE', '5301')).toBe('REVISAR');
    expect(classificarOperacaoSimples('NFE', null)).toBe('REVISAR');
  });

  it('distingue entradas por devolução de venda de retornos de transferência e devoluções ao fornecedor', () => {
    expect(CFOPS_DEVOLUCAO_VENDA).toEqual(
      expect.arrayContaining(['1202', '2202', '1411', '2411']),
    );
    for (const cfop of ['1102', '1208', '1553', '5202', '6202', '5411']) {
      expect(CFOPS_DEVOLUCAO_VENDA).not.toContain(cfop);
    }
  });

  it('transporta o excedente de devolução entre competências sem descontar de outra segregação', () => {
    const normal = 'ANEXO_I:false:false';
    const st = 'ANEXO_I:true:false';
    const porMes = distribuirDevolucoesSimples(
      [
        { mes: '2026-11', grupo: normal, valor: 20000n },
        { mes: '2026-11', grupo: st, valor: 50000n },
        { mes: '2027-01', grupo: st, valor: 4000n },
        { mes: '2027-02', grupo: normal, valor: 50000n },
      ],
      [{ mes: '2026-11', grupo: normal, valor: 40000n }],
      new Set(['2026-12']),
      '2027-03',
    );
    expect(porMes.get('2026-11')).toMatchObject({
      abatimentos: new Map([[normal, 20000n]]),
      saldo: 20000n,
    });
    expect(porMes.get('2027-01')).toMatchObject({
      abatimentos: new Map(),
      saldo: 20000n,
      saldoComHistoricoManual: true,
    });
    expect(porMes.get('2027-02')).toMatchObject({
      abatimentos: new Map([[normal, 20000n]]),
      saldo: 0n,
      saldoComHistoricoManual: true,
    });
    expect(porMes.get('2027-03')?.saldoComHistoricoManual).toBe(false);
  });

  it.each(['5351', '5353', '5360', '6352', '6357', '6360'])(
    'reconhece a prestação de transporte %s como receita do CT-e',
    (cfop) => expect(classificarOperacaoSimples('CTE', cfop)).toBe('RECEITA'),
  );

  it.each(['1352', '5206', '5358', '7358', '5949'])(
    'exige revisão para CT-e com CFOP %s sem segregação segura',
    (cfop) => expect(classificarOperacaoSimples('CTE', cfop)).toBe('REVISAR'),
  );

  it('apura uma nota mista apenas pelo item vendido, após desconto incondicional', () => {
    const venda = valorReceitaSimples({
      bruto: '1000.00',
      frete: '30.00',
      seguro: null,
      outras: null,
      desconto: '100.00',
    });
    const bonificacao = valorReceitaSimples({
      bruto: '200.00',
      frete: null,
      seguro: null,
      outras: null,
      desconto: null,
    });
    const itens = [
      { cfop: '5102', valor: venda },
      { cfop: '5910', valor: bonificacao },
    ];
    expect(
      somarReceitaSimples(
        itens
          .filter(
            (item) =>
              classificarOperacaoSimples('NFE', item.cfop) === 'RECEITA',
          )
          .map((item) => item.valor),
      ),
    ).toBe('930.00');
  });
});

describe('consolidação mensal da receita (base do Simples e da relação de faturamento)', () => {
  const linha = (
    mes: string,
    tipoDocumento: string,
    cfop: string | null,
    bruto: string,
    extra: Partial<{ indTotal: string; desconto: string; frete: string }> = {},
  ) => ({
    mes,
    tipoDocumento,
    cfop,
    cfopXml: null,
    indTotal: extra.indTotal ?? '1',
    bruto,
    frete: extra.frete ?? null,
    seguro: null,
    outras: null,
    desconto: extra.desconto ?? null,
  });

  it('separa mercadorias, serviços e transportes e soma frete e desconto do item', () => {
    const [mes] = consolidarReceitaMensal([
      linha('2026-10', 'NFE', '5102', '100.00', {
        frete: '10.00',
        desconto: '5.00',
      }),
      linha('2026-10', 'NFCE', '5405', '50.00'),
      linha('2026-10', 'NFSE', null, '300.00'),
      linha('2026-10', 'CTE', '6353', '1000.00'),
    ]);
    expect(mes).toEqual({
      mes: '2026-10',
      mercadorias: 15500n,
      servicos: 30000n,
      transportes: 100000n,
      devolucoes: 0n,
      receita: 145500n,
    });
  });

  it('deixa fora bonificações, remessas, transferências e itens fora do total da nota', () => {
    const [mes] = consolidarReceitaMensal([
      linha('2026-10', 'NFE', '5102', '1000.00'),
      linha('2026-10', 'NFE', '5910', '400.00'), // bonificação
      linha('2026-10', 'NFE', '5152', '300.00'), // transferência
      linha('2026-10', 'NFE', '5901', '200.00'), // remessa
      linha('2026-10', 'NFE', '5102', '99.00', { indTotal: '0' }),
    ]);
    expect(mes.receita).toBe(100000n);
  });

  it('abate as devoluções de vendas do mês', () => {
    const [mes] = consolidarReceitaMensal(
      [linha('2026-10', 'NFE', '5102', '54129.00')],
      new Map([
        [
          '2026-10',
          { abatimentos: new Map([['ANEXO_I:false:false', 413500n]]) },
        ],
      ]),
    );
    expect(mes).toMatchObject({
      mercadorias: 5412900n,
      devolucoes: 413500n,
      receita: 4999400n,
    });
  });

  it('o CT-e de anulação deduz a prestação, sem deixar o transporte negativo', () => {
    const [mes] = consolidarReceitaMensal([
      linha('2026-10', 'CTE', '6353', '1000.00'),
      linha('2026-10', 'CTE', '6353', '-1000.00'),
      linha('2026-10', 'CTE', '6353', '-50.00'),
      linha('2026-10', 'NFSE', null, '10.00'),
    ]);
    expect(mes.transportes).toBe(0n);
    expect(mes.receita).toBe(1000n);
  });
});

describe('base de cálculo do mês (relação de faturamento e card de vendas)', () => {
  const docs = {
    mes: '2026-10',
    mercadorias: 5412900n,
    servicos: 80000n,
    transportes: 0n,
    devolucoes: 413500n,
    receita: 5079400n,
  };

  it('a base informada manualmente prevalece sobre a apuração e os documentos', () => {
    const r = decidirReceitaDoMes({
      documentos: docs,
      apuracao: 5079400n,
      manual: 5100000n,
    });
    expect(r).toMatchObject({
      origem: 'HISTORICO_INFORMADO',
      receita: 5100000n,
      detalhado: false,
      mercadorias: 0n,
    });
  });

  it('vale a base manual no mês sem notas no sistema', () => {
    expect(
      decidirReceitaDoMes({
        documentos: undefined,
        apuracao: undefined,
        manual: 6121550n,
      }),
    ).toMatchObject({ origem: 'HISTORICO_INFORMADO', receita: 6121550n });
  });

  it('sem base manual, usa a apuração salva e a composição líquida quando ela soma a base', () => {
    const r = decidirReceitaDoMes({
      documentos: docs,
      apuracao: 5079400n,
      manual: undefined,
    });
    expect(r).toMatchObject({
      origem: 'APURACAO_SIMPLES',
      detalhado: true,
      mercadorias: 4999400n, // 54.129,00 − 4.135,00 (devoluções)
      servicos: 80000n,
    });
    expect(r.mercadorias + r.servicos + r.transportes).toBe(r.receita);
  });

  it('a manual igual aos documentos mantém a composição por tipo', () => {
    expect(
      decidirReceitaDoMes({
        documentos: docs,
        apuracao: undefined,
        manual: 5079400n,
      }).detalhado,
    ).toBe(true);
  });

  it('sem manual nem apuração, usa os documentos', () => {
    expect(
      decidirReceitaDoMes({
        documentos: docs,
        apuracao: undefined,
        manual: undefined,
      }),
    ).toMatchObject({
      origem: 'DOCUMENTOS',
      receita: 5079400n,
      detalhado: true,
    });
    expect(
      decidirReceitaDoMes({
        documentos: undefined,
        apuracao: undefined,
        manual: undefined,
      }),
    ).toMatchObject({ origem: 'DOCUMENTOS', receita: 0n, detalhado: true });
  });
});
