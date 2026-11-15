import {
  CFOPS_DEVOLUCAO_VENDA,
  classificarOperacaoSimples,
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
