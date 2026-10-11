import { NotFoundException } from '@nestjs/common';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
  spedInventarios,
} from '../../database/schema';
import { OnboardingMatrizService } from './onboarding-matriz.service';

/**
 * Testes de SERVIÇO da matriz de onboarding (Fase 5, tarefa 4.1 — R4.1).
 *
 * A lógica de classificação é coberta exaustivamente no núcleo puro
 * (`onboarding-matriz.spec.ts`). Aqui o foco é o CONTRATO DO SERVIÇO: que ele
 * carregue os quatro conjuntos de fatos do banco (cabeçalho+config, contagem de
 * modelos, sinais agregados dos itens e inventários) e os MAPEIE corretamente
 * para a projeção pura, e que trate o escopo (estabelecimento inexistente → 404).
 *
 * O projeto `api` não tem harness de banco vivo (ver
 * `fiscal-item-reconciliation.integration.spec.ts`); seguimos o mesmo caminho:
 * um `db` FALSO cuja superfície (`select().from()...`) devolve linhas canônicas
 * por TABELA-ALVO. Cada query do serviço começa por uma tabela distinta
 * (`clientes`, `documentos_fiscais`, `documentos_fiscais_itens`,
 * `sped_inventarios`), então roteamos a resposta pela tabela do `.from()`.
 */

type Rows = Record<string, unknown>[];

/**
 * Query-builder thenable que ecoa a superfície drizzle usada pelo serviço
 * (`select/from/leftJoin/innerJoin/where/groupBy/limit`) e resolve, quando
 * aguardado, as linhas canônicas associadas à TABELA do `.from()`.
 */
function criarDb(resultadosPorTabela: Map<unknown, Rows>) {
  function builder() {
    let tabela: unknown = null;
    const self: Record<string, unknown> = {};
    const chain = () => self;
    self.from = (t: unknown) => {
      tabela = t;
      return self;
    };
    self.leftJoin = chain;
    self.innerJoin = chain;
    self.where = chain;
    self.groupBy = chain;
    self.orderBy = chain;
    self.limit = chain;
    self.then = (
      resolve: (rows: Rows) => unknown,
      reject?: (e: unknown) => unknown,
    ) =>
      Promise.resolve(resultadosPorTabela.get(tabela) ?? []).then(
        resolve,
        reject,
      );
    return self;
  }
  return { select: () => builder() };
}

function criarServico(resultadosPorTabela: Map<unknown, Rows>) {
  const database = { db: criarDb(resultadosPorTabela) };
  return new OnboardingMatrizService(
    database as unknown as ConstructorParameters<
      typeof OnboardingMatrizService
    >[0],
  );
}

