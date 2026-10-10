import {
  calcularDebitoAdRem,
  creditosMesmaNatureza,
  resolverHipoteseCst,
} from './pis-cofins-cst';
import type { PisCofinsNaturezaCredito } from './pis-cofins-natureza';

describe('resolverHipoteseCst (Fase 4 / tarefa 3.4 — R2.4)', () => {
  describe('receitas tributadas por base × percentual (CST 01/02)', () => {
    it('CST 01 → TRIBUTADA, método BASE_PERCENTUAL, gera débito', () => {
      const h = resolverHipoteseCst('01');
      expect(h).not.toBeNull();
      expect(h!.efeito).toBe('RECEITA');
      expect(h!.naturezaReceita).toBe('TRIBUTADA');
      expect(h!.metodoCalculo).toBe('BASE_PERCENTUAL');
      expect(h!.geraDebito).toBe(true);
      expect(h!.geraCredito).toBe(false);
      expect(h!.naturezaCredito).toBe('NENHUM');
    });

    it('CST 02 → TRIBUTADA por base × percentual (alíquota diferenciada)', () => {
      const h = resolverHipoteseCst('02');
      expect(h!.naturezaReceita).toBe('TRIBUTADA');
      expect(h!.metodoCalculo).toBe('BASE_PERCENTUAL');
    });
  });

  describe('CST 03 — ad rem como hipótese DISTINTA, não base × percentual (R2.4)', () => {
    it('CST 03 → TRIBUTADA porém método AD_REM (não BASE_PERCENTUAL)', () => {
      const h = resolverHipoteseCst('03');
      expect(h).not.toBeNull();
      expect(h!.efeito).toBe('RECEITA');
      expect(h!.naturezaReceita).toBe('TRIBUTADA');
      expect(h!.metodoCalculo).toBe('AD_REM');
      expect(h!.geraDebito).toBe(true);
      expect(h!.descricao.toLowerCase()).toContain('unidade');
    });

    it('CST 03 NÃO compartilha o método de cálculo com CST 01/02', () => {
      const adRem = resolverHipoteseCst('03')!;
      const percentual = resolverHipoteseCst('01')!;
      expect(adRem.metodoCalculo).not.toBe(percentual.metodoCalculo);
    });
  });

  describe('receitas sem débito próprio (CST 04–09)', () => {
    it('CST 04 → MONOFASICA, método NENHUM, sem débito', () => {
      const h = resolverHipoteseCst('04');
      expect(h!.naturezaReceita).toBe('MONOFASICA');
      expect(h!.metodoCalculo).toBe('NENHUM');
      expect(h!.geraDebito).toBe(false);
    });

    it('CST 05 → SUBSTITUICAO, sem débito', () => {
      expect(resolverHipoteseCst('05')!.naturezaReceita).toBe('SUBSTITUICAO');
    });

    it.each(['06', '07', '08', '09'])(
      'CST %s → ALIQUOTA_ZERO, sem débito',
      (cst) => {
        const h = resolverHipoteseCst(cst);
        expect(h!.naturezaReceita).toBe('ALIQUOTA_ZERO');
        expect(h!.geraDebito).toBe(false);
      },
    );
  });

  describe('créditos: básico (50–56) separado de presumido (60–67) — R2.4', () => {
    it.each(['50', '51', '52', '53', '54', '55', '56'])(
      'CST %s → crédito BÁSICO',
      (cst) => {
        const h = resolverHipoteseCst(cst);
        expect(h!.efeito).toBe('CREDITO');
        expect(h!.naturezaCredito).toBe('BASICO');
        expect(h!.geraCredito).toBe(true);
      },
    );

    it.each(['60', '61', '62', '63', '64', '65', '66'])(
      'CST %s → crédito PRESUMIDO (agroindústria), distinto do básico',
      (cst) => {
        const h = resolverHipoteseCst(cst);
        expect(h!.efeito).toBe('CREDITO');
        expect(h!.naturezaCredito).toBe('PRESUMIDO');
      },
    );

    it('CST 67 → crédito PRESUMIDO, NÃO básico (foco de R2.4)', () => {
      const h = resolverHipoteseCst('67');
      expect(h).not.toBeNull();
      expect(h!.efeito).toBe('CREDITO');
      expect(h!.naturezaCredito).toBe('PRESUMIDO');
      expect(h!.geraCredito).toBe(true);
      expect(h!.descricao).toContain('R2.4');
    });

    it('o crédito básico e o crédito presumido têm naturezas distintas', () => {
      const basico = resolverHipoteseCst('50')!;
      const presumido = resolverHipoteseCst('67')!;
      expect(basico.naturezaCredito).not.toBe(presumido.naturezaCredito);
    });
  });

  describe('normalização e escopo honesto', () => {
    it('normaliza um dígito para dois (ex.: "3" → CST 03 ad rem)', () => {
      const h = resolverHipoteseCst('3');
      expect(h!.cst).toBe('03');
      expect(h!.metodoCalculo).toBe('AD_REM');
    });

    it('ignora espaços ao redor do CST', () => {
      expect(resolverHipoteseCst(' 01 ')!.cst).toBe('01');
    });

    it('CST desconhecido → null (pendência, nunca tributado presumido)', () => {
      expect(resolverHipoteseCst('99')).toBeNull();
      expect(resolverHipoteseCst('')).toBeNull();
      expect(resolverHipoteseCst(null)).toBeNull();
      expect(resolverHipoteseCst('AB')).toBeNull();
    });
  });
});

