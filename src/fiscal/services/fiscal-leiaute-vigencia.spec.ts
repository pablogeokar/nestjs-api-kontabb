import {
  anoDaCompetencia,
  confirmarVersaoPva,
  leiauteDaVigencia,
  LeiauteVigenciaError,
  resolverLeiautePorVigencia,
} from './fiscal-leiaute-vigencia';

/**
 * Testes do núcleo PURO do leiaute por VIGÊNCIA e da confirmação do PVA
 * (Fase 5, tarefa 2.4 / R2.5 — N03/N04 e N05). São determinísticos e sem banco:
 *  - 2026 → leiaute 3.2.2; 2027 (em diante) → 3.2.3, por VIGÊNCIA da competência;
 *  - leiaute informado que não casa a vigência é REJEITADO (sem reutilização
 *    silenciosa do leiaute de outra vigência);
 *  - a versão do PVA só é aceita quando CONFIRMADA explicitamente (nunca
 *    presumida como "a última").
 */

describe('leiauteDaVigencia — 2026 vs. 2027 por vigência da competência (R2.5/N03/N04)', () => {
  it('competência de 2026 resolve o leiaute 3.2.2', () => {
    expect(leiauteDaVigencia('2026-01')).toBe('3.2.2');
    expect(leiauteDaVigencia('2026-08')).toBe('3.2.2');
    expect(leiauteDaVigencia('2026-12')).toBe('3.2.2');
    // Também aceita 'YYYY-MM-DD' (coluna date do Postgres).
    expect(leiauteDaVigencia('2026-08-01')).toBe('3.2.2');
  });

  it('competência de 2027 (em diante) resolve o leiaute 3.2.3', () => {
    expect(leiauteDaVigencia('2027-01')).toBe('3.2.3');
    expect(leiauteDaVigencia('2027-12')).toBe('3.2.3');
    expect(leiauteDaVigencia('2028-05')).toBe('3.2.3');
    expect(leiauteDaVigencia('2030-01-01')).toBe('3.2.3');
  });

  it('competência anterior à vigência coberta é rejeitada (sem reutilizar o mais antigo)', () => {
    expect(() => leiauteDaVigencia('2025-12')).toThrow(LeiauteVigenciaError);
    expect(() => leiauteDaVigencia('2025-12')).toThrow('Não há leiaute definido');
  });

  it('competência malformada é rejeitada', () => {
    expect(() => leiauteDaVigencia('2026/08')).toThrow(LeiauteVigenciaError);
    expect(() => leiauteDaVigencia('abc')).toThrow('Competência inválida');
    expect(() => leiauteDaVigencia('2026-13')).toThrow(LeiauteVigenciaError);
  });
});

describe('resolverLeiautePorVigencia — deriva quando omitido, valida quando informado (R2.5)', () => {
  it('deriva o leiaute da vigência quando nenhum é informado', () => {
    expect(resolverLeiautePorVigencia('2026-08')).toBe('3.2.2');
    expect(resolverLeiautePorVigencia('2027-03')).toBe('3.2.3');
    expect(resolverLeiautePorVigencia('2026-08', null)).toBe('3.2.2');
    expect(resolverLeiautePorVigencia('2026-08', '')).toBe('3.2.2');
    expect(resolverLeiautePorVigencia('2026-08', '   ')).toBe('3.2.2');
  });

  it('aceita o leiaute informado quando casa a vigência', () => {
    expect(resolverLeiautePorVigencia('2026-08', '3.2.2')).toBe('3.2.2');
    expect(resolverLeiautePorVigencia('2027-03', '3.2.3')).toBe('3.2.3');
    // Tolera espaços em volta do valor informado.
    expect(resolverLeiautePorVigencia('2026-08', ' 3.2.2 ')).toBe('3.2.2');
  });

  it('REJEITA o leiaute de outra vigência (sem reutilização silenciosa)', () => {
    // 3.2.2 (vigência 2026) numa competência de 2027: exatamente a reutilização
    // silenciosa que o requisito proíbe.
    expect(() => resolverLeiautePorVigencia('2027-03', '3.2.2')).toThrow(
      LeiauteVigenciaError,
    );
    expect(() => resolverLeiautePorVigencia('2027-03', '3.2.2')).toThrow(
      'não corresponde à vigência',
    );
    // 3.2.3 (vigência 2027) numa competência de 2026.
    expect(() => resolverLeiautePorVigencia('2026-08', '3.2.3')).toThrow(
      'não corresponde à vigência',
    );
  });

  it('rejeita um leiaute fora do domínio conhecido', () => {
    expect(() => resolverLeiautePorVigencia('2026-08', '2026')).toThrow(
      'desconhecida',
    );
    expect(() => resolverLeiautePorVigencia('2026-08', '9.9.9')).toThrow(
      LeiauteVigenciaError,
    );
  });
});

