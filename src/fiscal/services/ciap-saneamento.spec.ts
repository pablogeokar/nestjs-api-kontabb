import {
  classificarFichaSaneamento,
  montarDiagnosticoSaneamentoCiap,
  type DiagnosticoSaneamentoCiapFatos,
  type FichaCiapSaneamentoFatos,
} from './ciap-saneamento';

/**
 * Testes do NÚCLEO PURO do saneamento assistido do CIAP (Fase 5, tarefa 5.4 —
 * R5.4).
 *
 * O design (§Rollout §13) proíbe reconstruir competência CIAP a partir de
 * contador acumulado e exige tratar casos ambíguos como saneamento assistido.
 * Os testes cobrem as posturas exigidas:
 *  1. ficha com contador porém SEM razão por competência → AMBÍGUA (nunca
 *     reconstruída a partir do contador);
 *  2. ficha com contador DIVERGENTE da razão conhecida / numeração incoerente →
 *     AMBÍGUA;
 *  3. ficha com razão por competência CONSISTENTE com o contador → OK;
 *  4. a garantia `reconstruidoPorContador` é SEMPRE `false`.
 */

function ficha(
  overrides: Partial<FichaCiapSaneamentoFatos> = {},
): FichaCiapSaneamentoFatos {
  return {
    bemId: 'b1',
    codigoBem: 'BEM-001',
    identificacaoBem: 'Torno CNC',
    status: 'ATIVO',
    origemIdentidade: 'aquisicao',
    saneamentoPendente: false,
    quantidadeParcelas: 48,
    contadorParcelasApropriadas: 0,
    apropriacoesConhecidas: [],
    ...overrides,
  };
}

describe('classificarFichaSaneamento — ficha consistente (OK)', () => {
  it('contador zero e sem apropriações é OK (ficha recém-registrada)', () => {
    const r = classificarFichaSaneamento(ficha());
    expect(r.classificacao).toBe('OK');
    expect(r.motivos).toEqual([]);
    expect(r.reconstruidoPorContador).toBe(false);
    expect(r.memoria).toContain('CONSISTENTE');
  });

  it('contador coincide com a razão conhecida (números 1..N) é OK', () => {
    const r = classificarFichaSaneamento(
      ficha({
        contadorParcelasApropriadas: 3,
        apropriacoesConhecidas: [
          { competencia: '2026-01', numeroParcela: 1 },
          { competencia: '2026-02', numeroParcela: 2 },
          { competencia: '2026-03', numeroParcela: 3 },
        ],
      }),
    );
    expect(r.classificacao).toBe('OK');
    expect(r.competenciasConhecidas).toBe(3);
    expect(r.contadorParcelasApropriadas).toBe(3);
    expect(r.reconstruidoPorContador).toBe(false);
  });
});

describe('classificarFichaSaneamento — contador sem razão (R5.4: não reconstruir)', () => {
  it('contador > 0 e NENHUMA apropriação por competência → AMBÍGUA, nunca reconstruída', () => {
    const r = classificarFichaSaneamento(
      ficha({
        contadorParcelasApropriadas: 12,
        apropriacoesConhecidas: [],
      }),
    );
    expect(r.classificacao).toBe('AMBIGUO_SANEAMENTO_ASSISTIDO');
    expect(r.motivos).toContain('CONTADOR_SEM_RAZAO');
    // Garantia central: as 12 competências do contador NÃO são fabricadas.
    expect(r.competenciasConhecidas).toBe(0);
    expect(r.reconstruidoPorContador).toBe(false);
    expect(r.memoria).toContain('NÃO');
    expect(r.memoria).toContain('reconstruídas');
  });
});

