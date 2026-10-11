import {
  montarMetricasRollout,
  type RolloutMetricasFatos,
} from './rollout-metricas';

/**
 * Testes do NÚCLEO PURO das métricas de rollout §13.3 (Fase 5, tarefa 5.5 —
 * R5.5).
 *
 * A projeção é read-only e determinística: dado o mesmo conjunto de fatos (já
 * agregados pelo serviço no SQL), o painel é sempre o mesmo. Os testes
 * exercitam as OITO métricas exigidas pelo design (§13.3): diferença por
 * tributo, créditos com/sem fundamento, pendências, repetições bloqueadas,
 * rejeições PVA, guias sem vínculo, mudanças pós-fechamento e consultas por
 * documento — além da postura de RETRATO (agrega/apresenta, não decide nada).
 */

function fatos(
  overrides: Partial<RolloutMetricasFatos> = {},
): RolloutMetricasFatos {
  return {
    clienteId: 'c1',
    geradoEm: '2026-09-01T00:00:00.000Z',
    diferencasPorTributo: [],
    creditosComFundamento: 0,
    creditosSemFundamento: 0,
    guiasPendentes: 0,
    guiasVencidas: 0,
    guiasComIdempotencyKey: 0,
    ciapSaneamentoBloqueado: 0,
    entregasRejeitadasPva: 0,
    guiasApuracaoSemVinculo: 0,
    guiasManuaisSemVinculo: 0,
    fechamentosRetificados: 0,
    entregasRetificadoras: 0,
    documentosFiscais: 0,
    consultasObservadas: 0,
    ...overrides,
  };
}

describe('montarMetricasRollout — identificação e retrato vazio', () => {
  it('ecoa cliente e geradoEm, e zera todas as métricas quando não há nada', () => {
    const m = montarMetricasRollout(fatos());
    expect(m.clienteId).toBe('c1');
    expect(m.geradoEm).toBe('2026-09-01T00:00:00.000Z');
    expect(m.diferencaPorTributo).toEqual([]);
    expect(m.creditos).toEqual({
      comFundamento: 0,
      semFundamento: 0,
      total: 0,
    });
    expect(m.pendencias).toEqual({ pendentes: 0, vencidas: 0, total: 0 });
    expect(m.repeticoesBloqueadas).toEqual({
      guiasIdempotentes: 0,
      ciapSaneamentoBloqueado: 0,
      total: 0,
    });
    expect(m.rejeicoesPva).toBe(0);
    expect(m.guiasSemVinculo).toEqual({
      apuracaoSemVinculo: 0,
      manuaisSemVinculo: 0,
      total: 0,
    });
    expect(m.mudancasPosFechamento).toEqual({
      fechamentosRetificados: 0,
      entregasRetificadoras: 0,
      total: 0,
    });
    expect(m.consultasPorDocumento).toEqual({
      documentos: 0,
      consultas: 0,
      razao: '0.0000',
    });
  });
});

describe('montarMetricasRollout — (1) diferença por tributo', () => {
  it('ordena por tributo, normaliza a soma a 2 casas e preserva string', () => {
    const m = montarMetricasRollout(
      fatos({
        diferencasPorTributo: [
          {
            tributo: 'ICMS_PROPRIO',
            somaDiferencaAbsoluta: '150.5',
            guiasDivergentes: 2,
          },
          { tributo: 'FCP', somaDiferencaAbsoluta: '0', guiasDivergentes: 1 },
        ],
      }),
    );
    expect(m.diferencaPorTributo).toEqual([
      { tributo: 'FCP', diferencaAbsoluta: '0.00', guiasDivergentes: 1 },
      {
        tributo: 'ICMS_PROPRIO',
        diferencaAbsoluta: '150.50',
        guiasDivergentes: 2,
      },
    ]);
  });

  it('não usa ponto flutuante: soma com muitas casas é truncada a centavos', () => {
    const m = montarMetricasRollout(
      fatos({
        diferencasPorTributo: [
          {
            tributo: 'PIS',
            somaDiferencaAbsoluta: '10.999',
            guiasDivergentes: 3,
          },
        ],
      }),
    );
    expect(m.diferencaPorTributo[0].diferencaAbsoluta).toBe('10.99');
  });
});

