/**
 * MATRIZ DE RISCO DO DIFAL (Fase 4 / tarefa 2.7 — R1.6).
 *
 * O design (§Verificação) e o critério R1.6 pedem testes POR MATRIZ DE RISCO
 * (não cartesiano) cobrindo, de ponta a ponta, os cenários que de fato mudam o
 * resultado do DIFAL de entrada: as alíquotas interestaduais 4/7/12, a base por
 * dentro (gross-up), o benefício fiscal, a retenção (ICMS-ST retido / não-
 * duplicidade) e o regime Simples Nacional. Cada cenário é validado contra as
 * normas estaduais e as notas N10–N12:
 *
 *  - N10 (LC 190/2022 / EC 87/2015): DIFAL ao consumidor final e as
 *    responsabilidades. Aqui recai sobre o DIFAL de ENTRADA do contribuinte
 *    (uso/consumo e ativo), em que o próprio adquirente recolhe a diferença de
 *    alíquota — e sobre a alíquota interestadual de 4% da mercadoria importada
 *    (Res. SF 13/2012), 7% e 12% conforme a origem/destino.
 *  - N11 (SEFAZ-SP — ST por mercadoria): quando há ICMS-ST retido pelo
 *    substituto, NÃO há DIFAL de entrada próprio a recolher — recolher de novo
 *    seria duplicidade (R1.4). A matriz prova a não-duplicidade de ponta a ponta.
 *  - N12 (SEFAZ-BA — dependência estadual do DIFAL): a alíquota interna, a
 *    interestadual e os demais parâmetros vêm do CATÁLOGO versionado por UF,
 *    nunca de uma tabela nacional única; sem regra homologada o resultado é
 *    pendência/simulação, nunca guia (R1.2).
 *  - N09 (LC 123/2006 — Simples Nacional): o Simples recolhe o ICMS próprio no
 *    DAS, mas o DIFAL de ENTRADA (uso/consumo e ativo) é obrigação estadual
 *    devida POR FORA do DAS. O DIFAL não é suprimido para o Simples; é calculado
 *    como para qualquer contribuinte e sinalizado como recolhido fora do DAS.
 *
 * Este arquivo é o teste de INTEGRAÇÃO da matriz pela porta do serviço
 * (`DifalEntradaService`), consumindo o catálogo (regra homologada) e compondo a
 * base — enquanto os specs unitários (`difal-calculador.spec`, `difal-base.spec`)
 * cobrem a aritmética pura de cada peça. Decimais permanecem strings.
 */
import { DifalEntradaService } from './difal-entrada.service';
import type { RegraVersaoResolvida } from './fiscal-normative-catalog.service';

// DB falso: getCliente resolve por .limit (devolvendo também o regime do
// adquirente, exigido pela tarefa 2.7); a busca de itens resolve por .where.
function createDb(
  cliente: { uf: string; regimeTributario?: string | null },
  itens: unknown[],
) {
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('uf' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([
                    {
                      id: 'c1',
                      uf: cliente.uf,
                      regimeTributario: cliente.regimeTributario ?? null,
                    },
                  ]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue(itens),
              }),
            }),
          };
        }),
    },
  };
}

// Catálogo falso: devolve uma regra de DIFAL homologada por hipótese/UF/
// competência (fonte do cálculo, N12), ou `null` quando não há regra vigente.
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

function regraAprovada(
  conteudo: Record<string, unknown>,
): Partial<RegraVersaoResolvida> {
  return { conteudo, escopoAprovado: true, pendente: false };
}

// Item mínimo de entrada-contribuinte (CFOP 2556, base 1.000), com overrides.
function item(overrides: Record<string, unknown> = {}) {
  return {
    documentoFiscalId: 'd1',
    itemId: 'i1',
    cfop: '2556',
    valorBcIcms: '1000.00',
    valorBrutoProduto: '1000.00',
    aliquotaIcms: '12.0000',
    ...overrides,
  };
}

async function apurar(
  cliente: { uf: string; regimeTributario?: string | null },
  itens: unknown[],
  conteudoRegra: Record<string, unknown>,
) {
  const service = new DifalEntradaService(
    createDb(cliente, itens) as never,
    createCatalogo(regraAprovada(conteudoRegra)) as never,
  );
  return service.apurarCompetencia({ clienteId: 'c1', competencia: '2026-09' });
}

