import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { clientes, documentos, user, visualizacoesDocumentos } from '../database/schema';
import { StorageService } from '../storage/storage.service';
import { StorageCleanupService } from '../storage/storage-cleanup.service';
import { MailService } from '../mail/mail.service';
import { AppLogger } from '../common/logger.service';
import { resultRows } from '../common/db-result';
import { deriveDocumentStatus, getBahiaDate } from '../common/document-status';
import { sanitizeFileName } from '../common/file-validation';
import type { PaginationParams } from '../common/types';

@Injectable()
export class DocumentosService {
    constructor(
        private readonly database: DatabaseService,
        private readonly storage: StorageService,
        private readonly storageCleanup: StorageCleanupService,
        private readonly mail: MailService,
        private readonly logger: AppLogger,
    ) { }

    // ─── Admin: List all documents ───
    async listAdminDocuments(input: {
        type: string;
        status: string;
        search: string;
        pagination: PaginationParams;
    }) {
        const conditions: SQL[] = [];
        const today = getBahiaDate();
        if (input.type) conditions.push(eq(documentos.tipo, input.type));
        if (input.status === 'PAGO') conditions.push(eq(documentos.status, 'PAGO'));
        if (input.status === 'VENCIDO') {
            conditions.push(and(eq(documentos.status, 'PENDENTE'), lt(documentos.vencimento, today))!);
        }
        if (input.status === 'PENDENTE') {
            conditions.push(
                and(eq(documentos.status, 'PENDENTE'), or(isNull(documentos.vencimento), gte(documentos.vencimento, today)))!,
            );
        }
        if (input.search) {
            const searchConditions: SQL[] = [ilike(clientes.razaoSocial, `%${input.search}%`)];
            const cnpjDigits = input.search.replace(/\D/g, '');
            if (cnpjDigits) searchConditions.push(ilike(clientes.cnpj, `%${cnpjDigits}%`));
            conditions.push(or(...searchConditions)!);
        }
        const where = conditions.length ? and(...conditions) : undefined;

        const [countResult, rows] = await Promise.all([
            this.database.db.select({ count: sql<number>`count(*)` }).from(documentos).leftJoin(clientes, eq(documentos.clienteId, clientes.id)).where(where),
            this.database.db
                .select({
                    id: documentos.id,
                    type: documentos.tipo,
                    period: documentos.periodo,
                    dueDate: documentos.vencimento,
                    valor: documentos.valor,
                    status: documentos.status,
                    fileName: documentos.arquivoNome,
                    emailStatus: documentos.emailStatus,
                    emailError: documentos.emailErro,
                    client: { companyName: clientes.razaoSocial, cnpj: clientes.cnpj, emails: clientes.emails },
                    visualizado: sql<boolean>`EXISTS (SELECT 1 FROM visualizacoes_documentos WHERE visualizacoes_documentos.documento_id = ${documentos.id})`.as('visualizado'),
                    primeiraVisualizacao: sql<string | null>`(SELECT MIN(visualizado_em) FROM visualizacoes_documentos WHERE visualizacoes_documentos.documento_id = ${documentos.id})`.as('primeira_visualizacao'),
                    totalVisualizacoes: sql<number>`(SELECT COUNT(*) FROM visualizacoes_documentos WHERE visualizacoes_documentos.documento_id = ${documentos.id})`.as('total_visualizacoes'),
                })
                .from(documentos)
                .leftJoin(clientes, eq(documentos.clienteId, clientes.id))
                .where(where)
                .orderBy(desc(documentos.criadoEm))
                .limit(input.pagination.limit)
                .offset(input.pagination.offset),
        ]);

        return {
            total: Number(countResult[0]?.count ?? 0),
            data: rows.map((doc) => ({
                id: doc.id,
                type: doc.type,
                period: doc.period,
                due_date: doc.dueDate,
                valor: doc.valor ? Number(doc.valor) : null,
                status: deriveDocumentStatus(doc.status, doc.dueDate, today),
                file_name: doc.fileName,
                email_status: doc.emailStatus,
                email_error: doc.emailError,
                client: doc.client ? { company_name: doc.client.companyName, cnpj: doc.client.cnpj, has_email: (doc.client.emails ?? []).length > 0 } : null,
                visualizado: doc.visualizado ?? false,
                primeira_visualizacao: doc.primeiraVisualizacao ?? null,
                total_visualizacoes: Number(doc.totalVisualizacoes ?? 0),
            })),
        };
    }

