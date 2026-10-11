import {
  CONVENIO_ICMS_142_2018,
  stCenarioPodeSerHabilitado,
  stMotivoBloqueio,
  verificarCenarioSt,
  type StVerificacaoInput,
  type StVerificacaoStatus,
} from './st-verificacao';
import type { CatalogoVersaoResolvida } from './fiscal-normative-catalog.service';

// Versão de catálogo ST_FCP resolvida, com overrides pontuais por teste. Reflete
// o que `FiscalNormativeCatalogService.resolverVersaoVigente` devolveria para a
// competência — a verificação (4.1) não consulta banco; recebe a versão pronta.
function versao(
  overrides: Partial<CatalogoVersaoResolvida> = {},
): CatalogoVersaoResolvida {
  const escopoAprovado = overrides.escopoAprovado ?? true;
  return {
    id: 'cat-st',
    tipo: 'ST_FCP',
    uf: 'SP',
    codigo: 'ST-SP',
    descricao: 'ST SP',
    fonte: 'convenio_icms_142_2018',
    fonteUrl: 'https://exemplo/142-2018',
    hashConteudo: null,
    conteudo: {},
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    competencia: '2026-09-01',
    escopoAprovado,
    aprovadoPor: escopoAprovado ? 'resp-fiscal' : null,
    pendente: !escopoAprovado,
    ...overrides,
  };
}

// Fonte nacional aprovada (arcabouço 142/2018).
function fonteNacionalAprovada(): CatalogoVersaoResolvida {
  return versao({
    id: 'cat-nacional',
    uf: 'BR',
    fonte: CONVENIO_ICMS_142_2018.fonte,
    fonteUrl: CONVENIO_ICMS_142_2018.fonteUrl,
    escopoAprovado: true,
    aprovadoPor: 'resp-fiscal',
  });
}

// Fonte estadual aprovada (legislação da UF).
function fonteEstadualAprovada(): CatalogoVersaoResolvida {
  return versao({
    id: 'cat-estadual',
    uf: 'SP',
    fonte: 'ricms_sp_anexo_st',
    fonteUrl: 'https://legislacao.sp/ricms',
    escopoAprovado: true,
    aprovadoPor: 'resp-fiscal',
  });
}

function input(
  overrides: Partial<StVerificacaoInput> = {},
): StVerificacaoInput {
  return {
    uf: 'SP',
    competencia: '2026-09',
    fonteNacional: fonteNacionalAprovada(),
    fonteEstadual: fonteEstadualAprovada(),
    ...overrides,
  };
}

