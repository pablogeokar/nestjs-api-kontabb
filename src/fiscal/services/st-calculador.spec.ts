import {
  calcularSt,
  stPodeGerarGuia,
  stCalculoMotivoInelegibilidade,
  type StCalculoInput,
  type StCalculoStatus,
  type StRegraCalculo,
} from './st-calculador';
import type { StEnquadramentoStatus } from './st-enquadramento';

// Regra de ST resolvida do catálogo ST_FCP, com overrides por teste. Reflete o
// `conteudo` de `fiscal_regras_versoes` já tipado — o calculador (4.3) não
// consulta banco; recebe pronto, como `calcularDifalHipotese`.
function regra(overrides: Partial<StRegraCalculo> = {}): StRegraCalculo {
  return {
    aliquotaInterna: '18.0000',
    aliquotaPropria: '18.0000',
    mva: '40.0000',
    aliquotaFcp: '2.0000',
    ...overrides,
  };
}

function input(overrides: Partial<StCalculoInput> = {}): StCalculoInput {
  return {
    enquadramento: 'SUJEITO',
    papel: 'SUBSTITUTO',
    uf: 'SP',
    competencia: '2026-09',
    basePropria: '1000.00',
    ...overrides,
  };
}

describe('calcularSt (Fase 4 / tarefa 4.3 — R3.2)', () => {
  describe('gate pelo enquadramento (4.2): só SUJEITO calcula guia', () => {
    it('BLOQUEADO → status BLOQUEADO, sem valores, nunca guia', () => {
      const r = calcularSt(
        input({ enquadramento: 'BLOQUEADO' }),
        regra(),
        { aprovada: true },
      );
      expect(r.status).toBe('BLOQUEADO');
      expect(r.pendente).toBe(true);
      expect(r.icmsStRetido).toBe('0.00');
      expect(r.impostoProprio).toBe('0.00');
      expect(r.fcpSt).toBe('0.00');
      expect(r.memoria).toMatch(/BLOQUEADO/);
      expect(stPodeGerarGuia(r.status)).toBe(false);
    });

    it('NAO_SUJEITO → PENDENTE, sem valores', () => {
      const r = calcularSt(
        input({ enquadramento: 'NAO_SUJEITO' }),
        regra(),
        { aprovada: true },
      );
      expect(r.status).toBe('PENDENTE');
      expect(r.pendente).toBe(true);
      expect(r.baseSt).toBe('0.00');
    });

    it('PENDENCIA → PENDENTE, sem valores', () => {
      const r = calcularSt(
        input({ enquadramento: 'PENDENCIA' }),
        regra(),
        { aprovada: true },
      );
      expect(r.status).toBe('PENDENTE');
      expect(r.icmsStTotal).toBe('0.00');
    });
  });

  describe('ausência de regra/MVA → PENDENTE (não presume margem)', () => {
    it('sem regra → PENDENTE', () => {
      const r = calcularSt(input(), null, { aprovada: true });
      expect(r.status).toBe('PENDENTE');
      expect(r.mva).toBeNull();
      expect(r.memoria).toMatch(/sem regra/i);
    });

    it('regra sem MVA apurável → PENDENTE', () => {
      const r = calcularSt(input(), regra({ mva: '' }), { aprovada: true });
      expect(r.status).toBe('PENDENTE');
      expect(r.baseSt).toBe('0.00');
      expect(r.memoria).toMatch(/MVA/);
    });
  });

  describe('cálculo e SEPARAÇÃO dos componentes (R3.2)', () => {
    it('separa imposto próprio, base ST, retenção e FCP-ST com regra aprovada', () => {
      const r = calcularSt(input(), regra(), { aprovada: true });
      expect(r.status).toBe('CALCULADO');
      expect(r.pendente).toBe(false);
      // imposto próprio = 1000 × 18% = 180.00
      expect(r.impostoProprio).toBe('180.00');
      // base ST = 1000 × (1 + 40%) = 1400.00
      expect(r.baseSt).toBe('1400.00');
      // ICMS-ST total = 1400 × 18% = 252.00
      expect(r.icmsStTotal).toBe('252.00');
      // retenção = 252 − 180 = 72.00 (componente separado do próprio)
      expect(r.icmsStRetido).toBe('72.00');
      // FCP-ST = 1400 × 2% = 28.00 (componente PRÓPRIO, não somado à ST)
      expect(r.fcpSt).toBe('28.00');
      // o FCP nunca é somado ao ICMS-ST (separação R3.2)
      expect(r.icmsStRetido).not.toBe(r.fcpSt);
    });

    it('alíquota própria distinta da interna é usada no imposto próprio', () => {
      const r = calcularSt(
        input(),
        regra({ aliquotaInterna: '18.0000', aliquotaPropria: '12.0000' }),
        { aprovada: true },
      );
      // próprio = 1000 × 12% = 120.00; ST total = 1400 × 18% = 252.00
      expect(r.impostoProprio).toBe('120.00');
      expect(r.icmsStTotal).toBe('252.00');
      // retenção = 252 − 120 = 132.00
      expect(r.icmsStRetido).toBe('132.00');
    });

    it('alíquota própria ausente cai para a interna', () => {
      const r = calcularSt(
        input(),
        regra({ aliquotaPropria: null }),
        { aprovada: true },
      );
      expect(r.aliquotaPropria).toBe('18.0000');
      expect(r.impostoProprio).toBe('180.00');
    });

    it('sem FCP na UF → fcpSt 0.00, demais componentes intactos', () => {
      const r = calcularSt(
        input(),
        regra({ aliquotaFcp: null }),
        { aprovada: true },
      );
      expect(r.fcpSt).toBe('0.00');
      expect(r.aliquotaFcp).toBeNull();
      expect(r.icmsStRetido).toBe('72.00');
      expect(r.memoria).toMatch(/sem FCP-ST/);
    });

    it('próprio maior que o total de ST → retenção não fica negativa', () => {
      // MVA 0 → base ST = base própria; interna < própria → total < próprio.
      const r = calcularSt(
        input(),
        regra({ mva: '0.0000', aliquotaInterna: '12.0000', aliquotaPropria: '18.0000' }),
        { aprovada: true },
      );
      // total = 1000 × 12% = 120; próprio = 1000 × 18% = 180 → retenção 0.00
      expect(r.icmsStRetido).toBe('0.00');
    });

    it('regra vigente porém não aprovada → SIMULACAO (nunca guia)', () => {
      const r = calcularSt(input(), regra(), { aprovada: false });
      expect(r.status).toBe('SIMULACAO');
      expect(r.pendente).toBe(true);
      // os componentes ainda são calculados na simulação
      expect(r.icmsStRetido).toBe('72.00');
      expect(r.memoria).toMatch(/simulação/i);
      expect(stPodeGerarGuia(r.status)).toBe(false);
    });

    it('default (sem opcoes) → SIMULACAO', () => {
      const r = calcularSt(input(), regra());
      expect(r.status).toBe('SIMULACAO');
    });
  });

  describe('substituto x substituído (R3.2 — papéis separados)', () => {
    it('ecoa o papel SUBSTITUTO no resultado e na memória', () => {
      const r = calcularSt(input({ papel: 'SUBSTITUTO' }), regra(), {
        aprovada: true,
      });
      expect(r.papel).toBe('SUBSTITUTO');
      expect(r.memoria).toMatch(/SUBSTITUTO/);
    });

    it('substituído: ICMS-ST já retido é ecoado, não recalculado', () => {
      const r = calcularSt(
        input({ papel: 'SUBSTITUIDO', icmsStRetidoAnterior: '72.00' }),
        regra(),
        { aprovada: true },
      );
      expect(r.papel).toBe('SUBSTITUIDO');
      expect(r.icmsStRetidoAnterior).toBe('72.00');
      expect(r.memoria).toMatch(/SUBSTITU/);
    });
  });

  describe('restituição/ressarcimento/complemento como entradas TIPADAS (R3.2)', () => {
    it('preserva cada ajuste separadamente com seu tipo e valor', () => {
      const r = calcularSt(
        input({
          papel: 'SUBSTITUIDO',
          ajustes: [
            { tipo: 'RESTITUICAO', valor: '10.00', fundamento: 'venda abaixo do presumido' },
            { tipo: 'RESSARCIMENTO', valor: '5.00' },
            { tipo: 'COMPLEMENTO', valor: '3.00' },
          ],
        }),
        regra(),
        { aprovada: true },
      );
      expect(r.ajustes).toHaveLength(3);
      expect(r.ajustes[0]).toEqual({
        tipo: 'RESTITUICAO',
        valor: '10.00',
        fundamento: 'venda abaixo do presumido',
      });
      expect(r.ajustes[1].tipo).toBe('RESSARCIMENTO');
      expect(r.ajustes[1].fundamento).toBeNull();
      expect(r.ajustes[2].tipo).toBe('COMPLEMENTO');
      // totais por tipo, mantidos SEPARADOS (não um "ajuste genérico")
      expect(r.totalRestituicao).toBe('10.00');
      expect(r.totalRessarcimento).toBe('5.00');
      expect(r.totalComplemento).toBe('3.00');
      expect(r.memoria).toMatch(/RESTITUICAO/);
    });

    it('soma por tipo múltiplos ajustes do mesmo tipo', () => {
      const r = calcularSt(
        input({
          ajustes: [
            { tipo: 'RESTITUICAO', valor: '10.00' },
            { tipo: 'RESTITUICAO', valor: '2.50' },
          ],
        }),
        regra(),
        { aprovada: true },
      );
      expect(r.totalRestituicao).toBe('12.50');
      expect(r.ajustes).toHaveLength(2);
    });

    it('ajustes são preservados mesmo em pendência (incidem sobre saída efetiva)', () => {
      const r = calcularSt(
        input({
          enquadramento: 'PENDENCIA',
          ajustes: [{ tipo: 'COMPLEMENTO', valor: '3.00' }],
        }),
        regra(),
        { aprovada: true },
      );
      expect(r.status).toBe('PENDENTE');
      expect(r.totalComplemento).toBe('3.00');
      expect(r.ajustes).toHaveLength(1);
    });

    it('valor negativo é normalizado para não-negativo (sentido vem do tipo)', () => {
      const r = calcularSt(
        input({ ajustes: [{ tipo: 'RESTITUICAO', valor: '-10.00' }] }),
        regra(),
        { aprovada: true },
      );
      expect(r.ajustes[0].valor).toBe('10.00');
    });

    it('sem ajustes → listas e totais zerados', () => {
      const r = calcularSt(input(), regra(), { aprovada: true });
      expect(r.ajustes).toEqual([]);
      expect(r.totalRestituicao).toBe('0.00');
      expect(r.totalRessarcimento).toBe('0.00');
      expect(r.totalComplemento).toBe('0.00');
    });
  });

  describe('normalização de eixos', () => {
    it('normaliza UF e ecoa competência e base própria', () => {
      const r = calcularSt(input({ uf: 'sp' }), regra(), { aprovada: true });
      expect(r.uf).toBe('SP');
      expect(r.competencia).toBe('2026-09');
      expect(r.basePropria).toBe('1000.00');
    });
  });
});

