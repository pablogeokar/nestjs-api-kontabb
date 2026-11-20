import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { clientes, guias } from '../database/schema';
import { AuthGuard } from '../auth/auth.guard';
import { StaffOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../common/types';
import { DashboardService } from './dashboard.service';
import { deriveDocumentStatus, getBahiaDate } from '../common/document-status';

@ApiTags('Dashboard')
@ApiBearerAuth('session-token')
@Controller('admin/dashboard')
@UseGuards(AuthGuard)
@StaffOnly()
export class DashboardController {
  constructor(
    private readonly database: DatabaseService,
    private readonly dashboardService: DashboardService,
  ) {}

  @Get('resumo')
  @ApiOperation({
    summary: 'Resumo operacional do escritório',
    description:
      'Indicadores, ações prioritárias, agenda, fechamento do mês e atividade recente. Valores financeiros só para ADMIN.',
  })
  async getResumo(
    @CurrentUser() currentUser: CurrentUserType,
    @Query('competencia') competencia?: string,
  ) {
    if (competencia && !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) {
      throw new BadRequestException('Competência deve estar no formato AAAA-MM.');
    }
    return this.dashboardService.resumo({
      competencia,
      incluirFinanceiro: currentUser.role === 'ADMIN',
    });
  }


  @Get()
  @ApiOperation({
    summary: 'Obter dados do dashboard',
    description:
      'Retorna métricas resumidas: total de clientes, guias, vencidos e uploads do mês, além das 5 guias mais recentes.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dados do dashboard retornados com sucesso.',
  })
  @ApiResponse({ status: 401, description: 'Não autorizado.' })
  @ApiResponse({ status: 403, description: 'Sem permissão (apenas staff).' })
  async getDashboardData() {
    const today = getBahiaDate();
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      [clientCountResult],
      [documentCountResult],
      [overdueCountResult],
      [uploadsThisMonthResult],
      recentDocumentRows,
    ] = await Promise.all([
      this.database.db.select({ count: sql<number>`count(*)` }).from(clientes),
      this.database.db.select({ count: sql<number>`count(*)` }).from(guias),
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(guias)
        .where(and(lt(guias.vencimento, today), eq(guias.status, 'PENDENTE'))),
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(guias)
        .where(gte(guias.criadoEm, firstDayOfMonth)),
      this.database.db
        .select({
          id: guias.id,
          type: guias.tipo,
          period: guias.periodo,
          dueDate: guias.vencimento,
          status: guias.status,
          companyName: clientes.razaoSocial,
        })
        .from(guias)
        .leftJoin(clientes, eq(guias.clienteId, clientes.id))
        .orderBy(desc(guias.criadoEm))
        .limit(5),
    ]);

    const recentDocuments = recentDocumentRows.map((doc) => ({
      ...doc,
      status: deriveDocumentStatus(doc.status, doc.dueDate, today),
    }));

    return {
      clientCount: Number(clientCountResult?.count ?? 0),
      documentCount: Number(documentCountResult?.count ?? 0),
      overdueCount: Number(overdueCountResult?.count ?? 0),
      uploadsThisMonth: Number(uploadsThisMonthResult?.count ?? 0),
      recentDocuments,
    };
  }
}