describe('montarMetricasRollout — (2) créditos com/sem fundamento', () => {
  it('soma os dois lados no total', () => {
    const m = montarMetricasRollout(
      fatos({ creditosComFundamento: 7, creditosSemFundamento: 3 }),
    );
    expect(m.creditos).toEqual({
      comFundamento: 7,
      semFundamento: 3,
      total: 10,
    });
  });
});

describe('montarMetricasRollout — (3) pendências', () => {
  it('separa pendentes e vencidas e soma no total', () => {
    const m = montarMetricasRollout(
      fatos({ guiasPendentes: 4, guiasVencidas: 2 }),
    );
    expect(m.pendencias).toEqual({ pendentes: 4, vencidas: 2, total: 6 });
  });
});

describe('montarMetricasRollout — (4) repetições bloqueadas', () => {
  it('agrega idempotência de guias e saneamento de CIAP', () => {
    const m = montarMetricasRollout(
      fatos({ guiasComIdempotencyKey: 5, ciapSaneamentoBloqueado: 2 }),
    );
    expect(m.repeticoesBloqueadas).toEqual({
      guiasIdempotentes: 5,
      ciapSaneamentoBloqueado: 2,
      total: 7,
    });
  });
});

describe('montarMetricasRollout — (5) rejeições PVA', () => {
  it('ecoa a contagem de entregas rejeitadas', () => {
    const m = montarMetricasRollout(fatos({ entregasRejeitadasPva: 3 }));
    expect(m.rejeicoesPva).toBe(3);
  });
});

describe('montarMetricasRollout — (6) guias sem vínculo', () => {
  it('separa anomalia de apuração e manuais fora da conciliação', () => {
    const m = montarMetricasRollout(
      fatos({ guiasApuracaoSemVinculo: 1, guiasManuaisSemVinculo: 4 }),
    );
    expect(m.guiasSemVinculo).toEqual({
      apuracaoSemVinculo: 1,
      manuaisSemVinculo: 4,
      total: 5,
    });
  });
});

describe('montarMetricasRollout — (7) mudanças pós-fechamento', () => {
  it('agrega fechamentos retificados e entregas retificadoras', () => {
    const m = montarMetricasRollout(
      fatos({ fechamentosRetificados: 2, entregasRetificadoras: 3 }),
    );
    expect(m.mudancasPosFechamento).toEqual({
      fechamentosRetificados: 2,
      entregasRetificadoras: 3,
      total: 5,
    });
  });
});

describe('montarMetricasRollout — (8) consultas por documento', () => {
  it('calcula a razão consultas/documento com 4 casas, como string', () => {
    const m = montarMetricasRollout(
      fatos({ documentosFiscais: 4, consultasObservadas: 10 }),
    );
    // 10 / 4 = 2.5000
    expect(m.consultasPorDocumento).toEqual({
      documentos: 4,
      consultas: 10,
      razao: '2.5000',
    });
  });

  it('razão é 0.0000 quando não há documentos (sem divisão por zero)', () => {
    const m = montarMetricasRollout(
      fatos({ documentosFiscais: 0, consultasObservadas: 7 }),
    );
    expect(m.consultasPorDocumento.razao).toBe('0.0000');
  });

  it('arredonda a razão meio-para-cima na quarta casa', () => {
    const m = montarMetricasRollout(
      fatos({ documentosFiscais: 3, consultasObservadas: 1 }),
    );
    // 1 / 3 = 0.33333… → 0.3333
    expect(m.consultasPorDocumento.razao).toBe('0.3333');
  });

  it('ignora valores negativos/não inteiros truncando para contagem válida', () => {
    const m = montarMetricasRollout(
      fatos({ documentosFiscais: -5, consultasObservadas: 2.9 }),
    );
    expect(m.consultasPorDocumento).toEqual({
      documentos: 0,
      consultas: 2,
      razao: '0.0000',
    });
  });
});

describe('montarMetricasRollout — determinismo', () => {
  it('produz o mesmo painel para os mesmos fatos', () => {
    const entrada = fatos({
      diferencasPorTributo: [
        {
          tributo: 'ICMS_ST',
          somaDiferencaAbsoluta: '12.34',
          guiasDivergentes: 1,
        },
      ],
      creditosComFundamento: 2,
      creditosSemFundamento: 1,
      guiasPendentes: 3,
      documentosFiscais: 2,
      consultasObservadas: 6,
    });
    expect(montarMetricasRollout(entrada)).toEqual(
      montarMetricasRollout(entrada),
    );
  });
});
