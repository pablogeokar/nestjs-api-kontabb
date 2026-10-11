import {
  classificarDifalHipotese,
  separarPorHipotese,
  type DifalItemClassificavel,
} from './difal-hipotese';

// Helper: item mínimo classificável, com overrides pontuais por teste.
function item(
  overrides: Partial<DifalItemClassificavel> = {},
): DifalItemClassificavel {
  return {
    tipoOperacaoEscriturada: 'ENTRADA',
    cfop: '2556',
    ...overrides,
  };
}

describe('classificarDifalHipotese (Fase 4 / tarefa 2.1 — R1.1)', () => {
  describe('DIFAL de entrada do contribuinte (uso/consumo e ativo)', () => {
    it('classifica uso/consumo (2556) como entrada-contribuinte', () => {
      const r = classificarDifalHipotese(item({ cfop: '2556' }));
      expect(r.hipotese).toBe('DIFAL_ENTRADA_CONTRIBUINTE');
      expect(r.sentido).toBe('ENTRADA');
      expect(r.stRetida).toBe(false);
    });

    it('classifica ativo imobilizado (2551) como entrada-contribuinte', () => {
      const r = classificarDifalHipotese(item({ cfop: '2551' }));
      expect(r.hipotese).toBe('DIFAL_ENTRADA_CONTRIBUINTE');
    });
  });

  describe('ST tem precedência (R1.4 / design: não incluir 2406/2407 sem analisar responsabilidade)', () => {
    it('classifica 2407 (uso/consumo de substituído) como ST, não entrada-contribuinte', () => {
      const r = classificarDifalHipotese(item({ cfop: '2407' }));
      expect(r.hipotese).toBe('ST');
      expect(r.stRetida).toBe(true);
      expect(r.motivo).toContain('substitui');
    });

    it('classifica 2406 (ativo de substituído) como ST, não entrada-contribuinte', () => {
      const r = classificarDifalHipotese(item({ cfop: '2406' }));
      expect(r.hipotese).toBe('ST');
      expect(r.stRetida).toBe(true);
    });

    it('indicador de ST no item sobrepõe o CFOP de uso/consumo', () => {
      // Mesmo um CFOP 2556 (que isolado seria entrada-contribuinte) vira ST
      // quando o item traz ICMS-ST retido — evita recolher em duplicidade.
      const r = classificarDifalHipotese(
        item({ cfop: '2556', possuiSt: true }),
      );
      expect(r.hipotese).toBe('ST');
      expect(r.stRetida).toBe(true);
    });

    it('ST retida anteriormente marca stRetida mesmo sem CFOP de ST', () => {
      const r = classificarDifalHipotese(
        item({ cfop: '2556', stRetidaAnteriormente: true }),
      );
      expect(r.hipotese).toBe('ST');
      expect(r.stRetida).toBe(true);
    });

    it('2406/2407 caem em ST por CFOP mesmo SEM indicadores de ST no item (decisão 2.5)', () => {
      // DECISÃO 2.5: 2406/2407 permanecem na busca, porém a análise de
      // responsabilidade (CFOP de substituído) basta para roteá-los a ST — sem
      // depender de possuiSt/stRetidaAnteriormente. Garante que nunca sejam
      // tratados como entrada-contribuinte e nunca gerem DIFAL próprio.
      for (const cfop of ['2406', '2407']) {
        const r = classificarDifalHipotese(item({ cfop }));
        expect(r.hipotese).toBe('ST');
        expect(r.stRetida).toBe(true);
        expect(r.motivo).toContain(cfop);
      }
    });
  });

  describe('DIFAL de saída a consumidor final não contribuinte (N10)', () => {
    it('classifica venda interestadual a não contribuinte (6107/6108)', () => {
      const r = classificarDifalHipotese(
        item({ tipoOperacaoEscriturada: 'SAIDA', cfop: '6108' }),
      );
      expect(r.hipotese).toBe('DIFAL_SAIDA_NAO_CONTRIBUINTE');
      expect(r.sentido).toBe('SAIDA');
    });

    it('saída sob ST vira ST, não saída-não-contribuinte', () => {
      const r = classificarDifalHipotese(
        item({ tipoOperacaoEscriturada: 'SAIDA', cfop: '6108', possuiSt: true }),
      );
      expect(r.hipotese).toBe('ST');
    });
  });

  describe('antecipação (só quando a UF exige)', () => {
    it('classifica entrada interestadual como ANTECIPACAO quando exigeAntecipacao', () => {
      const r = classificarDifalHipotese(
        item({ cfop: '2102' }),
        { exigeAntecipacao: true },
      );
      expect(r.hipotese).toBe('ANTECIPACAO');
    });

    it('sem exigeAntecipacao, revenda interestadual não é pertinente', () => {
      const r = classificarDifalHipotese(item({ cfop: '2102' }));
      expect(r.hipotese).toBeNull();
    });

    it('uso/consumo (2556) continua entrada-contribuinte mesmo com antecipação ligada', () => {
      // A entrada-contribuinte tem precedência sobre a antecipação genérica.
      const r = classificarDifalHipotese(item({ cfop: '2556' }), {
        exigeAntecipacao: true,
      });
      expect(r.hipotese).toBe('DIFAL_ENTRADA_CONTRIBUINTE');
    });
  });

  describe('itens não pertinentes', () => {
    it('operação interna (CFOP iniciando em 1) não é DIFAL', () => {
      const r = classificarDifalHipotese(item({ cfop: '1556' }));
      expect(r.hipotese).toBeNull();
    });

    it('saída não enquadrada não é DIFAL', () => {
      const r = classificarDifalHipotese(
        item({ tipoOperacaoEscriturada: 'SAIDA', cfop: '6102' }),
      );
      expect(r.hipotese).toBeNull();
    });
  });
});

