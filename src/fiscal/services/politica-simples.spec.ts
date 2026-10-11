import {
  apuraIcmsProprioParaConsumidores,
  celulaMatrizFiscal,
  competenciaDeIntervalo,
  MATRIZ_FISCAL_SIMPLES,
  resolverPoliticaSimples,
  type PoliticaSimplesInput,
  type VigenciaSimples,
} from './politica-simples';

describe('resolverPoliticaSimples — política única de Simples por vigência (F17, R6.1, R6.4)', () => {
  // -------------------------------------------------------------------------
  // Dimensão 2 — regime de ICMS próprio (base: regime + defaults da task 6.1)
  // -------------------------------------------------------------------------
  describe('Dimensão 2 — apuração de ICMS próprio (regime)', () => {
    it.each(['LUCRO_PRESUMIDO', 'LUCRO_REAL'] as const)(
      'Lucro normal (%s) apura ICMS próprio por regime',
      (regimeTributario) => {
        const r = resolverPoliticaSimples({ regimeTributario }, '2026-03');
        expect(r.apuracaoIcmsPropria).toEqual({
          apura: true,
          origem: 'REGIME_LUCRO_NORMAL',
        });
      },
    );

    it('Simples sem parâmetros usa o default documentado (não apura, origem do regime)', () => {
      const r = resolverPoliticaSimples(
        { regimeTributario: 'SIMPLES_NACIONAL' },
        '2026-03',
      );
      expect(r.apuracaoIcmsPropria).toEqual({
        apura: false,
        origem: 'REGIME_SIMPLES_PADRAO',
      });
    });

    it('Simples com apuraIcmsInformado respeita o valor com origem INFORMADO', () => {
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'SIMPLES_NACIONAL',
          vigencias: [{ inicio: '2026-01', apuraIcmsInformado: true }],
        },
        '2026-03',
      );
      expect(r.apuracaoIcmsPropria).toEqual({
        apura: true,
        origem: 'INFORMADO',
      });
    });

    it('sem regime não apura, com origem SEM_REGIME', () => {
      const r = resolverPoliticaSimples({ regimeTributario: null }, '2026-03');
      expect(r.apuracaoIcmsPropria).toEqual({
        apura: false,
        origem: 'SEM_REGIME',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Dimensão 1 — obrigação de EFD ICMS/IPI (ortogonal à apuração)
  // -------------------------------------------------------------------------
  describe('Dimensão 1 — obrigação de EFD ICMS/IPI', () => {
    it.each(['LUCRO_PRESUMIDO', 'LUCRO_REAL'] as const)(
      'Lucro normal (%s) é obrigado à EFD por regime',
      (regimeTributario) => {
        const r = resolverPoliticaSimples({ regimeTributario }, '2026-03');
        expect(r.obrigacaoEfd).toEqual({
          obrigado: true,
          origem: 'REGIME_LUCRO_NORMAL',
        });
      },
    );

    it('Simples é dispensado da EFD por padrão (default documentado)', () => {
      const r = resolverPoliticaSimples(
        { regimeTributario: 'SIMPLES_NACIONAL' },
        '2026-03',
      );
      expect(r.obrigacaoEfd).toEqual({
        obrigado: false,
        origem: 'SIMPLES_DISPENSADO_PADRAO',
      });
    });

    it('Simples obrigado à EFD por declaração estadual (INFORMADO) SEM apurar ICMS próprio', () => {
      // Separação-chave: a obrigação acessória EFD é independente da apuração
      // de ICMS próprio. Um Simples pode escriturar sem apurar em conta gráfica.
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'SIMPLES_NACIONAL',
          vigencias: [{ inicio: '2026-01', obrigadoEfd: true }],
        },
        '2026-03',
      );
      expect(r.obrigacaoEfd).toEqual({ obrigado: true, origem: 'INFORMADO' });
      // ...e continua NÃO apurando ICMS próprio.
      expect(r.apuracaoIcmsPropria.apura).toBe(false);
    });

    it('sem regime não tem obrigação apurável (origem SEM_REGIME)', () => {
      const r = resolverPoliticaSimples({ regimeTributario: null }, '2026-03');
      expect(r.obrigacaoEfd).toEqual({ obrigado: false, origem: 'SEM_REGIME' });
    });
  });

  // -------------------------------------------------------------------------
  // Dimensão 3 — sublimite / impedimento estadual
  // -------------------------------------------------------------------------
  describe('Dimensão 3 — sublimite / impedimento', () => {
    it('não é Simples → situação NAO_APLICAVEL', () => {
      const r = resolverPoliticaSimples(
        { regimeTributario: 'LUCRO_REAL' },
        '2026-03',
      );
      expect(r.sublimite).toEqual({
        situacao: 'NAO_APLICAVEL',
        origem: 'NAO_SIMPLES',
        recolheIcmsForaDoDas: false,
      });
    });

    it('Simples sem parâmetros assume DENTRO com origem SEM_PARAMETRO', () => {
      const r = resolverPoliticaSimples(
        { regimeTributario: 'SIMPLES_NACIONAL' },
        '2026-03',
      );
      expect(r.sublimite).toEqual({
        situacao: 'DENTRO',
        origem: 'SEM_PARAMETRO',
        recolheIcmsForaDoDas: false,
      });
    });

    it('RBT12 dentro do sublimite → DENTRO (origem da comparação)', () => {
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'SIMPLES_NACIONAL',
          vigencias: [
            { inicio: '2026-01', rbt12: '3000000.00', sublimite: '3600000.00' },
          ],
        },
        '2026-03',
      );
      expect(r.sublimite).toEqual({
        situacao: 'DENTRO',
        origem: 'DENTRO_DO_SUBLIMITE',
        recolheIcmsForaDoDas: false,
      });
    });

    it('RBT12 acima do sublimite → EXCEDIDO e recolhe ICMS fora do DAS', () => {
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'SIMPLES_NACIONAL',
          vigencias: [
            { inicio: '2026-01', rbt12: '3600000.01', sublimite: '3600000.00' },
          ],
        },
        '2026-03',
      );
      expect(r.sublimite).toEqual({
        situacao: 'EXCEDIDO',
        origem: 'SUBLIMITE_EXCEDIDO_RBT12',
        recolheIcmsForaDoDas: true,
      });
    });

    it('RBT12 exatamente igual ao sublimite → DENTRO (limite não é excesso)', () => {
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'SIMPLES_NACIONAL',
          vigencias: [
            { inicio: '2026-01', rbt12: '3600000.00', sublimite: '3600000.00' },
          ],
        },
        '2026-03',
      );
      expect(r.sublimite.situacao).toBe('DENTRO');
      expect(r.sublimite.recolheIcmsForaDoDas).toBe(false);
    });

    it('compara limiares com precisão de centavos (sem Number)', () => {
      // Diferença de 1 centavo deve ser detectada como excesso.
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'SIMPLES_NACIONAL',
          vigencias: [
            {
              inicio: '2026-01',
              rbt12: '18000000.01',
              sublimite: '18000000.00',
            },
          ],
        },
        '2026-03',
      );
      expect(r.sublimite.situacao).toBe('EXCEDIDO');
    });

    it('impedimento declarado vence qualquer comparação de valor', () => {
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'SIMPLES_NACIONAL',
          vigencias: [
            {
              inicio: '2026-01',
              impedidoDas: true,
              rbt12: '100000.00',
              sublimite: '3600000.00',
            },
          ],
        },
        '2026-03',
      );
      expect(r.sublimite).toEqual({
        situacao: 'IMPEDIDO',
        origem: 'IMPEDIMENTO_INFORMADO',
        recolheIcmsForaDoDas: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Interação dimensão 3 → dimensão 2: sublimite/impedimento força apuração
  // -------------------------------------------------------------------------
  describe('Sublimite/impedimento força apuração de ICMS próprio (dim 3 → dim 2)', () => {
    it('Simples que excedeu o sublimite passa a apurar ICMS próprio (origem SUBLIMITE_IMPEDIMENTO)', () => {
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'SIMPLES_NACIONAL',
          vigencias: [
            { inicio: '2026-01', rbt12: '4000000.00', sublimite: '3600000.00' },
          ],
        },
        '2026-03',
      );
      expect(r.apuracaoIcmsPropria).toEqual({
        apura: true,
        origem: 'SUBLIMITE_IMPEDIMENTO',
      });
    });

    it('impedimento sobrepõe apuraIcmsInformado=false (força apuração)', () => {
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'SIMPLES_NACIONAL',
          vigencias: [
            { inicio: '2026-01', impedidoDas: true, apuraIcmsInformado: false },
          ],
        },
        '2026-03',
      );
      expect(r.apuracaoIcmsPropria.apura).toBe(true);
      expect(r.apuracaoIcmsPropria.origem).toBe('SUBLIMITE_IMPEDIMENTO');
    });

    it('Lucro normal não é afetado pela dimensão de sublimite', () => {
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'LUCRO_REAL',
          vigencias: [
            { inicio: '2026-01', rbt12: '9999999.00', sublimite: '1.00' },
          ],
        },
        '2026-03',
      );
      expect(r.sublimite.situacao).toBe('NAO_APLICAVEL');
      expect(r.apuracaoIcmsPropria.origem).toBe('REGIME_LUCRO_NORMAL');
    });
  });

  // -------------------------------------------------------------------------
  // Dimensão 4 — obrigações fora do DAS (existem mesmo sem apuração própria)
  // -------------------------------------------------------------------------
  describe('Dimensão 4 — obrigações fora do DAS', () => {
    it('sem declaração → conjunto vazio com origem SEM_OBRIGACOES', () => {
      const r = resolverPoliticaSimples(
        { regimeTributario: 'SIMPLES_NACIONAL' },
        '2026-03',
      );
      expect(r.obrigacoesForaDoDas).toEqual({
        obrigacoes: [],
        origem: 'SEM_OBRIGACOES',
      });
    });

    it('ST/DIFAL existem mesmo sem apuração de ICMS próprio', () => {
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'SIMPLES_NACIONAL',
          vigencias: [
            { inicio: '2026-01', obrigacoesForaDoDas: ['DIFAL', 'ST'] },
          ],
        },
        '2026-03',
      );
      // Normalizadas para a ordem canônica do domínio e sem duplicatas.
      expect(r.obrigacoesForaDoDas).toEqual({
        obrigacoes: ['ST', 'DIFAL'],
        origem: 'INFORMADO',
      });
      // ...e a apuração própria segue sendo falsa (ortogonalidade).
      expect(r.apuracaoIcmsPropria.apura).toBe(false);
    });

    it('remove duplicatas declaradas', () => {
      const r = resolverPoliticaSimples(
        {
          regimeTributario: 'SIMPLES_NACIONAL',
          vigencias: [
            {
              inicio: '2026-01',
              obrigacoesForaDoDas: ['ST', 'ST', 'ANTECIPACAO'],
            },
          ],
        },
        '2026-03',
      );
      expect(r.obrigacoesForaDoDas.obrigacoes).toEqual(['ST', 'ANTECIPACAO']);
    });
  });

  // -------------------------------------------------------------------------
  // R6.4 — correção efetivo-datada (transições de vigência)
  // -------------------------------------------------------------------------
  describe('Vigência efetivo-datada (R6.4)', () => {
    const cruzaSublimiteNoMeioDoAno: PoliticaSimplesInput = {
      regimeTributario: 'SIMPLES_NACIONAL',
      vigencias: [
        // Até junho: dentro do sublimite.
        { inicio: '2026-01', rbt12: '3000000.00', sublimite: '3600000.00' },
        // A partir de julho: excedeu o sublimite.
        { inicio: '2026-07', rbt12: '3800000.00', sublimite: '3600000.00' },
      ],
    };

    it('antes de cruzar o sublimite (junho): DENTRO, não apura próprio', () => {
      const r = resolverPoliticaSimples(cruzaSublimiteNoMeioDoAno, '2026-06');
      expect(r.vigenciaAplicada).toBe('2026-01');
      expect(r.sublimite.situacao).toBe('DENTRO');
      expect(r.apuracaoIcmsPropria.apura).toBe(false);
    });

    it('no mês da transição (julho): EXCEDIDO, passa a apurar próprio', () => {
      const r = resolverPoliticaSimples(cruzaSublimiteNoMeioDoAno, '2026-07');
      expect(r.vigenciaAplicada).toBe('2026-07');
      expect(r.sublimite.situacao).toBe('EXCEDIDO');
      expect(r.apuracaoIcmsPropria).toEqual({
        apura: true,
        origem: 'SUBLIMITE_IMPEDIMENTO',
      });
    });

    it('depois da transição (dezembro): mantém EXCEDIDO (vigência mais recente aplicável)', () => {
      const r = resolverPoliticaSimples(cruzaSublimiteNoMeioDoAno, '2026-12');
      expect(r.vigenciaAplicada).toBe('2026-07');
      expect(r.sublimite.situacao).toBe('EXCEDIDO');
      expect(r.apuracaoIcmsPropria.apura).toBe(true);
    });

    it('competência anterior à primeira vigência → nenhuma vigência aplicada (usa defaults do regime)', () => {
      const r = resolverPoliticaSimples(cruzaSublimiteNoMeioDoAno, '2025-12');
      expect(r.vigenciaAplicada).toBeNull();
      // Sem vigência, cai no default do regime Simples.
      expect(r.sublimite.origem).toBe('SEM_PARAMETRO');
      expect(r.apuracaoIcmsPropria.origem).toBe('REGIME_SIMPLES_PADRAO');
    });

    it('início de impedimento efetivo-datado: antes NÃO apura, a partir do onset apura', () => {
      const input: PoliticaSimplesInput = {
        regimeTributario: 'SIMPLES_NACIONAL',
        vigencias: [
          { inicio: '2026-01' },
          { inicio: '2026-05', impedidoDas: true },
        ],
      };
      const antes = resolverPoliticaSimples(input, '2026-04');
      expect(antes.sublimite.situacao).toBe('DENTRO');
      expect(antes.apuracaoIcmsPropria.apura).toBe(false);

      const noOnset = resolverPoliticaSimples(input, '2026-05');
      expect(noOnset.sublimite.situacao).toBe('IMPEDIDO');
      expect(noOnset.apuracaoIcmsPropria.apura).toBe(true);
    });

    it('seleciona a vigência mais recente aplicável independentemente da ordem de entrada', () => {
      const desordenada: VigenciaSimples[] = [
        { inicio: '2026-07', obrigadoEfd: true },
        { inicio: '2026-01', obrigadoEfd: false },
        { inicio: '2026-04', obrigadoEfd: true },
      ];
      const r = resolverPoliticaSimples(
        { regimeTributario: 'SIMPLES_NACIONAL', vigencias: desordenada },
        '2026-05',
      );
      // 2026-04 é a última com início <= 2026-05.
      expect(r.vigenciaAplicada).toBe('2026-04');
      expect(r.obrigacaoEfd).toEqual({ obrigado: true, origem: 'INFORMADO' });
    });

    it('cada dimensão pode transicionar de forma independente ao longo do tempo', () => {
      const input: PoliticaSimplesInput = {
        regimeTributario: 'SIMPLES_NACIONAL',
        vigencias: [
          // Jan: só EFD obrigatória.
          { inicio: '2026-01', obrigadoEfd: true },
          // Jun: adiciona ST, ainda dentro do sublimite.
          {
            inicio: '2026-06',
            obrigadoEfd: true,
            obrigacoesForaDoDas: ['ST'],
          },
          // Set: cruza o sublimite (apura próprio) e mantém ST.
          {
            inicio: '2026-09',
            obrigadoEfd: true,
            obrigacoesForaDoDas: ['ST'],
            rbt12: '4000000.00',
            sublimite: '3600000.00',
          },
        ],
      };

      const marco = resolverPoliticaSimples(input, '2026-03');
      expect(marco.obrigacaoEfd.obrigado).toBe(true);
      expect(marco.obrigacoesForaDoDas.obrigacoes).toEqual([]);
      expect(marco.apuracaoIcmsPropria.apura).toBe(false);

      const julho = resolverPoliticaSimples(input, '2026-07');
      expect(julho.obrigacaoEfd.obrigado).toBe(true);
      expect(julho.obrigacoesForaDoDas.obrigacoes).toEqual(['ST']);
      expect(julho.apuracaoIcmsPropria.apura).toBe(false);

      const outubro = resolverPoliticaSimples(input, '2026-10');
      expect(outubro.obrigacaoEfd.obrigado).toBe(true);
      expect(outubro.obrigacoesForaDoDas.obrigacoes).toEqual(['ST']);
      expect(outubro.apuracaoIcmsPropria.apura).toBe(true);
      expect(outubro.apuracaoIcmsPropria.origem).toBe('SUBLIMITE_IMPEDIMENTO');
    });
  });

  // -------------------------------------------------------------------------
  // Garantia transversal: toda dimensão sempre tem origem auditável
  // -------------------------------------------------------------------------
  it('nunca produz dimensão sem origem auditável (varredura de combinações)', () => {
    const regimes = [
      'SIMPLES_NACIONAL',
      'LUCRO_PRESUMIDO',
      'LUCRO_REAL',
      null,
    ] as const;
    const competencias = ['2025-12', '2026-01', '2026-07', '2026-12'];
    const vigencias: VigenciaSimples[] = [
      { inicio: '2026-01', apuraIcmsInformado: false },
      {
        inicio: '2026-07',
        rbt12: '4000000.00',
        sublimite: '3600000.00',
        obrigadoEfd: true,
        obrigacoesForaDoDas: ['ST', 'DIFAL'],
      },
    ];

    for (const regimeTributario of regimes) {
      for (const competencia of competencias) {
        const r = resolverPoliticaSimples(
          { regimeTributario, vigencias },
          competencia,
        );
        expect(typeof r.obrigacaoEfd.obrigado).toBe('boolean');
        expect(r.obrigacaoEfd.origem).toBeTruthy();
        expect(typeof r.apuracaoIcmsPropria.apura).toBe('boolean');
        expect(r.apuracaoIcmsPropria.origem).toBeTruthy();
        expect(r.sublimite.situacao).toBeTruthy();
        expect(r.sublimite.origem).toBeTruthy();
        expect(Array.isArray(r.obrigacoesForaDoDas.obrigacoes)).toBe(true);
        expect(r.obrigacoesForaDoDas.origem).toBeTruthy();
      }
    }
  });
});