    // ─── Admin: Client documents ───
    async listClientDocumentsForStaff(input: {
        clientId: string;
        type: string;
        period: string;
        periodType?: string;
        pagination: PaginationParams;
    }) {
        const today = getBahiaDate();
        const conditions: SQL[] = [eq(documentos.clienteId, input.clientId)];
        if (input.type) conditions.push(eq(documentos.tipo, input.type));
        const periodCondition = this.documentPeriodCondition(input.period, input.periodType);
        if (periodCondition) conditions.push(periodCondition);
        const where = and(...conditions);

        const [countResult, rows] = await Promise.all([
            this.database.db.select({ count: sql<number>`count(*)` }).from(documentos).where(where),
            this.database.db
                .select({
                    id: documentos.id,
                    clientId: documentos.clienteId,
                    type: documentos.tipo,
                    period: documentos.periodo,
                    dueDate: documentos.vencimento,
                    valor: documentos.valor,
                    fileName: documentos.arquivoNome,
                    status: documentos.status,
                    createdAt: documentos.criadoEm,
                    visualizado: sql<boolean>`EXISTS (SELECT 1 FROM visualizacoes_documentos WHERE visualizacoes_documentos.documento_id = ${documentos.id})`.as('visualizado'),
                    totalVisualizacoes: sql<number>`(SELECT COUNT(*) FROM visualizacoes_documentos WHERE visualizacoes_documentos.documento_id = ${documentos.id})`.as('total_visualizacoes'),
                })
                .from(documentos)
                .where(where)
                .orderBy(desc(documentos.vencimento))
                .limit(input.pagination.limit)
                .offset(input.pagination.offset),
        ]);

        return {
            total: Number(countResult[0]?.count ?? 0),
            data: rows.map((doc) => ({
                id: doc.id,
                client_id: doc.clientId,
                type: doc.type,
                period: doc.period,
                due_date: doc.dueDate,
                valor: doc.valor ? Number(doc.valor) : null,
                file_name: doc.fileName,
                status: deriveDocumentStatus(doc.status, doc.dueDate, today),
                created_at: doc.createdAt.toISOString(),
                visualizado: doc.visualizado ?? false,
                total_visualizacoes: Number(doc.totalVisualizacoes ?? 0),
            })),
        };
    }

    // ─── Cliente: Own documents ───
    async listClientDocuments(input: {
        clientId: string;
        userId: string;
        type: string;
        period: string;
        periodType?: string;
        pagination: PaginationParams;
    }) {
        const today = getBahiaDate();
        const conditions: SQL[] = [eq(documentos.clienteId, input.clientId)];
        if (input.type) conditions.push(eq(documentos.tipo, input.type));
        const periodCondition = this.documentPeriodCondition(input.period, input.periodType);
        if (periodCondition) conditions.push(periodCondition);
        const where = and(...conditions);

        const [countResult, rows] = await Promise.all([
            this.database.db.select({ count: sql<number>`count(*)` }).from(documentos).where(where),
            this.database.db
                .select({
                    id: documentos.id,
                    clientId: documentos.clienteId,
                    type: documentos.tipo,
                    period: documentos.periodo,
                    dueDate: documentos.vencimento,
                    valor: documentos.valor,
                    fileName: documentos.arquivoNome,
                    status: documentos.status,
                    createdAt: documentos.criadoEm,
                    visualizado: sql<boolean>`EXISTS (SELECT 1 FROM visualizacoes_documentos WHERE visualizacoes_documentos.documento_id = ${documentos.id} AND visualizacoes_documentos.user_id = ${input.userId})`.as('visualizado'),
                })
                .from(documentos)
                .where(where)
                .orderBy(desc(documentos.vencimento))
                .limit(input.pagination.limit)
                .offset(input.pagination.offset),
        ]);

        return {
            total: Number(countResult[0]?.count ?? 0),
            data: rows.map((doc) => ({
                id: doc.id,
                client_id: doc.clientId,
                type: doc.type,
                period: doc.period,
                due_date: doc.dueDate,
                valor: doc.valor ? Number(doc.valor) : null,
                file_name: doc.fileName,
                status: deriveDocumentStatus(doc.status, doc.dueDate, today),
                created_at: doc.createdAt.toISOString(),
                visualizado: doc.visualizado ?? false,
            })),
        };
    }

