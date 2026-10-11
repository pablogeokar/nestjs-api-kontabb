import {
  montarInventarioRollout,
  type RolloutInventarioFatos,
} from './rollout-inventario';

/**
 * Testes do NÚCLEO PURO do inventário de rollout (Fase 5, tarefa 5.1 — R5.2).
 *
 * A projeção é read-only e determinística: dado o mesmo conjunto de fatos (já
 * carregados do banco pelo serviço), o inventário é sempre o mesmo. Os testes
 * exercitam os três eixos exigidos pelo design (§Rollout §13): versões
 * entregues, competências abertas e operações afetadas (CIAP, CT-e de saída,
 * créditos vedados, PIS misto), além da postura de RETRATO: agrega/apresenta
 * sem decidir ativação nem reconstruir nada.
 */

function fatos(
  overrides: Partial<RolloutInventarioFatos> = {},
): RolloutInventarioFatos {
  return {
    clienteId: 'c1',
    geradoEm: '2026-09-01T00:00:00.000Z',
    entregas: [],
    fechamentos: [],
    operacoes: {
      ciapBensAtivos: 0,
      ciapSaneamentoPendente: 0,
      ciapApropriacoesComParcelaVedada: 0,
      cteSaidaEscriturado: 0,
      creditosIcmsVedados: 0,
      pisItensTributados: 0,
      pisItensSemDebito: 0,
    },
    ...overrides,
  };
}

describe('montarInventarioRollout — identificação e retrato vazio', () => {
  it('ecoa cliente e geradoEm, e produz eixos vazios quando não há nada', () => {
    const inv = montarInventarioRollout(fatos());
    expect(inv.clienteId).toBe('c1');
    expect(inv.geradoEm).toBe('2026-09-01T00:00:00.000Z');
    expect(inv.versoesEntregues).toEqual([]);
    expect(inv.competenciasAbertas).toEqual([]);
    // As quatro linhas de operação sempre existem; nenhuma presente no vazio.
    expect(inv.operacoesAfetadas.map((o) => o.tipo)).toEqual([
      'CIAP',
      'CTE_SAIDA',
      'CREDITO_VEDADO',
      'PIS_MISTO',
    ]);
    expect(inv.operacoesAfetadas.every((o) => !o.presente)).toBe(true);
    expect(inv.resumo).toEqual({
      totalVersoesEntregues: 0,
      totalCompetenciasAbertas: 0,
      tiposOperacaoAfetadaPresentes: 0,
    });
  });
});

describe('montarInventarioRollout — eixo 1: versões entregues', () => {
  it('agrupa por obrigação/competência, conta retificações e resume status', () => {
    const inv = montarInventarioRollout(
      fatos({
        entregas: [
          {
            id: 'e1',
            obrigacao: 'EFD_ICMS_IPI',
            competencia: '2026-07',
            statusValidacao: 'TRANSMITIDA',
            ehRetificacao: false,
            protocoloNumero: 'P-1',
            transmitidaEm: '2026-08-10T12:00:00.000Z',
          },
          {
            id: 'e2',
            obrigacao: 'EFD_ICMS_IPI',
            competencia: '2026-07',
            statusValidacao: 'VALIDADA',
            ehRetificacao: true,
            protocoloNumero: 'P-2',
            transmitidaEm: '2026-09-01T12:00:00.000Z',
          },
          {
            id: 'e3',
            obrigacao: 'EFD_CONTRIBUICOES',
            competencia: '2026-07',
            statusValidacao: 'PENDENTE',
            ehRetificacao: false,
            protocoloNumero: null,
            transmitidaEm: null,
          },
        ],
      }),
    );

    expect(inv.versoesEntregues).toHaveLength(2);
    // Ordenação estável por obrigação depois competência.
    const [contrib, icms] = inv.versoesEntregues;
    expect(contrib.obrigacao).toBe('EFD_CONTRIBUICOES');
    expect(contrib.totalEntregas).toBe(1);
    expect(contrib.retificacoes).toBe(0);
    expect(contrib.transmitida).toBe(false);

    expect(icms.obrigacao).toBe('EFD_ICMS_IPI');
    expect(icms.totalEntregas).toBe(2);
    expect(icms.retificacoes).toBe(1);
    expect(icms.transmitida).toBe(true);
    // A entrega mais recente (maior transmitidaEm) define o status mais recente.
    expect(icms.statusMaisRecente).toBe('VALIDADA');
    expect(inv.resumo.totalVersoesEntregues).toBe(2);
  });

  it('marca transmitida quando o status é TRANSMITIDA mesmo sem data', () => {
    const inv = montarInventarioRollout(
      fatos({
        entregas: [
          {
            id: 'e1',
            obrigacao: 'DAS',
            competencia: '2026-01',
            statusValidacao: 'TRANSMITIDA',
            ehRetificacao: false,
            protocoloNumero: null,
            transmitidaEm: null,
          },
        ],
      }),
    );
    expect(inv.versoesEntregues[0].transmitida).toBe(true);
  });
});

