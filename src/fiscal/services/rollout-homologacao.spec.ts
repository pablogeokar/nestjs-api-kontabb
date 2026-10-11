import {
  avaliarHomologacao,
  montarPlanoRollout,
  type CenarioHomologacao,
  type CriteriosHomologacao,
} from './rollout-homologacao';

/**
 * Testes do NÚCLEO PURO dos critérios de "homologado" e da expansão de rollout
 * (Fase 5, tarefa 5.2 — R5.1).
 *
 * R5.1 é conjuntivo: um cenário só é homologado quando TODOS os critérios
 * aplicáveis estão satisfeitos. Os testes cobrem: todos os critérios atendidos →
 * homologado; qualquer critério ausente → não homologado com o faltante listado;
 * o critério de integração de persistência como CONDICIONAL ("quando
 * aplicável"); e a progressão amostra pequena → expansão por UF/perfil/regime,
 * sempre e somente sobre cenários homologados.
 */

/** Critérios TODOS satisfeitos (base para derivar faltas pontuais). */
function criteriosOk(
  overrides: Partial<CriteriosHomologacao> = {},
): CriteriosHomologacao {
  return {
    regraFonteVigente: true,
    testeUnitario: true,
    persistenciaAplicavel: true,
    integracaoPersistencia: true,
    livroConciliado: true,
    txtValidadoPva: true,
    revisaoFiscalRegistrada: true,
    ...overrides,
  };
}

function cenario(
  overrides: Partial<CenarioHomologacao> = {},
): CenarioHomologacao {
  return {
    id: 't01',
    coorte: { uf: 'SP', perfil: 'A', regime: 'PRESUMIDO' },
    criterios: criteriosOk(),
    ...overrides,
  };
}

describe('avaliarHomologacao — todos os critérios atendidos', () => {
  it('homologa quando os seis critérios aplicáveis estão satisfeitos', () => {
    const aval = avaliarHomologacao(cenario());
    expect(aval.homologado).toBe(true);
    expect(aval.faltantes).toEqual([]);
    expect(aval.memoria).toContain('Homologado');
  });

  it('homologa sem persistência quando ela não é aplicável', () => {
    // persistenciaAplicavel=false e SEM integração: ainda homologa, pois o
    // critério condicional não é exigido ("quando aplicável").
    const aval = avaliarHomologacao(
      cenario({
        criterios: criteriosOk({
          persistenciaAplicavel: false,
          integracaoPersistencia: false,
        }),
      }),
    );
    expect(aval.homologado).toBe(true);
    expect(aval.faltantes).toEqual([]);
    expect(aval.persistenciaAplicavel).toBe(false);
    expect(aval.memoria).toContain('não aplicável');
  });
});

describe('avaliarHomologacao — critério ausente → não homologado com faltante', () => {
  it('lista cada critério sempre-exigido quando ausente', () => {
    const faltaRegra = avaliarHomologacao(
      cenario({ criterios: criteriosOk({ regraFonteVigente: false }) }),
    );
    expect(faltaRegra.homologado).toBe(false);
    expect(faltaRegra.faltantes).toEqual(['REGRA_FONTE_VIGENTE']);

    const faltaTeste = avaliarHomologacao(
      cenario({ criterios: criteriosOk({ testeUnitario: false }) }),
    );
    expect(faltaTeste.faltantes).toEqual(['TESTE_UNITARIO']);

    const faltaLivro = avaliarHomologacao(
      cenario({ criterios: criteriosOk({ livroConciliado: false }) }),
    );
    expect(faltaLivro.faltantes).toEqual(['LIVRO_CONCILIADO']);

    const faltaPva = avaliarHomologacao(
      cenario({ criterios: criteriosOk({ txtValidadoPva: false }) }),
    );
    expect(faltaPva.faltantes).toEqual(['TXT_VALIDADO_PVA']);

    const faltaRevisao = avaliarHomologacao(
      cenario({ criterios: criteriosOk({ revisaoFiscalRegistrada: false }) }),
    );
    expect(faltaRevisao.faltantes).toEqual(['REVISAO_FISCAL_REGISTRADA']);
  });

  it('lista múltiplos faltantes em ordem estável de critério', () => {
    const aval = avaliarHomologacao(
      cenario({
        criterios: criteriosOk({
          regraFonteVigente: false,
          livroConciliado: false,
          revisaoFiscalRegistrada: false,
        }),
      }),
    );
    expect(aval.homologado).toBe(false);
    expect(aval.faltantes).toEqual([
      'REGRA_FONTE_VIGENTE',
      'LIVRO_CONCILIADO',
      'REVISAO_FISCAL_REGISTRADA',
    ]);
  });
});