describe('stPodeGerarGuia (guarda — R3.2/R3.4)', () => {
  it('só gera guia quando CALCULADO', () => {
    expect(stPodeGerarGuia('CALCULADO')).toBe(true);
    expect(stPodeGerarGuia('SIMULACAO')).toBe(false);
    expect(stPodeGerarGuia('PENDENTE')).toBe(false);
    expect(stPodeGerarGuia('BLOQUEADO')).toBe(false);
  });
});

describe('stCalculoMotivoInelegibilidade (bloqueio explicável — R3.4)', () => {
  it('CALCULADO não tem motivo', () => {
    expect(stCalculoMotivoInelegibilidade('CALCULADO')).toBeNull();
  });

  it('SIMULACAO explica regra não aprovada', () => {
    expect(stCalculoMotivoInelegibilidade('SIMULACAO')).toMatch(/SIMULAÇÃO/i);
  });

  it('PENDENTE explica falta de regra/habilitação', () => {
    expect(stCalculoMotivoInelegibilidade('PENDENTE')).toMatch(/PENDÊNCIA/i);
  });

  it('BLOQUEADO explica fonte não verificada (142/2018 + estadual)', () => {
    expect(stCalculoMotivoInelegibilidade('BLOQUEADO')).toMatch(/142\/2018/);
  });

  it('cobre todos os status possíveis', () => {
    const statuses: StCalculoStatus[] = [
      'CALCULADO',
      'SIMULACAO',
      'PENDENTE',
      'BLOQUEADO',
    ];
    for (const s of statuses) {
      const v = stCalculoMotivoInelegibilidade(s);
      expect(v === null || typeof v === 'string').toBe(true);
    }
  });
});

// Property-based style spot checks mantidos como exemplos determinísticos:
// a RETENÇÃO nunca excede o ICMS-ST total e nunca é negativa, para qualquer
// combinação plausível de base/MVA/alíquotas (invariante central da separação).
describe('invariantes da separação (R3.2)', () => {
  const bases = ['0.00', '100.00', '1000.00', '12345.67'];
  const mvas = ['0.0000', '35.0000', '71.6000'];
  const internas = ['12.0000', '18.0000'];

  it('retenção = total − próprio, nunca negativa e nunca > total', () => {
    for (const basePropria of bases) {
      for (const mva of mvas) {
        for (const interna of internas) {
          const r = calcularSt(
            input({ basePropria }),
            regra({ mva, aliquotaInterna: interna, aliquotaPropria: interna }),
            { aprovada: true },
          );
          const retido = Number(r.icmsStRetido);
          const total = Number(r.icmsStTotal);
          expect(retido).toBeGreaterThanOrEqual(0);
          expect(retido).toBeLessThanOrEqual(total + 0.001);
        }
      }
    }
  });
});