describe('confirmarVersaoPva — versão confirmada explicitamente (N05)', () => {
  it('aceita quando a confirmação casa a versão informada', () => {
    expect(
      confirmarVersaoPva({ pvaVersao: '6.1.1', pvaVersaoConfirmada: '6.1.1' }),
    ).toBe('6.1.1');
    // Tolera espaços em volta.
    expect(
      confirmarVersaoPva({ pvaVersao: ' 6.1.1 ', pvaVersaoConfirmada: '6.1.1' }),
    ).toBe('6.1.1');
  });

  it('REJEITA quando a versão não foi confirmada (não presume "a última")', () => {
    expect(() => confirmarVersaoPva({ pvaVersao: '6.1.1' })).toThrow(
      LeiauteVigenciaError,
    );
    expect(() => confirmarVersaoPva({ pvaVersao: '6.1.1' })).toThrow(
      'confirmada explicitamente',
    );
    expect(() =>
      confirmarVersaoPva({ pvaVersao: '6.1.1', pvaVersaoConfirmada: '' }),
    ).toThrow('confirmada explicitamente');
  });

  it('REJEITA quando a confirmação não casa a versão informada', () => {
    expect(() =>
      confirmarVersaoPva({ pvaVersao: '6.1.1', pvaVersaoConfirmada: '6.1.0' }),
    ).toThrow('não corresponde à versão informada');
  });

  it('rejeita versão em branco (nada a confirmar)', () => {
    expect(() =>
      confirmarVersaoPva({ pvaVersao: '', pvaVersaoConfirmada: '6.1.1' }),
    ).toThrow('obrigatória');
  });
});

/**
 * Property-based (gerador por amostragem determinística, sem lib externa — o
 * projeto não declara fast-check). PROPRIEDADE universal (R2.5): para qualquer
 * ano de competência coberto, `leiauteDaVigencia` resolve 3.2.2 sse o ano é
 * 2026 e 3.2.3 sse o ano é >= 2027; e `resolverLeiautePorVigencia` aceita o
 * leiaute informado SE E SOMENTE SE ele é igual ao derivado da vigência.
 */
describe('propriedade: leiaute ⇔ vigência; informado aceito ⇔ casa o derivado (R2.5)', () => {
  const anos = [2026, 2027, 2028, 2030, 2040];
  const meses = ['01', '06', '12'];
  const leiautes = ['3.2.2', '3.2.3'];

  const amostras: Array<[string, string]> = [];
  for (const ano of anos) {
    for (const mes of meses) {
      for (const leiaute of leiautes) {
        amostras.push([`${ano}-${mes}`, leiaute]);
      }
    }
  }

  it.each(amostras)(
    'competência %s com leiaute informado %s respeita a propriedade',
    (competencia, leiauteInformado) => {
      const ano = anoDaCompetencia(competencia);
      const derivado = ano >= 2027 ? '3.2.3' : '3.2.2';

      // Derivação pura segue a vigência.
      expect(leiauteDaVigencia(competencia)).toBe(derivado);
      // Omisso → sempre o derivado.
      expect(resolverLeiautePorVigencia(competencia)).toBe(derivado);

      // Informado é aceito SSE casa o derivado; caso contrário é rejeitado.
      if (leiauteInformado === derivado) {
        expect(resolverLeiautePorVigencia(competencia, leiauteInformado)).toBe(
          derivado,
        );
      } else {
        expect(() =>
          resolverLeiautePorVigencia(competencia, leiauteInformado),
        ).toThrow(LeiauteVigenciaError);
      }
    },
  );
});
