import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
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
import {
  montarMetricasRollout,
  type DiferencaTributoFato,
  type RolloutMetricas,
  type RolloutMetricasFatos,
} from './rollout-metricas';

/**
 * `entidade_tipo` dos eventos de auditoria que representam uma CONSULTA/leitura
 * de um documento fiscal. Usado para a métrica (8) tempo/consultas por
 * documento: contamos eventos de leitura amarrados aos documentos do escopo.
 */
const ENTIDADE_DOCUMENTO_FISCAL = 'documento_fiscal';

/**
 * MÉTRICAS DE ROLLOUT (§13.3) READ-ONLY (Fase 5, tarefa 5.5 — R5.5).
 *
 * Serviço ESTRITAMENTE READ-ONLY que CARREGA os fatos agregados do banco e
 * delega a montagem do painel de §13.3 ao núcleo PURO `montarMetricasRollout`.
 * Espelha o padrão de `RolloutInventarioService`/`OnboardingMatrizService`:
 * toda leitura é `select` (nunca `insert`/`update`/`delete`), as agregações
 * acontecem no SQL com `count(*)`/`count(*) filter`/`sum` — SEM N+1 e sem
 * carregar linha a linha — e a derivação final fica no núcleo puro, testável
 * sem banco e determinística.
 *
 * O design pede atenção a "N+1 e caches por versão": cada métrica é uma única
 * varredura agregada por fonte, e as agregações sobre `fiscal_fechamentos`
 * respeitam a semântica de VERSÃO (a corrente aprovada), em vez de recontar
 * versões históricas como se fossem fechamentos distintos.
 *
 * As métricas NÃO decidem ativação de correção, não retificam e não
 * reconstroem nada — apenas instrumentam o retrato quantitativo do §13.3.
 */
