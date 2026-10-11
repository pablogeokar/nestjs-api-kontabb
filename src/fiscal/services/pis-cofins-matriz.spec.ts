/**
 * MATRIZ DE RISCO DO PIS/COFINS (Fase 4 / tarefa 3.7 — R2.2–R2.5).
 *
 * O design (§Verificação) e a tarefa 3.7 pedem testes POR MATRIZ DE RISCO (não
 * cartesiano) cobrindo, de ponta a ponta, os cenários que de fato mudam o
 * resultado do PIS/COFINS por natureza de receita: o MIX de receitas, o CST 03
 * (ad rem), o CST 67 (crédito presumido), o SALDO CREDOR preservado/transportado
 * e o REGIME AUSENTE (pendência). Cada cenário amarra as PEÇAS PURAS da fase
 * umas às outras — a classificação do CST (`pis-cofins-cst`), o razão de
 * receitas (`pis-cofins-razao`), o calculador por natureza
 * (`pis-cofins-natureza`) e a apuração de saldo (`pis-cofins-saldo`) — exercendo
 * o fluxo real `CST → razão → natureza → saldo` que os specs unitários cobrem só
 * peça a peça. Espelha `difal-matriz.spec.ts`.
 *
 * Os critérios cobertos:
 *  - R2.2 (receita não coberta → PENDÊNCIA, não zero): o razão materializa a
 *    diferença entre a receita esperada e a coberta pelos lançamentos.
 *  - R2.3 (saldo credor preservado e transportado): o excedente de crédito não é
 *    cortado em zero; vira lançamento `SALDO_ANTERIOR` do período seguinte,
 *    fechando o ciclo entre o saldo e o razão.
 *  - R2.4 (CST 03 / CST 67 por hipótese, sem misturar tipos): o débito do CST 03
 *    é ad rem (quantidade × alíquota-em-reais), NUNCA base × percentual nem
 *    somado ao débito percentual; o crédito do CST 67 é PRESUMIDO e nunca se
 *    mistura ao crédito básico num balde único.
 *  - R2.5 (regime ausente → pendência, não cumulativo presumido): tanto o
 *    calculador puro quanto o serviço devolvem pendência sem valor-guia.
 *
 * DECIMAIS SEMPRE COMO STRING (restrição da fase): toda a aritmética esperada é
 * conferida como string, via `sped-decimal` nas peças; nenhum valor passa por
 * `Number`.
 */

import {
  calcularPisCofinsNatureza,
  type PisCofinsRegra,
} from './pis-cofins-natureza';
import {
  consolidarRazaoReceitas,
  type PisCofinsLancamentoReceita,
} from './pis-cofins-razao';
import { apurarSaldoPisCofins } from './pis-cofins-saldo';
import {
  calcularDebitoAdRem,
  creditosMesmaNatureza,
  resolverHipoteseCst,
} from './pis-cofins-cst';
import { PisCofinsService, resolverRegimeApuracao } from './pis-cofins.service';

// Regra não-cumulativa (Lucro Real): débito 1,65%/7,60% da receita tributada.
function regraDebitoNaoCumulativo(): PisCofinsRegra {
  return {
    regime: 'NAO_CUMULATIVO',
    aliquotaPis: '1.6500',
    aliquotaCofins: '7.6000',
    geraDebito: true,
    geraCredito: false,
  };
}

// Regra de crédito não-cumulativo, parametrizável pela natureza do crédito
// (BÁSICO × PRESUMIDO), para provar que os tipos não se misturam (R2.4).
function regraCredito(naturezaCredito: 'BASICO' | 'PRESUMIDO'): PisCofinsRegra {
  return {
    regime: 'NAO_CUMULATIVO',
    aliquotaPis: '1.6500',
    aliquotaCofins: '7.6000',
    geraDebito: false,
    geraCredito: true,
    naturezaCredito,
  };
}

// Regra de natureza SEM débito próprio (monofásica/ST/alíquota zero): base
// registrada, nenhum valor apurado.
function regraSemDebito(): PisCofinsRegra {
  return {
    regime: 'NAO_CUMULATIVO',
    aliquotaPis: '1.6500',
    aliquotaCofins: '7.6000',
    geraDebito: false,
    geraCredito: false,
  };
}

// DB falso para o serviço (porta de entrada do regime ausente): getCliente
// resolve por .limit; nenhum segmento é consultado quando o regime é ausente.
function createDb(cliente: { regimeTributario: string | null }) {
  return {
    db: {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'c1', ...cliente }]),
          }),
        }),
      })),
    },
  };
}

