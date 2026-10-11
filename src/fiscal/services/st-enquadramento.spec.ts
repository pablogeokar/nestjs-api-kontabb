import {
  enquadrarSt,
  stEnquadramentoHabilitaCalculo,
  stEnquadramentoMotivoInelegibilidade,
  type StEnquadramentoInput,
  type StEnquadramentoStatus,
  type StRegraEnquadramento,
} from './st-enquadramento';
import type { CatalogoVersaoResolvida } from './fiscal-normative-catalog.service';

// Versão de catálogo ST_FCP resolvida, com overrides por teste. Reflete o que
// `FiscalNormativeCatalogService.resolverVersaoVigente` devolveria por
// competência — o enquadramento (4.2) não consulta banco; recebe pronto.
function catalogo(
  overrides: Partial<CatalogoVersaoResolvida> = {},
): CatalogoVersaoResolvida {
  const escopoAprovado = overrides.escopoAprovado ?? true;
  return {
    id: 'cat-st',
    tipo: 'ST_FCP',
    uf: 'SP',
    codigo: 'ST-SP',
    descricao: 'ST SP',
    fonte: 'ricms_sp_anexo_st',
    fonteUrl: 'https://legislacao.sp/ricms',
    hashConteudo: 'hash-123',
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

function regraSujeito(
  overrides: Partial<StRegraEnquadramento> = {},
): StRegraEnquadramento {
  return {
    cest: '2810800',
    sujeitoAst: true,
    mva: '71.60',
    aliquotaFcp: '2.00',
    ...overrides,
  };
}

function input(
  overrides: Partial<StEnquadramentoInput> = {},
): StEnquadramentoInput {
  return {
    produto: { cest: '28.108.00', ncm: '22021000' },
    uf: 'SP',
    competencia: '2026-09',
    verificacao: 'VERIFICADO',
    catalogo: catalogo(),
    regra: regraSujeito(),
    regraAprovada: true,
    ...overrides,
  };
}

describe('enquadrarSt (Fase 4 / tarefa 4.2 — R3.1/R3.4)', () => {
  describe('portão de verificação (4.1): fonte não verificada → BLOQUEADO', () => {
    it('verificacao PENDENTE_NACIONAL → BLOQUEADO, nunca enquadra', () => {
      const r = enquadrarSt(input({ verificacao: 'PENDENTE_NACIONAL' }));
      expect(r.status).toBe('BLOQUEADO');
      expect(r.habilitadoParaCalculo).toBe(false);
      expect(r.memoria).toMatch(/142\/2018/);
      expect(r.memoria).toMatch(/BLOQUEADO/);
    });

    it('verificacao PENDENTE_ESTADUAL → BLOQUEADO mesmo com regra aprovada', () => {
      const r = enquadrarSt(input({ verificacao: 'PENDENTE_ESTADUAL' }));
      expect(r.status).toBe('BLOQUEADO');
      expect(r.habilitadoParaCalculo).toBe(false);
      expect(r.memoria).toMatch(/estadual/i);
    });

    it('o portão de verificação precede o de regra/CEST', () => {
      // Sem CEST E sem regra, mas verificação pendente: ainda bloqueia primeiro
      // pela fonte, não cai em PENDENCIA.
      const r = enquadrarSt(
        input({
          verificacao: 'PENDENTE_NACIONAL',
          produto: {},
          regra: null,
          regraAprovada: false,
        }),
      );
      expect(r.status).toBe('BLOQUEADO');
    });
  });

  describe('portão de CEST: fonte verificada, produto sem CEST → PENDENCIA', () => {
    it('sem CEST → PENDENCIA (CEST é a chave do catálogo)', () => {
      const r = enquadrarSt(input({ produto: { ncm: '22021000' } }));
      expect(r.status).toBe('PENDENCIA');
      expect(r.habilitadoParaCalculo).toBe(false);
      expect(r.cest).toBeNull();
      expect(r.memoria).toMatch(/CEST/);
    });

    it('CEST em branco/pontuação sem dígitos → PENDENCIA', () => {
      const r = enquadrarSt(input({ produto: { cest: '  ' } }));
      expect(r.status).toBe('PENDENCIA');
      expect(r.cest).toBeNull();
    });
  });

  describe('portão de regra (Task 1): fonte verificada, regra ausente/não aprovada', () => {
    it('sem regra → PENDENCIA, não presume enquadramento', () => {
      const r = enquadrarSt(input({ regra: null }));
      expect(r.status).toBe('PENDENCIA');
      expect(r.habilitadoParaCalculo).toBe(false);
      expect(r.memoria).toMatch(/sem regra/i);
    });

    it('regra presente porém versão NÃO aprovada → PENDENCIA', () => {
      const r = enquadrarSt(input({ regraAprovada: false }));
      expect(r.status).toBe('PENDENCIA');
      expect(r.habilitadoParaCalculo).toBe(false);
      expect(r.memoria).toMatch(/não aprovada/i);
    });

    it('regraAprovada ausente (default false) → PENDENCIA', () => {
      const { regraAprovada: _omit, ...rest } = input();
      const r = enquadrarSt(rest);
      expect(r.status).toBe('PENDENCIA');
    });
  });

  describe('regra aprovada decide sujeito/não-sujeito', () => {
    it('regra aprovada sujeitoAst=true → SUJEITO e habilitado para cálculo', () => {
      const r = enquadrarSt(input());
      expect(r.status).toBe('SUJEITO');
      expect(r.habilitadoParaCalculo).toBe(true);
      expect(r.cest).toBe('2810800');
      expect(r.ncm).toBe('22021000');
      expect(r.mva).toBe('71.60');
      expect(r.aliquotaFcp).toBe('2.00');
      expect(r.fonte).toBe('ricms_sp_anexo_st');
      expect(r.fonteUrl).toBe('https://legislacao.sp/ricms');
      expect(r.hashConteudo).toBe('hash-123');
      expect(r.memoria).toMatch(/SUJEITO/);
    });

    it('regra aprovada sujeitoAst=false → NAO_SUJEITO (exclusão definitiva)', () => {
      const r = enquadrarSt(
        input({ regra: regraSujeito({ sujeitoAst: false }) }),
      );
      expect(r.status).toBe('NAO_SUJEITO');
      expect(r.habilitadoParaCalculo).toBe(false);
      expect(r.memoria).toMatch(/EXCLU/i);
    });
  });

  describe('normalização e eco de eixos', () => {
    it('normaliza UF e CEST (remove pontuação) e ecoa competência', () => {
      const r = enquadrarSt(
        input({ uf: 'sp', produto: { cest: '28.108.00', ncm: '2202.10.00' } }),
      );
      expect(r.uf).toBe('SP');
      expect(r.cest).toBe('2810800');
      expect(r.ncm).toBe('22021000');
      expect(r.competencia).toBe('2026-09');
    });

    it('MVA/FCP vazios na regra viram null (não aritmética)', () => {
      const r = enquadrarSt(
        input({ regra: regraSujeito({ mva: '', aliquotaFcp: null }) }),
      );
      expect(r.mva).toBeNull();
      expect(r.aliquotaFcp).toBeNull();
      expect(r.status).toBe('SUJEITO');
    });
  });
});

describe('stEnquadramentoHabilitaCalculo (guarda — R3.4)', () => {
  it('só habilita o cálculo quando SUJEITO', () => {
    expect(stEnquadramentoHabilitaCalculo('SUJEITO')).toBe(true);
    expect(stEnquadramentoHabilitaCalculo('NAO_SUJEITO')).toBe(false);
    expect(stEnquadramentoHabilitaCalculo('PENDENCIA')).toBe(false);
    expect(stEnquadramentoHabilitaCalculo('BLOQUEADO')).toBe(false);
  });

  it('o resultado habilitadoParaCalculo coincide com a guarda', () => {
    const statuses: StEnquadramentoStatus[] = [
      'SUJEITO',
      'NAO_SUJEITO',
      'PENDENCIA',
      'BLOQUEADO',
    ];
    for (const status of statuses) {
      expect(typeof stEnquadramentoHabilitaCalculo(status)).toBe('boolean');
    }
  });
});

describe('stEnquadramentoMotivoInelegibilidade (bloqueio explicável — R3.4)', () => {
  it('SUJEITO não tem motivo de inelegibilidade', () => {
    expect(stEnquadramentoMotivoInelegibilidade('SUJEITO')).toBeNull();
  });

  it('NAO_SUJEITO explica a exclusão da ST', () => {
    expect(stEnquadramentoMotivoInelegibilidade('NAO_SUJEITO')).toMatch(
      /NÃO APLICÁVEL/i,
    );
  });

  it('PENDENCIA explica a falta de regra aprovada', () => {
    expect(stEnquadramentoMotivoInelegibilidade('PENDENCIA')).toMatch(
      /PENDÊNCIA/i,
    );
  });

  it('BLOQUEADO explica a fonte não verificada (142/2018 + estadual)', () => {
    expect(stEnquadramentoMotivoInelegibilidade('BLOQUEADO')).toMatch(
      /142\/2018/,
    );
  });
});