describe('calcularDebitoAdRem (CST 03 — quantidade × alíquota-reais) — R2.4', () => {
  it('débito = quantidade × alíquota-em-reais (ad rem), não base × percentual', () => {
    // 1000 unidades × R$ 0,1210/un = R$ 121,00 (ex.: alíquota ad rem PIS cerveja).
    expect(
      calcularDebitoAdRem({ quantidade: '1000.0000', aliquotaReais: '0.1210' }),
    ).toBe('121.00');
  });

  it('arredonda meia casa para cima, igual ao débito percentual (R5.5)', () => {
    // 333 × 0,0761 = 25,3413 → 25,34.
    expect(
      calcularDebitoAdRem({ quantidade: '333.0000', aliquotaReais: '0.0761' }),
    ).toBe('25.34');
    // 150 × 0,0767 = 11,505 → 11,51 (meia casa para cima).
    expect(
      calcularDebitoAdRem({ quantidade: '150.0000', aliquotaReais: '0.0767' }),
    ).toBe('11.51');
  });

  it('quantidade fracionária é respeitada (decimais como string)', () => {
    // 12,5 × 2,0000 = 25,00.
    expect(
      calcularDebitoAdRem({ quantidade: '12.5000', aliquotaReais: '2.0000' }),
    ).toBe('25.00');
  });

  it('quantidade ou alíquota zero → débito zero', () => {
    expect(
      calcularDebitoAdRem({ quantidade: '0', aliquotaReais: '0.1210' }),
    ).toBe('0.00');
    expect(
      calcularDebitoAdRem({ quantidade: '1000.0000', aliquotaReais: '0' }),
    ).toBe('0.00');
  });
});

describe('creditosMesmaNatureza — guarda de não-mistura (R2.4)', () => {
  it('mesma natureza → true (podem compor o mesmo balde)', () => {
    expect(creditosMesmaNatureza('BASICO', 'BASICO')).toBe(true);
    expect(creditosMesmaNatureza('PRESUMIDO', 'PRESUMIDO')).toBe(true);
  });

  it('básico × presumido → false (NUNCA somados juntos — R2.4)', () => {
    expect(creditosMesmaNatureza('BASICO', 'PRESUMIDO')).toBe(false);
    expect(creditosMesmaNatureza('PRESUMIDO', 'BASICO')).toBe(false);
  });

  it('qualquer par de naturezas distintas é não-misturável', () => {
    const naturezas: PisCofinsNaturezaCredito[] = [
      'BASICO',
      'PRESUMIDO',
      'IMPORTACAO',
      'NENHUM',
    ];
    for (const a of naturezas) {
      for (const b of naturezas) {
        expect(creditosMesmaNatureza(a, b)).toBe(a === b);
      }
    }
  });

  it('créditos presumidos de CSTs diferentes (60–67) são misturáveis entre si', () => {
    const c60 = resolverHipoteseCst('60')!.naturezaCredito;
    const c67 = resolverHipoteseCst('67')!.naturezaCredito;
    // Ambos PRESUMIDO → mesma natureza, podem compor o mesmo balde presumido,
    // mas NÃO o balde básico (verificado acima).
    expect(creditosMesmaNatureza(c60, c67)).toBe(true);
  });
});
