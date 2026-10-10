import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { clientes, fiscalApuracoesGuias } from '../../database/schema';
import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';
import { parseCompetenciaMensal } from '../fiscal-date.util';
import {
  difalMotivoInelegibilidadeGuia,
  difalPodeGerarGuia,
  type DifalCalculoStatus,
} from './difal-calculador';

export type TributoGuia =
  | 'ICMS_PROPRIO'
  | 'ICMS_ST'
  | 'DIFAL_ENTRADA'
  | 'DIFAL_SAIDA'
  | 'FCP'
  | 'IPI'
  | 'PIS'
  | 'COFINS'
  | 'DAS_SIMPLES';

export type TipoGuia = 'DAE' | 'GNRE' | 'DARF' | 'DAS';

export interface CriarGuiaInput {
  clienteId: string;
  competencia: string; // 'YYYY-MM'
  tributo: TributoGuia;
  ufFavorecida: string;
  tipoGuia: TipoGuia;
  codigoReceita: string;
  dataVencimento: string; // 'YYYY-MM-DD'
  valorPrincipal: string;
  valorMulta?: string;
  valorJuros?: string;
  /**
   * Estado do cálculo do DIFAL (R1.2 / tarefa 2.3), quando a guia tem origem no
   * calculador parametrizado de DIFAL. Obrigatório na prática para os tributos
   * `DIFAL_ENTRADA`/`DIFAL_SAIDA`: só um resultado `CALCULADO` (regra homologada
   * e vigente) pode virar guia. `SIMULACAO`/`PENDENTE` são bloqueados aqui para
   * que um item simulado/pendente NUNCA gere guia de recolhimento. Para tributos
   * não-DIFAL o campo é ignorado.
   */
  difalStatus?: DifalCalculoStatus;
}

// Tributos cuja guia tem origem no cálculo parametrizado de DIFAL (tarefa 2.3).
// Para eles, a criação de guia exige um estado `CALCULADO`; simulação/pendência
// são barradas (R1.2 — "sem regra homologada, nunca guia").
const TRIBUTOS_DIFAL: ReadonlySet<TributoGuia> = new Set<TributoGuia>([
  'DIFAL_ENTRADA',
  'DIFAL_SAIDA',
]);

@Injectable()
export class FiscalGuiasService {
  constructor(private readonly database: DatabaseService) { }

  async criarGuia(input: CriarGuiaInput) {
    await this.assertCliente(input.clienteId);
    const { competencia } = this.competenciaRange(input.competencia);

    // R1.2 / tarefa 2.3: um DIFAL em SIMULAÇÃO/PENDÊNCIA NUNCA vira guia. Este é
    // o ponto do fluxo em que o estado do cálculo precisa barrar a emissão —
    // sem este guard, um chamador poderia criar uma guia DIFAL a partir de um
    // item simulado/pendente. A decisão delega a `difalPodeGerarGuia` (fonte
    // única da regra); a referência legada jamais é fonte de verdade para guia.
    this.assertDifalElegivel(input);

    // R6.4/R6.3: reforça as invariantes do CriarGuiaDto no serviço para que um
    // chamador fora do HTTP (sem ValidationPipe) não as burle. Cada componente
    // (principal, multa, juros) deve ser um decimal NÃO NEGATIVO — checado
    // individualmente para que um principal negativo não seja compensado por
    // uma multa positiva a fim de passar apenas na validação do total.
    const principal = this.parseValorNaoNegativo(
      input.valorPrincipal,
      'principal',
    );
    const multa = this.parseValorNaoNegativo(input.valorMulta ?? '0', 'multa');
    const juros = this.parseValorNaoNegativo(input.valorJuros ?? '0', 'juros');

    const valorTotal = fromScaledInteger(principal + multa + juros);
    if (toScaledInteger(valorTotal) <= 0n) {
      throw new BadRequestException(
        'O valor total da guia deve ser maior que zero.',
      );
    }

    const rows = await this.database.db
      .insert(fiscalApuracoesGuias)
      .values({
        clienteId: input.clienteId,
        competencia,
        tributo: input.tributo,
        ufFavorecida: input.ufFavorecida.toUpperCase(),
        tipoGuia: input.tipoGuia,
        codigoReceita: input.codigoReceita,
        dataVencimento: input.dataVencimento,
        valorPrincipal: input.valorPrincipal,
        valorMulta: input.valorMulta ?? '0',
        valorJuros: input.valorJuros ?? '0',
        valorTotal,
        statusPagamento: 'PENDENTE',
      })
      .returning();
    return this.toGuiaResponse(rows[0]);
  }

  async listarGuias(input: {
    clienteId: string;
    competencia?: string;
    tributo?: TributoGuia;
    statusPagamento?: 'PENDENTE' | 'PAGO' | 'VENCIDO';
  }) {
    const conditions: SQL[] = [
      eq(fiscalApuracoesGuias.clienteId, input.clienteId),
    ];
    if (input.competencia) {
      conditions.push(
        eq(
          fiscalApuracoesGuias.competencia,
          this.competenciaRange(input.competencia).competencia,
        ),
      );
    }
    if (input.tributo) {
      conditions.push(eq(fiscalApuracoesGuias.tributo, input.tributo));
    }
    if (input.statusPagamento) {
      conditions.push(
        eq(fiscalApuracoesGuias.statusPagamento, input.statusPagamento),
      );
    }
    const rows = await this.database.db
      .select()
      .from(fiscalApuracoesGuias)
      .where(and(...conditions))
      .orderBy(
        asc(fiscalApuracoesGuias.competencia),
        asc(fiscalApuracoesGuias.tributo),
      );
    return { data: rows.map((row) => this.toGuiaResponse(row)) };
  }

