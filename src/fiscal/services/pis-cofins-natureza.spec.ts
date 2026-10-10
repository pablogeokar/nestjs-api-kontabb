import {
  calcularPisCofinsNatureza,
  pisCofinsMotivoInelegibilidade,
  pisCofinsPodeApurarDefinitivo,
  type PisCofinsCalculoInput,
  type PisCofinsCalculoStatus,
  type PisCofinsRegra,
} from './pis-cofins-natureza';

// Entrada mínima de cálculo, com overrides pontuais por teste.
function input(
  overrides: Partial<PisCofinsCalculoInput> = {},
): PisCofinsCalculoInput {
  return {
    tributo: 'PIS',
    natureza: 'TRIBUTADA',
    vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
    regime: 'CUMULATIVO',
    competencia: '2026-09',
    base: '10000.00',
    ...overrides,
  };
}

// Regra de receita tributada cumulativa (0,65% / 3,00%).
function regraTributadaCumulativa(): PisCofinsRegra {
  return {
    regime: 'CUMULATIVO',
    aliquotaPis: '0.6500',
    aliquotaCofins: '3.0000',
    geraDebito: true,
    geraCredito: false,
  };
}

// Regra de receita tributada não-cumulativa (1,65% / 7,60%).
function regraTributadaNaoCumulativa(): PisCofinsRegra {
  return {
    regime: 'NAO_CUMULATIVO',
    aliquotaPis: '1.6500',
    aliquotaCofins: '7.6000',
    geraDebito: true,
    geraCredito: false,
  };
}