describe('avaliarHomologacao — integração de persistência é CONDICIONAL (R5.1)', () => {
  it('exige integração quando persistência é aplicável e falta → faltante', () => {
    const aval = avaliarHomologacao(
      cenario({
        criterios: criteriosOk({
          persistenciaAplicavel: true,
          integracaoPersistencia: false,
        }),
      }),
    );
    expect(aval.homologado).toBe(false);
    expect(aval.faltantes).toEqual(['INTEGRACAO_PERSISTENCIA']);
  });

  it('NÃO exige integração quando persistência não é aplicável', () => {
    // Mesmo com integracaoPersistencia=false, não entra em faltantes.
    const aval = avaliarHomologacao(
      cenario({
        criterios: criteriosOk({
          persistenciaAplicavel: false,
          integracaoPersistencia: false,
        }),
      }),
    );
    expect(aval.faltantes).not.toContain('INTEGRACAO_PERSISTENCIA');
    expect(aval.homologado).toBe(true);
  });
});

describe('montarPlanoRollout — amostra pequena → expansão por UF/perfil/regime', () => {
  it('separa homologados de não homologados e nunca libera os não homologados', () => {
    const plano = montarPlanoRollout(
      [
        cenario({ id: 't01' }),
        cenario({
          id: 't02',
          criterios: criteriosOk({ livroConciliado: false }),
        }),
        cenario({ id: 't03' }),
      ],
      10,
    );
    expect(plano.homologados).toEqual(['t01', 't03']);
    expect(plano.naoHomologados).toEqual(['t02']);
    // Nenhuma coorte de expansão inclui o não homologado t02.
    const todosNaExpansao = plano.expansao.flatMap((c) => c.cenarios);
    expect(todosNaExpansao).not.toContain('t02');
    expect(todosNaExpansao.sort()).toEqual(['t01', 't03']);
  });

  it('amostra pega os primeiros N homologados em ordem estável', () => {
    const plano = montarPlanoRollout(
      [cenario({ id: 't03' }), cenario({ id: 't01' }), cenario({ id: 't02' })],
      2,
    );
    // Ordenados por id: t01, t02, t03 → amostra pequena de 2 = [t01, t02].
    expect(plano.amostra).toEqual(['t01', 't02']);
    expect(plano.resumo.tamanhoAmostra).toBe(2);
  });

  it('amostra limita-se aos homologados disponíveis quando há menos que o pedido', () => {
    const plano = montarPlanoRollout(
      [
        cenario({ id: 't01' }),
        cenario({
          id: 't02',
          criterios: criteriosOk({ testeUnitario: false }),
        }),
      ],
      5,
    );
    expect(plano.amostra).toEqual(['t01']); // só um homologado
    expect(plano.resumo.tamanhoAmostra).toBe(1);
  });

  it('tamanho de amostra negativo vira zero (sem amostra)', () => {
    const plano = montarPlanoRollout([cenario({ id: 't01' })], -3);
    expect(plano.amostra).toEqual([]);
    expect(plano.resumo.tamanhoAmostra).toBe(0);
    // A expansão continua cobrindo os homologados, independente da amostra.
    expect(plano.homologados).toEqual(['t01']);
  });

  it('expande agrupando homologados por coorte UF/perfil/regime em ordem estável', () => {
    const plano = montarPlanoRollout(
      [
        cenario({
          id: 't03',
          coorte: { uf: 'SP', perfil: 'A', regime: 'PRESUMIDO' },
        }),
        cenario({
          id: 't01',
          coorte: { uf: 'SP', perfil: 'A', regime: 'PRESUMIDO' },
        }),
        cenario({
          id: 't02',
          coorte: { uf: 'MG', perfil: 'B', regime: 'SIMPLES' },
        }),
        cenario({
          id: 't04',
          coorte: { uf: 'SP', perfil: 'C', regime: 'REAL' },
        }),
      ],
      1,
    );

    // Coortes ordenadas por UF, perfil, regime: MG/B/SIMPLES, SP/A/PRESUMIDO,
    // SP/C/REAL.
    expect(
      plano.expansao.map((c) => `${c.uf}/${c.perfil}/${c.regime}`),
    ).toEqual(['MG/B/SIMPLES', 'SP/A/PRESUMIDO', 'SP/C/REAL']);

    const sp = plano.expansao.find((c) => c.uf === 'SP' && c.perfil === 'A')!;
    // Cenários da coorte em ordem estável.
    expect(sp.cenarios).toEqual(['t01', 't03']);
    expect(plano.resumo.totalCoortes).toBe(3);
  });

  it('resumo reflete contagens coerentes', () => {
    const plano = montarPlanoRollout(
      [
        cenario({ id: 't01' }),
        cenario({
          id: 't02',
          criterios: criteriosOk({ txtValidadoPva: false }),
        }),
        cenario({
          id: 't03',
          coorte: { uf: 'MG', perfil: 'B', regime: 'SIMPLES' },
        }),
      ],
      1,
    );
    expect(plano.resumo).toEqual({
      totalCenarios: 3,
      totalHomologados: 2,
      totalNaoHomologados: 1,
      tamanhoAmostra: 1,
      totalCoortes: 2,
    });
  });

  it('plano vazio: nada homologado, nenhuma coorte', () => {
    const plano = montarPlanoRollout([], 5);
    expect(plano.avaliacoes).toEqual([]);
    expect(plano.homologados).toEqual([]);
    expect(plano.amostra).toEqual([]);
    expect(plano.expansao).toEqual([]);
    expect(plano.resumo.totalCenarios).toBe(0);
  });
});
