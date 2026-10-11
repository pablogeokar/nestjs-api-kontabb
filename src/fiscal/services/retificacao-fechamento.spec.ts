import type { FechamentoRegistro } from './fiscal-closing.service';
import { FISCAL_CLOSING_MOTOR_VERSAO } from './fiscal-closing.service';
import type { ResultadoApuracaoTotais } from './resultado-apuracao.contract';
import type { FechamentoSnapshots } from './resultado-apuracao.projector';
import {
  RETIFICACAO_PARAM_KEY,
  comReferenciaRetificacao,
  diferencaTotais,
  lerReferenciaRetificacao,
  montarDiferencaRetificacao,
  type RetificacaoReferencia,
} from './retificacao-fechamento';

/** Totais zerados base, para sobrescrever apenas o que o teste exercita. */
function totais(
  overrides: Partial<ResultadoApuracaoTotais> = {},
): ResultadoApuracaoTotais {
  return {
    debitos: '0.00',
    creditos: '0.00',
    saldoCredorAnterior: '0.00',
    ajustesDebitos: '0.00',
    ajustesCreditos: '0.00',
    estornosCreditos: '0.00',
    estornosDebitos: '0.00',
    deducoes: '0.00',
    debitosEspeciais: '0.00',
    saldoApurado: '0.00',
    icmsRecolher: '0.00',
    saldoCredorTransportar: '0.00',
    ...overrides,
  };
}

describe('retificacao-fechamento', () => {
  const REF: RetificacaoReferencia = {
    originalFechamentoId: 'orig-1',
    originalVersao: 1,
    originalHashEntradas: 'a'.repeat(64),
  };

  describe('comReferenciaRetificacao / lerReferenciaRetificacao (R1.5 — aponta o original)', () => {
    it('grava a referência de forma aditiva preservando os parâmetros existentes', () => {
      const params = comReferenciaRetificacao({ perfil: 'A' }, REF);
      expect(params.perfil).toBe('A');
      expect(params[RETIFICACAO_PARAM_KEY]).toEqual({
        originalFechamentoId: 'orig-1',
        originalVersao: 1,
        originalHashEntradas: 'a'.repeat(64),
      });
    });

    it('não muta o objeto de parâmetros original', () => {
      const original = { perfil: 'A' };
      comReferenciaRetificacao(original, REF);
      expect(original).toEqual({ perfil: 'A' });
    });

    it('faz o round-trip grava→lê', () => {
      const params = comReferenciaRetificacao({}, REF);
      expect(lerReferenciaRetificacao(params)).toEqual(REF);
    });

    it('retorna null quando a versão não é retificação (sem a chave)', () => {
      expect(lerReferenciaRetificacao({ perfil: 'A' })).toBeNull();
    });

    it('lança quando a referência existe mas está malformada', () => {
      expect(() =>
        lerReferenciaRetificacao({ [RETIFICACAO_PARAM_KEY]: { foo: 1 } }),
      ).toThrow(/incompleta/i);
      expect(() =>
        lerReferenciaRetificacao({ [RETIFICACAO_PARAM_KEY]: 'x' }),
      ).toThrow(/malformada/i);
    });
  });

  describe('diferencaTotais (R1.5 — expõe a diferença)', () => {
    it('computa delta exato por total com aritmética em centavos (preserva sinal)', () => {
      const diffs = diferencaTotais(
        totais({ debitos: '100.00', creditos: '30.00' }),
        totais({ debitos: '130.00', creditos: '25.50' }),
      );
      const porCodigo = Object.fromEntries(diffs.map((d) => [d.codigo, d]));
      expect(porCodigo.debitos.delta).toBe('30.00');
      expect(porCodigo.debitos.alterado).toBe(true);
      expect(porCodigo.creditos.delta).toBe('-4.50');
      expect(porCodigo.creditos.alterado).toBe(true);
    });

    it('marca como não alterado o total que não muda (delta 0.00)', () => {
      const diffs = diferencaTotais(
        totais({ debitos: '100.00' }),
        totais({ debitos: '100.00' }),
      );
      const debitos = diffs.find((d) => d.codigo === 'debitos')!;
      expect(debitos.alterado).toBe(false);
      expect(debitos.delta).toBe('0.00');
    });

    it('cobre TODOS os totais do contrato', () => {
      const diffs = diferencaTotais(totais(), totais());
      expect(diffs).toHaveLength(Object.keys(totais()).length);
    });

    it('rejeita valor que não é string decimal de duas casas', () => {
      expect(() =>
        diferencaTotais(totais(), totais({ debitos: '100' })),
      ).toThrow(/formato decimal inesperado/i);
    });
  });

  describe('montarDiferencaRetificacao (R1.5 — aponta original + diferença + seam do recibo)', () => {
    function registro(
      overrides: Partial<FechamentoRegistro>,
    ): FechamentoRegistro {
      return {
        id: 'f',
        clienteId: 'c1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09-01',
        versao: 1,
        estado: 'FECHADO',
        corrente: true,
        motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
        hashEntradas: 'a'.repeat(64),
        aprovadoPor: 'u1',
        fechadoEm: new Date('2026-10-01T00:00:00Z'),
        ...overrides,
      };
    }

    function snapshots(saldos: Record<string, unknown>): FechamentoSnapshots {
      return { documentos: [], saldos, parametros: {} };
    }

    it('aponta o original, expõe a diferença e deixa o recibo como seam da Fase 5', () => {
      const resultado = montarDiferencaRetificacao({
        original: registro({ id: 'orig', versao: 1, hashEntradas: 'a'.repeat(64) }),
        originalSnapshots: snapshots({ debitos: '100.00' }),
        retificadora: registro({
          id: 'retif',
          versao: 2,
          hashEntradas: 'b'.repeat(64),
          corrente: false,
        }),
        retificadoraSnapshots: snapshots({ debitos: '150.00' }),
      });

      // Aponta o original.
      expect(resultado.original.fechamentoId).toBe('orig');
      expect(resultado.original.versao).toBe(1);
      expect(resultado.retificadora.fechamentoId).toBe('retif');
      expect(resultado.retificadora.versao).toBe(2);

      // Expõe a diferença.
      const debitos = resultado.diferencas.find((d) => d.codigo === 'debitos')!;
      expect(debitos.delta).toBe('50.00');
      expect(resultado.houveAlteracao).toBe(true);

      // Seam do recibo (Fase 5): vinculado ao hash da retificadora, recibo null.
      expect(resultado.recibo.hashVinculado).toBe('b'.repeat(64));
      expect(resultado.recibo.recibo).toBeNull();
    });

    it('houveAlteracao=false quando nada muda entre as versões', () => {
      const resultado = montarDiferencaRetificacao({
        original: registro({ id: 'orig' }),
        originalSnapshots: snapshots({ debitos: '100.00' }),
        retificadora: registro({ id: 'retif', versao: 2 }),
        retificadoraSnapshots: snapshots({ debitos: '100.00' }),
      });
      expect(resultado.houveAlteracao).toBe(false);
    });
  });
});