    // ─── Get accessible document ───
    async getAccessibleDocument(documentId: string, currentUser: { id: string; role: string }) {
        const result = await this.database.db
            .select({ id: documentos.id, clienteId: documentos.clienteId, arquivoKey: documentos.arquivoKey, tipo: documentos.tipo, periodo: documentos.periodo, status: documentos.status })
            .from(documentos)
            .where(eq(documentos.id, documentId))
            .limit(1);

        const document = result[0];
        if (!document) return { document: null, isStaff: false, authorized: false };

        const isStaff = currentUser.role === 'ADMIN' || currentUser.role === 'COLABORADOR';
        if (isStaff) return { document, isStaff, authorized: true };

        const clientResult = await this.database.db
            .select({ id: clientes.id })
            .from(clientes)
            .where(eq(clientes.userId, currentUser.id))
            .limit(1);

        const authorized = clientResult[0]?.id === document.clienteId;
        return { document, isStaff, authorized };
    }

    // ─── Record view ───
    async recordDocumentView(documentId: string, userId: string) {
        await this.database.db.insert(visualizacoesDocumentos).values({ documentoId: documentId, userId });
    }

    // ─── Get signed URL ───
    async getSignedUrl(key: string) {
        return this.storage.getSignedUrl(key);
    }

    // ─── List document views ───
    async listDocumentViews(documentId: string) {
        const rows = await this.database.db
            .select({
                id: visualizacoesDocumentos.id,
                viewedAt: visualizacoesDocumentos.visualizadoEm,
                viewer: { id: user.id, name: user.name, email: user.email },
            })
            .from(visualizacoesDocumentos)
            .leftJoin(user, eq(visualizacoesDocumentos.userId, user.id))
            .where(eq(visualizacoesDocumentos.documentoId, documentId))
            .orderBy(desc(visualizacoesDocumentos.visualizadoEm));

        return rows.map((view) => ({
            id: view.id,
            visualizado_em: view.viewedAt.toISOString(),
            usuario: view.viewer ? { id: view.viewer.id, nome: view.viewer.name, email: view.viewer.email } : null,
        }));
    }

    // ─── Delete document ───
    async deleteDocument(input: { requestId?: string; documentId: string; actorUserId: string }) {
        const result = await this.database.db.execute(sql`
      WITH deleted_document AS (
        DELETE FROM documentos WHERE id = ${input.documentId}::uuid
        RETURNING id, arquivo_key, comprovante_key, arquivo_nome
      ),
      candidate_keys AS (
        SELECT id, arquivo_key AS object_key FROM deleted_document
        UNION ALL
        SELECT id, comprovante_key FROM deleted_document WHERE comprovante_key IS NOT NULL
      ),
      cleanup_jobs AS (
        INSERT INTO storage_cleanup_jobs (object_key, entidade_tipo, entidade_id)
        SELECT object_key, 'DOCUMENTO', id::text FROM candidate_keys
        ON CONFLICT (object_key) DO NOTHING
        RETURNING id
      ),
      audit_event AS (
        INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
        SELECT ${input.actorUserId}, 'DOCUMENTO_EXCLUIDO', 'DOCUMENTO', id::text,
          jsonb_build_object('arquivoNome', arquivo_nome, 'motivo', 'EXCLUSAO_ADMINISTRATIVA')
        FROM deleted_document
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM deleted_document) AS deleted,
        COALESCE((SELECT array_agg(id::text) FROM cleanup_jobs), ARRAY[]::text[]) AS job_ids
    `);

        const row = resultRows<{ deleted: boolean; job_ids: string[] | null }>(result)[0];
        if (!row?.deleted) return { deleted: false, cleanupPending: 0 };

        const cleanup = await this.storageCleanup.processJobs(row.job_ids ?? [], {
            requestId: input.requestId,
            userId: input.actorUserId,
            trigger: 'deletion',
        });
        return { deleted: true, cleanupPending: cleanup.failed };
    }

