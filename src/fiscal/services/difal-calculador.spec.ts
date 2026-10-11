import {
  calcularDifalHipotese,
  difalMotivoInelegibilidadeGuia,
  difalPodeGerarGuia,
  type DifalCalculoInput,
  type DifalCalculoStatus,
  type DifalRegra,
} from './difal-calculador';

// Entrada mínima de cálculo, com overrides pontuais por teste.
function input(overrides: Partial<DifalCalculoInput> = {}): DifalCalculoInput {
  return {
    hipotese: 'DIFAL_ENTRADA_CONTRIBUINTE',
    ufDestino: 'SP',
    competencia: '2026-09',
    responsavel: 'ADQUIRENTE',
    baseCalculo: '1000.00',
    ...overrides,
  };
}

describe('calcularDifalHipotese (Fase 4 / tarefa 2.2 — R1.1, R1.3)', () => {
  describe('cálculo dirigido pela regra do catálogo (4/7/12)', () => {
    it('interestadual 12% → DIFAL = base * (interna 18 - 12)/100', () => {
      const regra: DifalRegra = {
        aliquotaInterna: '18.0000',
        aliquotaInterestadual: '12.0000',
      };
      const r = calcularDifalHipotese(
        input({ baseCalculo: '1000.00' }),
        regra,
        {
          aprovada: true,
        },
      );
      expect(r.status).toBe('CALCULADO');
      expect(r.diferencialAliquota).toBe('6.0000');
      expect(r.valorDifal).toBe('60.00');
      expect(r.pendente).toBe(false);
    });

    it('interestadual 7% → DIFAL = base * (interna 18 - 7)/100', () => {
      const regra: DifalRegra = {
        aliquotaInterna: '18.0000',
        aliquotaInterestadual: '7.0000',
      };
      const r = calcularDifalHipotese(
        input({ baseCalculo: '1000.00' }),
        regra,
        {
          aprovada: true,
        },
      );
      expect(r.valorDifal).toBe('110.00');
    });

    it('interestadual 4% (origem importada) → DIFAL = base * (interna 18 - 4)/100', () => {
      const regra: DifalRegra = {
        aliquotaInterna: '18.0000',
        aliquotaInterestadual: '4.0000',
      };
      const r = calcularDifalHipotese(
        input({ baseCalculo: '1000.00' }),
        regra,
        {
          aprovada: true,
        },
      );
      expect(r.valorDifal).toBe('140.00');
    });
  });

  it('usa a alíquota interestadual destacada no item quando a regra não a fixa', () => {
    const regra: DifalRegra = { aliquotaInterna: '18.0000' };
    const r = calcularDifalHipotese(
      input({ baseCalculo: '1000.00', aliquotaInterestadualItem: '12.0000' }),
      regra,
      { aprovada: true },
    );
    expect(r.aliquotaInterestadual).toBe('12.0000');
    expect(r.valorDifal).toBe('60.00');
  });

  it('a regra tem precedência sobre a alíquota destacada no item', () => {
    const regra: DifalRegra = {
      aliquotaInterna: '18.0000',
      aliquotaInterestadual: '7.0000',
    };
    const r = calcularDifalHipotese(
      input({ aliquotaInterestadualItem: '12.0000' }),
      regra,
      { aprovada: true },
    );
    expect(r.aliquotaInterestadual).toBe('7.0000');
  });

  it('calcula FCP separado quando a regra o institui', () => {
    const regra: DifalRegra = {
      aliquotaInterna: '18.0000',
      aliquotaInterestadual: '12.0000',
      aliquotaFcp: '2.0000',
    };
    const r = calcularDifalHipotese(input({ baseCalculo: '1000.00' }), regra, {
      aprovada: true,
    });
    expect(r.valorDifal).toBe('60.00');
    expect(r.valorFcp).toBe('20.00');
    expect(r.aliquotaFcp).toBe('2.0000');
  });

  it('não gera DIFAL negativo quando interestadual >= interna', () => {
    const regra: DifalRegra = {
      aliquotaInterna: '17.0000',
      aliquotaInterestadual: '17.0000',
    };
    const r = calcularDifalHipotese(input(), regra, { aprovada: true });
    expect(r.diferencialAliquota).toBe('0.0000');
    expect(r.valorDifal).toBe('0.00');
  });

  describe('escopo honesto (R1.2)', () => {
    it('SEM regra → PENDENTE, sem valor de imposto', () => {
      const r = calcularDifalHipotese(input(), null);
      expect(r.status).toBe('PENDENTE');
      expect(r.pendente).toBe(true);
      expect(r.valorDifal).toBe('0.00');
      expect(r.aliquotaInterna).toBeNull();
    });

    it('regra vigente NÃO aprovada → SIMULACAO (calcula, mas não é guia)', () => {
      const regra: DifalRegra = {
        aliquotaInterna: '18.0000',
        aliquotaInterestadual: '12.0000',
      };
      const r = calcularDifalHipotese(input(), regra, { aprovada: false });
      expect(r.status).toBe('SIMULACAO');
      expect(r.pendente).toBe(true);
      // O valor é calculado para visibilidade, mas o estado o marca como não guia.
      expect(r.valorDifal).toBe('60.00');
      expect(r.memoria).toContain('simulação');
    });

    it('regra sem alíquota interestadual nem item → PENDENTE (não presume 12%)', () => {
      const regra: DifalRegra = { aliquotaInterna: '18.0000' };
      const r = calcularDifalHipotese(
        input({ aliquotaInterestadualItem: null }),
        regra,
        { aprovada: true },
      );
      expect(r.status).toBe('PENDENTE');
      expect(r.valorDifal).toBe('0.00');
      expect(r.diferencialAliquota).toBeNull();
    });
  });

  it('ecoa os eixos de seleção (hipótese, UF, competência, responsável) no resultado', () => {
    const regra: DifalRegra = {
      aliquotaInterna: '18.0000',
      aliquotaInterestadual: '12.0000',
    };
    const r = calcularDifalHipotese(
      input({
        hipotese: 'DIFAL_SAIDA_NAO_CONTRIBUINTE',
        ufDestino: 'ba',
        responsavel: 'REMETENTE',
      }),
      regra,
      { aprovada: true },
    );
    expect(r.hipotese).toBe('DIFAL_SAIDA_NAO_CONTRIBUINTE');
    expect(r.ufDestino).toBe('BA');
    expect(r.competencia).toBe('2026-09');
    expect(r.responsavel).toBe('REMETENTE');
    expect(r.memoria).toContain('DIFAL_SAIDA_NAO_CONTRIBUINTE');
  });
});

