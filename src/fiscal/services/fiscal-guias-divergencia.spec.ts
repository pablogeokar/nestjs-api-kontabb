import {
  TOLERANCIA_DIVERGENCIA_GUIA,
  compararGuiaComObrigacao,
  obrigacaoDoFechamento,
} from './fiscal-guias-divergencia';
import type { ResultadoApuracaoTotais } from './resultado-apuracao.contract';
import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';

/**
 * Tarefa 1.3 / R1.2 — "QUANDO uma guia diverge da obrigação apurada, o sistema
 * DEVE sinalizá-la." Testes do NÚCLEO PURO da sinalização (sem banco): dado o
 * total da guia e o total da obrigação apurada, `compararGuiaComObrigacao`
 * decide se há divergência; `obrigacaoDoFechamento` extrai o total da obrigação
 * do snapshot congelado reusando a projeção do contrato.
 */

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

describe('compararGuiaComObrigacao — sinalização de divergência (R1.2)', () => {
  it('guia IGUAL à obrigação não é divergente (diferença zero)', () => {
    const sinal = compararGuiaComObrigacao('100.00', '100.00');
    expect(sinal.divergente).toBe(false);
    expect(sinal.diferenca).toBe('0.00');
    expect(sinal.valorGuia).toBe('100.00');
    expect(sinal.valorObrigacao).toBe('100.00');
  });

  it('guia ACIMA da obrigação é SINALIZADA (diferença positiva)', () => {
    const sinal = compararGuiaComObrigacao('150.00', '100.00');
    expect(sinal.divergente).toBe(true);
    expect(sinal.diferenca).toBe('50.00');
  });

  it('guia ABAIXO da obrigação é SINALIZADA (diferença negativa)', () => {
    const sinal = compararGuiaComObrigacao('80.00', '100.00');
    expect(sinal.divergente).toBe(true);
    expect(sinal.diferenca).toBe('-20.00');
  });

  it('diferença de centavo DENTRO da tolerância não é divergência (arredondamento)', () => {
    // 100.02 − 100.00 = 0.02 == tolerância: não sinaliza.
    const sinal = compararGuiaComObrigacao('100.02', '100.00');
    expect(sinal.divergente).toBe(false);
    expect(sinal.diferenca).toBe('0.02');
  });

  it('diferença ACIMA da tolerância sinaliza (0.03 > 0.02)', () => {
    const sinal = compararGuiaComObrigacao('100.03', '100.00');
    expect(sinal.divergente).toBe(true);
    expect(sinal.diferenca).toBe('0.03');
  });

  it('obrigação ZERO com guia positiva é SINALIZADA (guia sem obrigação a pagar)', () => {
    const sinal = compararGuiaComObrigacao('10.00', '0.00');
    expect(sinal.divergente).toBe(true);
    expect(sinal.diferenca).toBe('10.00');
  });
});

describe('obrigacaoDoFechamento — total da obrigação do snapshot (R1.2)', () => {
  it('prioriza icmsRecolher como total da obrigação devedora', () => {
    const saldo = obrigacaoDoFechamento(
      totais({ icmsRecolher: '123.45', saldoApurado: '999.99' }),
    );
    expect(saldo.valor).toBe('123.45');
    expect(saldo.possuiSaldoDevedor).toBe(true);
    // Nunca é uma guia automática: a emissão é passo separado (R2.5).
    expect(saldo.guiaAutomatica).toBe(false);
  });

  it('recai sobre saldoApurado positivo quando icmsRecolher é zero', () => {
    const saldo = obrigacaoDoFechamento(
      totais({ icmsRecolher: '0.00', saldoApurado: '77.00' }),
    );
    expect(saldo.valor).toBe('77.00');
    expect(saldo.possuiSaldoDevedor).toBe(true);
  });

  it('saldo credor (apurado negativo) não é obrigação devedora: zero', () => {
    const saldo = obrigacaoDoFechamento(
      totais({ icmsRecolher: '0.00', saldoApurado: '-50.00' }),
    );
    expect(saldo.valor).toBe('0.00');
    expect(saldo.possuiSaldoDevedor).toBe(false);
  });
});

/**
 * Property-based (gerador por amostragem determinística, sem lib externa — o
 * projeto não declara fast-check). A PROPRIEDADE universal: para quaisquer
 * valores, `divergente` é verdadeiro SE E SOMENTE SE a diferença absoluta
 * excede a tolerância; e o sinal da `diferenca` segue `guia − obrigação`. Isso
 * cobre toda a faixa de entrada, não só os exemplos acima.
 */
describe('compararGuiaComObrigacao — propriedade: divergência ⇔ |g−o| > tolerância (R1.2)', () => {
  const tolerancia = toScaledInteger(TOLERANCIA_DIVERGENCIA_GUIA);

  // Amostra determinística de pares (guia, obrigação) em centavos, cobrindo:
  // iguais, dentro/na/fora da tolerância, guia>obrigação, guia<obrigação,
  // obrigação zero, valores grandes.
  const amostras: Array<[bigint, bigint]> = [];
  const pontos = [0n, 1n, 2n, 3n, 5n, 99n, 100n, 10000n, 123456n];
  for (const g of pontos) {
    for (const o of pontos) {
      amostras.push([g, o]);
      amostras.push([o, g]);
    }
  }
  // Pares justos em torno da tolerância, para fechar as bordas.
  for (const base of [0n, 100n, 50000n]) {
    for (const delta of [0n, 1n, 2n, 3n]) {
      amostras.push([base + delta, base]);
      amostras.push([base, base + delta]);
    }
  }

  it.each(amostras)(
    'g=%s o=%s (centavos) respeita a propriedade',
    (guiaCents, obrigacaoCents) => {
      const guia = fromScaledInteger(guiaCents);
      const obrigacao = fromScaledInteger(obrigacaoCents);
      const sinal = compararGuiaComObrigacao(guia, obrigacao);

      const diff = guiaCents - obrigacaoCents;
      const abs = diff < 0n ? -diff : diff;
      const esperaDivergente = abs > tolerancia;

      expect(sinal.divergente).toBe(esperaDivergente);
      expect(sinal.diferenca).toBe(fromScaledInteger(diff));
      expect(sinal.valorGuia).toBe(fromScaledInteger(guiaCents));
      expect(sinal.valorObrigacao).toBe(fromScaledInteger(obrigacaoCents));
    },
  );
});