describe('OnboardingMatrizService.montar', () => {
  it('monta a matriz mapeando os quatro conjuntos de fatos do banco', async () => {
    const resultados = new Map<unknown, Rows>([
      [
        clientes,
        [
          {
            clienteId: 'c1',
            razaoSocial: 'Posto Combustível LTDA',
            cnpj: '11222333000181',
            uf: 'SP',
            regimeTributario: 'PRESUMIDO',
            configuracaoId: 'cfg1',
            perfilEfd: 'A',
            indAtiv: '0',
            obrigadoEfdIcmsIpi: true,
            inventarioObrigatorio: true,
            mesEntregaInventario: 2,
            blocoKComMovimento: true,
            indicadores1010: { IND_COMB: 'S' },
          },
        ],
      ],
      [
        documentosFiscais,
        [
          { modelo: '55', quantidade: 12 },
          { modelo: '65', quantidade: 4 },
        ],
      ],
      [
        documentosFiscaisItens,
        [
          {
            itensComCstIcmsMonofasico: 3,
            itensComCstPisCofinsMonofasico: 1,
            itensComCest: 5,
            itensComIcmsSt: 2,
            itensComStRetido: 0,
          },
        ],
      ],
      [
        spedInventarios,
        [{ dataInventario: '2025-12-31', motivo: '01', status: 'FECHADO' }],
      ],
    ]);
    const servico = criarServico(resultados);

    const matriz = await servico.montar({
      clienteId: 'c1',
      competencia: '2026-09',
    });

    expect(matriz.clienteId).toBe('c1');
    expect(matriz.competencia).toBe('2026-09');
    expect(matriz.configurado).toBe(true);
    expect(matriz.perfil).toBe('A');
    expect(matriz.setor.indAtiv).toBe('0');
    expect(matriz.estabelecimento.cnpj).toBe('11222333000181');

    // Modelos mapeados e contados.
    expect(matriz.modelos.map((m) => m.modelo)).toEqual(['55', '65']);

    // Sinais de combustíveis vêm de IND_COMB (config) + CST monofásico (itens).
    expect(matriz.combustiveis.presente).toBe(true);
    expect(matriz.combustiveis.indComb).toBe(true);
    expect(matriz.combustiveis.cstIcmsMonofasico).toBe(true);
    expect(matriz.combustiveis.obrigacao1601Aplicavel).toBe(true);

    // Controles ST mapeados das contagens agregadas.
    expect(matriz.controleSt.presente).toBe(true);
    expect(matriz.controleSt.itensComCest).toBe(5);
    expect(matriz.controleSt.itensComIcmsSt).toBe(2);

    // Inventário por motivo mapeado.
    expect(matriz.inventariosPorMotivo).toHaveLength(1);
    expect(matriz.inventariosPorMotivo[0].motivo).toBe('01');
    expect(matriz.inventariosPorMotivo[0].motivoSuportado).toBe(true);

    // Bloco K industrial COM movimento: aplicável, não suportado (conservador).
    expect(matriz.blocos.blocoK.aplicavel).toBe(true);
    expect(matriz.blocos.blocoK.suportado).toBe(false);

    // Prontidão (4.3): há obrigação não atendida (Bloco K com movimento) →
    // IMPEDIDO, não pronto para entrega.
    expect(matriz.prontidao.prontoParaEntrega).toBe(false);
    expect(matriz.prontidao.status).toBe('IMPEDIDO');
  });

  it('expõe impedimentos explícitos (4.2) quando há documento/obrigação aplicável e não suportado', async () => {
    const resultados = new Map<unknown, Rows>([
      [
        clientes,
        [
          {
            clienteId: 'c3',
            razaoSocial: 'Indústria com CT-e LTDA',
            cnpj: '11222333000181',
            uf: 'SP',
            regimeTributario: 'PRESUMIDO',
            configuracaoId: 'cfg3',
            perfilEfd: 'A',
            indAtiv: '0',
            obrigadoEfdIcmsIpi: true,
            inventarioObrigatorio: true,
            mesEntregaInventario: 2,
            // Bloco K com movimento (aplicável, não suportado) → impedimento.
            blocoKComMovimento: true,
            indicadores1010: {},
          },
        ],
      ],
      // Modelo 57 (CT-e) usado: modelo não suportado + Bloco B aplicável.
      [documentosFiscais, [{ modelo: '57', quantidade: 2 }]],
      [
        documentosFiscaisItens,
        [
          {
            itensComCstIcmsMonofasico: 0,
            itensComCstPisCofinsMonofasico: 0,
            itensComCest: 0,
            itensComIcmsSt: 0,
            itensComStRetido: 0,
          },
        ],
      ],
      // Inventário motivo 02 (não suportado para fechamento) → impedimento.
      [
        spedInventarios,
        [{ dataInventario: '2026-12-31', motivo: '02', status: 'RASCUNHO' }],
      ],
    ]);
    const servico = criarServico(resultados);

    const matriz = await servico.montar({
      clienteId: 'c3',
      competencia: '2026-09',
    });

    // Cada eixo aplicável e não suportado produz impedimento explícito —
    // alinhado aos bloqueios conservadores da geração, nunca arquivo vazio.
    expect(matriz.impedimentos.map((i) => i.codigo).sort()).toEqual([
      'BLOCO_B_NAO_SUPORTADO',
      'BLOCO_K_MOVIMENTO_NAO_CONFIGURADO',
      'INVENTARIO_MOTIVO_NAO_SUPORTADO',
      'MODELO_NAO_SUPORTADO',
    ]);

    // Prontidão (4.3 — R4.4): obrigações não atendidas → NÃO pronto, bloqueios
    // espelham os impedimentos.
    expect(matriz.prontidao.prontoParaEntrega).toBe(false);
    expect(matriz.prontidao.status).toBe('IMPEDIDO');
    expect(matriz.prontidao.bloqueios).toEqual(matriz.impedimentos);
  });

  it('estabelecimento sem configuração SPED: configurado=false, eixos vazios/nulos', async () => {
    const resultados = new Map<unknown, Rows>([
      [
        clientes,
        [
          {
            clienteId: 'c2',
            razaoSocial: 'Empresa Sem Config',
            cnpj: '99888777000166',
            uf: 'MG',
            regimeTributario: null,
            configuracaoId: null,
            perfilEfd: null,
            indAtiv: null,
            obrigadoEfdIcmsIpi: null,
            inventarioObrigatorio: null,
            mesEntregaInventario: null,
            blocoKComMovimento: null,
            indicadores1010: null,
          },
        ],
      ],
      [documentosFiscais, []],
      [
        documentosFiscaisItens,
        [
          {
            itensComCstIcmsMonofasico: 0,
            itensComCstPisCofinsMonofasico: 0,
            itensComCest: 0,
            itensComIcmsSt: 0,
            itensComStRetido: 0,
          },
        ],
      ],
      [spedInventarios, []],
    ]);
    const servico = criarServico(resultados);

    const matriz = await servico.montar({
      clienteId: 'c2',
      competencia: '2026-01',
    });

    expect(matriz.configurado).toBe(false);
    expect(matriz.perfil).toBeNull();
    expect(matriz.modelos).toEqual([]);
    expect(matriz.combustiveis.presente).toBe(false);
    expect(matriz.controleSt.presente).toBe(false);
    expect(matriz.inventariosPorMotivo).toEqual([]);

    // Ausência de registros opcionais não é obrigação não atendida (R4.5): sem
    // impedimentos, o estabelecimento permanece pronto para entrega.
    expect(matriz.impedimentos).toEqual([]);
    expect(matriz.prontidao.prontoParaEntrega).toBe(true);
    expect(matriz.prontidao.status).toBe('PRONTO');
  });

  it('estabelecimento inexistente → NotFound', async () => {
    const servico = criarServico(new Map([[clientes, []]]));
    await expect(
      servico.montar({ clienteId: 'inexistente', competencia: '2026-09' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('competência inválida → erro (o chamador converte em BadRequest)', async () => {
    const servico = criarServico(new Map());
    await expect(
      servico.montar({ clienteId: 'c1', competencia: '2026-13' }),
    ).rejects.toThrow(/AAAA-MM/);
  });
});
