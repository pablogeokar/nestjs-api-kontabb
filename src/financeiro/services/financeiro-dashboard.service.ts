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
import { FinanceiroFaturasService } from './financeiro-faturas.service';

@Injectable()
export class FinanceiroDashboardService {
  constructor(
    private readonly database: DatabaseService,
    private readonly faturas: FinanceiroFaturasService,
  ) {}

  /**
   * KPIs da competência (MM/AAAA; padrão: mês corrente em America/Bahia).
   * Faturado, recebido e em aberto são da competência. A inadimplência e o
   * ranking de devedores cobrem todas as competências vencidas até hoje.
   */
  async getDashboard(competencia?: string) {
    const hoje = getBahiaDate();
    const alvo = competencia ?? competenciaDeData(hoje);
    const db = this.database.db;
    const ativas = and(
      eq(financeiroFaturas.competencia, alvo),
      ne(financeiroFaturas.status, 'CANCELADA'),
    );
    const vencidasEmAberto = and(
      inArray(financeiroFaturas.status, [
        'PENDENTE',
        'PARCIALMENTE_PAGA',
        'VENCIDA',
      ]),
      sql`${financeiroFaturas.dataVencimento} < ${hoje}`,
    );

    const [
      [totais],
      [vencidoCompetencia],
      [inadimplenciaGeral],
      ranking,
      pendentesGeracao,
    ] = await Promise.all([
      db
        .select({
          quantidade: sql<number>`count(*)::int`,
          pagas: sql<number>`count(*) FILTER (WHERE ${financeiroFaturas.status} = 'PAGA')::int`,
          faturado: sql<string>`COALESCE(SUM(${financeiroFaturas.valorLiquido}), 0)`,
          recebido: sql<string>`COALESCE(SUM(${financeiroFaturas.valorPago}), 0)`,
          emAberto: sql<string>`COALESCE(SUM(${saldoAbertoSql}), 0)`,
        })
        .from(financeiroFaturas)
        .where(ativas),
      db
        .select({
          valor: sql<string>`COALESCE(SUM(${saldoAbertoSql}), 0)`,
        })
        .from(financeiroFaturas)
        .where(and(ativas, vencidasEmAberto)),
      db
        .select({
          faturasVencidas: sql<number>`count(*)::int`,
          clientes: sql<number>`count(DISTINCT ${financeiroFaturas.clienteId})::int`,
          valor: sql<string>`COALESCE(SUM(${saldoAbertoSql}), 0)`,
        })
        .from(financeiroFaturas)
        .where(vencidasEmAberto),
      db
        .select({
          clienteId: clientes.id,
          razaoSocial: clientes.razaoSocial,
          faturasVencidas: sql<number>`count(*)::int`,
          valorDevido: sql<string>`COALESCE(SUM(${saldoAbertoSql}), 0)`,
        })
        .from(financeiroFaturas)
        .innerJoin(clientes, eq(clientes.id, financeiroFaturas.clienteId))
        .where(vencidasEmAberto)
        .groupBy(clientes.id, clientes.razaoSocial)
        .orderBy(desc(sql`SUM(${saldoAbertoSql})`))
        .limit(10),
      this.faturas.contarClientesSemFatura(alvo),
    ]);

    const faturadoCents = toCents(totais.faturado);
    const vencidoCompetenciaCents = toCents(vencidoCompetencia.valor);
    return {
      competencia: alvo,
      totalFaturas: totais.quantidade,
      faturasPagas: totais.pagas,
      totalFaturado: fromCents(faturadoCents),
      totalRecebido: fromCents(toCents(totais.recebido)),
      totalEmAberto: fromCents(toCents(totais.emAberto)),
      pendentesGeracao,
      inadimplencia: {
        faturasVencidas: inadimplenciaGeral.faturasVencidas,
        clientes: inadimplenciaGeral.clientes,
        valor: fromCents(toCents(inadimplenciaGeral.valor)),
        valorCompetencia: fromCents(vencidoCompetenciaCents),
        percentualCompetencia:
          faturadoCents > 0
            ? Math.round((vencidoCompetenciaCents / faturadoCents) * 10000) /
              100
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
