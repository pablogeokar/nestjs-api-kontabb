import {
  comporBaseDifal,
  type DifalBaseItem,
  type DifalBaseRegra,
} from './difal-base';

// Item mínimo para composição, com overrides pontuais por teste.
function item(overrides: Partial<DifalBaseItem> = {}): DifalBaseItem {
  return {
    valorBcIcms: '1000.00',
    valorBrutoProduto: '1000.00',
    origemMercadoria: '0',
    ...overrides,
  };
}

describe('comporBaseDifal (Fase 4 / tarefa 2.4 — R1.3, R1.5)', () => {
  describe('base bruta', () => {
    it('usa a BC de ICMS do item quando destacada', () => {
      const r = comporBaseDifal(item({ valorBcIcms: '1500.00' }), null);
      expect(r.baseCalculo).toBe('1500.00');
      expect(r.passos[0].nome).toBe('base_bruta');
    });

    it('compõe pelas parcelas quando não há BC apurada', () => {
      // produto 1000 + frete 50 + seguro 20 + outras 30 − desconto 100 = 1000.
      const r = comporBaseDifal(
        item({
          valorBcIcms: '0.00',
          valorBrutoProduto: '1000.00',
          valorFrete: '50.00',
          valorSeguro: '20.00',
          valorOutrasDespesas: '30.00',
          valorDesconto: '100.00',
        }),
        null,
      );
      expect(r.baseCalculo).toBe('1000.00');
    });
  });

  describe('origem importada (R1.3) → interestadual 4%', () => {
    it('origem 1 (importação direta) força interestadual 4%', () => {
      const r = comporBaseDifal(
        item({ origemMercadoria: '1', aliquotaIcms: '12.0000' }),
        null,
      );
      expect(r.origemImportada).toBe(true);
      expect(r.aliquotaInterestadualEfetiva).toBe('4.0000');
    });

    it('origem 8 (conteúdo de importação > 70%) força interestadual 4%', () => {
      const r = comporBaseDifal(item({ origemMercadoria: '8' }), null);
      expect(r.origemImportada).toBe(true);
      expect(r.aliquotaInterestadualEfetiva).toBe('4.0000');
    });

    it('origem nacional (0) mantém a interestadual destacada no item', () => {
      const r = comporBaseDifal(
        item({ origemMercadoria: '0', aliquotaIcms: '12.0000' }),
        null,
      );
      expect(r.origemImportada).toBe(false);
      expect(r.aliquotaInterestadualEfetiva).toBe('12.0000');
    });
  });

  describe('redução de base (R1.3)', () => {
    it('aplica a redução destacada no item', () => {
      // base 1000 × (1 − 30%) = 700.
      const r = comporBaseDifal(
        item({ percentualReducaoBcIcms: '30.0000' }),
        null,
      );
      expect(r.baseCalculo).toBe('700.00');
    });

    it('soma redução do item e da regra', () => {
      // base 1000 × (1 − (10 + 20)%) = 700.
      const regra: DifalBaseRegra = { percentualReducao: '20.0000' };
      const r = comporBaseDifal(
        item({ percentualReducaoBcIcms: '10.0000' }),
        regra,
      );
      expect(r.baseCalculo).toBe('700.00');
    });
  });

  describe('benefício fiscal (R1.3)', () => {
    it('aplica benefício separado da redução ordinária', () => {
      // base 1000, redução 10% → 900; benefício 50% → 450.
      const regra: DifalBaseRegra = { percentualBeneficio: '50.0000' };
      const r = comporBaseDifal(
        item({ percentualReducaoBcIcms: '10.0000' }),
        regra,
      );
      expect(r.baseCalculo).toBe('450.00');
      // A memória distingue redução e benefício como passos distintos.
      const nomes = r.passos.map((p) => p.nome);
      expect(nomes).toContain('reducao_base');
      expect(nomes).toContain('beneficio_fiscal');
    });
  });

  describe('base por dentro / gross-up (R1.3)', () => {
    it('faz o gross-up quando a regra exige', () => {
      // base 1000 / (1 − 18/100) = 1000 / 0.82 = 1219.51 (arredondado).
      const regra: DifalBaseRegra = {
        basePorDentro: true,
        aliquotaInterna: '18.0000',
      };
      const r = comporBaseDifal(item(), regra);
      expect(r.baseCalculo).toBe('1219.51');
    });

    it('não aplica por dentro sem alíquota interna', () => {
      const regra: DifalBaseRegra = { basePorDentro: true };
      const r = comporBaseDifal(item(), regra);
      expect(r.baseCalculo).toBe('1000.00');
    });
  });

  describe('FCP na base (R1.3)', () => {
    it('expõe a base de FCP igual à base composta quando há FCP', () => {
      const regra: DifalBaseRegra = { aliquotaFcp: '2.0000' };
      const r = comporBaseDifal(item({ valorBcIcms: '1000.00' }), regra);
      expect(r.baseFcp).toBe('1000.00');
    });

    it('base de FCP é zero quando a regra não institui FCP', () => {
      const r = comporBaseDifal(item(), null);
      expect(r.baseFcp).toBe('0.00');
    });
  });

  describe('retenção / ST (R1.3, R1.4)', () => {
    it('zera a base de DIFAL próprio quando há ICMS-ST retido', () => {
      const r = comporBaseDifal(item({ valorIcmsStRetido: '50.00' }), null);
      expect(r.retido).toBe(true);
      expect(r.baseCalculo).toBe('0.00');
    });

    it('zera também a base de FCP quando retido', () => {
      const regra: DifalBaseRegra = { aliquotaFcp: '2.0000' };
      const r = comporBaseDifal(item({ stRetida: true }), regra);
      expect(r.baseCalculo).toBe('0.00');
      expect(r.baseFcp).toBe('0.00');
    });

    it('valor de ICMS-ST destacado também caracteriza retenção', () => {
      const r = comporBaseDifal(item({ valorIcmsSt: '80.00' }), null);
      expect(r.retido).toBe(true);
    });

    it('a retenção zera ambas as bases mesmo com redução, benefício, por dentro e FCP', () => {
      // Não-duplicidade (tarefa 2.5 — R1.4): qualquer que seja a composição
      // (redução + benefício + gross-up + FCP), a retenção zera a base própria
      // E a base de FCP. Nenhum passo anterior "sobrevive" à retenção.
      const regra: DifalBaseRegra = {
        percentualReducao: '20.0000',
        percentualBeneficio: '25.0000',
        basePorDentro: true,
        aliquotaInterna: '18.0000',
        aliquotaFcp: '2.0000',
      };
      const r = comporBaseDifal(item({ valorIcmsStRetido: '123.45' }), regra);
      expect(r.retido).toBe(true);
      expect(r.baseCalculo).toBe('0.00');
      expect(r.baseFcp).toBe('0.00');
      // O passo de retenção é o último e documenta o zeramento (auditável).
      const retencao = r.passos.at(-1)!;
      expect(retencao.nome).toBe('retencao_st');
      expect(retencao.valor).toBe('0.00');
      expect(r.memoriaArredondamento).toContain('duplicidade');
    });
  });

  describe('exposição de base bruta, benefícios e imposto já pago (tarefa 2.6 — R1.5)', () => {
    it('expõe a base bruta antes dos abatimentos e os valores abatidos', () => {
      // base 1000 → redução 20% (abate 200 → 800) → benefício 25% (abate 200 →
      // 600). A base bruta permanece 1000; cada abatimento é exposto à parte.
      const regra: DifalBaseRegra = {
        percentualReducao: '20.0000',
        percentualBeneficio: '25.0000',
      };
      const r = comporBaseDifal(item(), regra);
      expect(r.baseBruta).toBe('1000.00');
      expect(r.baseCalculo).toBe('600.00');
      expect(r.beneficios.percentualReducao).toBe('20.0000');
      expect(r.beneficios.valorReducao).toBe('200.00');
      expect(r.beneficios.percentualBeneficio).toBe('25.0000');
      expect(r.beneficios.valorBeneficio).toBe('200.00');
    });

    it('benefícios zerados quando não há redução nem benefício', () => {
      const r = comporBaseDifal(item(), null);
      expect(r.beneficios.percentualReducao).toBe('0.0000');
      expect(r.beneficios.valorReducao).toBe('0.00');
      expect(r.beneficios.percentualBeneficio).toBe('0.0000');
      expect(r.beneficios.valorBeneficio).toBe('0.00');
    });

    it('expõe o imposto já pago a partir do ICMS-ST retido', () => {
      const r = comporBaseDifal(item({ valorIcmsStRetido: '80.00' }), null);
      expect(r.impostoJaPago).toBe('80.00');
    });

    it('usa o ICMS-ST destacado como imposto já pago quando não há retido', () => {
      const r = comporBaseDifal(item({ valorIcmsSt: '55.00' }), null);
      expect(r.impostoJaPago).toBe('55.00');
    });

    it('prefere o ICMS-ST retido ao destacado quando ambos existem', () => {
      const r = comporBaseDifal(
        item({ valorIcmsStRetido: '80.00', valorIcmsSt: '55.00' }),
        null,
      );
      expect(r.impostoJaPago).toBe('80.00');
    });

    it('imposto já pago é zero quando não há ST', () => {
      const r = comporBaseDifal(item(), null);
      expect(r.impostoJaPago).toBe('0.00');
    });
  });

  describe('memória de arredondamento (R1.5)', () => {
    it('documenta cada passo com ordem e detalhe', () => {
      const regra: DifalBaseRegra = {
        percentualReducao: '20.0000',
        basePorDentro: true,
        aliquotaInterna: '18.0000',
        aliquotaFcp: '2.0000',
      };
      const r = comporBaseDifal(item(), regra);
      expect(r.memoriaArredondamento).toContain('base_bruta');
      expect(r.memoriaArredondamento).toContain('reducao_base');
      expect(r.memoriaArredondamento).toContain('base_por_dentro');
      expect(r.memoriaArredondamento).toContain('arredondado');
      // Passos numerados em sequência.
      expect(r.passos[0].ordem).toBe(1);
      expect(r.passos.at(-1)!.ordem).toBe(r.passos.length);
    });
  });

  describe('composição completa (ordem fiscal)', () => {
    it('base bruta → redução → benefício → por dentro, na ordem', () => {
      // 1000 → redução 20% = 800 → benefício 25% = 600 → por dentro /(1−18/100)
      // = 600 / 0.82 = 731.71.
      const regra: DifalBaseRegra = {
        percentualReducao: '20.0000',
        percentualBeneficio: '25.0000',
        basePorDentro: true,
        aliquotaInterna: '18.0000',
      };
      const r = comporBaseDifal(item(), regra);
      expect(r.baseCalculo).toBe('731.71');
    });
  });
});
