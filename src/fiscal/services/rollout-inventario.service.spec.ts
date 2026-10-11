import { NotFoundException } from '@nestjs/common';
import {
  ciapApropriacoes,
  ciapAtivoPermanente,
  clientes,
  documentosFiscaisCteEscrituracao,
  documentosFiscaisItens,
  fiscalDecisoesItem,
  fiscalEntregas,
  fiscalFechamentos,
} from '../../database/schema';
import { RolloutInventarioService } from './rollout-inventario.service';

/**
 * Testes de SERVIÇO do inventário de rollout (Fase 5, tarefa 5.1 — R5.2).
 *
 * A lógica de classificação é coberta no núcleo puro (`rollout-inventario.spec.ts`).
 * Aqui o foco é o CONTRATO DO SERVIÇO: que ele CARREGUE os fatos do banco (sempre
 * read-only — `select`), os MAPEIE para a projeção pura e trate o escopo
 * (estabelecimento inexistente → 404).
 *
 * Como `onboarding-matriz.service.spec.ts`, o projeto `api` não tem harness de
 * banco vivo: usamos um `db` FALSO cuja superfície (`select().from()...`)
 * devolve linhas canônicas por TABELA-ALVO. Cada consulta começa por uma tabela
 * distinta, então roteamos a resposta pela tabela do `.from()`. O `db` só expõe
 * `select` — qualquer `insert`/`update`/`delete` quebraria o teste, reforçando a
 * natureza read-only do serviço.
 */

type Rows = Record<string, unknown>[];

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
  return new RolloutInventarioService(
    database as unknown as ConstructorParameters<
      typeof RolloutInventarioService
    >[0],
  );
}

describe('RolloutInventarioService.inventariar', () => {
  it('monta o inventário mapeando entregas, fechamentos e operações do banco', async () => {
    const resultados = new Map<unknown, Rows>([
      [clientes, [{ id: 'c1' }]],
      [
        fiscalEntregas,
        [
          {
            id: 'e1',
            obrigacao: 'EFD_ICMS_IPI',
            competencia: '2026-07-01',
            statusValidacao: 'TRANSMITIDA',
            entregaOriginalId: null,
            protocoloNumero: 'P-1',
            transmitidaEm: new Date('2026-08-10T12:00:00.000Z'),
          },
          {
            id: 'e2',
            obrigacao: 'EFD_ICMS_IPI',
            competencia: '2026-07-01',
            statusValidacao: 'VALIDADA',
            entregaOriginalId: 'e1',
            protocoloNumero: 'P-2',
            transmitidaEm: new Date('2026-09-01T12:00:00.000Z'),
          },
        ],
      ],
      [
        fiscalFechamentos,
        [
          {
            obrigacao: 'EFD_ICMS_IPI',
            competencia: '2026-08-01',
            versao: 1,
            estado: 'RASCUNHO',
            corrente: false,
          },
          {
            obrigacao: 'EFD_ICMS_IPI',
            competencia: '2026-07-01',
            versao: 1,
            estado: 'FECHADO',
            corrente: true,
          },
        ],
      ],
      [ciapAtivoPermanente, [{ ativos: 3, saneamento: 1 }]],
      [ciapApropriacoes, [{ total: 2 }]],
      [documentosFiscaisCteEscrituracao, [{ total: 4 }]],
      [fiscalDecisoesItem, [{ total: 5 }]],
      [documentosFiscaisItens, [{ tributados: 10, semDebito: 6 }]],
    ]);
    const servico = criarServico(resultados);

    const inv = await servico.inventariar({ clienteId: 'c1' });

    expect(inv.clienteId).toBe('c1');
    expect(typeof inv.geradoEm).toBe('string');

    // Eixo 1: entregas agrupadas por competência, com retificação contada.
    expect(inv.versoesEntregues).toHaveLength(1);
    expect(inv.versoesEntregues[0].competencia).toBe('2026-07');
    expect(inv.versoesEntregues[0].totalEntregas).toBe(2);
    expect(inv.versoesEntregues[0].retificacoes).toBe(1);
    expect(inv.versoesEntregues[0].transmitida).toBe(true);

    // Eixo 2: 2026-08 aberta (sem corrente fechada); 2026-07 fechada → excluída.
    expect(inv.competenciasAbertas.map((c) => c.competencia)).toEqual([
      '2026-08',
    ]);

    // Eixo 3: operações mapeadas das agregações.
    const ciap = inv.operacoesAfetadas.find((o) => o.tipo === 'CIAP')!;
    expect(ciap.quantidade).toBe(3 + 1 + 2); // ativos + saneamento + vedada
    const cte = inv.operacoesAfetadas.find((o) => o.tipo === 'CTE_SAIDA')!;
    expect(cte.quantidade).toBe(4);
    const vedado = inv.operacoesAfetadas.find(
      (o) => o.tipo === 'CREDITO_VEDADO',
    )!;
    expect(vedado.quantidade).toBe(5);
    const pis = inv.operacoesAfetadas.find((o) => o.tipo === 'PIS_MISTO')!;
    expect(pis.presente).toBe(true);
    expect(pis.quantidade).toBe(16);
  });

  it('estabelecimento sem dados: inventário vazio, nenhuma operação presente', async () => {
    const resultados = new Map<unknown, Rows>([
      [clientes, [{ id: 'c2' }]],
      [fiscalEntregas, []],
      [fiscalFechamentos, []],
      [ciapAtivoPermanente, []],
      [ciapApropriacoes, []],
      [documentosFiscaisCteEscrituracao, []],
      [fiscalDecisoesItem, []],
      [documentosFiscaisItens, []],
    ]);
    const servico = criarServico(resultados);

    const inv = await servico.inventariar({ clienteId: 'c2' });

    expect(inv.versoesEntregues).toEqual([]);
    expect(inv.competenciasAbertas).toEqual([]);
    expect(inv.operacoesAfetadas.every((o) => !o.presente)).toBe(true);
    expect(inv.resumo.tiposOperacaoAfetadaPresentes).toBe(0);
  });

  it('estabelecimento inexistente → NotFound', async () => {
    const servico = criarServico(new Map([[clientes, []]]));
    await expect(
      servico.inventariar({ clienteId: 'inexistente' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
