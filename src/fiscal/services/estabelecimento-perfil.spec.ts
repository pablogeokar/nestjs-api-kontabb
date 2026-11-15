import { perfilNaData, ufsNoIntervalo } from './estabelecimento-perfil';

const atual = { uf: 'BA', regimeTributario: 'LUCRO_REAL' };
const linha = (o: object) => ({
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  uf: 'BA',
  inscricaoEstadual: null,
  regimeTributario: 'LUCRO_REAL',
  origem: 'ALTERACAO_CADASTRAL',
  ...o,
});

describe('perfilNaData', () => {
  it('sem histórico usa o cadastro atual com confiança BAIXA', () => {
    const p = perfilNaData([], '2026-05-01', atual);
    expect(p).toMatchObject({
      fonte: 'CADASTRO_ATUAL_SEM_HISTORICO',
      confianca: 'BAIXA',
      uf: 'BA',
    });
  });
  it('escolhe a linha que cobre a data (limites inclusivos)', () => {
    const perfis = [
      linha({
        vigenciaInicio: '2020-01-01',
        vigenciaFim: '2025-12-31',
        regimeTributario: 'SIMPLES_NACIONAL',
      }),
      linha({ vigenciaInicio: '2026-01-01' }),
    ];
    expect(perfilNaData(perfis, '2025-12-31', atual).regimeTributario).toBe(
      'SIMPLES_NACIONAL',
    );
    expect(perfilNaData(perfis, '2026-01-01', atual).regimeTributario).toBe(
      'LUCRO_REAL',
    );
    expect(perfilNaData(perfis, '2026-01-01', atual).confianca).toBe('ALTA');
  });
  it('perfil presumido desde a criação tem confiança BAIXA', () => {
    const p = perfilNaData(
      [linha({ origem: 'ANTERIOR_A_ALTERACAO' })],
      '2026-03-01',
      atual,
    );
    expect(p).toMatchObject({ fonte: 'HISTORICO', confianca: 'BAIXA' });
  });
  it('data anterior ao primeiro registro usa o primeiro perfil, com BAIXA', () => {
    const p = perfilNaData([linha({ uf: 'SP' })], '2020-01-01', atual);
    expect(p).toMatchObject({
      fonte: 'HISTORICO_ANTERIOR_AO_REGISTRO',
      confianca: 'BAIXA',
      uf: 'SP',
    });
  });
  it('lacuna entre perfis cai no cadastro atual, BAIXA', () => {
    const perfis = [
      linha({ vigenciaInicio: '2020-01-01', vigenciaFim: '2020-12-31' }),
      linha({ vigenciaInicio: '2022-01-01' }),
    ];
    expect(perfilNaData(perfis, '2021-06-01', atual).fonte).toBe(
      'CADASTRO_ATUAL_SEM_HISTORICO',
    );
  });
  it('normaliza UF e trata vazio como ausente', () => {
    const p = perfilNaData(
      [linha({ uf: ' ba ', regimeTributario: ' ' })],
      '2026-02-01',
      atual,
    );
    expect(p.uf).toBe('BA');
    expect(p.regimeTributario).toBeNull();
  });
});

describe('ufsNoIntervalo', () => {
  it('reúne as UFs que valem em algum dia do intervalo', () => {
    const perfis = [
      linha({
        vigenciaInicio: '2020-01-01',
        vigenciaFim: '2026-10-14',
        uf: 'SP',
      }),
      linha({ vigenciaInicio: '2026-10-15', uf: 'BA' }),
    ];
    expect(
      [...ufsNoIntervalo(perfis, '2026-10-01', '2026-10-31', atual)].sort(),
    ).toEqual(['BA', 'SP']);
    expect([
      ...ufsNoIntervalo(perfis, '2026-11-01', '2026-11-30', atual),
    ]).toEqual(['BA']);
  });
  it('sem histórico usa a UF atual', () => {
    expect([...ufsNoIntervalo([], '2026-10-01', '2026-10-31', atual)]).toEqual([
      'BA',
    ]);
  });
});
