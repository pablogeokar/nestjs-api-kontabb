import {
  consolidarRazaoReceitas,
  type PisCofinsLancamentoReceita,
  type PisCofinsRazaoInput,
} from './pis-cofins-razao';

// Lançamento mínimo de RECEITA, com overrides pontuais por teste.
function receita(
  overrides: Partial<PisCofinsLancamentoReceita> = {},
): PisCofinsLancamentoReceita {
  return {
    fonte: 'XML_NFE',
    tipo: 'RECEITA',
    natureza: 'TRIBUTADA',
    vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
    valor: '1000.00',
    ...overrides,
  };
}

// Entrada mínima do razão, com overrides pontuais por teste.
function input(
  overrides: Partial<PisCofinsRazaoInput> = {},
): PisCofinsRazaoInput {
  return {
    competencia: '2026-09',
    lancamentos: [],
    ...overrides,
  };
}

describe('consolidarRazaoReceitas (Fase 4 / tarefa 3.2 — R2.2, R2.6)', () => {
  describe('razão multi-fonte: não depende só do XML (R2.6)', () => {
    it('agrega receita de XML e sem NF-e na mesma natureza, separando a origem', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [
            receita({ fonte: 'XML_NFE', valor: '1000.00' }),
            receita({ fonte: 'SEM_NFE', valor: '400.00' }),
          ],
        }),
      );
      expect(r.naturezas).toHaveLength(1);
      const n = r.naturezas[0];
      expect(n.natureza).toBe('TRIBUTADA');
      expect(n.base).toBe('1400.00');
      expect(n.baseXml).toBe('1000.00');
      expect(n.baseSemNfe).toBe('400.00');
      expect(r.receitaTotal).toBe('1400.00');
      expect(r.receitaSemNfe).toBe('400.00');
    });

    it('receita SEM NF-e isolada aparece na base, não é ignorada por não ter XML', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [receita({ fonte: 'SEM_NFE', valor: '2500.00' })],
        }),
      );
      expect(r.receitaTotal).toBe('2500.00');
      expect(r.receitaSemNfe).toBe('2500.00');
      expect(r.naturezas[0].base).toBe('2500.00');
      expect(r.naturezas[0].baseXml).toBe('0.00');
    });

    it('separa naturezas/vinculações distintas em bases distintas', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [
            receita({ natureza: 'TRIBUTADA', valor: '1000.00' }),
            receita({
              natureza: 'EXPORTACAO',
              vinculacao: 'EXPORTACAO',
              valor: '3000.00',
            }),
          ],
        }),
      );
      expect(r.naturezas).toHaveLength(2);
      // Ordenação determinística por natureza: EXPORTACAO antes de TRIBUTADA.
      expect(r.naturezas[0].natureza).toBe('EXPORTACAO');
      expect(r.naturezas[0].base).toBe('3000.00');
      expect(r.naturezas[1].natureza).toBe('TRIBUTADA');
      expect(r.naturezas[1].base).toBe('1000.00');
    });
  });

  describe('incorporação de retenções e saldos anteriores (R2.6)', () => {
    it('retenção na fonte é incorporada como abatimento, não como base de receita', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [
            receita({ valor: '1000.00' }),
            {
              fonte: 'RETENCAO',
              tipo: 'RETENCAO',
              valor: '35.00',
              descricao: 'PIS retido por tomador PJ',
            },
          ],
        }),
      );
      expect(r.retencaoTotal).toBe('35.00');
      // A retenção NÃO infla a base de receita nem vira natureza.
      expect(r.receitaTotal).toBe('1000.00');
      expect(r.naturezas).toHaveLength(1);
      expect(r.naturezas[0].base).toBe('1000.00');
    });

    it('saldo anterior é incorporado e rastreado (crédito positivo)', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [
            receita({ valor: '1000.00' }),
            {
              fonte: 'SALDO_ANTERIOR',
              tipo: 'SALDO',
              valor: '120.50',
              descricao: 'Saldo credor transportado de 2026-08',
            },
          ],
        }),
      );
      expect(r.saldoAnterior).toBe('120.50');
      // Saldo não é base de receita.
      expect(r.receitaTotal).toBe('1000.00');
      expect(r.memoria).toContain('Saldo do período anterior');
    });

    it('acumula múltiplas retenções e múltiplos saldos', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [
            { fonte: 'RETENCAO', tipo: 'RETENCAO', valor: '10.00' },
            { fonte: 'RETENCAO', tipo: 'RETENCAO', valor: '25.00' },
            { fonte: 'SALDO_ANTERIOR', tipo: 'SALDO', valor: '5.00' },
            { fonte: 'SALDO_ANTERIOR', tipo: 'SALDO', valor: '15.00' },
          ],
        }),
      );
      expect(r.retencaoTotal).toBe('35.00');
      expect(r.saldoAnterior).toBe('20.00');
    });
  });

  describe('pendência de cobertura: receita não coberta aparece, não vira zero (R2.2)', () => {
    it('receita esperada maior que a coberta → pendência explícita', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [receita({ valor: '6000.00' })],
          receitaEsperada: '10000.00',
        }),
      );
      expect(r.pendenciaCobertura).not.toBeNull();
      expect(r.pendenciaCobertura?.receitaEsperada).toBe('10000.00');
      expect(r.pendenciaCobertura?.receitaCoberta).toBe('6000.00');
      // A diferença APARECE como pendência, não como zero silencioso.
      expect(r.pendenciaCobertura?.receitaNaoCoberta).toBe('4000.00');
      expect(r.pendenciaCobertura?.motivo).toContain('R2.2');
    });

    it('receita coberta igual à esperada → sem pendência', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [receita({ valor: '10000.00' })],
          receitaEsperada: '10000.00',
        }),
      );
      expect(r.pendenciaCobertura).toBeNull();
    });

    it('receita coberta maior que a esperada → sem pendência (não negativa)', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [receita({ valor: '12000.00' })],
          receitaEsperada: '10000.00',
        }),
      );
      expect(r.pendenciaCobertura).toBeNull();
    });

    it('sem receita esperada informada → não presume cobertura total nem zera a falta', () => {
      const r = consolidarRazaoReceitas(
        input({ lancamentos: [receita({ valor: '6000.00' })] }),
      );
      expect(r.pendenciaCobertura).toBeNull();
      // Apenas consolida o lançado; nada é presumido.
      expect(r.receitaTotal).toBe('6000.00');
    });

    it('cobertura com receita sem NF-e reduz a pendência (R2.2 + R2.6 juntos)', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [
            receita({ fonte: 'XML_NFE', valor: '6000.00' }),
            receita({ fonte: 'SEM_NFE', valor: '3000.00' }),
          ],
          receitaEsperada: '10000.00',
        }),
      );
      // XML 6000 + sem NF-e 3000 = 9000 coberto; falta 1000.
      expect(r.pendenciaCobertura?.receitaNaoCoberta).toBe('1000.00');
    });
  });

  describe('rótulo "demonstrativo" até cobertura completa (R2.6)', () => {
    it('com pendência de cobertura → demonstrativo', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [receita({ valor: '6000.00' })],
          receitaEsperada: '10000.00',
        }),
      );
      expect(r.demonstrativo).toBe(true);
      expect(r.memoria).toContain('DEMONSTRATIVO');
    });

    it('com lançamento simulado → demonstrativo mesmo sem pendência', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [receita({ valor: '1000.00', simulado: true })],
        }),
      );
      expect(r.demonstrativo).toBe(true);
      expect(r.naturezas[0].simulado).toBe(true);
    });

    it('cobertura completa e sem simulação → não demonstrativo', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [receita({ valor: '10000.00' })],
          receitaEsperada: '10000.00',
        }),
      );
      expect(r.demonstrativo).toBe(false);
      expect(r.memoria).toContain('Cobertura completa');
    });
  });

  describe('eixos preservados para as tarefas seguintes (3.3/3.4)', () => {
    it('preserva naturezaCredito informada no lançamento', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [
            receita({
              natureza: 'TRIBUTADA',
              naturezaCredito: 'PRESUMIDO',
              valor: '1000.00',
            }),
          ],
        }),
      );
      expect(r.naturezas[0].naturezaCredito).toBe('PRESUMIDO');
    });

    it('lançamento de receita sem natureza cai em OUTRA/NAO_APLICAVEL (pendência no calculador)', () => {
      const r = consolidarRazaoReceitas(
        input({
          lancamentos: [
            {
              fonte: 'SEM_NFE',
              tipo: 'RECEITA',
              valor: '500.00',
            },
          ],
        }),
      );
      expect(r.naturezas[0].natureza).toBe('OUTRA');
      expect(r.naturezas[0].vinculacao).toBe('NAO_APLICAVEL');
    });
  });

  it('razão vazio → tudo zero, sem pendência, não demonstrativo', () => {
    const r = consolidarRazaoReceitas(input({ lancamentos: [] }));
    expect(r.naturezas).toHaveLength(0);
    expect(r.receitaTotal).toBe('0.00');
    expect(r.retencaoTotal).toBe('0.00');
    expect(r.saldoAnterior).toBe('0.00');
    expect(r.pendenciaCobertura).toBeNull();
    expect(r.demonstrativo).toBe(false);
  });
});