    // ─── Upload document ───
    async uploadDocument(input: {
        requestId?: string;
        actorUserId: string;
        client: { id: string; cnpj: string; razaoSocial: string; emails: string[] | null };
        bytes: Buffer;
        fileName: string;
        tipo: string;
        periodo: string;
        vencimento: string | null;
        valorNumerico: string | null;
        valorLabel: string | null;
        parcelaLabel: string | null;
    }) {
        const obligationId = crypto.randomUUID();
        const r2Key = this.storage.documentObjectKey({
            cnpj: input.client.cnpj,
            period: input.periodo,
            obligationId,
            type: input.tipo,
        });

        try {
            await this.storage.upload(r2Key, input.bytes, 'application/pdf');
        } catch (error) {
            this.logger.error('document_upload_storage_failed', error, { requestId: input.requestId, obligationId });
            return { ok: false as const, code: 'STORAGE_FAILED' };
        }

        try {
            const fileName = sanitizeFileName(input.fileName);
            const emailStatus = input.client.emails?.length ? 'PENDENTE' : 'SEM_EMAIL';
            const insertResult = await this.database.db.execute(sql`
        WITH inserted_document AS (
          INSERT INTO documentos (id, cliente_id, tipo, periodo, vencimento, valor, arquivo_key, arquivo_nome, status, email_status)
          VALUES (${obligationId}::uuid, ${input.client.id}::uuid, ${input.tipo}, ${input.periodo}, ${input.vencimento}::date, ${input.valorNumerico}::numeric, ${r2Key}, ${fileName}, 'PENDENTE', ${emailStatus})
          RETURNING id
        ),
        audit_event AS (
          INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
          SELECT ${input.actorUserId}, 'DOCUMENTO_ENVIADO', 'DOCUMENTO', id::text,
            jsonb_build_object('clienteId', ${input.client.id}::text, 'tipo', ${input.tipo}::text, 'periodo', ${input.periodo}::text)
          FROM inserted_document
          RETURNING id
        )
        SELECT EXISTS (SELECT 1 FROM inserted_document) AS inserted
      `);
            if (!resultRows<{ inserted: boolean }>(insertResult)[0]?.inserted) {
                throw new Error('DOCUMENT_INSERT_FAILED');
            }
        } catch (error) {
            await this.storage.delete(r2Key).catch(() => { });
            this.logger.error('document_upload_database_failed', error, { requestId: input.requestId, obligationId });
            const isUnique = this.isUniqueViolation(error);
            return { ok: false as const, code: isUnique ? 'DUPLICATE' : 'DATABASE_FAILED' };
        }

        // Send email notification (fire-and-forget)
        if (input.client.emails?.length) {
            this.mail
                .sendDocumentNotificationEmail({
                    to: input.client.emails,
                    clientName: input.client.razaoSocial,
                    documentType: input.tipo,
                    period: input.periodo,
                    dueDate: input.vencimento,
                    valor: input.valorLabel,
                    parcela: input.parcelaLabel,
                })
                .then((sent) => {
                    this.database.db.execute(sql`
            UPDATE documentos SET email_status = ${sent ? 'ENVIADO' : 'FALHOU'},
              email_erro = ${sent ? null : 'Falha ao enviar a notificação.'}
            WHERE id = ${obligationId}::uuid
          `).catch(() => { });
                })
                .catch(() => { });
        }

        return { ok: true as const, obligationId, r2Key };
    }

    // ─── Find duplicate document ───
    async findDuplicateDocument(input: { clientId: string; type: string; period: string }) {
        const result = await this.database.db
            .select({ id: documentos.id, arquivoNome: documentos.arquivoNome })
            .from(documentos)
            .where(and(eq(documentos.clienteId, input.clientId), eq(documentos.tipo, input.type), eq(documentos.periodo, input.period)))
            .limit(1);
        return result[0];
    }