describe('calcularPisCofinsNatureza (Fase 4 / tarefa 3.1 — R2.1)', () => {
  describe('débito por natureza tributada dirigido pela regra do catálogo', () => {
    it('PIS cumulativo 0,65% → débito = base × 0,65 / 100', () => {
      const r = calcularPisCofinsNatureza(
        input({ tributo: 'PIS', base: '10000.00' }),
        regraTributadaCumulativa(),
        { aprovada: true },
      );
      expect(r.status).toBe('CALCULADO');
      expect(r.aliquota).toBe('0.6500');
      expect(r.debito).toBe('65.00');
      expect(r.credito).toBe('0.00');
      expect(r.pendente).toBe(false);
    });

    it('COFINS cumulativo 3% → débito = base × 3 / 100', () => {
      const r = calcularPisCofinsNatureza(
        input({ tributo: 'COFINS', base: '10000.00' }),
        regraTributadaCumulativa(),
        { aprovada: true },
      );
      expect(r.debito).toBe('300.00');
    });

    it('PIS não-cumulativo 1,65% → débito = base × 1,65 / 100', () => {
      const r = calcularPisCofinsNatureza(
        input({
          tributo: 'PIS',
          regime: 'NAO_CUMULATIVO',
          base: '10000.00',
        }),
        regraTributadaNaoCumulativa(),
        { aprovada: true },
      );
      expect(r.debito).toBe('165.00');
    });

    it('COFINS não-cumulativo 7,6% → débito = base × 7,6 / 100', () => {
      const r = calcularPisCofinsNatureza(
        input({
          tributo: 'COFINS',
          regime: 'NAO_CUMULATIVO',
          base: '10000.00',
        }),
        regraTributadaNaoCumulativa(),
        { aprovada: true },
      );
      expect(r.debito).toBe('760.00');
    });
  });

  it('usa a alíquota destacada no item quando a regra não a fixa (R5.2)', () => {
    const regra: PisCofinsRegra = {
      regime: 'CUMULATIVO',
      aliquotaPis: '',
      aliquotaCofins: '',
      geraDebito: true,
      geraCredito: false,
    };
    const r = calcularPisCofinsNatureza(
      input({ tributo: 'PIS', base: '1000.00', aliquotaItem: '1.6500' }),
      regra,
      { aprovada: true },
    );
    expect(r.aliquota).toBe('1.6500');
    expect(r.debito).toBe('16.50');
  });

  it('a regra tem precedência sobre a alíquota destacada no item', () => {
    const r = calcularPisCofinsNatureza(
      input({ base: '1000.00', aliquotaItem: '7.6000' }),
      regraTributadaCumulativa(),
      { aprovada: true },
    );
    expect(r.aliquota).toBe('0.6500');
  });

  describe('crédito por natureza (não-cumulativo), separado do débito (R2.4)', () => {
    it('crédito básico → credito = base × alíquota / 100, sem débito', () => {
      const regra: PisCofinsRegra = {
        regime: 'NAO_CUMULATIVO',
        aliquotaPis: '1.6500',
        aliquotaCofins: '7.6000',
        geraDebito: false,
        geraCredito: true,
        naturezaCredito: 'BASICO',
      };
      const r = calcularPisCofinsNatureza(
        input({ tributo: 'PIS', regime: 'NAO_CUMULATIVO', base: '4000.00' }),
        regra,
        { aprovada: true },
      );
      expect(r.credito).toBe('66.00');
      expect(r.debito).toBe('0.00');
      expect(r.naturezaCredito).toBe('BASICO');
    });

    it('crédito presumido não se confunde com básico (naturezaCredito distinta)', () => {
      const regra: PisCofinsRegra = {
        regime: 'NAO_CUMULATIVO',
        aliquotaPis: '1.6500',
        aliquotaCofins: '7.6000',
        geraDebito: false,
        geraCredito: true,
        naturezaCredito: 'PRESUMIDO',
      };
      const r = calcularPisCofinsNatureza(
        input({ tributo: 'PIS', regime: 'NAO_CUMULATIVO', base: '4000.00' }),
        regra,
        { aprovada: true },
      );
      expect(r.naturezaCredito).toBe('PRESUMIDO');
      expect(r.credito).toBe('66.00');
    });

    it('crédito não é apurado no regime cumulativo (apenas não-cumulativo)', () => {
      const regra: PisCofinsRegra = {
        regime: 'CUMULATIVO',
        aliquotaPis: '1.6500',
        aliquotaCofins: '7.6000',
        geraDebito: false,
        geraCredito: true,
        naturezaCredito: 'BASICO',
      };
      const r = calcularPisCofinsNatureza(
        input({ regime: 'CUMULATIVO', base: '4000.00' }),
        regra,
        { aprovada: true },
      );
      expect(r.credito).toBe('0.00');
    });
  });

  describe('naturezas sem débito próprio: base registrada, sem valor', () => {
    it('monofásica → base registrada, débito 0, sem presumir débito', () => {
      const regra: PisCofinsRegra = {
        regime: 'CUMULATIVO',
        aliquotaPis: '0.6500',
        aliquotaCofins: '3.0000',
        geraDebito: false,
        geraCredito: false,
      };
      const r = calcularPisCofinsNatureza(
        input({ natureza: 'MONOFASICA', base: '5000.00' }),
        regra,
        { aprovada: true },
      );
      expect(r.base).toBe('5000.00');
      expect(r.debito).toBe('0.00');
      expect(r.credito).toBe('0.00');
      expect(r.aliquota).toBeNull();
      expect(r.memoria).toContain('SEM débito próprio');
    });
  });

  describe('escopo honesto (R2.1/R2.5)', () => {
    it('regime ausente → PENDENTE, NÃO presume cumulativo (R2.5)', () => {
      const r = calcularPisCofinsNatureza(
        input({ regime: null }),
        regraTributadaCumulativa(),
        { aprovada: true },
      );
      expect(r.status).toBe('PENDENTE');
      expect(r.pendente).toBe(true);
      expect(r.regime).toBeNull();
      expect(r.debito).toBe('0.00');
      expect(r.memoria).toContain('regime');
    });

    it('SEM regra → PENDENTE, sem valor apurado', () => {
      const r = calcularPisCofinsNatureza(input(), null);
      expect(r.status).toBe('PENDENTE');
      expect(r.pendente).toBe(true);
      expect(r.debito).toBe('0.00');
      expect(r.aliquota).toBeNull();
    });

    it('regra vigente NÃO aprovada → SIMULACAO (calcula, mas não é guia)', () => {
      const r = calcularPisCofinsNatureza(
        input({ base: '10000.00' }),
        regraTributadaCumulativa(),
        { aprovada: false },
      );
      expect(r.status).toBe('SIMULACAO');
      expect(r.pendente).toBe(true);
      // O valor é calculado para visibilidade, mas o estado o marca como não guia.
      expect(r.debito).toBe('65.00');
      expect(r.memoria).toContain('simulação');
    });

    it('natureza tributável sem alíquota na regra nem no item → PENDENTE', () => {
      const regra: PisCofinsRegra = {
        regime: 'CUMULATIVO',
        aliquotaPis: '',
        aliquotaCofins: '',
        geraDebito: true,
        geraCredito: false,
      };
      const r = calcularPisCofinsNatureza(
        input({ aliquotaItem: null }),
        regra,
        { aprovada: true },
      );
      expect(r.status).toBe('PENDENTE');
      expect(r.debito).toBe('0.00');
      expect(r.aliquota).toBeNull();
    });
  });

  it('ecoa os eixos de seleção (tributo, natureza, vinculação, regime, competência)', () => {
    const r = calcularPisCofinsNatureza(
      input({
        tributo: 'COFINS',
        natureza: 'EXPORTACAO',
        vinculacao: 'EXPORTACAO',
        regime: 'NAO_CUMULATIVO',
      }),
      {
        regime: 'NAO_CUMULATIVO',
        aliquotaPis: '1.6500',
        aliquotaCofins: '7.6000',
        geraDebito: false,
        geraCredito: false,
      },
      { aprovada: true },
    );
    expect(r.tributo).toBe('COFINS');
    expect(r.natureza).toBe('EXPORTACAO');
    expect(r.vinculacao).toBe('EXPORTACAO');
    expect(r.regime).toBe('NAO_CUMULATIVO');
    expect(r.competencia).toBe('2026-09');
    expect(r.memoria).toContain('EXPORTACAO');
  });
});

