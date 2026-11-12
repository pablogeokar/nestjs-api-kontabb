import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { clientes, financeiroFaturas } from '../../database/schema';
import { getBahiaDate } from '../../common/document-status';
import {
  competenciaDeData,
  fromCents,
  saldoAbertoSql,
  toCents,
} from '../financeiro.utils';

@Injectable()
export class FinanceiroDashboardService {
  constructor(private readonly database: DatabaseService) {}

  /** KPIs da competência (MM/AAAA); padrão: mês corrente (America/Bahia). */
  async getDashboard(competencia?: string) {
    const hoje = getBahiaDate();
    const alvo = competencia ?? competenciaDeData(hoje);
    const db = this.database.db;
    const ativas = and(
      eq(financeiroFaturas.competencia, alvo),
      ne(financeiroFaturas.status, 'CANCELADA'),
    );
    const vencida = sql`${financeiroFaturas.dataVencimento} < ${hoje}`;

    const [[totais], [inadimplencia], ranking] = await Promise.all([
      db
        .select({
          quantidade: sql<number>`count(*)::int`,
          faturado: sql<string>`COALESCE(SUM(${financeiroFaturas.valorLiquido}), 0)`,
          recebido: sql<string>`COALESCE(SUM(${financeiroFaturas.valorPago}), 0)`,
          emAberto: sql<string>`COALESCE(SUM(${saldoAbertoSql}), 0)`,
        })
        .from(financeiroFaturas)
        .where(ativas),
      db
        .select({
          quantidade: sql<number>`count(*)::int`,
          valor: sql<string>`COALESCE(SUM(${saldoAbertoSql}), 0)`,
        })
        .from(financeiroFaturas)
        .where(
          and(
            ativas,
            inArray(financeiroFaturas.status, [
              'PENDENTE',
              'PARCIALMENTE_PAGA',
              'VENCIDA',
            ]),
            vencida,
          ),
        ),
      db
        .select({
          clienteId: clientes.id,
          razaoSocial: clientes.razaoSocial,
          faturasVencidas: sql<number>`count(*)::int`,
          valorDevido: sql<string>`COALESCE(SUM(${saldoAbertoSql}), 0)`,
        })
        .from(financeiroFaturas)
        .innerJoin(clientes, eq(clientes.id, financeiroFaturas.clienteId))
        .where(
          and(
            inArray(financeiroFaturas.status, [
              'PENDENTE',
              'PARCIALMENTE_PAGA',
              'VENCIDA',
            ]),
            vencida,
          ),
        )
        .groupBy(clientes.id, clientes.razaoSocial)
        .orderBy(desc(sql`SUM(${saldoAbertoSql})`))
        .limit(10),
    ]);

    const faturadoCents = toCents(totais.faturado);
    const inadimplidoCents = toCents(inadimplencia.valor);
    return {
      competencia: alvo,
      totalFaturas: totais.quantidade,
      totalFaturado: fromCents(faturadoCents),
      totalRecebido: fromCents(toCents(totais.recebido)),
      totalEmAberto: fromCents(toCents(totais.emAberto)),
      inadimplencia: {
        faturasVencidas: inadimplencia.quantidade,
        valor: fromCents(inadimplidoCents),
        percentual:
          faturadoCents > 0
            ? Math.round((inadimplidoCents / faturadoCents) * 10000) / 100
            : 0,
      },
      rankingDevedores: ranking.map((row) => ({
        clienteId: row.clienteId,
        razaoSocial: row.razaoSocial,
        faturasVencidas: row.faturasVencidas,
        valorDevido: fromCents(toCents(row.valorDevido)),
      })),
    };
  }
}