describe('PIS/COFINS — matriz de risco (Fase 4 / tarefa 3.7 — R2.2–R2.5)', () => {
  // ── Mix de receitas: cada natureza apurada por si; receita não coberta vira
  //    pendência, nunca zero (R2.2) ───────────────────────────────────────────
  describe('mix de receitas por natureza (R2.2)', () => {
    it('razão consolida o mix e cada natureza é apurada conforme seu tratamento', () => {
      // Mix de SAÍDAS numa competência não-cumulativa: tributada (CST 01),
      // monofásica (CST 04, sem débito) e exportação (sem débito, crédito
      // vinculado tratado adiante). O razão separa as bases por natureza; o
      // calculador apura o débito APENAS da tributada.
      const lancamentos: PisCofinsLancamentoReceita[] = [
        {
          fonte: 'XML_NFE',
          tipo: 'RECEITA',
          natureza: 'TRIBUTADA',
          vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
          valor: '10000.00',
        },
        {
          fonte: 'XML_NFE',
          tipo: 'RECEITA',
          natureza: 'MONOFASICA',
          vinculacao: 'MERCADO_INTERNO_NAO_TRIBUTADO',
          valor: '4000.00',
        },
        {
          fonte: 'SEM_NFE',
          tipo: 'RECEITA',
          natureza: 'EXPORTACAO',
          vinculacao: 'EXPORTACAO',
          valor: '6000.00',
        },
      ];
      const razao = consolidarRazaoReceitas({
        competencia: '2026-09',
        lancamentos,
      });
      // Três naturezas distintas, bases separadas (ordem determinística).
      expect(razao.naturezas).toHaveLength(3);
      const porNatureza = Object.fromEntries(
        razao.naturezas.map((n) => [n.natureza, n]),
      );
      expect(porNatureza['TRIBUTADA'].base).toBe('10000.00');
      expect(porNatureza['MONOFASICA'].base).toBe('4000.00');
      expect(porNatureza['EXPORTACAO'].base).toBe('6000.00');

      // Só a TRIBUTADA gera débito (PIS 1,65% de 10.000 = 165,00); as demais
      // registram base sem débito — não são tributadas em duplicidade.
      const debitoTributada = calcularPisCofinsNatureza(
        {
          tributo: 'PIS',
          natureza: 'TRIBUTADA',
          vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
          regime: 'NAO_CUMULATIVO',
          competencia: '2026-09',
          base: porNatureza['TRIBUTADA'].base,
        },
        regraDebitoNaoCumulativo(),
        { aprovada: true },
      );
      expect(debitoTributada.debito).toBe('165.00');

      const monofasica = calcularPisCofinsNatureza(
        {
          tributo: 'PIS',
          natureza: 'MONOFASICA',
          vinculacao: 'MERCADO_INTERNO_NAO_TRIBUTADO',
          regime: 'NAO_CUMULATIVO',
          competencia: '2026-09',
          base: porNatureza['MONOFASICA'].base,
        },
        regraSemDebito(),
        { aprovada: true },
      );
      expect(monofasica.debito).toBe('0.00');
      expect(monofasica.base).toBe('4000.00');
    });

    it('receita esperada acima da coberta pelo mix → pendência explícita (R2.2)', () => {
      // Receita contábil esperada 25.000, mas o mix cobre só 20.000 (10k + 4k +
      // 6k). A diferença de 5.000 APARECE como pendência — não vira zero.
      const razao = consolidarRazaoReceitas({
        competencia: '2026-09',
        receitaEsperada: '25000.00',
        lancamentos: [
          {
            fonte: 'XML_NFE',
            tipo: 'RECEITA',
            natureza: 'TRIBUTADA',
            vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
            valor: '10000.00',
          },
          {
            fonte: 'XML_NFE',
            tipo: 'RECEITA',
            natureza: 'MONOFASICA',
            vinculacao: 'MERCADO_INTERNO_NAO_TRIBUTADO',
            valor: '4000.00',
          },
          {
            fonte: 'SEM_NFE',
            tipo: 'RECEITA',
            natureza: 'EXPORTACAO',
            vinculacao: 'EXPORTACAO',
            valor: '6000.00',
          },
        ],
      });
      expect(razao.pendenciaCobertura).not.toBeNull();
      expect(razao.pendenciaCobertura?.receitaCoberta).toBe('20000.00');
      expect(razao.pendenciaCobertura?.receitaNaoCoberta).toBe('5000.00');
      expect(razao.demonstrativo).toBe(true);
    });
  });

  // ── CST 03 (ad rem) — hipótese distinta, não base × percentual, não misturada
  //    ao débito percentual do mix (R2.4) ────────────────────────────────────
  describe('CST 03 ad rem no mix (R2.4)', () => {
    it('CST 03 resolve para AD_REM e seu débito é quantidade × alíquota-reais', () => {
      const h = resolverHipoteseCst('03');
      expect(h!.metodoCalculo).toBe('AD_REM');
      expect(h!.geraDebito).toBe(true);
      // 1.000 unidades × R$ 0,1210/un (ex.: PIS ad rem) = 121,00.
      const debitoAdRem = calcularDebitoAdRem({
        quantidade: '1000.0000',
        aliquotaReais: '0.1210',
      });
      expect(debitoAdRem).toBe('121.00');
    });

    it('no mix, o débito ad rem do CST 03 soma ao débito percentual do CST 01 SEM confundir aritméticas', () => {
      // CST 01: base 10.000 × 1,65% = 165,00 (percentual).
      const debitoPercentual = calcularPisCofinsNatureza(
        {
          tributo: 'PIS',
          natureza: 'TRIBUTADA',
          vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
          regime: 'NAO_CUMULATIVO',
          competencia: '2026-09',
          base: '10000.00',
        },
        regraDebitoNaoCumulativo(),
        { aprovada: true },
      );
      expect(debitoPercentual.debito).toBe('165.00');

      // CST 03: 2.000 un × R$ 0,1210 = 242,00 (ad rem), calculado por fora da
      // conta percentual — o `Set` de tributados não contemplava isso.
      expect(resolverHipoteseCst('03')!.metodoCalculo).toBe('AD_REM');
      const debitoAdRem = calcularDebitoAdRem({
        quantidade: '2000.0000',
        aliquotaReais: '0.1210',
      });
      expect(debitoAdRem).toBe('242.00');

      // O débito total do período soma as duas hipóteses (165 + 242 = 407,00),
      // cada uma pela sua aritmética — nunca aplicando percentual sobre a
      // quantidade do ad rem nem vice-versa (R2.4).
      const totalScaled =
        BigInt(debitoPercentual.debito.replace('.', '')) +
        BigInt(debitoAdRem.replace('.', ''));
      expect(totalScaled).toBe(40700n); // 407,00 em centavos.
    });
  });

  // ── CST 67 (crédito presumido) — nunca somado ao crédito básico (R2.4) ──────
  describe('CST 67 crédito presumido no mix (R2.4)', () => {
    it('CST 67 resolve para PRESUMIDO, distinto do básico (CST 50)', () => {
      const presumido = resolverHipoteseCst('67')!;
      const basico = resolverHipoteseCst('50')!;
      expect(presumido.naturezaCredito).toBe('PRESUMIDO');
      expect(basico.naturezaCredito).toBe('BASICO');
      expect(
        creditosMesmaNatureza(
          presumido.naturezaCredito,
          basico.naturezaCredito,
        ),
      ).toBe(false);
    });

    it('créditos básico e presumido ficam em baldes separados — não somados num total único', () => {
      // Crédito BÁSICO (CST 50): base 4.000 × 1,65% = 66,00.
      const basico = calcularPisCofinsNatureza(
        {
          tributo: 'PIS',
          natureza: 'OUTRA',
          vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
          regime: 'NAO_CUMULATIVO',
          competencia: '2026-09',
          base: '4000.00',
        },
        regraCredito('BASICO'),
        { aprovada: true },
      );
      expect(basico.naturezaCredito).toBe('BASICO');
      expect(basico.credito).toBe('66.00');

      // Crédito PRESUMIDO (CST 67): base 2.000 × 1,65% = 33,00.
      const presumido = calcularPisCofinsNatureza(
        {
          tributo: 'PIS',
          natureza: 'OUTRA',
          vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
          regime: 'NAO_CUMULATIVO',
          competencia: '2026-09',
          base: '2000.00',
        },
        regraCredito('PRESUMIDO'),
        { aprovada: true },
      );
      expect(presumido.naturezaCredito).toBe('PRESUMIDO');
      expect(presumido.credito).toBe('33.00');

      // A guarda impede misturá-los: baldes separados por natureza. Agregamos
      // cada natureza no SEU balde e nunca num total único (R2.4).
      const baldes = new Map<string, bigint>();
      for (const c of [basico, presumido]) {
        const chave = c.naturezaCredito!;
        baldes.set(
          chave,
          (baldes.get(chave) ?? 0n) + BigInt(c.credito.replace('.', '')),
        );
      }
      expect(baldes.get('BASICO')).toBe(6600n); // 66,00
      expect(baldes.get('PRESUMIDO')).toBe(3300n); // 33,00
      // Dois baldes distintos — não um balde único de 99,00.
      expect(baldes.size).toBe(2);
    });
  });

  // ── Saldo credor preservado e transportado, ponta a ponta: razão → natureza →
  //    saldo → razão do período seguinte (R2.3) ──────────────────────────────
  describe('saldo credor preservado e carregado adiante (R2.3)', () => {
    it('crédito > débito num período → saldo credor transportado vira saldo anterior do próximo', () => {
      // Período 1 (Lucro Real): débito pequeno, crédito grande.
      // Débito: base tributada 2.000 × 1,65% = 33,00.
      const debito = calcularPisCofinsNatureza(
        {
          tributo: 'PIS',
          natureza: 'TRIBUTADA',
          vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
          regime: 'NAO_CUMULATIVO',
          competencia: '2026-09',
          base: '2000.00',
        },
        regraDebitoNaoCumulativo(),
        { aprovada: true },
      );
      expect(debito.debito).toBe('33.00');

      // Crédito básico: base 10.000 × 1,65% = 165,00.
      const credito = calcularPisCofinsNatureza(
        {
          tributo: 'PIS',
          natureza: 'OUTRA',
          vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
          regime: 'NAO_CUMULATIVO',
          competencia: '2026-09',
          base: '10000.00',
        },
        regraCredito('BASICO'),
        { aprovada: true },
      );
      expect(credito.credito).toBe('165.00');

      // Saldo do período 1: crédito (165) supera o débito (33). O excedente
      // (132,00) é PRESERVADO, não cortado em zero.
      const saldoP1 = apurarSaldoPisCofins({
        tributo: 'PIS',
        competencia: '2026-09',
        debito: debito.debito,
        credito: credito.credito,
      });
      expect(saldoP1.saldoARecolher).toBe('0.00');
      expect(saldoP1.saldoCredorATransportar).toBe('132.00');
      expect(saldoP1.temSaldoCredor).toBe(true);
      expect(saldoP1.lancamentoTransporte).not.toBeNull();

      // Período 2: o razão incorpora o transporte como saldo anterior,
      // comprovando o RASTREIO do saldo credor adiante (R2.3).
      const razaoP2 = consolidarRazaoReceitas({
        competencia: '2026-10',
        lancamentos: [
          saldoP1.lancamentoTransporte!,
          {
            fonte: 'XML_NFE',
            tipo: 'RECEITA',
            natureza: 'TRIBUTADA',
            vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
            valor: '5000.00',
          },
        ],
      });
      expect(razaoP2.saldoAnterior).toBe('132.00');

      // E no período 2 o saldo anterior abate o novo débito.
      // Débito P2: 5.000 × 1,65% = 82,50; saldo anterior 132,00 o cobre e ainda
      // sobra 49,50 a transportar (preservação em cadeia).
      const debitoP2 = calcularPisCofinsNatureza(
        {
          tributo: 'PIS',
          natureza: 'TRIBUTADA',
          vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
          regime: 'NAO_CUMULATIVO',
          competencia: '2026-10',
          base: '5000.00',
        },
        regraDebitoNaoCumulativo(),
        { aprovada: true },
      );
      expect(debitoP2.debito).toBe('82.50');

      const saldoP2 = apurarSaldoPisCofins({
        tributo: 'PIS',
        competencia: '2026-10',
        debito: debitoP2.debito,
        credito: '0.00',
        saldoCredorAnterior: razaoP2.saldoAnterior,
      });
      expect(saldoP2.saldoARecolher).toBe('0.00');
      expect(saldoP2.saldoCredorATransportar).toBe('49.50');
    });
  });

  // ── Regime ausente → pendência, não cumulativo presumido (R2.5) ─────────────
  describe('regime ausente → pendência (R2.5)', () => {
    it('calculador puro: regime null → PENDENTE, sem valor como guia', () => {
      const r = calcularPisCofinsNatureza(
        {
          tributo: 'PIS',
          natureza: 'TRIBUTADA',
          vinculacao: 'MERCADO_INTERNO_TRIBUTADO',
          regime: null,
          competencia: '2026-09',
          base: '10000.00',
        },
        regraDebitoNaoCumulativo(),
        { aprovada: true },
      );
      expect(r.status).toBe('PENDENTE');
      expect(r.regime).toBeNull();
      expect(r.debito).toBe('0.00');
      expect(r.pendente).toBe(true);
    });

    it('resolução de regime: ausente → PENDENTE (nunca CUMULATIVO presumido)', () => {
      expect(resolverRegimeApuracao(null)).toBe('PENDENTE');
      expect(resolverRegimeApuracao(null)).not.toBe('CUMULATIVO');
    });

    it('serviço ponta a ponta: regime ausente → PENDENTE, demonstrativo, sem saldo-guia', async () => {
      const service = new PisCofinsService(
        createDb({ regimeTributario: null }) as never,
      );
      const result = await service.apurarCompetencia({
        clienteId: 'c1',
        competencia: '2026-09',
      });
      expect(result.regime_apuracao).toBe('PENDENTE');
      expect(result.regime).toBeNull();
      expect(result.observacao).toContain('ausente');
      expect(result.demonstrativo).toBe(true);
      expect(result.pis.saldo_a_recolher).toBe('0.00');
      expect(result.pis.debito).toBe('0.00');
      expect(result.cofins.saldo_a_recolher).toBe('0.00');
    });
  });
});