describe('separarPorHipotese (base do calculador por hipótese — tarefa 2.2)', () => {
  it('agrupa cada item na sua hipótese e separa os não pertinentes', () => {
    const itens: DifalItemClassificavel[] = [
      { tipoOperacaoEscriturada: 'ENTRADA', cfop: '2556' }, // entrada-contribuinte
      { tipoOperacaoEscriturada: 'ENTRADA', cfop: '2551' }, // entrada-contribuinte
      { tipoOperacaoEscriturada: 'ENTRADA', cfop: '2407' }, // ST (substituído)
      { tipoOperacaoEscriturada: 'SAIDA', cfop: '6108' }, // saída não contribuinte
      { tipoOperacaoEscriturada: 'ENTRADA', cfop: '1556' }, // não pertinente (interna)
    ];

    const { grupos, naoPertinentes } = separarPorHipotese(itens);

    expect(grupos.DIFAL_ENTRADA_CONTRIBUINTE).toHaveLength(2);
    expect(grupos.ST).toHaveLength(1);
    expect(grupos.DIFAL_SAIDA_NAO_CONTRIBUINTE).toHaveLength(1);
    expect(grupos.ANTECIPACAO).toHaveLength(0);
    expect(naoPertinentes).toHaveLength(1);
  });

  it('cada item cai em exatamente uma hipótese (exclusividade)', () => {
    const itens: DifalItemClassificavel[] = [
      { tipoOperacaoEscriturada: 'ENTRADA', cfop: '2556' },
      { tipoOperacaoEscriturada: 'ENTRADA', cfop: '2406' },
      { tipoOperacaoEscriturada: 'SAIDA', cfop: '6107' },
    ];
    const { grupos, naoPertinentes } = separarPorHipotese(itens);
    const total =
      grupos.DIFAL_ENTRADA_CONTRIBUINTE.length +
      grupos.DIFAL_SAIDA_NAO_CONTRIBUINTE.length +
      grupos.ANTECIPACAO.length +
      grupos.ST.length +
      naoPertinentes.length;
    expect(total).toBe(itens.length);
  });

  it('propaga exigeAntecipacao para o agrupamento', () => {
    const itens: DifalItemClassificavel[] = [
      { tipoOperacaoEscriturada: 'ENTRADA', cfop: '2102' },
    ];
    const semAntecipacao = separarPorHipotese(itens);
    expect(semAntecipacao.naoPertinentes).toHaveLength(1);

    const comAntecipacao = separarPorHipotese(itens, {
      exigeAntecipacao: true,
    });
    expect(comAntecipacao.grupos.ANTECIPACAO).toHaveLength(1);
  });
});