@Injectable()
export class RolloutMetricasService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Monta as métricas de §13.3 do estabelecimento (`clienteId`). Lança 404
   * quando o estabelecimento não existe. É read-only: nenhuma linha é alterada.
   */
  async medir(input: { clienteId: string }): Promise<RolloutMetricas> {
    await this.assertCliente(input.clienteId);
    const cid = input.clienteId;

    const [
      diferencasPorTributo,
      creditos,
      pendencias,
      repeticoes,
      rejeicoesPva,
      semVinculo,
      mudancas,
      consultas,
    ] = await Promise.all([
      this.agregarDiferencaPorTributo(cid),
      this.agregarCreditos(cid),
      this.agregarPendencias(cid),
      this.agregarRepeticoesBloqueadas(cid),
      this.contarRejeicoesPva(cid),
      this.agregarGuiasSemVinculo(cid),
      this.agregarMudancasPosFechamento(cid),
      this.agregarConsultasPorDocumento(cid),
    ]);

    const fatos: RolloutMetricasFatos = {
      clienteId: cid,
      geradoEm: new Date().toISOString(),
      diferencasPorTributo,
      creditosComFundamento: creditos.comFundamento,
      creditosSemFundamento: creditos.semFundamento,
      guiasPendentes: pendencias.pendentes,
      guiasVencidas: pendencias.vencidas,
      guiasComIdempotencyKey: repeticoes.idempotentes,
      ciapSaneamentoBloqueado: repeticoes.saneamento,
      entregasRejeitadasPva: rejeicoesPva,
      guiasApuracaoSemVinculo: semVinculo.apuracao,
      guiasManuaisSemVinculo: semVinculo.manuais,
      fechamentosRetificados: mudancas.fechamentos,
      entregasRetificadoras: mudancas.entregas,
      documentosFiscais: consultas.documentos,
      consultasObservadas: consultas.consultas,
    };

    return montarMetricasRollout(fatos);
  }

  /**
   * Garante que o estabelecimento existe (escopo por cliente verificado pelo
   * chamador). Leitura mínima; inexistente é 404 (nunca cria nada).
   */
  private async assertCliente(clienteId: string): Promise<void> {
    const rows = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
  }

  /**
   * MÉTRICA 1 — diferença por tributo. Numa só varredura das guias ATIVAS
   * (não canceladas) de origem APURAÇÃO marcadas como divergentes (R1.2),
   * agrupa por `tributo` e soma `abs(valor_total − valor_obrigacao)` em
   * `numeric` (string, nunca `Number`), contando as guias divergentes. GROUP BY
   * no SQL evita N+1.
   */
  private async agregarDiferencaPorTributo(
    clienteId: string,
  ): Promise<DiferencaTributoFato[]> {
    const rows = await this.database.db
      .select({
        tributo: fiscalApuracoesGuias.tributo,
        somaDiferencaAbsoluta: sql<string>`coalesce(sum(abs(${fiscalApuracoesGuias.valorTotal} - ${fiscalApuracoesGuias.valorObrigacao})), 0)::text`,
        guiasDivergentes: sql<number>`cast(count(*) as int)`,
      })
      .from(fiscalApuracoesGuias)
      .where(
        and(
          eq(fiscalApuracoesGuias.clienteId, clienteId),
          eq(fiscalApuracoesGuias.cancelada, false),
          eq(fiscalApuracoesGuias.origem, 'APURACAO'),
          eq(fiscalApuracoesGuias.divergenteObrigacao, true),
          sql`${fiscalApuracoesGuias.valorObrigacao} is not null`,
        ),
      )
      .groupBy(fiscalApuracoesGuias.tributo);

    return rows.map((r) => ({
      tributo: r.tributo,
      somaDiferencaAbsoluta: r.somaDiferencaAbsoluta ?? '0',
      guiasDivergentes: r.guiasDivergentes ?? 0,
    }));
  }

  /**
   * MÉTRICA 2 — créditos com/sem fundamento. Numa só varredura de
   * `fiscal_decisoes_item`, conta ADMITIDO (com fundamento) de um lado e
   * VEDADO/EXIGE_REVISAO (sem fundamento) do outro, com `count(*) filter`.
   */
  private async agregarCreditos(
    clienteId: string,
  ): Promise<{ comFundamento: number; semFundamento: number }> {
    const rows = await this.database.db
      .select({
        comFundamento: contarSe(
          sql`${fiscalDecisoesItem.decisao} = 'ADMITIDO'`,
        ),
        semFundamento: contarSe(
          sql`${fiscalDecisoesItem.decisao} in ('VEDADO', 'EXIGE_REVISAO')`,
        ),
      })
      .from(fiscalDecisoesItem)
      .where(eq(fiscalDecisoesItem.clienteId, clienteId));
    const row = rows[0];
    return {
      comFundamento: row?.comFundamento ?? 0,
      semFundamento: row?.semFundamento ?? 0,
    };
  }

  /**
   * MÉTRICA 3 — pendências. Numa só varredura das guias ATIVAS (não
   * canceladas), conta PENDENTE e VENCIDO por `count(*) filter` (guia cancelada
   * não é pendência).
   */
  private async agregarPendencias(
    clienteId: string,
  ): Promise<{ pendentes: number; vencidas: number }> {
    const rows = await this.database.db
      .select({
        pendentes: contarSe(
          sql`${fiscalApuracoesGuias.statusPagamento} = 'PENDENTE'`,
        ),
        vencidas: contarSe(
          sql`${fiscalApuracoesGuias.statusPagamento} = 'VENCIDO'`,
        ),
      })
      .from(fiscalApuracoesGuias)
      .where(
        and(
          eq(fiscalApuracoesGuias.clienteId, clienteId),
          eq(fiscalApuracoesGuias.cancelada, false),
        ),
      );
    const row = rows[0];
    return {
      pendentes: row?.pendentes ?? 0,
      vencidas: row?.vencidas ?? 0,
    };
  }

  /**
   * MÉTRICA 4 — repetições bloqueadas. Dois sinais, cada um numa varredura:
   * guias ATIVAS com `idempotency_key` (retries deduplicados — R1.6) e fichas
   * de CIAP travadas em saneamento assistido (reconstrução por contador
   * recusada — R5.4). O núcleo puro soma os dois lados.
   */
  private async agregarRepeticoesBloqueadas(
    clienteId: string,
  ): Promise<{ idempotentes: number; saneamento: number }> {
    const [idempotentes, saneamento] = await Promise.all([
      this.contar(
        fiscalApuracoesGuias,
        and(
          eq(fiscalApuracoesGuias.clienteId, clienteId),
          eq(fiscalApuracoesGuias.cancelada, false),
          sql`${fiscalApuracoesGuias.idempotencyKey} is not null`,
        ),
      ),
      this.contar(
        ciapAtivoPermanente,
        and(
          eq(ciapAtivoPermanente.clienteId, clienteId),
          eq(ciapAtivoPermanente.saneamentoPendente, true),
        ),
      ),
    ]);
    return { idempotentes, saneamento };
  }

  /**
   * MÉTRICA 5 — rejeições do PVA. Conta entregas com `status_validacao`
   * REJEITADA numa só consulta `count(*)`.
   */
  private async contarRejeicoesPva(clienteId: string): Promise<number> {
    return this.contar(
      fiscalEntregas,
      and(
        eq(fiscalEntregas.clienteId, clienteId),
        eq(fiscalEntregas.statusValidacao, 'REJEITADA'),
      ),
    );
  }

  /**
   * MÉTRICA 6 — guias sem vínculo. Numa só varredura das guias ATIVAS, conta de
   * um lado as de origem APURAÇÃO sem `fechamento_id` (anomalia que o CHECK
   * impede — deveria ser 0, mas a métrica audita) e, de outro, as MANUAIS sem
   * `fechamento_id` (legítimas, mas fora da conciliação por apuração).
   */
  private async agregarGuiasSemVinculo(
    clienteId: string,
  ): Promise<{ apuracao: number; manuais: number }> {
    const rows = await this.database.db
      .select({
        apuracao: contarSe(
          sql`${fiscalApuracoesGuias.origem} = 'APURACAO' and ${fiscalApuracoesGuias.fechamentoId} is null`,
        ),
        manuais: contarSe(
          sql`${fiscalApuracoesGuias.origem} = 'MANUAL' and ${fiscalApuracoesGuias.fechamentoId} is null`,
        ),
      })
      .from(fiscalApuracoesGuias)
      .where(
        and(
          eq(fiscalApuracoesGuias.clienteId, clienteId),
          eq(fiscalApuracoesGuias.cancelada, false),
        ),
      );
    const row = rows[0];
    return {
      apuracao: row?.apuracao ?? 0,
      manuais: row?.manuais ?? 0,
    };
  }

  /**
   * MÉTRICA 7 — mudanças pós-fechamento. Dois sinais, cada um numa varredura:
   * fechamentos CORRENTES cuja versão é > 1 (reabertos/retificados — a versão
   * corrente aprovada, não as versões históricas, para não recontar o mesmo
   * escopo) e entregas que são retificações (`entrega_original_id` não nulo).
   */
  private async agregarMudancasPosFechamento(
    clienteId: string,
  ): Promise<{ fechamentos: number; entregas: number }> {
    const [fechamentos, entregas] = await Promise.all([
      this.contar(
        fiscalFechamentos,
        and(
          eq(fiscalFechamentos.clienteId, clienteId),
          eq(fiscalFechamentos.corrente, true),
          sql`${fiscalFechamentos.versao} > 1`,
        ),
      ),
      this.contar(
        fiscalEntregas,
        and(
          eq(fiscalEntregas.clienteId, clienteId),
          sql`${fiscalEntregas.entregaOriginalId} is not null`,
        ),
      ),
    ]);
    return { fechamentos, entregas };
  }

  /**
   * MÉTRICA 8 — tempo/consultas por documento. Conta os documentos fiscais do
   * escopo (uma consulta) e os eventos de auditoria de LEITURA de documento
   * amarrados a esses documentos (outra consulta, com join por `entidade_id`
   * para manter o escopo por cliente, sem N+1). O núcleo puro deriva a razão
   * consultas/documento com aritmética inteira.
   */
  private async agregarConsultasPorDocumento(
    clienteId: string,
  ): Promise<{ documentos: number; consultas: number }> {
    const [documentos, consultas] = await Promise.all([
      this.contar(
        documentosFiscais,
        eq(documentosFiscais.clienteId, clienteId),
      ),
      this.contarConsultasDocumento(clienteId),
    ]);
    return { documentos, consultas };
  }

  /**
   * Conta, numa só consulta, os eventos de auditoria de leitura cujo
   * `entidade_tipo = 'documento_fiscal'` e cujo `entidade_id` pertence a um
   * documento DESTE cliente (join por `entidade_id = documentos_fiscais.id`).
   * O join escopa por cliente sem carregar linhas; retorna 0 sem eventos.
   */
  private async contarConsultasDocumento(clienteId: string): Promise<number> {
    const rows = await this.database.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(eventosAuditoria)
      .innerJoin(
        documentosFiscais,
        sql`${documentosFiscais.id}::text = ${eventosAuditoria.entidadeId}`,
      )
      .where(
        and(
          eq(eventosAuditoria.entidadeTipo, ENTIDADE_DOCUMENTO_FISCAL),
          eq(documentosFiscais.clienteId, clienteId),
        ),
      );
    return rows[0]?.total ?? 0;
  }

  /**
   * Conta linhas de uma tabela que satisfazem uma condição, numa só consulta
   * (`count(*)`), sem carregar as linhas. Read-only por construção. Mesma
   * utilidade de `RolloutInventarioService.contar`.
   */
  private async contar(table: any, where: SQL | undefined): Promise<number> {
    const rows = await this.database.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(table)
      .where(where);
    return rows[0]?.total ?? 0;
  }
}

/**
 * Expressão agregada `count(*) filter (where <cond>)` tipada como inteiro — a
 * forma portável de contar linhas que satisfazem uma condição numa única
 * varredura, sem N+1 (mesma utilidade de `rollout-inventario.service.ts`).
 */
function contarSe(condicao: SQL): SQL<number> {
  return sql<number>`cast(count(*) filter (where ${condicao}) as int)`;
}
