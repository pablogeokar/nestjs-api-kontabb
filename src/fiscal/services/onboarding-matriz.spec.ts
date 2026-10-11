import {
  MOTIVO_INVENTARIO_LABEL,
  montarMatrizOnboarding,
  type OnboardingMatrizFatos,
} from './onboarding-matriz';

/**
 * Testes do NÚCLEO PURO da matriz de onboarding (Fase 5, tarefa 4.1 — R4.1).
 *
 * A projeção é read-only e determinística: dado o mesmo conjunto de fatos (já
 * carregados do banco pelo serviço), a matriz é sempre a mesma. Os testes
 * exercitam cada eixo exigido pelo requisito — modelos, perfil, setor, regime
 * especial, Blocos B/K/1, 1601, combustíveis/monofásicos, inventário por motivo
 * e controles ST — e a postura de ESCOPO HONESTO da fase: a matriz EXIBE sinais
 * de atenção (Bloco K/B, inventário com motivo não suportado) sem convertê-los
 * em impedimento/liberação (isso é 4.2/4.3) e sem tratar ausência de registro
 * opcional como defeito (R4.5).
 */

function fatos(
  overrides: Partial<OnboardingMatrizFatos> = {},
): OnboardingMatrizFatos {
  return {
    clienteId: 'c1',
    competencia: '2026-09',
    cliente: {
      razaoSocial: 'Estabelecimento Teste LTDA',
      cnpj: '11222333000181',
      uf: 'SP',
      regimeTributario: 'PRESUMIDO',
    },
    configuracao: {
      perfilEfd: 'A',
      indAtiv: '1',
      obrigadoEfdIcmsIpi: true,
      inventarioObrigatorio: false,
      mesEntregaInventario: 2,
      blocoKComMovimento: false,
      indicadores1010: {},
    },
    modelosContagem: [{ modelo: '55', quantidade: 10 }],
    sinaisItens: {
      temIndComb: false,
      temCstIcmsMonofasico: false,
      temCstPisCofinsMonofasico: false,
      itensComCest: 0,
      itensComIcmsSt: 0,
      itensComStRetido: 0,
    },
    inventarios: [],
    ...overrides,
  };
}

describe('montarMatrizOnboarding — identificação e eixos básicos', () => {
  it('ecoa estabelecimento, competência, perfil e setor da configuração', () => {
    const m = montarMatrizOnboarding(fatos());
    expect(m.clienteId).toBe('c1');
    expect(m.competencia).toBe('2026-09');
    expect(m.estabelecimento).toEqual({
      razaoSocial: 'Estabelecimento Teste LTDA',
      cnpj: '11222333000181',
      uf: 'SP',
    });
    expect(m.configurado).toBe(true);
    expect(m.perfil).toBe('A');
    expect(m.setor.indAtiv).toBe('1');
    expect(m.setor.descricao).toBe('Outros');
  });

  it('sem configuração SPED: configurado=false, perfil/setor nulos (ausência, não defeito)', () => {
    const m = montarMatrizOnboarding(fatos({ configuracao: null }));
    expect(m.configurado).toBe(false);
    expect(m.perfil).toBeNull();
    expect(m.setor.indAtiv).toBeNull();
    expect(m.setor.descricao).toBe('Setor não configurado');
  });

  it('normaliza perfil/setor inválidos para null', () => {
    const m = montarMatrizOnboarding(
      fatos({
        configuracao: {
          perfilEfd: 'Z',
          indAtiv: '9',
          obrigadoEfdIcmsIpi: true,
          inventarioObrigatorio: false,
          mesEntregaInventario: 2,
          blocoKComMovimento: false,
          indicadores1010: {},
        },
      }),
    );
    expect(m.perfil).toBeNull();
    expect(m.setor.indAtiv).toBeNull();
  });
});

describe('montarMatrizOnboarding — modelos de documento usados', () => {
  it('lista modelos válidos com contagem, em ordem estável, ignorando quantidades <= 0', () => {
    const m = montarMatrizOnboarding(
      fatos({
        modelosContagem: [
          { modelo: '65', quantidade: 3 },
          { modelo: '55', quantidade: 10 },
          { modelo: '57', quantidade: 0 },
        ],
      }),
    );
    expect(m.modelos.map((x) => x.modelo)).toEqual(['55', '65']);
    expect(m.modelos[0]).toEqual({
      modelo: '55',
      descricao: 'NF-e (modelo 55)',
      quantidade: 10,
    });
  });

  it('ignora modelos fora do domínio 55/57/65', () => {
    const m = montarMatrizOnboarding(
      fatos({ modelosContagem: [{ modelo: '01', quantidade: 5 }] }),
    );
    expect(m.modelos).toEqual([]);
  });
});