describe('classificarFichaSaneamento — contador divergente / numeração incoerente', () => {
  it('contador maior que o nº de competências conhecidas → AMBÍGUA (razão incompleta)', () => {
    const r = classificarFichaSaneamento(
      ficha({
        contadorParcelasApropriadas: 5,
        apropriacoesConhecidas: [
          { competencia: '2026-01', numeroParcela: 1 },
          { competencia: '2026-02', numeroParcela: 2 },
        ],
      }),
    );
    expect(r.classificacao).toBe('AMBIGUO_SANEAMENTO_ASSISTIDO');
    expect(r.motivos).toContain('CONTADOR_DIVERGE_DA_RAZAO');
    expect(r.reconstruidoPorContador).toBe(false);
  });

  it('mais competências conhecidas que o contador → AMBÍGUA', () => {
    const r = classificarFichaSaneamento(
      ficha({
        contadorParcelasApropriadas: 1,
        apropriacoesConhecidas: [
          { competencia: '2026-01', numeroParcela: 1 },
          { competencia: '2026-02', numeroParcela: 2 },
        ],
      }),
    );
    expect(r.classificacao).toBe('AMBIGUO_SANEAMENTO_ASSISTIDO');
    expect(r.motivos).toContain('CONTADOR_DIVERGE_DA_RAZAO');
  });

  it('número de parcela duplicado → AMBÍGUA (numeração inconsistente)', () => {
    const r = classificarFichaSaneamento(
      ficha({
        contadorParcelasApropriadas: 2,
        apropriacoesConhecidas: [
          { competencia: '2026-01', numeroParcela: 1 },
          { competencia: '2026-02', numeroParcela: 1 },
        ],
      }),
    );
    expect(r.classificacao).toBe('AMBIGUO_SANEAMENTO_ASSISTIDO');
    expect(r.motivos).toContain('NUMERACAO_PARCELA_INCONSISTENTE');
  });

  it('número de parcela fora da faixa 1..quantidadeParcelas → AMBÍGUA', () => {
    const r = classificarFichaSaneamento(
      ficha({
        quantidadeParcelas: 48,
        contadorParcelasApropriadas: 1,
        apropriacoesConhecidas: [{ competencia: '2026-01', numeroParcela: 49 }],
      }),
    );
    expect(r.classificacao).toBe('AMBIGUO_SANEAMENTO_ASSISTIDO');
    expect(r.motivos).toContain('NUMERACAO_PARCELA_INCONSISTENTE');
  });

  it('maior parcela não coincide com o contador (mesma cardinalidade) → AMBÍGUA', () => {
    const r = classificarFichaSaneamento(
      ficha({
        contadorParcelasApropriadas: 3,
        apropriacoesConhecidas: [
          { competencia: '2026-01', numeroParcela: 1 },
          { competencia: '2026-02', numeroParcela: 2 },
          { competencia: '2026-05', numeroParcela: 7 },
        ],
      }),
    );
    expect(r.classificacao).toBe('AMBIGUO_SANEAMENTO_ASSISTIDO');
    expect(r.motivos).toContain('NUMERACAO_PARCELA_INCONSISTENTE');
  });
});

describe('classificarFichaSaneamento — flag e identidade', () => {
  it('respeita saneamentoPendente já marcado pela migração de identidade', () => {
    const r = classificarFichaSaneamento(
      ficha({
        saneamentoPendente: true,
        contadorParcelasApropriadas: 1,
        apropriacoesConhecidas: [{ competencia: '2026-01', numeroParcela: 1 }],
      }),
    );
    expect(r.classificacao).toBe('AMBIGUO_SANEAMENTO_ASSISTIDO');
    expect(r.motivos).toContain('FLAG_SANEAMENTO_PENDENTE');
  });

  it('identidade não comprovada (reconstruido_nao_comprovado) → AMBÍGUA', () => {
    const r = classificarFichaSaneamento(
      ficha({ origemIdentidade: 'reconstruido_nao_comprovado' }),
    );
    expect(r.classificacao).toBe('AMBIGUO_SANEAMENTO_ASSISTIDO');
    expect(r.motivos).toContain('IDENTIDADE_NAO_COMPROVADA');
  });

  it('identidade sku_legado (ainda não migrada) também é não comprovada', () => {
    const r = classificarFichaSaneamento(
      ficha({ origemIdentidade: 'sku_legado' }),
    );
    expect(r.classificacao).toBe('AMBIGUO_SANEAMENTO_ASSISTIDO');
    expect(r.motivos).toContain('IDENTIDADE_NAO_COMPROVADA');
  });
});

