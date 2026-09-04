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
}

@Injectable()
export class FiscalGuiasService {
  constructor(private readonly database: DatabaseService) {}

  async criarGuia(input: CriarGuiaInput) {
    await this.assertCliente(input.clienteId);
    const { competencia } = this.competenciaRange(input.competencia);
    const valorTotal = fromScaledInteger(
      toScaledInteger(input.valorPrincipal) +
        toScaledInteger(input.valorMulta ?? '0') +
        toScaledInteger(input.valorJuros ?? '0'),
    );
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
