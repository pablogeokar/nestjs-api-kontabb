import { NotFoundException } from '@nestjs/common';
import {
  ciapAtivoPermanente,
  clientes,
  documentosFiscais,
  eventosAuditoria,
  fiscalApuracoesGuias,
  fiscalDecisoesItem,
  fiscalEntregas,
  fiscalFechamentos,
} from '../../database/schema';
import { RolloutMetricasService } from './rollout-metricas.service';

/**
 * Testes de SERVIÇO das métricas de rollout §13.3 (Fase 5, tarefa 5.5 — R5.5).
 *
 * A lógica de montagem é coberta no núcleo puro (`rollout-metricas.spec.ts`).
 * Aqui o foco é o CONTRATO DO SERVIÇO: que ele AGREGUE os fatos do banco
 * (sempre read-only — `select`), os MAPEIE para o painel puro e trate o escopo
 * (estabelecimento inexistente → 404).
 *
 * Como `rollout-inventario.service.spec.ts`, o projeto `api` não tem harness de
 * banco vivo: usamos um `db` FALSO cuja superfície (`select().from()...`)
 * devolve linhas canônicas por TABELA-ALVO (`.from()`). Cada métrica começa a
 * consulta por uma tabela distinta; quando a mesma tabela é varrida por mais de
 * uma métrica (ex.: `fiscal_apuracoes_guias`), a linha devolvida carrega TODOS
 * os aliases que as diferentes agregações esperam. O `db` só expõe `select` —
 * qualquer `insert`/`update`/`delete` quebraria o teste, reforçando a natureza
 * read-only do serviço.
 */

type Rows = Record<string, unknown>[];

function criarDb(resultadosPorTabela: Map<unknown, Rows>) {
  function builder() {
    let tabela: unknown = null;
    const self: Record<string, unknown> = {};
    const chain = () => self;
    self.from = (t: unknown) => {
      // A primeira tabela do `.from()` decide a resposta (joins não trocam).
      if (tabela === null) tabela = t;
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
  return new RolloutMetricasService(
    database as unknown as ConstructorParameters<
      typeof RolloutMetricasService
    >[0],
  );
}

describe('RolloutMetricasService.medir', () => {
  it('monta o painel de §13.3 agregando as oito métricas do banco', async () => {
    const resultados = new Map<unknown, Rows>([
      [clientes, [{ id: 'c1' }]],
      // fiscal_apuracoes_guias é varrido por 4 agregações distintas; a linha
      // carrega todos os aliases esperados por elas.
      [
        fiscalApuracoesGuias,
        [
          {
            // (1) diferença por tributo (GROUP BY tributo):
            tributo: 'ICMS_PROPRIO',
            somaDiferencaAbsoluta: '42.00',
            guiasDivergentes: 2,
            // (3) pendências:
            pendentes: 5,
            vencidas: 1,
            // (4) idempotência (contagem simples via `total`):
            total: 7,
            // (6) sem vínculo:
            apuracao: 0,
            manuais: 3,
          },
        ],
      ],
      [fiscalDecisoesItem, [{ comFundamento: 9, semFundamento: 4 }]],
      [ciapAtivoPermanente, [{ total: 2 }]],
      [fiscalEntregas, [{ total: 6 }]],
      [fiscalFechamentos, [{ total: 1 }]],
      [documentosFiscais, [{ total: 8 }]],
      [eventosAuditoria, [{ total: 24 }]],
    ]);
    const servico = criarServico(resultados);

    const m = await servico.medir({ clienteId: 'c1' });

    expect(m.clienteId).toBe('c1');
    expect(typeof m.geradoEm).toBe('string');

    // (1) diferença por tributo
    expect(m.diferencaPorTributo).toEqual([
      {
        tributo: 'ICMS_PROPRIO',
        diferencaAbsoluta: '42.00',
        guiasDivergentes: 2,
      },
    ]);
    // (2) créditos com/sem fundamento
    expect(m.creditos).toEqual({
      comFundamento: 9,
      semFundamento: 4,
      total: 13,
    });
    // (3) pendências
    expect(m.pendencias).toEqual({ pendentes: 5, vencidas: 1, total: 6 });
    // (4) repetições bloqueadas: idempotência (guias `total`=7) + CIAP (2)
    expect(m.repeticoesBloqueadas).toEqual({
      guiasIdempotentes: 7,
      ciapSaneamentoBloqueado: 2,
      total: 9,
    });
    // (5) rejeições PVA (entregas `total`=6)
    expect(m.rejeicoesPva).toBe(6);
    // (6) guias sem vínculo
    expect(m.guiasSemVinculo).toEqual({
      apuracaoSemVinculo: 0,
      manuaisSemVinculo: 3,
      total: 3,
    });
    // (7) mudanças pós-fechamento: fechamentos (`total`=1) + entregas (`total`=6)
    expect(m.mudancasPosFechamento).toEqual({
      fechamentosRetificados: 1,
      entregasRetificadoras: 6,
      total: 7,
    });
    // (8) consultas por documento: 24 consultas / 8 documentos = 3.0000
    expect(m.consultasPorDocumento).toEqual({
      documentos: 8,
      consultas: 24,
      razao: '3.0000',
    });
  });

  it('estabelecimento sem dados: painel todo zerado', async () => {
    const resultados = new Map<unknown, Rows>([
      [clientes, [{ id: 'c2' }]],
      [fiscalApuracoesGuias, []],
      [fiscalDecisoesItem, []],
      [ciapAtivoPermanente, []],
      [fiscalEntregas, []],
      [fiscalFechamentos, []],
      [documentosFiscais, []],
      [eventosAuditoria, []],
    ]);
    const servico = criarServico(resultados);

    const m = await servico.medir({ clienteId: 'c2' });

    expect(m.diferencaPorTributo).toEqual([]);
    expect(m.creditos.total).toBe(0);
    expect(m.pendencias.total).toBe(0);
    expect(m.repeticoesBloqueadas.total).toBe(0);
    expect(m.rejeicoesPva).toBe(0);
    expect(m.guiasSemVinculo.total).toBe(0);
    expect(m.mudancasPosFechamento.total).toBe(0);
    expect(m.consultasPorDocumento).toEqual({
      documentos: 0,
      consultas: 0,
      razao: '0.0000',
    });
  });

  it('estabelecimento inexistente → NotFound', async () => {
    const servico = criarServico(new Map([[clientes, []]]));
    await expect(
      servico.medir({ clienteId: 'inexistente' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