describe('montarInventarioRollout — eixo 2: competências abertas', () => {
  it('inclui competência sem versão corrente fechada e exclui a fechada', () => {
    const inv = montarInventarioRollout(
      fatos({
        fechamentos: [
          // Aberta: só rascunho/revisado, sem corrente fechada.
          {
            obrigacao: 'EFD_ICMS_IPI',
            competencia: '2026-08',
            versao: 1,
            estado: 'RASCUNHO',
            corrente: false,
          },
          {
            obrigacao: 'EFD_ICMS_IPI',
            competencia: '2026-08',
            versao: 2,
            estado: 'REVISADO',
            corrente: false,
          },
          // Fechada: tem versão corrente FECHADA → não é aberta.
          {
            obrigacao: 'EFD_ICMS_IPI',
            competencia: '2026-07',
            versao: 1,
            estado: 'FECHADO',
            corrente: true,
          },
        ],
      }),
    );

    expect(inv.competenciasAbertas).toHaveLength(1);
    const aberta = inv.competenciasAbertas[0];
    expect(aberta.competencia).toBe('2026-08');
    // Reporta a última versão (a de maior número) e seu estado.
    expect(aberta.ultimaVersao).toBe(2);
    expect(aberta.estadoUltimaVersao).toBe('REVISADO');
    expect(aberta.motivo).toContain('Sem versão corrente fechada');
    expect(inv.resumo.totalCompetenciasAbertas).toBe(1);
  });

  it('competência com versões fechadas mas sem corrente ainda é aberta', () => {
    const inv = montarInventarioRollout(
      fatos({
        fechamentos: [
          {
            obrigacao: 'DAPI',
            competencia: '2026-05',
            versao: 1,
            estado: 'FECHADO',
            corrente: false,
          },
        ],
      }),
    );
    // Fechado mas não corrente: a correção ainda pode gerar nova versão corrente.
    expect(inv.competenciasAbertas).toHaveLength(1);
    expect(inv.competenciasAbertas[0].competencia).toBe('2026-05');
  });
});

describe('montarInventarioRollout — eixo 3: operações afetadas', () => {
  it('CIAP soma bens ativos, saneamento pendente e apropriações vedadas', () => {
    const inv = montarInventarioRollout(
      fatos({
        operacoes: {
          ciapBensAtivos: 3,
          ciapSaneamentoPendente: 2,
          ciapApropriacoesComParcelaVedada: 4,
          cteSaidaEscriturado: 0,
          creditosIcmsVedados: 0,
          pisItensTributados: 0,
          pisItensSemDebito: 0,
        },
      }),
    );
    const ciap = inv.operacoesAfetadas.find((o) => o.tipo === 'CIAP')!;
    expect(ciap.presente).toBe(true);
    expect(ciap.quantidade).toBe(9);
    expect(ciap.memoria).toContain('saneamento assistido');
  });

  it('CT-e de saída e crédito vedado presentes quando há contagem', () => {
    const inv = montarInventarioRollout(
      fatos({
        operacoes: {
          ciapBensAtivos: 0,
          ciapSaneamentoPendente: 0,
          ciapApropriacoesComParcelaVedada: 0,
          cteSaidaEscriturado: 5,
          creditosIcmsVedados: 7,
          pisItensTributados: 0,
          pisItensSemDebito: 0,
        },
      }),
    );
    const cte = inv.operacoesAfetadas.find((o) => o.tipo === 'CTE_SAIDA')!;
    const vedado = inv.operacoesAfetadas.find(
      (o) => o.tipo === 'CREDITO_VEDADO',
    )!;
    expect(cte.presente).toBe(true);
    expect(cte.quantidade).toBe(5);
    expect(vedado.presente).toBe(true);
    expect(vedado.quantidade).toBe(7);
  });

  it('PIS é misto SOMENTE quando há tributado E sem débito no mesmo escopo', () => {
    const misto = montarInventarioRollout(
      fatos({
        operacoes: {
          ciapBensAtivos: 0,
          ciapSaneamentoPendente: 0,
          ciapApropriacoesComParcelaVedada: 0,
          cteSaidaEscriturado: 0,
          creditosIcmsVedados: 0,
          pisItensTributados: 10,
          pisItensSemDebito: 4,
        },
      }),
    );
    const pisMisto = misto.operacoesAfetadas.find(
      (o) => o.tipo === 'PIS_MISTO',
    )!;
    expect(pisMisto.presente).toBe(true);
    expect(pisMisto.quantidade).toBe(14);

    // Só um lado presente → NÃO é misto.
    const soTributado = montarInventarioRollout(
      fatos({
        operacoes: {
          ciapBensAtivos: 0,
          ciapSaneamentoPendente: 0,
          ciapApropriacoesComParcelaVedada: 0,
          cteSaidaEscriturado: 0,
          creditosIcmsVedados: 0,
          pisItensTributados: 10,
          pisItensSemDebito: 0,
        },
      }),
    );
    const pisSoTrib = soTributado.operacoesAfetadas.find(
      (o) => o.tipo === 'PIS_MISTO',
    )!;
    expect(pisSoTrib.presente).toBe(false);
    expect(pisSoTrib.quantidade).toBe(0);
  });

  it('resumo conta os tipos de operação presentes', () => {
    const inv = montarInventarioRollout(
      fatos({
        operacoes: {
          ciapBensAtivos: 1,
          ciapSaneamentoPendente: 0,
          ciapApropriacoesComParcelaVedada: 0,
          cteSaidaEscriturado: 2,
          creditosIcmsVedados: 0,
          pisItensTributados: 3,
          pisItensSemDebito: 3,
        },
      }),
    );
    // CIAP + CT-e de saída + PIS misto presentes; crédito vedado ausente.
    expect(inv.resumo.tiposOperacaoAfetadaPresentes).toBe(3);
  });
});