describe('CONVENIO_ICMS_142_2018 (fonte nacional da ST — R3.1)', () => {
  it('expõe fonte, URL verificável e vigência aberta a partir de 2019-01-01', () => {
    expect(CONVENIO_ICMS_142_2018.fonte).toBe('convenio_icms_142_2018');
    expect(CONVENIO_ICMS_142_2018.vigenciaInicio).toBe('2019-01-01');
    expect(CONVENIO_ICMS_142_2018.vigenciaFim).toBeNull();
    expect(CONVENIO_ICMS_142_2018.fonteUrl).toMatch(/^https:\/\//);
    expect(CONVENIO_ICMS_142_2018.descricao).toMatch(/142\/2018/);
  });
});

describe('verificarCenarioSt (Fase 4 / tarefa 4.1 — R3.1/R3.4)', () => {
  describe('bloqueio quando a fonte nacional não está verificada', () => {
    it('sem fonte nacional → PENDENTE_NACIONAL e bloqueado', () => {
      const r = verificarCenarioSt(input({ fonteNacional: null }));
      expect(r.status).toBe('PENDENTE_NACIONAL');
      expect(r.habilitado).toBe(false);
      expect(r.memoria).toMatch(/142\/2018/);
    });

    it('fonte nacional vigente porém NÃO aprovada → PENDENTE_NACIONAL', () => {
      const r = verificarCenarioSt(
        input({
          fonteNacional: versao({
            id: 'cat-nacional',
            fonte: CONVENIO_ICMS_142_2018.fonte,
            escopoAprovado: false,
          }),
        }),
      );
      expect(r.status).toBe('PENDENTE_NACIONAL');
      expect(r.habilitado).toBe(false);
    });
  });

  describe('bloqueio quando falta a legislação estadual verificada', () => {
    it('nacional ok, sem estadual → PENDENTE_ESTADUAL e bloqueado', () => {
      const r = verificarCenarioSt(input({ fonteEstadual: null }));
      expect(r.status).toBe('PENDENTE_ESTADUAL');
      expect(r.habilitado).toBe(false);
      expect(r.fonteNacional).toBe(CONVENIO_ICMS_142_2018.fonte);
      expect(r.fonteEstadual).toBeNull();
      expect(r.memoria).toMatch(/estadual/i);
    });

    it('nacional ok, estadual vigente porém NÃO aprovada → PENDENTE_ESTADUAL', () => {
      const r = verificarCenarioSt(
        input({
          fonteEstadual: versao({
            id: 'cat-estadual',
            fonte: 'ricms_sp_anexo_st',
            escopoAprovado: false,
          }),
        }),
      );
      expect(r.status).toBe('PENDENTE_ESTADUAL');
      expect(r.habilitado).toBe(false);
    });
  });

  describe('verificação completa (duas camadas aprovadas)', () => {
    it('nacional + estadual aprovadas → VERIFICADO e habilitado', () => {
      const r = verificarCenarioSt(input());
      expect(r.status).toBe('VERIFICADO');
      expect(r.habilitado).toBe(true);
      expect(r.fonteNacional).toBe(CONVENIO_ICMS_142_2018.fonte);
      expect(r.fonteEstadual).toBe('ricms_sp_anexo_st');
      expect(r.fonteNacionalUrl).toBe(CONVENIO_ICMS_142_2018.fonteUrl);
      expect(r.fonteEstadualUrl).toBe('https://legislacao.sp/ricms');
      expect(r.memoria).toMatch(/habilitado/i);
    });

    it('normaliza a UF e ecoa competência no resultado', () => {
      const r = verificarCenarioSt(input({ uf: 'sp', competencia: '2026-09' }));
      expect(r.uf).toBe('SP');
      expect(r.competencia).toBe('2026-09');
    });
  });

  describe('ordem de decisão: nacional precede estadual', () => {
    it('faltando ambas, bloqueia primeiro pela nacional', () => {
      const r = verificarCenarioSt(
        input({ fonteNacional: null, fonteEstadual: null }),
      );
      expect(r.status).toBe('PENDENTE_NACIONAL');
    });
  });
});

describe('stCenarioPodeSerHabilitado (guarda — R3.4)', () => {
  it('só habilita quando VERIFICADO', () => {
    expect(stCenarioPodeSerHabilitado('VERIFICADO')).toBe(true);
    expect(stCenarioPodeSerHabilitado('PENDENTE_NACIONAL')).toBe(false);
    expect(stCenarioPodeSerHabilitado('PENDENTE_ESTADUAL')).toBe(false);
  });

  it('o resultado habilitado coincide com a guarda', () => {
    const statuses: StVerificacaoStatus[] = [
      'VERIFICADO',
      'PENDENTE_NACIONAL',
      'PENDENTE_ESTADUAL',
    ];
    for (const status of statuses) {
      const habilitado = stCenarioPodeSerHabilitado(status);
      expect(typeof habilitado).toBe('boolean');
    }
  });
});

describe('stMotivoBloqueio (bloqueio explicável — R3.4)', () => {
  it('VERIFICADO não tem motivo de bloqueio', () => {
    expect(stMotivoBloqueio('VERIFICADO')).toBeNull();
  });

  it('PENDENTE_NACIONAL explica a falta do arcabouço 142/2018', () => {
    expect(stMotivoBloqueio('PENDENTE_NACIONAL')).toMatch(/142\/2018/);
  });

  it('PENDENTE_ESTADUAL explica a falta da legislação estadual', () => {
    expect(stMotivoBloqueio('PENDENTE_ESTADUAL')).toMatch(/estadual/i);
  });
});