describe('montarMatrizOnboarding — regime especial (indicadores 1010)', () => {
  it('lista apenas indicadores ativos (S), em ordem alfabética, com o regime cadastral', () => {
    const m = montarMatrizOnboarding(
      fatos({
        configuracao: {
          perfilEfd: 'A',
          indAtiv: '0',
          obrigadoEfdIcmsIpi: true,
          inventarioObrigatorio: false,
          mesEntregaInventario: 2,
          blocoKComMovimento: false,
          indicadores1010: { IND_USINA: 'S', IND_EXP: 'S', IND_CART: 'N' },
        },
      }),
    );
    expect(m.regimeEspecial.regimeTributario).toBe('PRESUMIDO');
    expect(m.regimeEspecial.indicadoresAtivos).toEqual([
      'IND_EXP',
      'IND_USINA',
    ]);
  });
});

describe('montarMatrizOnboarding — combustíveis/monofásicos e 1601', () => {
  it('IND_COMB=S marca presença e 1601 aplicável', () => {
    const m = montarMatrizOnboarding(
      fatos({
        configuracao: {
          perfilEfd: 'A',
          indAtiv: '1',
          obrigadoEfdIcmsIpi: true,
          inventarioObrigatorio: false,
          mesEntregaInventario: 2,
          blocoKComMovimento: false,
          indicadores1010: { IND_COMB: 'S' },
        },
      }),
    );
    expect(m.combustiveis.presente).toBe(true);
    expect(m.combustiveis.indComb).toBe(true);
    expect(m.combustiveis.obrigacao1601Aplicavel).toBe(true);
  });

  it('CST ICMS/PIS-COFINS monofásico nos itens marca presença mesmo sem IND_COMB', () => {
    const m = montarMatrizOnboarding(
      fatos({
        sinaisItens: {
          temIndComb: false,
          temCstIcmsMonofasico: true,
          temCstPisCofinsMonofasico: true,
          itensComCest: 0,
          itensComIcmsSt: 0,
          itensComStRetido: 0,
        },
      }),
    );
    expect(m.combustiveis.presente).toBe(true);
    expect(m.combustiveis.indComb).toBe(false);
    expect(m.combustiveis.cstIcmsMonofasico).toBe(true);
    expect(m.combustiveis.cstPisCofinsMonofasico).toBe(true);
    expect(m.combustiveis.obrigacao1601Aplicavel).toBe(true);
  });

  it('sem sinais: 1601 não aplicável e ausência não é defeito', () => {
    const m = montarMatrizOnboarding(fatos());
    expect(m.combustiveis.presente).toBe(false);
    expect(m.combustiveis.obrigacao1601Aplicavel).toBe(false);
    expect(m.combustiveis.memoria).toMatch(/não é defeito/);
  });
});

describe('montarMatrizOnboarding — controles ST', () => {
  it('resume contagens de CEST, ICMS-ST e ST retido e marca presença', () => {
    const m = montarMatrizOnboarding(
      fatos({
        sinaisItens: {
          temIndComb: false,
          temCstIcmsMonofasico: false,
          temCstPisCofinsMonofasico: false,
          itensComCest: 4,
          itensComIcmsSt: 2,
          itensComStRetido: 1,
        },
      }),
    );
    expect(m.controleSt.presente).toBe(true);
    expect(m.controleSt.itensComCest).toBe(4);
    expect(m.controleSt.itensComIcmsSt).toBe(2);
    expect(m.controleSt.itensComStRetido).toBe(1);
  });

  it('sem sinais de ST: presença falsa e ausência não é defeito', () => {
    const m = montarMatrizOnboarding(fatos());
    expect(m.controleSt.presente).toBe(false);
    expect(m.controleSt.memoria).toMatch(/não é defeito/);
  });
});

