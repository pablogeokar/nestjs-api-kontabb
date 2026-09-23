import {
  cfopVedaCreditoIcms,
  decidirCreditoIcms,
  type EntradaDecisaoCredito,
} from './decisao-credito';

describe('decidirCreditoIcms (F05 / R3.1, R3.3)', () => {
  describe('ADMITIDO — CST autoriza crédito', () => {
    it.each(['00', '10', '20', '70'])(
      'admite o ICMS destacado quando CST %s e CFOP não veda',
      (cst) => {
        const resultado = decidirCreditoIcms({
          cfop: '1102',
          cstIcms: cst,
          valorIcms: '12.00',
        });
        expect(resultado.decisao).toBe('ADMITIDO');
        expect(resultado.motivo).toBe('CST_AUTORIZA_CREDITO');
        expect(resultado.valorAdmitido).toBe(1200n);
        expect(resultado.regraVersaoId).toBeNull();
      },
    );

    it('aceita CST com origem prefixada (ex.: 000 → 00)', () => {
      const resultado = decidirCreditoIcms({
        cfop: '2102',
        cstIcms: '000',
        valorIcms: '35.55',
      });
      expect(resultado.decisao).toBe('ADMITIDO');
      expect(resultado.valorAdmitido).toBe(3555n);
    });
  });

  describe('VEDADO por CFOP', () => {
    it.each(['1556', '1557', '2407', '1403', '1405', '1406', '1401', '1551', '2552'])(
      'veda o crédito quando CFOP de entrada %s mesmo com CST autorizado',
      (cfop) => {
        const resultado = decidirCreditoIcms({
          cfop,
          cstIcms: '00',
          valorIcms: '10.00',
        });
        expect(resultado.decisao).toBe('VEDADO');
        expect(resultado.motivo).toBe('CFOP_VEDA_CREDITO');
        expect(resultado.valorAdmitido).toBe(0n);
      },
    );

    it('não veda CFOP de crédito normal (1102)', () => {
      expect(cfopVedaCreditoIcms('1102')).toBe(false);
      expect(cfopVedaCreditoIcms('1556')).toBe(true);
    });

    it('não aplica vedação a CFOP de saída (5xxx)', () => {
      expect(cfopVedaCreditoIcms('5556')).toBe(false);
    });
  });

  describe('VEDADO por regra fiscal (R3.1)', () => {
    it('a regra com apropriaCreditoIcms=false prevalece sobre CST/CFOP válidos', () => {
      const resultado = decidirCreditoIcms({
        cfop: '1102',
        cstIcms: '00',
        valorIcms: '99.99',
        regra: { apropriaCreditoIcms: false, regraVersaoId: 'regra-v3' },
      });
      expect(resultado.decisao).toBe('VEDADO');
      expect(resultado.motivo).toBe('REGRA_VEDA_CREDITO');
      expect(resultado.valorAdmitido).toBe(0n);
      expect(resultado.regraVersaoId).toBe('regra-v3');
    });

    it('regra com apropriaCreditoIcms=true não força crédito além da política documental', () => {
      const resultado = decidirCreditoIcms({
        cfop: '1102',
        cstIcms: '41', // não autorizado
        valorIcms: '10.00',
        regra: { apropriaCreditoIcms: true, regraVersaoId: 'regra-v1' },
      });
      expect(resultado.decisao).toBe('EXIGE_REVISAO');
      expect(resultado.regraVersaoId).toBe('regra-v1');
    });
  });

  describe('EXIGE_REVISAO — CST ambíguo/não autorizado', () => {
    it.each(['40', '41', '50', '60', '90'])(
      'exige revisão quando há destaque mas CST %s não autoriza apropriação',
      (cst) => {
        const resultado = decidirCreditoIcms({
          cfop: '1102',
          cstIcms: cst,
          valorIcms: '10.00',
        });
        expect(resultado.decisao).toBe('EXIGE_REVISAO');
        expect(resultado.motivo).toBe('CST_NAO_AUTORIZADO');
        expect(resultado.valorAdmitido).toBe(0n);
      },
    );

    it('exige revisão quando há destaque de ICMS mas nenhum CST informado', () => {
      const resultado = decidirCreditoIcms({
        cfop: '1102',
        cstIcms: null,
        valorIcms: '10.00',
      });
      expect(resultado.decisao).toBe('EXIGE_REVISAO');
      expect(resultado.motivo).toBe('CST_NAO_AUTORIZADO');
    });
  });

  describe('CSOSN 101/201 (Simples Nacional)', () => {
    it.each(['101', '201'])(
      'admite o crédito SN informado quando CSOSN %s',
      (csosn) => {
        const resultado = decidirCreditoIcms({
          cfop: '1102',
          csosnIcms: csosn,
          valorCreditoIcmsSn: '3.45',
        });
        expect(resultado.decisao).toBe('ADMITIDO');
        expect(resultado.motivo).toBe('CSOSN_PERMITE_CREDITO');
        expect(resultado.valorAdmitido).toBe(345n);
      },
    );

    it.each(['102', '202', '500', '900'])(
      'exige revisão quando há crédito SN mas CSOSN %s não permite',
      (csosn) => {
        const resultado = decidirCreditoIcms({
          cfop: '1102',
          csosnIcms: csosn,
          valorCreditoIcmsSn: '3.45',
        });
        expect(resultado.decisao).toBe('EXIGE_REVISAO');
        expect(resultado.motivo).toBe('CST_NAO_AUTORIZADO');
        expect(resultado.valorAdmitido).toBe(0n);
      },
    );

    it('crédito SN tem precedência sobre o ICMS destacado do regime normal', () => {
      const resultado = decidirCreditoIcms({
        cfop: '1102',
        csosnIcms: '101',
        cstIcms: '00',
        valorCreditoIcmsSn: '2.00',
        valorIcms: '10.00',
      });
      expect(resultado.decisao).toBe('ADMITIDO');
      expect(resultado.motivo).toBe('CSOSN_PERMITE_CREDITO');
      expect(resultado.valorAdmitido).toBe(200n);
    });
  });

  describe('valores zero/ausentes', () => {
    it('sem valor destacado retorna ADMITIDO com valorAdmitido 0', () => {
      const resultado = decidirCreditoIcms({ cfop: '1102', cstIcms: '00' });
      expect(resultado.decisao).toBe('ADMITIDO');
      expect(resultado.motivo).toBe('SEM_VALOR_DESTACADO');
      expect(resultado.valorAdmitido).toBe(0n);
    });

    it('ICMS explicitamente zero é tratado como sem destaque, não como vedação', () => {
      const resultado = decidirCreditoIcms({
        cfop: '1556', // CFOP que vedaria se houvesse destaque
        cstIcms: '00',
        valorIcms: '0.00',
      });
      expect(resultado.decisao).toBe('ADMITIDO');
      expect(resultado.motivo).toBe('SEM_VALOR_DESTACADO');
      expect(resultado.valorAdmitido).toBe(0n);
    });

    it('entrada totalmente vazia não credita nada e não quebra', () => {
      const resultado = decidirCreditoIcms({} as EntradaDecisaoCredito);
      expect(resultado.decisao).toBe('ADMITIDO');
      expect(resultado.motivo).toBe('SEM_VALOR_DESTACADO');
      expect(resultado.valorAdmitido).toBe(0n);
      expect(resultado.regraVersaoId).toBeNull();
    });
  });

  describe('pureza e echo de regraVersaoId', () => {
    it('não muta a entrada e ecoa o regraVersaoId em qualquer decisão', () => {
      const entrada: EntradaDecisaoCredito = {
        cfop: '1556',
        cstIcms: '00',
        valorIcms: '10.00',
        regra: { apropriaCreditoIcms: true, regraVersaoId: 'v42' },
      };
      const snapshot = JSON.stringify(entrada);
      const resultado = decidirCreditoIcms(entrada);
      expect(JSON.stringify(entrada)).toBe(snapshot);
      expect(resultado.decisao).toBe('VEDADO');
      expect(resultado.regraVersaoId).toBe('v42');
    });
  });
});