describe('elegibilidade de guia por estado (Fase 4 / tarefa 2.3 — R1.2)', () => {
  describe('difalPodeGerarGuia', () => {
    it('CALCULADO → pode gerar guia (regra homologada e vigente)', () => {
      expect(difalPodeGerarGuia('CALCULADO')).toBe(true);
    });

    it('SIMULACAO → NUNCA gera guia (regra vigente não aprovada)', () => {
      expect(difalPodeGerarGuia('SIMULACAO')).toBe(false);
    });

    it('PENDENTE → NUNCA gera guia (sem regra homologada)', () => {
      expect(difalPodeGerarGuia('PENDENTE')).toBe(false);
    });

    it('apenas CALCULADO é elegível entre todos os estados', () => {
      const estados: DifalCalculoStatus[] = [
        'CALCULADO',
        'SIMULACAO',
        'PENDENTE',
      ];
      const elegiveis = estados.filter((e) => difalPodeGerarGuia(e));
      expect(elegiveis).toEqual(['CALCULADO']);
    });
  });

  describe('difalMotivoInelegibilidadeGuia', () => {
    it('CALCULADO → null (não há recusa a explicar)', () => {
      expect(difalMotivoInelegibilidadeGuia('CALCULADO')).toBeNull();
    });

    it('SIMULACAO → motivo cita simulação e R1.2', () => {
      const motivo = difalMotivoInelegibilidadeGuia('SIMULACAO');
      expect(motivo).toContain('SIMULAÇÃO');
      expect(motivo).toContain('R1.2');
    });

    it('PENDENTE → motivo cita pendência e R1.2', () => {
      const motivo = difalMotivoInelegibilidadeGuia('PENDENTE');
      expect(motivo).toContain('PENDÊNCIA');
      expect(motivo).toContain('R1.2');
    });
  });
});