describe('montarMatrizOnboarding — inventário por motivo', () => {
  it('lista inventários por motivo, ordenados por data/motivo, com rótulo e suporte', () => {
    const m = montarMatrizOnboarding(
      fatos({
        inventarios: [
          { dataInventario: '2026-12-31', motivo: '06', status: 'RASCUNHO' },
          { dataInventario: '2025-12-31', motivo: '01', status: 'FECHADO' },
        ],
      }),
    );
    expect(
      m.inventariosPorMotivo.map((i) => [i.dataInventario, i.motivo]),
    ).toEqual([
      ['2025-12-31', '01'],
      ['2026-12-31', '06'],
    ]);
    const final = m.inventariosPorMotivo[0];
    expect(final.descricaoMotivo).toBe(MOTIVO_INVENTARIO_LABEL['01']);
    expect(final.motivoSuportado).toBe(true);
    // Motivo 06 (ST) exibido, mas marcado como não suportado — sinal, não decisão.
    expect(m.inventariosPorMotivo[1].motivoSuportado).toBe(false);
  });

  it('ignora inventário com motivo fora do domínio 01–06', () => {
    const m = montarMatrizOnboarding(
      fatos({
        inventarios: [
          { dataInventario: '2026-12-31', motivo: '09', status: 'RASCUNHO' },
        ],
      }),
    );
    expect(m.inventariosPorMotivo).toEqual([]);
  });
});

describe('montarMatrizOnboarding — Blocos B/K/1 (apresentação, não decisão)', () => {
  it('Bloco K aplicável para industrial (IND_ATIV=0) e suportado quando sem movimento', () => {
    const m = montarMatrizOnboarding(
      fatos({
        configuracao: {
          perfilEfd: 'A',
          indAtiv: '0',
          obrigadoEfdIcmsIpi: true,
          inventarioObrigatorio: false,
          mesEntregaInventario: 2,
          blocoKComMovimento: false,
          indicadores1010: {},
        },
      }),
    );
    expect(m.blocos.blocoK.aplicavel).toBe(true);
    expect(m.blocos.blocoK.suportado).toBe(true);
  });

  it('Bloco K com movimento declarado: aplicável mas NÃO suportado (bloqueio conservador)', () => {
    const m = montarMatrizOnboarding(
      fatos({
        configuracao: {
          perfilEfd: 'A',
          indAtiv: '0',
          obrigadoEfdIcmsIpi: true,
          inventarioObrigatorio: false,
          mesEntregaInventario: 2,
          blocoKComMovimento: true,
          indicadores1010: {},
        },
      }),
    );
    expect(m.blocos.blocoK.aplicavel).toBe(true);
    expect(m.blocos.blocoK.suportado).toBe(false);
    expect(m.blocos.blocoK.memoria).toMatch(/conservador/);
  });

  it('Bloco K não aplicável para não industrial sem movimento', () => {
    const m = montarMatrizOnboarding(fatos());
    expect(m.blocos.blocoK.aplicavel).toBe(false);
  });

  it('Bloco B aplicável (serviços/CT-e) mas não suportado hoje', () => {
    const m = montarMatrizOnboarding(
      fatos({ modelosContagem: [{ modelo: '57', quantidade: 2 }] }),
    );
    expect(m.blocos.blocoB.aplicavel).toBe(true);
    expect(m.blocos.blocoB.suportado).toBe(false);
  });

  it('Bloco 1 aplicável quando há combustíveis ou ST; não aplicável caso contrário', () => {
    const comComb = montarMatrizOnboarding(
      fatos({
        configuracao: {
          perfilEfd: 'A',
          indAtiv: '1',
          obrigadoEfdIcmsIpi: true,
          inventarioObrigatorio: false,
          mesEntregaInventario: 2,
          blocoKComMovimento: false,
          indicadores1010: { IND_COMB: 'S' },
        },
      }),
    );
    expect(comComb.blocos.bloco1.aplicavel).toBe(true);

    const vazio = montarMatrizOnboarding(fatos());
    expect(vazio.blocos.bloco1.aplicavel).toBe(false);
  });
});