describe('DIFAL — matriz de risco (Fase 4 / tarefa 2.7 — R1.6, N09–N12)', () => {
  // ── Alíquotas interestaduais 4 / 7 / 12 (N10, Res. SF 13/2012) ────────────
  describe('alíquotas interestaduais 4/7/12 (N10)', () => {
    it('12% → DIFAL = base × (interna 18 − 12)/100 = 60,00', async () => {
      const r = await apurar(
        { uf: 'SP' },
        [item({ aliquotaIcms: '12.0000' })],
        {
          aliquota_interna: '18.0000',
        },
      );
      expect(r.itens[0].aliquota_interestadual).toBe('12.0000');
      expect(r.itens[0].valor_difal).toBe('60.00');
      expect(r.total_difal_recolher).toBe('60.00');
    });

    it('7% → DIFAL = base × (interna 18 − 7)/100 = 110,00', async () => {
      const r = await apurar({ uf: 'SP' }, [item({ aliquotaIcms: '7.0000' })], {
        aliquota_interna: '18.0000',
      });
      expect(r.itens[0].aliquota_interestadual).toBe('7.0000');
      expect(r.itens[0].valor_difal).toBe('110.00');
    });

    it('4% (origem importada força Res. SF 13/2012) → DIFAL = base × (18 − 4)/100 = 140,00', async () => {
      // Mesmo com 12% destacado no item, a origem importada força 4%.
      const r = await apurar(
        { uf: 'SP' },
        [item({ aliquotaIcms: '12.0000', origemMercadoria: '1' })],
        { aliquota_interna: '18.0000' },
      );
      expect(r.itens[0].origem_importada).toBe(true);
      expect(r.itens[0].aliquota_interestadual).toBe('4.0000');
      expect(r.itens[0].valor_difal).toBe('140.00');
    });
  });

  // ── Base por dentro / gross-up (N12 — composição exigida pela UF) ─────────
  it('base por dentro (gross-up): 1000/(1−18/100)=1219,51 → DIFAL=73,17', async () => {
    const r = await apurar({ uf: 'SP' }, [item()], {
      aliquota_interna: '18.0000',
      base_por_dentro: true,
    });
    expect(r.itens[0].base_calculo).toBe('1219.51');
    expect(r.itens[0].valor_difal).toBe('73.17');
    expect(r.itens[0].memoria_arredondamento).toContain('base_por_dentro');
  });

  // ── Benefício fiscal (N12 — redução de base concedida pela UF) ────────────
  it('benefício fiscal reduz a base e é exposto separado da redução ordinária', async () => {
    // base 1000 → redução 10% (900) → benefício 20% (720).
    const r = await apurar(
      { uf: 'SP' },
      [item({ percentualReducaoBcIcms: '10.0000' })],
      { aliquota_interna: '18.0000', percentual_beneficio: '20.0000' },
    );
    const d = r.itens[0];
    expect(d.base_bruta).toBe('1000.00');
    expect(d.base_calculo).toBe('720.00');
    expect(d.beneficios.percentual_beneficio).toBe('20.0000');
    expect(d.beneficios.valor_beneficio).toBe('180.00');
    // DIFAL = 720 × (18 − 12)/100 = 43,20.
    expect(d.valor_difal).toBe('43.20');
  });

  // ── Retenção / ICMS-ST retido — não-duplicidade (N11, R1.4) ───────────────
  describe('retenção (ICMS-ST retido) — não recolher em duplicidade (N11)', () => {
    it('2556 com ICMS-ST retido vira ST, zera a base e não recolhe próprio', async () => {
      const r = await apurar(
        { uf: 'SP' },
        [item({ valorIcmsStRetido: '80.00' })],
        { aliquota_interna: '18.0000' },
      );
      const d = r.itens[0];
      expect(d.hipotese).toBe('ST');
      expect(d.retido).toBe(true);
      expect(d.recolhimento_proprio).toBe('NAO');
      expect(d.imposto_ja_pago).toBe('80.00');
      expect(d.valor_difal).toBe('0.00');
      expect(r.total_difal_recolher).toBe('0.00');
      expect(r.itens_sem_recolhimento_proprio).toBe(1);
    });

    it('não mistura: item sem ST recolhe; item com ST retido não (sem duplicidade)', async () => {
      const r = await apurar(
        { uf: 'SP' },
        [
          item({ documentoFiscalId: 'd1', itemId: 'i1' }),
          item({
            documentoFiscalId: 'd2',
            itemId: 'i2',
            valorBcIcms: '5000.00',
            valorBrutoProduto: '5000.00',
            valorIcmsStRetido: '300.00',
          }),
        ],
        { aliquota_interna: '18.0000' },
      );
      const [recolhido, retido] = r.itens;
      expect(recolhido.recolhimento_proprio).toBe('SIM');
      expect(recolhido.valor_difal).toBe('60.00');
      expect(retido.recolhimento_proprio).toBe('NAO');
      // Só o item sem ST compõe o total (1000 × 6% = 60); o retido não duplica.
      expect(r.total_difal_recolher).toBe('60.00');
    });
  });

  // ── Simples Nacional — DIFAL de entrada FORA do DAS (N09 — LC 123/2006) ───
  describe('Simples Nacional — DIFAL de entrada fora do DAS (N09)', () => {
    it('adquirente Simples: DIFAL de entrada NÃO é suprimido; é recolhido fora do DAS', async () => {
      // O Simples recolhe o ICMS próprio no DAS, mas o DIFAL de entrada
      // (uso/consumo e ativo) é obrigação estadual devida por fora do DAS. O
      // valor é o mesmo de qualquer contribuinte (60,00); o flag prova que a
      // obrigação é própria do Simples e não foi suprimida.
      const r = await apurar(
        { uf: 'SP', regimeTributario: 'SIMPLES_NACIONAL' },
        [item()],
        { aliquota_interna: '18.0000' },
      );
      const d = r.itens[0];
      expect(r.regime_adquirente).toBe('SIMPLES_NACIONAL');
      expect(d.hipotese).toBe('DIFAL_ENTRADA_CONTRIBUINTE');
      expect(d.valor_difal).toBe('60.00');
      expect(d.recolhimento_proprio).toBe('SIM');
      expect(d.recolhido_fora_do_das).toBe(true);
      expect(r.total_difal_recolher).toBe('60.00');
      expect(r.itens_recolhidos_fora_do_das).toBe(1);
    });

    it('Lucro Presumido/Real: DIFAL de entrada NÃO é marcado como fora do DAS', async () => {
      // Para Lucro normal o DIFAL de entrada corre pela apuração normal; o flag
      // "fora do DAS" é específico do Simples (N09).
      const r = await apurar(
        { uf: 'SP', regimeTributario: 'LUCRO_PRESUMIDO' },
        [item()],
        { aliquota_interna: '18.0000' },
      );
      const d = r.itens[0];
      expect(r.regime_adquirente).toBe('LUCRO_PRESUMIDO');
      expect(d.valor_difal).toBe('60.00');
      expect(d.recolhido_fora_do_das).toBe(false);
      expect(r.itens_recolhidos_fora_do_das).toBe(0);
    });

    it('Simples sob ST retido: nada a recolher, logo nada "fora do DAS" (não-duplicidade)', async () => {
      // Mesmo Simples, se o ICMS-ST foi retido pelo substituto não há DIFAL de
      // entrada próprio — então não há recolhimento a situar fora do DAS (N11).
      const r = await apurar(
        { uf: 'SP', regimeTributario: 'SIMPLES_NACIONAL' },
        [item({ valorIcmsStRetido: '80.00' })],
        { aliquota_interna: '18.0000' },
      );
      const d = r.itens[0];
      expect(d.hipotese).toBe('ST');
      expect(d.recolhido_fora_do_das).toBe(false);
      expect(r.itens_recolhidos_fora_do_das).toBe(0);
      expect(r.total_difal_recolher).toBe('0.00');
    });

    it('regime do adquirente ausente → regime_adquirente null, sem "fora do DAS"', async () => {
      const r = await apurar({ uf: 'SP' }, [item()], {
        aliquota_interna: '18.0000',
      });
      expect(r.regime_adquirente).toBeNull();
      expect(r.itens[0].recolhido_fora_do_das).toBe(false);
    });
  });

  // ── Dependência estadual / escopo honesto (N12, R1.2) ─────────────────────
  it('sem regra homologada no catálogo → pendência, nunca guia (N12 / R1.2)', async () => {
    const service = new DifalEntradaService(
      createDb({ uf: 'BA' }, [item()]) as never,
      createCatalogo(null) as never,
    );
    const r = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(r.itens[0].status_calculo).toBe('PENDENTE');
    expect(r.total_difal_recolher).toBe('0.00');
    expect(r.origem_regra).toBeNull();
  });
});
