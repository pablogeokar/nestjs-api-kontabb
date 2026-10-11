import {
  avaliarCenarioHabilitadoSt,
  aplicarCenarioHabilitadoSt,
  conciliarCenarioSt,
  ST_CENARIO_HABILITADO_CODIGOS,
  type StCenarioHabilitadoInput,
} from './st-cenario-habilitado';
import { createSpedRecord, decimalField, type SpedRecord } from './core';
import type { SpedInconsistencia } from './sped-efd.types';
import type { CatalogoVersaoResolvida } from '../services/fiscal-normative-catalog.service';
import type { StCalculoResultado } from '../services/st-calculador';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: um cenário "feliz" habilitado por padrão. Cada teste desvia UMA
// condição do contrato (verificação/enquadramento/cálculo/fonte/conciliação).
// ─────────────────────────────────────────────────────────────────────────────

const contexto = {
  uf: 'sp',
  competencia: '2026-09',
  documentoId: 'doc-1',
  numeroDocumento: '123',
  chaveAcesso: '3526...',
};

// Catálogo ST_FCP aprovado por um responsável (revisão fiscal registrada).
function catalogo(
  overrides: Partial<CatalogoVersaoResolvida> = {},
): CatalogoVersaoResolvida {
  return {
    id: 'cat-1',
    tipo: 'ST_FCP',
    uf: 'SP',
    codigo: 'ST_SP_142',
    descricao: 'ST SP — Convênio 142/2018 + RICMS/SP',
    fonte: 'convenio_icms_142_2018+ricms_sp',
    fonteUrl:
      'https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18',
    hashConteudo: 'abc123',
    conteudo: {},
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    competencia: '2026-09-01',
    escopoAprovado: true,
    aprovadoPor: 'fiscal.responsavel@kontabb',
    pendente: false,
    ...overrides,
  };
}

// Resultado de cálculo CALCULADO com ICMS-ST retido e FCP-ST separados.
function calculo(
  overrides: Partial<StCalculoResultado> = {},
): StCalculoResultado {
  return {
    uf: 'SP',
    competencia: '2026-09',
    papel: 'SUBSTITUTO',
    status: 'CALCULADO',
    pendente: false,
    aliquotaInterna: '18',
    aliquotaPropria: '18',
    mva: '40',
    aliquotaFcp: '2',
    basePropria: '1000.00',
    impostoProprio: '180.00',
    baseSt: '1400.00',
    icmsStTotal: '252.00',
    icmsStRetido: '72.00',
    icmsStRetidoAnterior: '0.00',
    fcpSt: '28.00',
    ajustes: [],
    totalRestituicao: '0.00',
    totalRessarcimento: '0.00',
    totalComplemento: '0.00',
    memoria: 'ST SP (2026-09): memória de cálculo auditável.',
    ...overrides,
  };
}

// C191 que reflete os componentes calculados: VL_FCPUFDEST + VL_ICMSUFDEST.
function c191(fcp: string, icms: string, remet = '0.00'): SpedRecord {
  return createSpedRecord(
    'C191',
    decimalField(fcp), // 02 VL_FCPUFDEST
    decimalField(icms), // 03 VL_ICMSUFDEST
    decimalField(remet), // 04 VL_ICMSUFREMET
  );
}