describe('montarMatrizOnboarding — impedimentos explícitos (4.2, R4.2/R4.3)', () => {
  it('sem nada aplicável e não suportado: lista de impedimentos vazia (não impede entrega)', () => {
    const m = montarMatrizOnboarding(fatos());
    expect(m.impedimentos).toEqual([]);
  });

  it('Bloco K com movimento → impedimento explícito com código do bloqueio de geração', () => {
    const m = montarMatrizOnboarding(
      fatos({
        configuracao: {
          perfilEfd: 'A',
          indAtiv: '0',
          obrigadoEfdIcmsIpi: true,
          inventarioObrigatorio: false,
          mesEntregaInventario: 2,
          blocoKComMovimento: true,
          indicadores1010: {},
        },
      }),
    );
    const k = m.impedimentos.find((i) => i.eixo === 'blocoK');
    expect(k).toBeDefined();
    expect(k?.codigo).toBe('BLOCO_K_MOVIMENTO_NAO_CONFIGURADO');
    expect(k?.motivo).toMatch(/Bloco K/);
    // Bloco K industrial SEM movimento é suportado: não gera impedimento.
    expect(m.blocos.blocoK.suportado).toBe(false);
  });

  it('Bloco K industrial SEM movimento (suportado) → nenhum impedimento de Bloco K', () => {
    const m = montarMatrizOnboarding(
      fatos({
        configuracao: {
          perfilEfd: 'A',
          indAtiv: '0',
          obrigadoEfdIcmsIpi: true,
          inventarioObrigatorio: false,
          mesEntregaInventario: 2,
          blocoKComMovimento: false,
          indicadores1010: {},
        },
      }),
    );
    expect(m.impedimentos.filter((i) => i.eixo === 'blocoK')).toEqual([]);
  });

  it('Bloco B aplicável (CT-e) e não suportado → impedimento de Bloco B', () => {
    const m = montarMatrizOnboarding(
      fatos({ modelosContagem: [{ modelo: '57', quantidade: 2 }] }),
    );
    const b = m.impedimentos.find((i) => i.eixo === 'blocoB');
    expect(b).toBeDefined();
    expect(b?.codigo).toBe('BLOCO_B_NAO_SUPORTADO');
  });

  it('inventário com motivo não suportado (≠ 01) → impedimento explícito por inventário', () => {
    const m = montarMatrizOnboarding(
      fatos({
        inventarios: [
          { dataInventario: '2025-12-31', motivo: '01', status: 'FECHADO' },
          { dataInventario: '2026-12-31', motivo: '02', status: 'RASCUNHO' },
          { dataInventario: '2026-12-31', motivo: '06', status: 'RASCUNHO' },
        ],
      }),
    );
    const inv = m.impedimentos.filter((i) => i.eixo === 'inventario');
    // Motivo 01 suportado não gera impedimento; 02 e 06 geram.
    expect(inv).toHaveLength(2);
    expect(
      inv.every((i) => i.codigo === 'INVENTARIO_MOTIVO_NAO_SUPORTADO'),
    ).toBe(true);
    expect(inv.some((i) => i.motivo.includes('motivo 02'))).toBe(true);
    expect(inv.some((i) => i.motivo.includes('motivo 06'))).toBe(true);
  });

  it('modelo de documento não suportado (CT-e/57) → impedimento de modelo', () => {
    const m = montarMatrizOnboarding(
      fatos({
        modelosContagem: [
          { modelo: '55', quantidade: 10 },
          { modelo: '57', quantidade: 3 },
        ],
      }),
    );
    const mod = m.impedimentos.find((i) => i.eixo === 'modelo');
    expect(mod).toBeDefined();
    expect(mod?.codigo).toBe('MODELO_NAO_SUPORTADO');
    expect(mod?.motivo).toMatch(/modelo 57/i);
    // Modelos suportados (55/65) nunca geram impedimento de modelo.
    expect(
      montarMatrizOnboarding(
        fatos({
          modelosContagem: [
            { modelo: '55', quantidade: 10 },
            { modelo: '65', quantidade: 2 },
          ],
        }),
      ).impedimentos.filter((i) => i.eixo === 'modelo'),
    ).toEqual([]);
  });

  it('múltiplos eixos não suportados: impedimentos acumulados e ordenados de forma estável', () => {
    const m = montarMatrizOnboarding(
      fatos({
        configuracao: {
          perfilEfd: 'A',
          indAtiv: '0',
          obrigadoEfdIcmsIpi: true,
          inventarioObrigatorio: false,
          mesEntregaInventario: 2,
          blocoKComMovimento: true,
          indicadores1010: {},
        },
        modelosContagem: [{ modelo: '57', quantidade: 1 }],
        inventarios: [
          { dataInventario: '2026-12-31', motivo: '02', status: 'RASCUNHO' },
        ],
      }),
    );
    expect(m.impedimentos.map((i) => i.eixo)).toEqual([
      'blocoB',
      'blocoK',
      'inventario',
      'modelo',
    ]);
    // Determinístico: os mesmos fatos produzem a mesma lista de impedimentos.
    expect(montarMatrizOnboarding(fatos()).impedimentos).toEqual([]);
  });
});