describe('elegibilidade de apuração definitiva por estado (Fase 4 / 3.1 — R2.1)', () => {
  describe('pisCofinsPodeApurarDefinitivo', () => {
    it('CALCULADO → pode apurar definitivo (regra homologada e vigente)', () => {
      expect(pisCofinsPodeApurarDefinitivo('CALCULADO')).toBe(true);
    });

    it('SIMULACAO → NUNCA definitivo (regra vigente não aprovada)', () => {
      expect(pisCofinsPodeApurarDefinitivo('SIMULACAO')).toBe(false);
    });

    it('PENDENTE → NUNCA definitivo (sem regra/regime)', () => {
      expect(pisCofinsPodeApurarDefinitivo('PENDENTE')).toBe(false);
    });

    it('apenas CALCULADO é elegível entre todos os estados', () => {
      const estados: PisCofinsCalculoStatus[] = [
        'CALCULADO',
        'SIMULACAO',
        'PENDENTE',
      ];
      const elegiveis = estados.filter((e) => pisCofinsPodeApurarDefinitivo(e));
      expect(elegiveis).toEqual(['CALCULADO']);
    });
  });

  describe('pisCofinsMotivoInelegibilidade', () => {
    it('CALCULADO → null (não há recusa a explicar)', () => {
      expect(pisCofinsMotivoInelegibilidade('CALCULADO')).toBeNull();
    });

    it('SIMULACAO → motivo cita simulação e R2.1', () => {
      const motivo = pisCofinsMotivoInelegibilidade('SIMULACAO');
      expect(motivo).toContain('SIMULAÇÃO');
      expect(motivo).toContain('R2.1');
    });

    it('PENDENTE → motivo cita pendência e R2.1', () => {
      const motivo = pisCofinsMotivoInelegibilidade('PENDENTE');
      expect(motivo).toContain('PENDÊNCIA');
      expect(motivo).toContain('R2.1');
    });
  });
});