// ===========================================================================
// Task 6.3 — Matriz fiscal única + consumo por livros e builder (R6.3)
// ===========================================================================

describe('MATRIZ_FISCAL_SIMPLES — matriz aprovada pelo fiscal (R6.3)', () => {
  it('é a fonte única: cada combinação regime × situação de sublimite tem exatamente uma célula', () => {
    const chaves = MATRIZ_FISCAL_SIMPLES.map(
      (c) => `${String(c.regime)}|${c.situacaoSublimite}`,
    );
    const unicas = new Set(chaves);
    expect(unicas.size).toBe(chaves.length);
  });

  it('toda célula carrega uma nota normativa (revisável pelo fiscal)', () => {
    for (const celula of MATRIZ_FISCAL_SIMPLES) {
      expect(celula.nota.trim().length).toBeGreaterThan(0);
    }
  });

  it('a célula do caso base coincide com a resolução da política para o mesmo estado', () => {
    // Simples que excedeu o sublimite: a política deve resolver exatamente a
    // célula EXCEDIDO da matriz (apura próprio, recolhe fora do DAS).
    const celula = celulaMatrizFiscal('SIMPLES_NACIONAL', 'EXCEDIDO');
    expect(celula).toMatchObject({
      apuraIcmsProprio: true,
      recolheForaDoDas: true,
    });

    const r = resolverPoliticaSimples(
      {
        regimeTributario: 'SIMPLES_NACIONAL',
        vigencias: [
          { inicio: '2026-01', rbt12: '4000000.00', sublimite: '3600000.00' },
        ],
      },
      '2026-03',
    );
    expect(r.sublimite.situacao).toBe('EXCEDIDO');
    expect(r.apuracaoIcmsPropria.apura).toBe(celula!.apuraIcmsProprio);
    expect(r.sublimite.recolheIcmsForaDoDas).toBe(celula!.recolheForaDoDas);
  });

  it('cobre Lucro normal, Simples (dentro/excedido/impedido) e sem regime', () => {
    expect(
      celulaMatrizFiscal('LUCRO_REAL', 'NAO_APLICAVEL')?.apuraIcmsProprio,
    ).toBe(true);
    expect(
      celulaMatrizFiscal('LUCRO_PRESUMIDO', 'NAO_APLICAVEL')?.apuraIcmsProprio,
    ).toBe(true);
    expect(
      celulaMatrizFiscal('SIMPLES_NACIONAL', 'DENTRO')?.apuraIcmsProprio,
    ).toBe(false);
    expect(
      celulaMatrizFiscal('SIMPLES_NACIONAL', 'EXCEDIDO')?.apuraIcmsProprio,
    ).toBe(true);
    expect(
      celulaMatrizFiscal('SIMPLES_NACIONAL', 'IMPEDIDO')?.apuraIcmsProprio,
    ).toBe(true);
    expect(celulaMatrizFiscal(null, 'NAO_APLICAVEL')?.apuraIcmsProprio).toBe(
      false,
    );
  });
});

