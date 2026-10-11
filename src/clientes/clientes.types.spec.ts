import {
  resolveApuraIcms,
  simplesNacionalSemApuracaoIcms,
  type RegimeTributario,
} from './clientes.types';

describe('resolveApuraIcms — resolução explícita e auditável (F17, R6.2)', () => {
  it.each(['LUCRO_PRESUMIDO', 'LUCRO_REAL'] as const)(
    'Lucro normal (%s) sempre apura ICMS próprio com origem REGIME_LUCRO_NORMAL',
    (regimeTributario) => {
      expect(resolveApuraIcms({ regimeTributario })).toEqual({
        apuraIcms: true,
        origem: 'REGIME_LUCRO_NORMAL',
      });
    },
  );

  it('Lucro normal ignora valor informado divergente, mas sinaliza a origem (regra do regime)', () => {
    // Um informado=false para Lucro real é inconsistente com o regime: a regra
    // vence, e a origem deixa explícito que a decisão veio do regime — não de
    // um default oculto.
    expect(
      resolveApuraIcms({ regimeTributario: 'LUCRO_REAL', informado: false }),
    ).toEqual({ apuraIcms: true, origem: 'REGIME_LUCRO_NORMAL' });
  });

  it.each([true, false])(
    'Simples respeita o valor informado=%s com origem INFORMADO',
    (informado) => {
      expect(
        resolveApuraIcms({
          regimeTributario: 'SIMPLES_NACIONAL',
          informado,
        }),
      ).toEqual({ apuraIcms: informado, origem: 'INFORMADO' });
    },
  );

  it('Simples sem valor informado usa default DOCUMENTADO (não silencioso)', () => {
    // O Simples recolhe ICMS no DAS: por padrão não apura ICMS próprio. É um
    // default explícito e rastreável, não uma inferência silenciosa.
    expect(resolveApuraIcms({ regimeTributario: 'SIMPLES_NACIONAL' })).toEqual({
      apuraIcms: false,
      origem: 'REGIME_SIMPLES_PADRAO',
    });
  });

  it('sem regime definido não apura, com origem SEM_REGIME', () => {
    expect(resolveApuraIcms({ regimeTributario: null })).toEqual({
      apuraIcms: false,
      origem: 'SEM_REGIME',
    });
  });

  it('sem regime ignora valor informado (não há conta gráfica sem regime)', () => {
    expect(
      resolveApuraIcms({ regimeTributario: null, informado: true }),
    ).toEqual({ apuraIcms: false, origem: 'SEM_REGIME' });
  });

  it('nunca produz valor sem origem auditável para qualquer combinação', () => {
    const regimes: (RegimeTributario | null)[] = [
      'SIMPLES_NACIONAL',
      'LUCRO_PRESUMIDO',
      'LUCRO_REAL',
      null,
    ];
    const informados: (boolean | undefined)[] = [true, false, undefined];

    for (const regimeTributario of regimes) {
      for (const informado of informados) {
        const resolucao = resolveApuraIcms({ regimeTributario, informado });
        expect(typeof resolucao.apuraIcms).toBe('boolean');
        expect([
          'INFORMADO',
          'REGIME_LUCRO_NORMAL',
          'REGIME_SIMPLES_PADRAO',
          'SEM_REGIME',
        ]).toContain(resolucao.origem);
      }
    }
  });
});

describe('simplesNacionalSemApuracaoIcms', () => {
  it('é verdadeiro apenas para Simples que não apura ICMS próprio', () => {
    expect(
      simplesNacionalSemApuracaoIcms({
        regimeTributario: 'SIMPLES_NACIONAL',
        apuraIcms: false,
      }),
    ).toBe(true);
  });

  it('é falso para Simples que apura ICMS próprio (sublimite/impedimento)', () => {
    expect(
      simplesNacionalSemApuracaoIcms({
        regimeTributario: 'SIMPLES_NACIONAL',
        apuraIcms: true,
      }),
    ).toBe(false);
  });

  it('é falso para regimes de Lucro normal', () => {
    expect(
      simplesNacionalSemApuracaoIcms({
        regimeTributario: 'LUCRO_REAL',
        apuraIcms: true,
      }),
    ).toBe(false);
  });
});