    // ─── Confirm payment ───
    async confirmPayment(input: {
        requestId?: string;
        obligationId: string;
        userId: string;
        observation: string | null;
        receipt?: { bytes: Buffer; contentType: string; extension: string };
    }) {
        const receiptKey = input.receipt
            ? this.storage.receiptObjectKey({ obligationId: input.obligationId, receiptId: crypto.randomUUID(), extension: input.receipt.extension })
            : null;

        if (input.receipt && receiptKey) {
            try {
                await this.storage.upload(receiptKey, input.receipt.bytes, input.receipt.contentType);
            } catch (error) {
                this.logger.error('payment_receipt_upload_failed', error, { requestId: input.requestId, obligationId: input.obligationId });
                return { ok: false as const, code: 'STORAGE_FAILED' };
            }
        }

        try {
            const updateResult = await this.database.db.execute(sql`
        WITH updated_document AS (
          UPDATE documentos SET
            status = 'PAGO', pago_em = now(), pagamento_confirmado_por = ${input.userId},
            observacao_pagamento = ${input.observation},
            comprovante_key = CASE WHEN ${receiptKey}::text IS NOT NULL THEN ${receiptKey} ELSE comprovante_key END
          WHERE id = ${input.obligationId}::uuid AND status <> 'PAGO'
          RETURNING id
        ),
        audit_event AS (
          INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
          SELECT ${input.userId}, 'PAGAMENTO_CONFIRMADO', 'DOCUMENTO', id::text,
            jsonb_build_object('possuiComprovante', ${receiptKey}::text IS NOT NULL)
          FROM updated_document
          RETURNING id
        )
        SELECT EXISTS (SELECT 1 FROM updated_document) AS updated
      `);
            const updated = resultRows<{ updated: boolean }>(updateResult)[0]?.updated;
            if (!updated) {
                if (receiptKey) await this.storage.delete(receiptKey).catch(() => { });
                return { ok: false as const, code: 'ALREADY_PAID' };
            }
        } catch (error) {
            if (receiptKey) await this.storage.delete(receiptKey).catch(() => { });
            this.logger.error('payment_database_failed', error, { requestId: input.requestId });
            return { ok: false as const, code: 'DATABASE_FAILED' };
        }

        return { ok: true as const };
    }

    // ─── Notify document ───
    async notifyDocument(input: { documentId: string; actorUserId: string; requestId?: string }) {
        const rows = await this.database.db
            .select({
                id: documentos.id,
                type: documentos.tipo,
                period: documentos.periodo,
                dueDate: documentos.vencimento,
                client: { companyName: clientes.razaoSocial, emails: clientes.emails },
            })
            .from(documentos)
            .leftJoin(clientes, eq(documentos.clienteId, clientes.id))
            .where(eq(documentos.id, input.documentId))
            .limit(1);

        const document = rows[0];
        if (!document) return { ok: false as const, code: 'DOCUMENT_NOT_FOUND' };
        if (!document.client?.emails?.length) {
            await this.updateNotificationStatus({ ...input, status: 'SEM_EMAIL', error: 'Cliente não possui e-mail cadastrado.', action: 'NOTIFICACAO_SEM_EMAIL' });
            return { ok: false as const, code: 'CLIENT_WITHOUT_EMAIL' };
        }

        let sent = false;
        try {
            sent = await this.mail.sendDocumentNotificationEmail({
                to: document.client.emails,
                clientName: document.client.companyName,
                documentType: document.type,
                period: document.period,
                dueDate: document.dueDate,
            });
        } catch (error) {
            this.logger.error('document_notification_provider_failed', error, { requestId: input.requestId });
        }

        await this.updateNotificationStatus({
            ...input,
            status: sent ? 'ENVIADO' : 'FALHOU',
            error: sent ? null : 'Falha ao enviar a notificação.',
            action: sent ? 'NOTIFICACAO_ENVIADA' : 'NOTIFICACAO_FALHOU',
        });

        return sent ? { ok: true as const, status: 'ENVIADO' } : { ok: false as const, code: 'NOTIFICATION_FAILED' };
    }

    private async updateNotificationStatus(input: { documentId: string; actorUserId: string; status: string; error: string | null; action: string }) {
        await this.database.db.execute(sql`
      WITH updated_document AS (
        UPDATE documentos SET email_status = ${input.status}, email_erro = ${input.error} WHERE id = ${input.documentId}::uuid RETURNING id
      )
      INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
      SELECT ${input.actorUserId}, ${input.action}, 'DOCUMENTO', id::text, jsonb_build_object('status', ${input.status}::text) FROM updated_document
    `);
    }

    private documentPeriodCondition(period: string, periodType?: string) {
        if (!period) return null;
        if (periodType !== 'vencimento') return eq(documentos.periodo, period);
        const [month, year] = period.split('/');
        if (!month || !year || year.length !== 4) return null;
        const numericMonth = Number.parseInt(month, 10);
        const numericYear = Number.parseInt(year, 10);
        const nextMonth = numericMonth === 12 ? 1 : numericMonth + 1;
        const nextYear = numericMonth === 12 ? numericYear + 1 : numericYear;
        const startDate = `${year}-${month}-01`;
        const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
        return sql`${documentos.vencimento} >= ${startDate} AND ${documentos.vencimento} < ${endDate}`;
    }

    private isUniqueViolation(error: unknown) {
        const candidate = error as { code?: string; cause?: { code?: string } } | null;
        return candidate?.code === '23505' || candidate?.cause?.code === '23505';
    }
}
