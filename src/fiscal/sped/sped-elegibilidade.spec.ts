import { isSpedElegivel } from './sped-elegibilidade';

describe('isSpedElegivel', () => {
  it.each(['LUCRO_PRESUMIDO', 'LUCRO_REAL'])(
    'habilita o regime normal %s',
    (regimeTributario) => {
      expect(isSpedElegivel({ regimeTributario })).toBe(true);
    },
  );

  it('dispensa Simples sem obrigação estadual nem conta gráfica', () => {
    expect(
      isSpedElegivel({
        regimeTributario: 'SIMPLES_NACIONAL',
        apuraIcms: false,
        obrigadoEfdIcmsIpi: false,
      }),
    ).toBe(false);
  });

  it.each([
    { apuraIcms: true, obrigadoEfdIcmsIpi: false },
    { apuraIcms: false, obrigadoEfdIcmsIpi: true },
  ])('habilita a exceção do Simples', (flags) => {
    expect(
      isSpedElegivel({ regimeTributario: 'SIMPLES_NACIONAL', ...flags }),
    ).toBe(true);
  });

  it('não habilita regime ausente', () => {
    expect(isSpedElegivel({ regimeTributario: null })).toBe(false);
  });
});