describe('classificarFichaSaneamento — determinismo', () => {
  it('os mesmos fatos produzem a mesma classificação', () => {
    const base = ficha({
      contadorParcelasApropriadas: 2,
      apropriacoesConhecidas: [
        { competencia: '2026-01', numeroParcela: 1 },
        { competencia: '2026-02', numeroParcela: 2 },
      ],
    });
    expect(classificarFichaSaneamento(base)).toEqual(
      classificarFichaSaneamento(base),
    );
  });

  it('motivos saem em ordem estável, independentemente da ordem de detecção', () => {
    const r = classificarFichaSaneamento(
      ficha({
        saneamentoPendente: true,
        origemIdentidade: 'reconstruido_nao_comprovado',
        contadorParcelasApropriadas: 5,
        apropriacoesConhecidas: [],
      }),
    );
    expect(r.motivos).toEqual([
      'FLAG_SANEAMENTO_PENDENTE',
      'IDENTIDADE_NAO_COMPROVADA',
      'CONTADOR_SEM_RAZAO',
    ]);
  });
});

describe('montarDiagnosticoSaneamentoCiap — agregação read-only', () => {
  function fatos(): DiagnosticoSaneamentoCiapFatos {
    return {
      clienteId: 'c1',
      geradoEm: '2026-08-01T00:00:00.000Z',
      fichas: [
        // OK: contador consistente com a razão.
        ficha({
          bemId: 'b-ok',
          codigoBem: 'BEM-OK',
          contadorParcelasApropriadas: 2,
          apropriacoesConhecidas: [
            { competencia: '2026-01', numeroParcela: 1 },
            { competencia: '2026-02', numeroParcela: 2 },
          ],
        }),
        // Ambígua: só contador, sem razão.
        ficha({
          bemId: 'b-contador',
          codigoBem: 'BEM-CONTADOR',
          contadorParcelasApropriadas: 10,
          apropriacoesConhecidas: [],
        }),
        // Ambígua: flag de saneamento.
        ficha({
          bemId: 'b-flag',
          codigoBem: 'BEM-FLAG',
          saneamentoPendente: true,
        }),
      ],
    };
  }

  it('separa fichas OK das que exigem saneamento assistido e conta por motivo', () => {
    const diag = montarDiagnosticoSaneamentoCiap(fatos());

    expect(diag.resumo.totalFichas).toBe(3);
    expect(diag.resumo.fichasOk).toBe(1);
    expect(diag.resumo.fichasAmbiguas).toBe(2);
    expect(diag.resumo.porMotivo.CONTADOR_SEM_RAZAO).toBe(1);
    expect(diag.resumo.porMotivo.FLAG_SANEAMENTO_PENDENTE).toBe(1);
    // Garantia no nível do diagnóstico inteiro: nada reconstruído por contador.
    expect(diag.resumo.reconstruiuPorContador).toBe(false);
    expect(diag.fichas.every((f) => f.reconstruidoPorContador === false)).toBe(
      true,
    );
  });

  it('ordena as fichas de forma estável por código do bem', () => {
    const diag = montarDiagnosticoSaneamentoCiap(fatos());
    expect(diag.fichas.map((f) => f.codigoBem)).toEqual([
      'BEM-CONTADOR',
      'BEM-FLAG',
      'BEM-OK',
    ]);
  });

  it('é determinístico', () => {
    expect(montarDiagnosticoSaneamentoCiap(fatos())).toEqual(
      montarDiagnosticoSaneamentoCiap(fatos()),
    );
  });
});