function entrada(
  overrides: Partial<StCenarioHabilitadoInput> = {},
): StCenarioHabilitadoInput {
  return {
    contexto,
    verificacao: 'VERIFICADO',
    enquadramento: 'SUJEITO',
    calculo: calculo(),
    catalogo: catalogo(),
    registros: [c191('28.00', '72.00')],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// conciliarCenarioSt — componentes calculados ↔ C191 escriturados.
// ─────────────────────────────────────────────────────────────────────────────

describe('conciliarCenarioSt (Fase 4 / tarefa 4.6 — R3.5)', () => {
  it('reconcilia quando ICMS-ST e FCP-ST batem com os C191', () => {
    const r = conciliarCenarioSt({ icmsStRetido: '72.00', fcpSt: '28.00' }, [
      c191('28.00', '72.00'),
    ]);
    expect(r.reconcilia).toBe(true);
    expect(r.icmsStCalculado).toBe('72.00');
    expect(r.fcpStCalculado).toBe('28.00');
    expect(r.icmsStRegistrado).toBe('72.00');
    expect(r.fcpStRegistrado).toBe('28.00');
    expect(r.divergencia).toBe('0.00');
  });

  it('soma múltiplos C191 por componente', () => {
    const r = conciliarCenarioSt({ icmsStRetido: '100.00', fcpSt: '40.00' }, [
      c191('28.00', '72.00'),
      c191('12.00', '28.00'),
    ]);
    expect(r.icmsStRegistrado).toBe('100.00');
    expect(r.fcpStRegistrado).toBe('40.00');
    expect(r.reconcilia).toBe(true);
  });

  it('ignora registros que não são C191 na conciliação', () => {
    const r = conciliarCenarioSt({ icmsStRetido: '72.00', fcpSt: '28.00' }, [
      c191('28.00', '72.00'),
      createSpedRecord('C195', '0460', 'obs'),
      createSpedRecord(
        'C197',
        'SP10000000',
        null,
        null,
        null,
        null,
        null,
        decimalField('10.00'),
      ),
    ]);
    expect(r.reconcilia).toBe(true);
    expect(r.icmsStRegistrado).toBe('72.00');
    expect(r.fcpStRegistrado).toBe('28.00');
  });

  it('NÃO reconcilia quando o ICMS-ST escriturado diverge do calculado', () => {
    const r = conciliarCenarioSt({ icmsStRetido: '72.00', fcpSt: '28.00' }, [
      c191('28.00', '70.00'),
    ]);
    expect(r.reconcilia).toBe(false);
    expect(r.divergencia).toBe('2.00');
  });

  it('reconcilia dentro da tolerância de um centavo por componente', () => {
    const r = conciliarCenarioSt({ icmsStRetido: '72.00', fcpSt: '28.00' }, [
      c191('28.01', '71.99'),
    ]);
    // |72.00-71.99| + |28.00-28.01| = 0.02, dentro da tolerância.
    expect(r.divergencia).toBe('0.02');
    expect(r.reconcilia).toBe(true);
  });

  it('divergência além da tolerância não reconcilia', () => {
    const r = conciliarCenarioSt({ icmsStRetido: '72.00', fcpSt: '28.00' }, [
      c191('28.02', '71.99'),
    ]);
    expect(r.divergencia).toBe('0.03');
    expect(r.reconcilia).toBe(false);
  });

  it('concilia FCP e ICMS SEPARADAMENTE (não compensa um com o outro)', () => {
    // ICMS escriturado +5, FCP escriturado -5: a soma "bateria", mas por
    // componente há 5+5=10 de divergência.
    const r = conciliarCenarioSt({ icmsStRetido: '72.00', fcpSt: '28.00' }, [
      c191('23.00', '77.00'),
    ]);
    expect(r.divergencia).toBe('10.00');
    expect(r.reconcilia).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// avaliarCenarioHabilitadoSt — o contrato completo (R3.5).
// ─────────────────────────────────────────────────────────────────────────────

describe('avaliarCenarioHabilitadoSt (Fase 4 / tarefa 4.6 — R3.5)', () => {
  it('cenário feliz: HABILITADO com fonte + registro + memória + conciliação', () => {
    const r = avaliarCenarioHabilitadoSt(entrada());
    expect(r.habilitado).toBe(true);
    expect(r.inconsistencias).toHaveLength(0);
    expect(r.motivo).toBeNull();
    expect(r.cenario).not.toBeNull();

    // (a) FONTE com revisão fiscal registrada.
    expect(r.cenario!.fonte.fonte).toBe('convenio_icms_142_2018+ricms_sp');
    expect(r.cenario!.fonte.aprovadoPor).toBe('fiscal.responsavel@kontabb');
    expect(r.cenario!.fonte.hashConteudo).toBe('abc123');
    expect(r.cenario!.fonte.vigenciaInicio).toBe('2026-01-01');

    // (b) REGISTRO transportado.
    expect(r.cenario!.registros).toHaveLength(1);
    expect(r.cenario!.registros[0].reg).toBe('C191');

    // (c) MEMÓRIA íntegra (da 4.3).
    expect(r.cenario!.memoria).toMatch(/memória de cálculo auditável/);

    // (d) CONCILIAÇÃO reconcilia.
    expect(r.cenario!.conciliacao.reconcilia).toBe(true);
  });

  describe('bloqueio de camada (reaproveita a 4.5)', () => {
    it('fonte não verificada (4.1) → não habilita, inconsistência de bloqueio', () => {
      const r = avaliarCenarioHabilitadoSt(
        entrada({ verificacao: 'PENDENTE_ESTADUAL' }),
      );
      expect(r.habilitado).toBe(false);
      expect(r.cenario).toBeNull();
      expect(r.inconsistencias.length).toBeGreaterThanOrEqual(1);
      expect(r.inconsistencias.every((i) => i.severidade === 'ERRO')).toBe(
        true,
      );
    });

    it('enquadramento NAO_SUJEITO (4.2) → não habilita', () => {
      const r = avaliarCenarioHabilitadoSt(
        entrada({ enquadramento: 'NAO_SUJEITO' }),
      );
      expect(r.habilitado).toBe(false);
      expect(r.cenario).toBeNull();
    });

    it('cálculo SIMULACAO (4.3) → não habilita (não vira guia)', () => {
      const r = avaliarCenarioHabilitadoSt(
        entrada({ calculo: calculo({ status: 'SIMULACAO', pendente: true }) }),
      );
      expect(r.habilitado).toBe(false);
      expect(r.cenario).toBeNull();
    });
  });

  describe('fonte não registrada (R3.5)', () => {
    it('catálogo ausente → FONTE_NAO_REGISTRADA', () => {
      const r = avaliarCenarioHabilitadoSt(entrada({ catalogo: null }));
      expect(r.habilitado).toBe(false);
      expect(r.inconsistencias).toHaveLength(1);
      expect(r.inconsistencias[0].codigo).toBe(
        ST_CENARIO_HABILITADO_CODIGOS.FONTE_NAO_REGISTRADA,
      );
      expect(r.inconsistencias[0].severidade).toBe('ERRO');
    });

    it('catálogo vigente porém NÃO aprovado → FONTE_NAO_REGISTRADA', () => {
      const r = avaliarCenarioHabilitadoSt(
        entrada({
          catalogo: catalogo({ escopoAprovado: false, pendente: true }),
        }),
      );
      expect(r.habilitado).toBe(false);
      expect(r.inconsistencias[0].codigo).toBe(
        ST_CENARIO_HABILITADO_CODIGOS.FONTE_NAO_REGISTRADA,
      );
    });

    it('catálogo aprovado porém SEM responsável → FONTE_NAO_REGISTRADA', () => {
      const r = avaliarCenarioHabilitadoSt(
        entrada({ catalogo: catalogo({ aprovadoPor: null }) }),
      );
      expect(r.habilitado).toBe(false);
      expect(r.inconsistencias[0].codigo).toBe(
        ST_CENARIO_HABILITADO_CODIGOS.FONTE_NAO_REGISTRADA,
      );
      expect(r.inconsistencias[0].mensagem).toMatch(
        /revisão fiscal registrada/,
      );
    });
  });

  describe('conciliação divergente (R3.5)', () => {
    it('componentes NÃO reconciliam com os C191 → CONCILIACAO_DIVERGENTE', () => {
      const r = avaliarCenarioHabilitadoSt(
        entrada({ registros: [c191('28.00', '50.00')] }),
      );
      expect(r.habilitado).toBe(false);
      expect(r.inconsistencias).toHaveLength(1);
      expect(r.inconsistencias[0].codigo).toBe(
        ST_CENARIO_HABILITADO_CODIGOS.CONCILIACAO_DIVERGENTE,
      );
      expect(r.inconsistencias[0].severidade).toBe('ERRO');
      expect(r.inconsistencias[0].mensagem).toMatch(/não reconciliam/i);
      // Carrega rastreadores de documento.
      expect(r.inconsistencias[0].documentoId).toBe('doc-1');
    });

    it('sem C191 escriturado quando há ICMS-ST calculado → divergente', () => {
      const r = avaliarCenarioHabilitadoSt(entrada({ registros: [] }));
      expect(r.habilitado).toBe(false);
      expect(r.inconsistencias[0].codigo).toBe(
        ST_CENARIO_HABILITADO_CODIGOS.CONCILIACAO_DIVERGENTE,
      );
    });
  });

  it('ordem do contrato: bloqueio de camada precede fonte e conciliação', () => {
    // Fonte ausente E conciliação divergente E fonte não verificada: para no
    // bloqueio de camada (4.5), não acumula os códigos do caso positivo.
    const r = avaliarCenarioHabilitadoSt(
      entrada({
        verificacao: 'PENDENTE_NACIONAL',
        catalogo: null,
        registros: [c191('28.00', '50.00')],
      }),
    );
    expect(r.habilitado).toBe(false);
    const codigos = r.inconsistencias.map((i) => i.codigo);
    expect(codigos).not.toContain(
      ST_CENARIO_HABILITADO_CODIGOS.FONTE_NAO_REGISTRADA,
    );
    expect(codigos).not.toContain(
      ST_CENARIO_HABILITADO_CODIGOS.CONCILIACAO_DIVERGENTE,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// aplicarCenarioHabilitadoSt — costura no padrão de inconsistências do builder.
// ─────────────────────────────────────────────────────────────────────────────

describe('aplicarCenarioHabilitadoSt (Fase 4 / tarefa 4.6)', () => {
  it('habilitado → nada empurrado, devolve o cenário', () => {
    const inconsistencias: SpedInconsistencia[] = [];
    const r = aplicarCenarioHabilitadoSt(entrada(), inconsistencias);
    expect(r.habilitado).toBe(true);
    expect(r.cenario).not.toBeNull();
    expect(inconsistencias).toHaveLength(0);
  });

  it('conciliação divergente → empurra a inconsistência impeditiva', () => {
    const inconsistencias: SpedInconsistencia[] = [];
    const r = aplicarCenarioHabilitadoSt(
      entrada({ registros: [c191('28.00', '50.00')] }),
      inconsistencias,
    );
    expect(r.habilitado).toBe(false);
    expect(r.cenario).toBeNull();
    expect(inconsistencias).toHaveLength(1);
    expect(inconsistencias[0].codigo).toBe(
      ST_CENARIO_HABILITADO_CODIGOS.CONCILIACAO_DIVERGENTE,
    );
  });
});
