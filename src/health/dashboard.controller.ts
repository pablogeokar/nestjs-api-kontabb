import { Controller, Get, UseGuards } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { clientes, documentos } from '../database/schema';
import { AuthGuard } from '../auth/auth.guard';
import { StaffOnly } from '../auth/roles.decorator';
import { deriveDocumentStatus, getBahiaDate } from '../common/document-status';

@Controller('admin/dashboard')
@UseGuards(AuthGuard)
@StaffOnly()
export class DashboardController {
    constructor(private readonly database: DatabaseService) { }

    @Get()
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
            this.database.db.select({ count: sql<number>`count(*)` }).from(documentos),
            this.database.db
                .select({ count: sql<number>`count(*)` })
                .from(documentos)
                .where(and(lt(documentos.vencimento, today), eq(documentos.status, 'PENDENTE'))),
            this.database.db
                .select({ count: sql<number>`count(*)` })
                .from(documentos)
                .where(gte(documentos.criadoEm, firstDayOfMonth)),
            this.database.db
                .select({
                    id: documentos.id,
                    type: documentos.tipo,
                    period: documentos.periodo,
                    dueDate: documentos.vencimento,
                    status: documentos.status,
                    companyName: clientes.razaoSocial,
                })
                .from(documentos)
                .leftJoin(clientes, eq(documentos.clienteId, clientes.id))
                .orderBy(desc(documentos.criadoEm))
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