describe('competenciaDeIntervalo — derivação consistente da competência', () => {
  it('usa a competência do fim do intervalo', () => {
    expect(
      competenciaDeIntervalo({
        dataInicio: new Date('2026-08-01T00:00:00.000Z'),
        dataFim: new Date('2026-08-31T23:59:59.999Z'),
      }),
    ).toBe('2026-08');
  });

  it('usa o início quando não há fim', () => {
    expect(
      competenciaDeIntervalo({
        dataInicio: new Date('2026-03-10T12:00:00.000Z'),
      }),
    ).toBe('2026-03');
  });

  it('retorna null quando não há datas (política cai nos defaults do regime)', () => {
    expect(competenciaDeIntervalo({})).toBeNull();
  });
});

describe('apuraIcmsProprioParaConsumidores — ponto único de decisão (R6.3)', () => {
  it('equivale ao legado: Simples com apuraIcms=false não apura próprio', () => {
    expect(
      apuraIcmsProprioParaConsumidores(
        { regimeTributario: 'SIMPLES_NACIONAL', apuraIcms: false },
        null,
      ),
    ).toBe(false);
  });

  it('Simples com apuraIcms=true (confirmado pelo fiscal) apura próprio', () => {
    expect(
      apuraIcmsProprioParaConsumidores(
        { regimeTributario: 'SIMPLES_NACIONAL', apuraIcms: true },
        null,
      ),
    ).toBe(true);
  });

  it('Lucro normal sempre apura próprio, mesmo com apuraIcms=false informado', () => {
    expect(
      apuraIcmsProprioParaConsumidores(
        { regimeTributario: 'LUCRO_REAL', apuraIcms: false },
        '2026-05',
      ),
    ).toBe(true);
    expect(
      apuraIcmsProprioParaConsumidores(
        { regimeTributario: 'LUCRO_PRESUMIDO', apuraIcms: false },
        '2026-05',
      ),
    ).toBe(true);
  });

  it('sem regime não apura próprio', () => {
    expect(
      apuraIcmsProprioParaConsumidores(
        { regimeTributario: null, apuraIcms: true },
        '2026-05',
      ),
    ).toBe(false);
  });
});
