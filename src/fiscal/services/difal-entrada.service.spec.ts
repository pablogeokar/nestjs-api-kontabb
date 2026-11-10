import { PgDialect } from 'drizzle-orm/pg-core';
import { DifalEntradaService } from './difal-entrada.service';
import type { RegraVersaoResolvida } from './fiscal-normative-catalog.service';

// DB falso: getCliente resolve por .limit; a busca de itens resolve por .where.
function createDb(
  uf: string,
  itens: unknown[],
  entradasForaDoCalculo: unknown[] = [],
  regimeTributario?: string,
) {
  const whereConferencia = jest.fn().mockReturnValue({
    groupBy: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockResolvedValue(entradasForaDoCalculo),
    }),
  });
  const whereItens = jest.fn().mockResolvedValue(itens);
  return {
    whereItens,
    whereConferencia,
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('uf' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([{ id: 'c1', uf, regimeTributario }]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: 'numero_documento' in selection ? whereConferencia : whereItens,
              }),
            }),
          };
        }),
    },
  };
}

// Catálogo falso (tarefa 2.2): devolve uma regra de DIFAL já resolvida por
// hipótese/UF/competência, ou `null` quando não há regra vigente. Substitui a
// tabela modal fixa como fonte do cálculo.
function createCatalogo(regra: Partial<RegraVersaoResolvida> | null): {
  resolverRegraVigente: jest.Mock;
} {
  return {
    resolverRegraVigente: jest.fn().mockResolvedValue(
      regra == null
        ? null
        : {
            id: 'reg-1',
            catalogoVersaoId: 'cat-1',
            chave: 'DIFAL_ENTRADA_CONTRIBUINTE',
            revisao: 1,
            conteudo: {},
            fonte: 'LC190/2022',
            fonteUrl: null,
            responsavelPor: null,
            vigenciaInicio: '2026-01-01',
            vigenciaFim: null,
            competencia: '2026-09-01',
            escopoAprovado: true,
            pendente: false,
            ...regra,
          },
    ),
  };
}

// Regra aprovada e vigente com alíquota interna no conteúdo (fonte do cálculo).
function regraAprovada(
  conteudo: Record<string, unknown>,
): Partial<RegraVersaoResolvida> {
  return { conteudo, escopoAprovado: true, pendente: false };
}