  async marcarPagamento(input: {
    clienteId: string;
    guiaId: string;
    statusPagamento: 'PENDENTE' | 'PAGO' | 'VENCIDO';
  }) {
    const rows = await this.database.db
      .update(fiscalApuracoesGuias)
      .set({
        statusPagamento: input.statusPagamento,
        atualizadoEm: new Date(),
      })
      .where(
        and(
          eq(fiscalApuracoesGuias.id, input.guiaId),
          eq(fiscalApuracoesGuias.clienteId, input.clienteId),
        ),
      )
      .returning();
    if (!rows[0]) throw new NotFoundException('Guia não encontrada.');
    return this.toGuiaResponse(rows[0]);
  }

  async removerGuia(input: { clienteId: string; guiaId: string }) {
    const rows = await this.database.db
      .delete(fiscalApuracoesGuias)
      .where(
        and(
          eq(fiscalApuracoesGuias.id, input.guiaId),
          eq(fiscalApuracoesGuias.clienteId, input.clienteId),
        ),
      )
      .returning({ id: fiscalApuracoesGuias.id });
    if (!rows[0]) throw new NotFoundException('Guia não encontrada.');
  }

  /**
   * Resumo consolidado de guias por competência: total por tributo e por
   * status de pagamento. Base para o cockpit fiscal.
   */
  async resumoCompetencia(input: { clienteId: string; competencia: string }) {
    const { competencia } = this.competenciaRange(input.competencia);
    const rows = await this.database.db
      .select({
        tributo: fiscalApuracoesGuias.tributo,
        status_pagamento: fiscalApuracoesGuias.statusPagamento,
        total: sql<string>`COALESCE(SUM(${fiscalApuracoesGuias.valorTotal}), 0)`,
        quantidade: sql<number>`COUNT(*)::int`,
      })
      .from(fiscalApuracoesGuias)
      .where(
        and(
          eq(fiscalApuracoesGuias.clienteId, input.clienteId),
          eq(fiscalApuracoesGuias.competencia, competencia),
        ),
      )
      .groupBy(
        fiscalApuracoesGuias.tributo,
        fiscalApuracoesGuias.statusPagamento,
      );
    const totalGeral = rows.reduce(
      (sum, row) => sum + toScaledInteger(row.total),
      0n,
    );
    return {
      competencia,
      total_geral: fromScaledInteger(totalGeral),
      por_tributo_status: rows,
    };
  }

  private competenciaRange(competencia: string) {
    try {
      return parseCompetenciaMensal(competencia);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Competência inválida.',
      );
    }
  }

  /**
   * R1.2 / tarefa 2.3: garante que uma guia de DIFAL (`DIFAL_ENTRADA`/
   * `DIFAL_SAIDA`) só seja criada a partir de um resultado `CALCULADO`.
   *
   * - Para tributos não-DIFAL, não há nada a validar aqui.
   * - Para tributos DIFAL, o `difalStatus` é OBRIGATÓRIO: criar uma guia de
   *   DIFAL sem o estado do cálculo abriria a porta para emitir guia de um item
   *   cujo escopo não foi verificado. Ausência do estado é rejeitada.
   * - Com estado presente, só `CALCULADO` passa; `SIMULACAO`/`PENDENTE` são
   *   barrados com o motivo auditável (nunca guia a partir de simulação/pendência).
   */
  private assertDifalElegivel(input: CriarGuiaInput) {
    if (!TRIBUTOS_DIFAL.has(input.tributo)) return;

    if (input.difalStatus == null) {
      throw new BadRequestException(
        `Guia de ${input.tributo} exige o estado do cálculo do DIFAL ` +
        '(CALCULADO/SIMULACAO/PENDENTE). Sem ele, a emissão é bloqueada ' +
        'para não gerar guia de um item cujo escopo não foi verificado (R1.2).',
      );
    }

    if (!difalPodeGerarGuia(input.difalStatus)) {
      throw new BadRequestException(
        difalMotivoInelegibilidadeGuia(input.difalStatus) ??
        `DIFAL em estado ${input.difalStatus} não pode gerar guia (R1.2).`,
      );
    }
  }

  /**
   * R6.4/R6.3: converte um componente monetário em inteiro escalado, exigindo
   * que seja um decimal não negativo, independentemente do ValidationPipe.
   */
  private parseValorNaoNegativo(valor: string, rotulo: string): bigint {
    let escalado: bigint;
    try {
      escalado = toScaledInteger(valor);
    } catch {
      throw new BadRequestException(
        `Valor ${rotulo} inválido: "${valor}".`,
      );
    }
    if (escalado < 0n) {
      throw new BadRequestException(
        `O valor ${rotulo} da guia não pode ser negativo.`,
      );
    }
    return escalado;
  }

  private async assertCliente(clienteId: string) {
    const rows = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
  }

  private toGuiaResponse(row: typeof fiscalApuracoesGuias.$inferSelect) {
    return {
      id: row.id,
      cliente_id: row.clienteId,
      competencia: row.competencia,
      tributo: row.tributo,
      uf_favorecida: row.ufFavorecida,
      tipo_guia: row.tipoGuia,
      codigo_receita: row.codigoReceita,
      data_vencimento: row.dataVencimento,
      valor_principal: row.valorPrincipal,
      valor_multa: row.valorMulta,
      valor_juros: row.valorJuros,
      valor_total: row.valorTotal,
      codigo_barras: row.codigoBarras,
      linha_digitavel: row.linhaDigitavel,
      status_pagamento: row.statusPagamento,
      arquivo_guia_key: row.arquivoGuiaKey,
      criado_em: row.criadoEm.toISOString(),
      atualizado_em: row.atualizadoEm.toISOString(),
    };
  }
}
