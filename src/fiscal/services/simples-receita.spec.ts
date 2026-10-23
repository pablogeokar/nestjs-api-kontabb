import {
  classificarOperacaoSimples,
  somarReceitaSimples,
  valorReceitaSimples,
} from './simples-receita';

describe('receita documental do Simples Nacional', () => {
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