describe('montarMatrizOnboarding — prontidão "pronto para entrega" (4.3, R4.4/R4.5)', () => {
  it('sem impedimentos: pronto para entrega, status PRONTO, sem bloqueios (R4.4)', () => {
    const m = montarMatrizOnboarding(fatos());
    expect(m.impedimentos).toEqual([]);
    expect(m.prontidao.prontoParaEntrega).toBe(true);
    expect(m.prontidao.status).toBe('PRONTO');
    expect(m.prontidao.bloqueios).toEqual([]);
  });

  it('com qualquer impedimento: NÃO pronto, status IMPEDIDO, bloqueios = impedimentos (R4.4)', () => {
    const m = montarMatrizOnboarding(
      fatos({ modelosContagem: [{ modelo: '57', quantidade: 2 }] }),
    );
    expect(m.impedimentos.length).toBeGreaterThan(0);
    expect(m.prontidao.prontoParaEntrega).toBe(false);
    expect(m.prontidao.status).toBe('IMPEDIDO');
    // Os bloqueios são exatamente os impedimentos de 4.2 (obrigações não atendidas).
    expect(m.prontidao.bloqueios).toEqual(m.impedimentos);
  });

  it('múltiplas obrigações não atendidas: todas listadas como bloqueios, status IMPEDIDO', () => {
    const m = montarMatrizOnboarding(
      fatos({
        configuracao: {
          perfilEfd: 'A',
          indAtiv: '0',
          obrigadoEfdIcmsIpi: true,
          inventarioObrigatorio: false,
          mesEntregaInventario: 2,
          blocoKComMovimento: true,
          indicadores1010: {},
        },
        modelosContagem: [{ modelo: '57', quantidade: 1 }],
        inventarios: [
          { dataInventario: '2026-12-31', motivo: '02', status: 'RASCUNHO' },
        ],
      }),
    );
    expect(m.prontidao.prontoParaEntrega).toBe(false);
    expect(m.prontidao.status).toBe('IMPEDIDO');
    expect(m.prontidao.bloqueios.map((b) => b.eixo)).toEqual([
      'blocoB',
      'blocoK',
      'inventario',
      'modelo',
    ]);
  });

  it('ausência de registro opcional (combustíveis/ST/inventário/1601) NÃO impede e NÃO é defeito (R4.5)', () => {
    // Estabelecimento sem combustíveis, sem ST, sem inventário, sem 1601, só
    // modelos suportados: tudo opcional ausente — nada disso é obrigação não
    // atendida, então permanece pronto para entrega.
    const m = montarMatrizOnboarding(
      fatos({
        modelosContagem: [
          { modelo: '55', quantidade: 10 },
          { modelo: '65', quantidade: 2 },
        ],
        sinaisItens: {
          temIndComb: false,
          temCstIcmsMonofasico: false,
          temCstPisCofinsMonofasico: false,
          itensComCest: 0,
          itensComIcmsSt: 0,
          itensComStRetido: 0,
        },
        inventarios: [],
      }),
    );
    // Opcionais ausentes: nenhum vira impedimento (não é obrigação não atendida).
    expect(m.combustiveis.presente).toBe(false);
    expect(m.combustiveis.obrigacao1601Aplicavel).toBe(false);
    expect(m.controleSt.presente).toBe(false);
    expect(m.inventariosPorMotivo).toEqual([]);
    expect(m.impedimentos).toEqual([]);
    // E a prontidão não é afetada: pronto, sem bloqueios, sem defeito.
    expect(m.prontidao.prontoParaEntrega).toBe(true);
    expect(m.prontidao.status).toBe('PRONTO');
    expect(m.prontidao.memoria).toMatch(/defeito/);
  });

  it('inventário opcional NÃO fechado (motivo 01, não obrigatório) não impede a entrega', () => {
    // Inventário motivo 01 (suportado) não gera impedimento mesmo em rascunho:
    // sua presença/ausência não é obrigação não atendida aqui — segue pronto.
    const m = montarMatrizOnboarding(
      fatos({
        inventarios: [
          { dataInventario: '2025-12-31', motivo: '01', status: 'RASCUNHO' },
        ],
      }),
    );
    expect(m.impedimentos.filter((i) => i.eixo === 'inventario')).toEqual([]);
    expect(m.prontidao.prontoParaEntrega).toBe(true);
  });
});

describe('montarMatrizOnboarding — determinismo', () => {
  it('os mesmos fatos produzem a mesma matriz', () => {
    const f = fatos({
      modelosContagem: [
        { modelo: '55', quantidade: 10 },
        { modelo: '65', quantidade: 3 },
      ],
      inventarios: [
        { dataInventario: '2025-12-31', motivo: '01', status: 'FECHADO' },
      ],
    });
    expect(montarMatrizOnboarding(f)).toEqual(montarMatrizOnboarding(f));
  });
});