describe('DifalEntradaService (tarefa 2.2 — cálculo parametrizado pelo catálogo)', () => {
  it('seleciona pelo período de entrada e delimita os CFOPs interestaduais', async () => {
    const database = createDb('SP', []);
    const service = new DifalEntradaService(database as never, createCatalogo(null) as never);

    await service.apurarCompetencia({ clienteId: 'c1', competencia: '2026-09' });

    const query = new PgDialect().sqlToQuery(database.whereItens.mock.calls[0][0]);
    expect(query.sql).toContain('"documentos_fiscais"."data_entrada_saida_fiscal"');
    expect(query.sql).toContain('"documentos_fiscais_itens"."cfop" in (');
    expect(query.sql).toContain('IS DISTINCT FROM');
    expect(query.params).toEqual(expect.arrayContaining(['c1', 'SP', '2551', '2556', '2406', '2407']));
  });

  it('mostra a nota em revisão sem incluir seus itens no total a recolher', async () => {
    const entrada = {
      documento_fiscal_id: 'd1',
      numero_documento: '123',
      competencia_emissao: '2026-10',
      uf_origem: 'SE',
      situacao: 'EM_REVISAO',
      quantidade_itens: 6,
    };
    const database = createDb('BA', [], [entrada]);
    const catalogo = createCatalogo(regraAprovada({ aliquota_interna: '18' }));
    const service = new DifalEntradaService(database as never, catalogo as never);

    const result = await service.apurarCompetencia({ clienteId: 'c1', competencia: '2026-10' });

    expect(result.entradas_fora_do_calculo).toEqual([entrada]);
    expect(result.itens).toEqual([]);
    expect(result.total_difal_recolher).toBe('0.00');
    const query = new PgDialect().sqlToQuery(database.whereConferencia.mock.calls[0][0]);
    expect(query.sql).toContain('"documentos_fiscais_itens"."cfop_revisao_necessaria"');
    expect(query.sql).toContain('"documentos_fiscais"."tp_nf_xml" IS DISTINCT FROM');
    expect(query.params).toEqual(expect.arrayContaining(['c1', 'BA', 'NFE', 'ENTRADA']));
  });

  it('mantém os valores de DIFAL e Antecipação Parcial em totais separados', async () => {
    const database = createDb('BA', [
      { cfop: '2556', valorBcIcms: '1000.00', aliquotaIcms: '12.0000' },
      {
        cfop: '2102',
        emitenteUf: 'SE',
        ncm: '17041000',
        cest: null,
        valorBrutoProduto: '1000.00',
        valorIcms: '120.00',
      },
    ], [], 'LUCRO_REAL');
    const regraDifal = { escopoAprovado: true, conteudo: { aliquota_interna: '18' } };
    const regraAntecipacao = {
      escopoAprovado: true,
      conteudo: { enquadramentos: [{
        ncm: '17041000',
        cest: null,
        regime: 'LUCRO_REAL',
        tratamento: 'APLICAVEL',
        aliquota_interna: '20.5',
      }] },
    };
    const catalogo = {
      resolverRegraVigente: jest.fn(({ chave }) =>
        Promise.resolve(chave === 'ANTECIPACAO_PARCIAL' ? regraAntecipacao : regraDifal),
      ),
    };
    const service = new DifalEntradaService(database as never, catalogo as never);
    const result = await service.apurarCompetencia({ clienteId: 'c1', competencia: '2026-10' });

    expect(result.quantidade_itens).toBe(1);
    expect(result.total_difal_recolher).toBe('60.00');
    expect(result.antecipacao_parcial).toMatchObject({
      total_apurado: '85.00',
      itens: [{ situacao: 'CALCULADO', calculo: { valor_antecipacao: '85.00' } }],
    });
  });

  it('calcula DIFAL com a alíquota interna vinda do CATÁLOGO, não da tabela fixa', async () => {
    // Regra do catálogo: interna 18%. Item 2556, base 1.000, interestadual 12%.
    // DIFAL = 1000 * (18 - 12)/100 = 60,00. A tabela modal fixa não é usada.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.uf_adquirente).toBe('SP');
    expect(result.total_difal_recolher).toBe('60.00');
    expect(result.itens[0].valor_difal).toBe('60.00');
    expect(result.itens[0].status_calculo).toBe('CALCULADO');
    expect(result.itens[0].aliquota_interna).toBe('18.0000');
    expect(result.itens_por_status.CALCULADO).toBe(1);
    expect(result.origem_regra?.fonte).toBe('LC190/2022');
  });

  it('usa a alíquota interestadual da REGRA quando o item não a destaca (sem presumir 12%)', async () => {
    // Regra do catálogo: interna 17%, interestadual 7%. Ativo 2551, base 2.000,
    // sem alíquota no item. DIFAL = 2000 * (17 - 7)/100 = 200,00.
    const service = new DifalEntradaService(
      createDb('RS', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2551',
          valorBcIcms: '0.00',
          valorBrutoProduto: '2000.00',
          aliquotaIcms: null,
        },
      ]) as never,
      createCatalogo(
        regraAprovada({
          aliquota_interna: '17.0000',
          aliquota_interestadual: '7.0000',
        }),
      ) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.total_difal_recolher).toBe('200.00');
    expect(result.itens[0].aliquota_interestadual).toBe('7.0000');
  });

  it('calcula FCP separado quando a regra o institui', async () => {
    // Regra: interna 18%, interestadual 12%, FCP 2%. Base 1.000.
    // DIFAL = 1000 * 6/100 = 60,00; FCP = 1000 * 2/100 = 20,00.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
        },
      ]) as never,
      createCatalogo(
        regraAprovada({
          aliquota_interna: '18.0000',
          aliquota_fcp: '2.0000',
        }),
      ) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].valor_difal).toBe('60.00');
    expect(result.itens[0].valor_fcp).toBe('20.00');
    expect(result.total_fcp_recolher).toBe('20.00');
    expect(result.itens[0].aliquota_fcp).toBe('2.0000');
  });

  it('não gera DIFAL negativo quando interestadual >= interna', async () => {
    // Regra: interna 17%, item interestadual 17% => diferença zero.
    const service = new DifalEntradaService(
      createDb('SC', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '17.0000',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '17.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.total_difal_recolher).toBe('0.00');
  });

  it('SEM regra homologada no catálogo → PENDÊNCIA, nunca guia (R1.2)', async () => {
    // Nenhuma regra vigente: o item é pendência; não vira valor a recolher nem
    // usa a tabela modal fixa como fonte de verdade.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
        },
      ]) as never,
      createCatalogo(null) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].status_calculo).toBe('PENDENTE');
    expect(result.itens[0].pendente).toBe(true);
    expect(result.itens_por_status.PENDENTE).toBe(1);
    expect(result.total_difal_recolher).toBe('0.00');
    expect(result.origem_regra).toBeNull();
    // A referência legada é exposta como referência identificada, não cálculo.
    expect(result.aliquota_interna_referencia_legada).toBe('18');
  });

  it('regra vigente porém NÃO aprovada → SIMULAÇÃO, não entra no total a recolher (R1.2)', async () => {
    // Regra existe e tem alíquota, mas não está aprovada: calcula o valor como
    // simulação identificada, sem compor o total a recolher (não é guia).
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
        },
      ]) as never,
      createCatalogo({
        conteudo: { aliquota_interna: '18.0000' },
        escopoAprovado: false,
        pendente: true,
      }) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].status_calculo).toBe('SIMULACAO');
    expect(result.itens[0].valor_difal).toBe('60.00');
    expect(result.itens_por_status.SIMULACAO).toBe(1);
    // Simulação NÃO compõe o total a recolher.
    expect(result.total_difal_recolher).toBe('0.00');
  });

  it('item sob ST (2407) é separado como ST e não calculado como entrada-contribuinte', async () => {
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2407',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].hipotese).toBe('ST');
    expect(result.itens[0].status_calculo).toBeNull();
    expect(result.itens_por_hipotese.ST).toBe(1);
    expect(result.total_difal_recolher).toBe('0.00');
  });

  it('mantém em pendência quando o catálogo contém alíquota inválida', async () => {
    const service = new DifalEntradaService(
      createDb('SP', [{
        cfop: '2556',
        valorBcIcms: '1000.00',
        aliquotaIcms: '12.0000',
      }]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18', aliquota_fcp: 'inválida' })) as never,
    );

    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].status_calculo).toBe('PENDENTE');
    expect(result.itens[0].memoria_calculo).toContain('parâmetros inválidos');
    expect(result.total_difal_recolher).toBe('0.00');
    expect(result.total_fcp_recolher).toBe('0.00');
  });

  it('rejeita competência inválida', async () => {
    const service = new DifalEntradaService(
      createDb('SP', []) as never,
      createCatalogo(null) as never,
    );
    await expect(
      service.apurarCompetencia({ clienteId: 'c1', competencia: '2026-13' }),
    ).rejects.toThrow('Competência inválida');
  });

  // ── Composição da base (tarefa 2.4 — R1.3, R1.5) ──────────────────────────

  it('origem importada força interestadual 4% e expõe no detalhe', async () => {
    // Mercadoria importada (origem 1): mesmo que o item destaque 12%, a
    // composição força 4%. DIFAL = 1000 * (18 - 4)/100 = 140,00.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
          origemMercadoria: '1',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].origem_importada).toBe(true);
    expect(result.itens[0].aliquota_interestadual).toBe('4.0000');
    expect(result.itens[0].valor_difal).toBe('140.00');
    expect(result.total_difal_recolher).toBe('140.00');
  });

  it('aplica redução de base do item e documenta na memória de arredondamento', async () => {
    // Sem base destacada, redução de 30% sobre 1000 resulta em base 700.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: null,
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
          percentualReducaoBcIcms: '30.0000',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].base_calculo).toBe('700.00');
    expect(result.itens[0].valor_difal).toBe('42.00');
    expect(result.itens[0].memoria_arredondamento).toContain('reducao_base');
    expect(result.itens[0].memoria_arredondamento).toContain('arredondado');
  });

  it.each([
    ['70.00', null, '1120.48', '120.48', '0.00', 'CALCULADO'],
    ['70.00', '2.0000', '1148.15', '125.19', '22.96', 'CALCULADO'],
    [null, null, '1000.00', '0.00', '0.00', 'PENDENTE'],
  ])('apura base dupla com ICMS de origem %s e FCP %s', async (valorIcms, aliquotaFcp, base, difal, fcp, status) => {
    const service = new DifalEntradaService(
      createDb('MT', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2551',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '980.00',
          valorIpi: '20.00',
          valorIcms,
          aliquotaIcms: '7.0000',
        },
      ]) as never,
      createCatalogo(regraAprovada({
        aliquota_interna: '17.0000',
        base_dupla: true,
        aliquota_fcp: aliquotaFcp,
        fcp_na_base_por_dentro: aliquotaFcp != null,
      })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.itens[0]).toMatchObject({
      base_calculo: base,
      icms_origem: valorIcms,
      valor_difal: difal,
      valor_fcp: fcp,
      status_calculo: status,
    });
    expect(result.total_difal_recolher).toBe(difal);
    expect(result.total_fcp_recolher).toBe(fcp);
  });

  it('faz o gross-up (base por dentro) quando a regra exige', async () => {
    // base 1000 / (1 − 18/100) = 1219,51. DIFAL = 1219,51 * (18 - 12)/100 = 73,17.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
        },
      ]) as never,
      createCatalogo(
        regraAprovada({
          aliquota_interna: '18.0000',
          base_por_dentro: true,
        }),
      ) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].base_calculo).toBe('1219.51');
    expect(result.itens[0].valor_difal).toBe('73.17');
    expect(result.itens[0].memoria_arredondamento).toContain('base_por_dentro');
  });

  it('mercadoria com ICMS-ST retido zera a base própria (não recolher em duplicidade)', async () => {
    // Item 2556 (seria entrada-contribuinte), mas com ICMS-ST retido: a
    // classificação o roteia para ST; aqui conferimos que a composição também
    // sinaliza retenção. Como ST não é calculada aqui, o detalhe reflete retido.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
          valorIcmsStRetido: '80.00',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].hipotese).toBe('ST');
    expect(result.itens[0].retido).toBe(true);
    expect(result.total_difal_recolher).toBe('0.00');
  });

  // ── Não-duplicidade sob retenção/responsabilidade ST (tarefa 2.5 — R1.4) ──

  it('2406/2407 permanecem na BUSCA, mas são roteados a ST sem recolhimento próprio', async () => {
    // DECISÃO 2.5: 2406/2407 continuam no conjunto de busca para que apareçam no
    // resultado — porém jamais como DIFAL próprio. Devem sair como ST, com
    // recolhimento_proprio = 'NAO' e motivo, e nunca compor o total.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2406',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
        },
        {
          documentoFiscalId: 'd2',
          itemId: 'i2',
          cfop: '2407',
          valorBcIcms: '2000.00',
          valorBrutoProduto: '2000.00',
          aliquotaIcms: '12.0000',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    // Ambos aparecem no resultado (não foram omitidos da busca).
    expect(result.quantidade_itens).toBe(2);
    for (const detalhe of result.itens) {
      expect(detalhe.hipotese).toBe('ST');
      expect(detalhe.recolhimento_proprio).toBe('NAO');
      expect(detalhe.motivo_nao_recolhimento).toContain('substituição');
      expect(detalhe.valor_difal).toBe('0.00');
    }
    expect(result.itens_por_hipotese.ST).toBe(2);
    expect(result.itens_sem_recolhimento_proprio).toBe(2);
    expect(result.total_difal_recolher).toBe('0.00');
  });

  it('ICMS-ST retido em CFOP de entrada-contribuinte (2556) não recolhe DIFAL próprio', async () => {
    // 2556 isolado seria entrada-contribuinte; com ICMS-ST retido, a análise de
    // responsabilidade o impede de recolher (não-duplicidade), de forma
    // auditável no detalhe do item.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
          valorIcmsStRetido: '80.00',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].recolhimento_proprio).toBe('NAO');
    expect(result.itens[0].motivo_nao_recolhimento).toContain('R1.4');
    expect(result.itens_sem_recolhimento_proprio).toBe(1);
    expect(result.total_difal_recolher).toBe('0.00');
  });

  it('não mistura: um item recolhe (entrada-contribuinte) e outro não (ST retido)', async () => {
    // Dois itens com a MESMA regra homologada: o 2556 sem ST recolhe; o 2556 com
    // ST retido não. Só o primeiro compõe o total — não há duplicidade sobre o
    // segundo, cujo imposto já foi retido pelo substituto.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
        },
        {
          documentoFiscalId: 'd2',
          itemId: 'i2',
          cfop: '2556',
          valorBcIcms: '5000.00',
          valorBrutoProduto: '5000.00',
          aliquotaIcms: '12.0000',
          valorIcmsStRetido: '300.00',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    const [recolhido, retido] = result.itens;
    expect(recolhido.recolhimento_proprio).toBe('SIM');
    expect(recolhido.valor_difal).toBe('60.00');
    expect(retido.recolhimento_proprio).toBe('NAO');
    expect(retido.hipotese).toBe('ST');
    expect(retido.valor_difal).toBe('0.00');
    // Total = só o item sem ST (1000 * 6% = 60). O item retido não duplica.
    expect(result.total_difal_recolher).toBe('60.00');
    expect(result.itens_sem_recolhimento_proprio).toBe(1);
  });

  // ── Exposição completa do resultado (tarefa 2.6 — R1.5) ───────────────────

  it('expõe UF origem/destino, responsável, benefícios e imposto já pago por item', async () => {
    // Entrada-contribuinte (2556) de MG→SP, com redução de base de 10% e regra
    // com benefício de 20%. Responsável = ADQUIRENTE. Sem ST → imposto já pago 0.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          emitenteUf: 'MG',
          valorBcIcms: null,
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
          percentualReducaoBcIcms: '10.0000',
        },
      ]) as never,
      createCatalogo(
        regraAprovada({
          aliquota_interna: '18.0000',
          percentual_beneficio: '20.0000',
        }),
      ) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    const item = result.itens[0];
    expect(item.uf_origem).toBe('MG');
    expect(item.uf_destino).toBe('SP');
    expect(item.responsavel).toBe('ADQUIRENTE');
    // base 1000 → redução 10% (900) → benefício 20% (720).
    expect(item.base_bruta).toBe('1000.00');
    expect(item.base_calculo).toBe('720.00');
    expect(item.beneficios.percentual_reducao).toBe('10.0000');
    expect(item.beneficios.valor_reducao).toBe('100.00');
    expect(item.beneficios.percentual_beneficio).toBe('20.0000');
    expect(item.beneficios.valor_beneficio).toBe('180.00');
    expect(item.imposto_ja_pago).toBe('0.00');
    // DIFAL = 720 * (18 - 12)/100 = 43,20.
    expect(item.valor_difal).toBe('43.20');
  });

  it('item sob ST expõe responsável TERCEIRO e o imposto já pago (ICMS-ST retido)', async () => {
    // 2556 com ICMS-ST retido → hipótese ST, responsável TERCEIRO. O imposto já
    // retido é exposto como imposto_ja_pago, ao lado de recolhimento_proprio=NAO.
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          emitenteUf: 'PR',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
          valorIcmsStRetido: '80.00',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    const item = result.itens[0];
    expect(item.hipotese).toBe('ST');
    expect(item.responsavel).toBe('TERCEIRO');
    expect(item.uf_origem).toBe('PR');
    expect(item.uf_destino).toBe('SP');
    expect(item.imposto_ja_pago).toBe('80.00');
    expect(item.recolhimento_proprio).toBe('NAO');
    expect(item.valor_difal).toBe('0.00');
  });

  it('uf_origem é null quando o emitente não traz a UF', async () => {
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          emitenteUf: null,
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].uf_origem).toBeNull();
    expect(result.itens[0].uf_destino).toBe('SP');
  });

  it('item entrada-contribuinte normal expõe recolhimento_proprio = SIM', async () => {
    const service = new DifalEntradaService(
      createDb('SP', [
        {
          documentoFiscalId: 'd1',
          itemId: 'i1',
          cfop: '2556',
          valorBcIcms: '1000.00',
          valorBrutoProduto: '1000.00',
          aliquotaIcms: '12.0000',
        },
      ]) as never,
      createCatalogo(regraAprovada({ aliquota_interna: '18.0000' })) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(result.itens[0].recolhimento_proprio).toBe('SIM');
    expect(result.itens[0].motivo_nao_recolhimento).toBeNull();
    expect(result.itens_sem_recolhimento_proprio).toBe(0);
  });
});
