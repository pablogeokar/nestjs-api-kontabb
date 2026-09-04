import { Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { clientes, guias, user, visualizacoesGuias } from '../database/schema';
import { StorageService } from '../storage/storage.service';
import { StorageCleanupService } from '../storage/storage-cleanup.service';
import { MailService } from '../mail/mail.service';
import { AppLogger } from '../common/logger.service';
import { resultRows } from '../common/db-result';
import { deriveDocumentStatus, getBahiaDate } from '../common/document-status';
import { sanitizeFileName } from '../common/file-validation';
import type { PaginationParams } from '../common/types';
import {
  simplesNacionalSemApuracaoIcms,
  type RegimeTributario,
} from '../clientes/clientes.types';

@Injectable()
export class GuiasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly storageCleanup: StorageCleanupService,
    private readonly mail: MailService,
    private readonly logger: AppLogger,
  ) { }

  // ─── Admin: List all guias ───
  async listAdminGuias(input: {
    type: string;
    status: string;
    search: string;
    pagination: PaginationParams;
  }) {
    const conditions: SQL[] = [];
    const today = getBahiaDate();
    // Exclude FOLHA-PAGAMENTO from general listing (managed in RH module)
    conditions.push(ne(guias.tipo, 'FOLHA-PAGAMENTO'));
    if (input.type) conditions.push(eq(guias.tipo, input.type));
    if (input.status === 'PAGO') conditions.push(eq(guias.status, 'PAGO'));
    if (input.status === 'VENCIDO') {
      conditions.push(
        and(eq(guias.status, 'PENDENTE'), lt(guias.vencimento, today))!,
      );
    }
    if (input.status === 'PENDENTE') {
      conditions.push(
        and(
          eq(guias.status, 'PENDENTE'),
          or(isNull(guias.vencimento), gte(guias.vencimento, today)),
        )!,
      );
    }
    if (input.search) {
      const searchConditions: SQL[] = [
        ilike(clientes.razaoSocial, `%${input.search}%`),
      ];
      const cnpjDigits = input.search.replace(/\D/g, '');
      if (cnpjDigits) {
        searchConditions.push(
          ilike(clientes.cnpj, `%${cnpjDigits}%`),
          ilike(clientes.cpf, `%${cnpjDigits}%`),
        );
      }
      conditions.push(or(...searchConditions)!);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(guias)
        .leftJoin(clientes, eq(guias.clienteId, clientes.id))
        .where(where),
      this.database.db
        .select({
          id: guias.id,
          type: guias.tipo,
          period: guias.periodo,
          dueDate: guias.vencimento,
          valor: guias.valor,
          status: guias.status,
          fileName: guias.arquivoNome,
          emailStatus: guias.emailStatus,
          emailError: guias.emailErro,
          paidAt: guias.pagoEm,
          receiptKey: guias.comprovanteKey,
          installmentNumber: guias.numeroParcelamento,
          client: {
            companyName: clientes.razaoSocial,
            cnpj: clientes.cnpj,
            emails: clientes.emails,
          },
          visualizado:
            sql<boolean>`EXISTS (SELECT 1 FROM visualizacoes_guias WHERE visualizacoes_guias.guia_id = ${guias.id})`.as(
              'visualizado',
            ),
          primeiraVisualizacao: sql<
            string | null
          >`(SELECT MIN(visualizado_em) FROM visualizacoes_guias WHERE visualizacoes_guias.guia_id = ${guias.id})`.as(
            'primeira_visualizacao',
          ),
          totalVisualizacoes:
            sql<number>`(SELECT COUNT(*) FROM visualizacoes_guias WHERE visualizacoes_guias.guia_id = ${guias.id})`.as(
              'total_visualizacoes',
            ),
        })
        .from(guias)
        .leftJoin(clientes, eq(guias.clienteId, clientes.id))
        .where(where)
        .orderBy(desc(guias.criadoEm))
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
        paid_at: doc.paidAt?.toISOString() ?? null,
        has_receipt: Boolean(doc.receiptKey),
        numero_parcelamento: doc.installmentNumber,
        client: doc.client
          ? {
            company_name: doc.client.companyName,
            cnpj: doc.client.cnpj,
            has_email: (doc.client.emails ?? []).length > 0,
          }
          : null,
        visualizado: doc.visualizado ?? false,
        primeira_visualizacao: doc.primeiraVisualizacao ?? null,
        total_visualizacoes: Number(doc.totalVisualizacoes ?? 0),
      })),
    };
  }

  // ─── Admin: Client guias ───
  async listClientGuiasForStaff(input: {
    clientId: string;
    type: string;
    period: string;
    periodType?: string;
    pagination: PaginationParams;
  }) {
    const today = getBahiaDate();
    const conditions: SQL[] = [eq(guias.clienteId, input.clientId)];
    // Exclude FOLHA-PAGAMENTO from general listing
    conditions.push(ne(guias.tipo, 'FOLHA-PAGAMENTO'));
    if (input.type) conditions.push(eq(guias.tipo, input.type));
    const periodCondition = this.guiaPeriodCondition(
      input.period,
      input.periodType,
    );
    if (periodCondition) conditions.push(periodCondition);
    const where = and(...conditions);

    const [countResult, rows] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(guias)
        .where(where),
      this.database.db
        .select({
          id: guias.id,
          clientId: guias.clienteId,
          type: guias.tipo,
          period: guias.periodo,
          dueDate: guias.vencimento,
          valor: guias.valor,
          fileName: guias.arquivoNome,
          status: guias.status,
          createdAt: guias.criadoEm,
          paidAt: guias.pagoEm,
          receiptKey: guias.comprovanteKey,
          installmentNumber: guias.numeroParcelamento,
          visualizado:
            sql<boolean>`EXISTS (SELECT 1 FROM visualizacoes_guias WHERE visualizacoes_guias.guia_id = ${guias.id})`.as(
              'visualizado',
            ),
          totalVisualizacoes:
            sql<number>`(SELECT COUNT(*) FROM visualizacoes_guias WHERE visualizacoes_guias.guia_id = ${guias.id})`.as(
              'total_visualizacoes',
            ),
        })
        .from(guias)
        .where(where)
        .orderBy(desc(guias.vencimento))
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
        paid_at: doc.paidAt?.toISOString() ?? null,
        has_receipt: Boolean(doc.receiptKey),
        numero_parcelamento: doc.installmentNumber,
        visualizado: doc.visualizado ?? false,
        total_visualizacoes: Number(doc.totalVisualizacoes ?? 0),
      })),
    };
  }

  // ─── Cliente: Own guias ───
  async listClientGuias(input: {
    clientId: string;
    userId: string;
    type: string;
    period: string;
    periodType?: string;
    pagination: PaginationParams;
  }) {
    const today = getBahiaDate();
    const conditions: SQL[] = [eq(guias.clienteId, input.clientId)];
    // Exclude FOLHA-PAGAMENTO from general listing
    conditions.push(ne(guias.tipo, 'FOLHA-PAGAMENTO'));
    if (input.type) conditions.push(eq(guias.tipo, input.type));
    const periodCondition = this.guiaPeriodCondition(
      input.period,
      input.periodType,
    );
    if (periodCondition) conditions.push(periodCondition);
    const where = and(...conditions);

    const [countResult, rows] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(guias)
        .where(where),
      this.database.db
        .select({
          id: guias.id,
          clientId: guias.clienteId,
          type: guias.tipo,
          period: guias.periodo,
          dueDate: guias.vencimento,
          valor: guias.valor,
          fileName: guias.arquivoNome,
          status: guias.status,
          createdAt: guias.criadoEm,
          paidAt: guias.pagoEm,
          receiptKey: guias.comprovanteKey,
          installmentNumber: guias.numeroParcelamento,
          visualizado:
            sql<boolean>`EXISTS (SELECT 1 FROM visualizacoes_guias WHERE visualizacoes_guias.guia_id = ${guias.id} AND visualizacoes_guias.user_id = ${input.userId})`.as(
              'visualizado',
            ),
        })
        .from(guias)
        .where(where)
        .orderBy(desc(guias.vencimento))
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
        paid_at: doc.paidAt?.toISOString() ?? null,
        has_receipt: Boolean(doc.receiptKey),
        numero_parcelamento: doc.installmentNumber,
        visualizado: doc.visualizado ?? false,
      })),
    };
  }

  // ─── Get accessible guia ───
  async getAccessibleGuia(
    guiaId: string,
    currentUser: { id: string; role: string },
  ) {
    const result = await this.database.db
      .select({
        id: guias.id,
        clienteId: guias.clienteId,
        arquivoKey: guias.arquivoKey,
        comprovanteKey: guias.comprovanteKey,
        tipo: guias.tipo,
        periodo: guias.periodo,
        status: guias.status,
      })
      .from(guias)
      .where(eq(guias.id, guiaId))
      .limit(1);

    const guia = result[0];
    if (!guia) return { guia: null, isStaff: false, authorized: false };

    const isStaff =
      currentUser.role === 'ADMIN' || currentUser.role === 'COLABORADOR';
    if (isStaff) return { guia, isStaff, authorized: true };

    const clientResult = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.userId, currentUser.id))
      .limit(1);

    const authorized = clientResult[0]?.id === guia.clienteId;
    return { guia, isStaff, authorized };
  }

  // ─── Record view ───
  async recordGuiaView(guiaId: string, userId: string) {
    await this.database.db
      .insert(visualizacoesGuias)
      .values({ guiaId, userId });
  }

  // ─── Get signed URL ───
  async getSignedUrl(key: string) {
    return this.storage.getSignedUrl(key);
  }

  // ─── List guia views ───
  async listGuiaViews(guiaId: string) {
    const rows = await this.database.db
      .select({
        id: visualizacoesGuias.id,
        viewedAt: visualizacoesGuias.visualizadoEm,
        viewer: { id: user.id, name: user.name, email: user.email },
      })
      .from(visualizacoesGuias)
      .leftJoin(user, eq(visualizacoesGuias.userId, user.id))
      .where(eq(visualizacoesGuias.guiaId, guiaId))
      .orderBy(desc(visualizacoesGuias.visualizadoEm));

    return rows.map((view) => ({
      id: view.id,
      visualizado_em: view.viewedAt.toISOString(),
      usuario: view.viewer
        ? {
          id: view.viewer.id,
          nome: view.viewer.name,
          email: view.viewer.email,
        }
        : null,
    }));
  }

  // ─── Delete guia ───
  async deleteGuia(input: {
    requestId?: string;
    guiaId: string;
    actorUserId: string;
  }) {
    const result = await this.database.db.execute(sql`
      WITH deleted_guia AS (
        DELETE FROM guias WHERE id = ${input.guiaId}::uuid
        RETURNING id, arquivo_key, comprovante_key, arquivo_nome
      ),
      candidate_keys AS (
        SELECT id, arquivo_key AS object_key FROM deleted_guia
        UNION ALL
        SELECT id, comprovante_key FROM deleted_guia WHERE comprovante_key IS NOT NULL
      ),
      cleanup_jobs AS (
        INSERT INTO storage_cleanup_jobs (object_key, entidade_tipo, entidade_id)
        SELECT object_key, 'GUIA', id::text FROM candidate_keys
        ON CONFLICT (object_key) DO NOTHING
        RETURNING id
      ),
      audit_event AS (
        INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
        SELECT ${input.actorUserId}, 'GUIA_EXCLUIDA', 'GUIA', id::text,
          jsonb_build_object('arquivoNome', arquivo_nome, 'motivo', 'EXCLUSAO_ADMINISTRATIVA')
        FROM deleted_guia
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM deleted_guia) AS deleted,
        COALESCE((SELECT array_agg(id::text) FROM cleanup_jobs), ARRAY[]::text[]) AS job_ids
    `);

    const row = resultRows<{ deleted: boolean; job_ids: string[] | null }>(
      result,
    )[0];
    if (!row?.deleted) return { deleted: false, cleanupPending: 0 };

    const cleanup = await this.storageCleanup.processJobs(row.job_ids ?? [], {
      requestId: input.requestId,
      userId: input.actorUserId,
      trigger: 'deletion',
    });
    return { deleted: true, cleanupPending: cleanup.failed };
  }

  // ─── Upload guia ───
  async uploadGuia(input: {
    requestId?: string;
    actorUserId: string;
    client: {
      id: string;
      cnpj: string;
      razaoSocial: string;
      emails: string[] | null;
      regimeTributario: RegimeTributario | null;
      apuraIcms: boolean;
      suspenso?: boolean;
    };
    bytes: Buffer;
    fileName: string;
    tipo: string;
    periodo: string;
    vencimento: string | null;
    valorNumerico: string | null;
    valorLabel: string | null;
    parcelaLabel: string | null;
    numeroParcelamento: string | null;
  }) {
    if (input.tipo === 'ICMS' && simplesNacionalSemApuracaoIcms(input.client)) {
      return { ok: false as const, code: 'ICMS_NOT_APPLICABLE' };
    }

    const guiaId = crypto.randomUUID();
    const r2Key = this.storage.documentObjectKey({
      cnpj: input.client.cnpj,
      period: input.periodo,
      obligationId: guiaId,
      type: input.tipo,
    });

    try {
      await this.storage.upload(r2Key, input.bytes, 'application/pdf');
    } catch (error) {
      this.logger.error('guia_upload_storage_failed', error, {
        requestId: input.requestId,
        guiaId,
      });
      return { ok: false as const, code: 'STORAGE_FAILED' };
    }

    try {
      const fileName = sanitizeFileName(input.fileName);
      const emailStatus = input.client.suspenso
        ? 'SUSPENSO'
        : input.client.emails?.length
          ? 'PENDENTE'
          : 'SEM_EMAIL';
      const insertResult = await this.database.db.execute(sql`
        WITH inserted_guia AS (
          INSERT INTO guias (id, cliente_id, tipo, periodo, vencimento, valor, arquivo_key, arquivo_nome, status, email_status, numero_parcelamento)
          VALUES (${guiaId}::uuid, ${input.client.id}::uuid, ${input.tipo}, ${input.periodo}, ${input.vencimento}::date, ${input.valorNumerico}::numeric, ${r2Key}, ${fileName}, 'PENDENTE', ${emailStatus}, ${input.numeroParcelamento})
          RETURNING id
        ),
        audit_event AS (
          INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
          SELECT ${input.actorUserId}, 'GUIA_ENVIADA', 'GUIA', id::text,
            jsonb_build_object('clienteId', ${input.client.id}::text, 'tipo', ${input.tipo}::text, 'periodo', ${input.periodo}::text)
          FROM inserted_guia
          RETURNING id
        )
        SELECT EXISTS (SELECT 1 FROM inserted_guia) AS inserted
      `);
      if (!resultRows<{ inserted: boolean }>(insertResult)[0]?.inserted) {
        throw new Error('GUIA_INSERT_FAILED');
      }
    } catch (error) {
      await this.storage.delete(r2Key).catch(() => { });
      this.logger.error('guia_upload_database_failed', error, {
        requestId: input.requestId,
        guiaId,
      });
      const isUnique = this.isUniqueViolation(error);
      return {
        ok: false as const,
        code: isUnique ? 'DUPLICATE' : 'DATABASE_FAILED',
      };
    }

    // Send email notification (fire-and-forget).
    // Suspended clients do not receive any e-mail notifications.
    if (!input.client.suspenso && input.client.emails?.length) {
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
          this.database.db
            .execute(
              sql`
            UPDATE guias SET email_status = ${sent ? 'ENVIADO' : 'FALHOU'},
              email_erro = ${sent ? null : 'Falha ao enviar a notificação.'}
            WHERE id = ${guiaId}::uuid
          `,
            )
            .catch(() => { });
        })
        .catch(() => { });
    }

    return { ok: true as const, obligationId: guiaId, r2Key };
  }

  // ─── Find duplicate guia ───
  async findDuplicateGuia(input: {
    clientId: string;
    type: string;
    period: string;
    installmentNumber: string | null;
  }) {
    const result = await this.database.db
      .select({ id: guias.id, arquivoNome: guias.arquivoNome })
      .from(guias)
      .where(
        and(
          eq(guias.clienteId, input.clientId),
          eq(guias.tipo, input.type),
          eq(guias.periodo, input.period),
          input.installmentNumber
            ? eq(guias.numeroParcelamento, input.installmentNumber)
            : isNull(guias.numeroParcelamento),
        ),
      )
      .limit(1);
    return result[0];
  }

  // ─── Confirm payment ───
  async confirmPayment(input: {
    requestId?: string;
    guiaId: string;
    userId: string;
    observation: string | null;
    receipt?: { bytes: Buffer; contentType: string; extension: string };
  }) {
    let receiptKey: string | null = null;

    if (input.receipt) {
      // Buscar cnpj/cpf do cliente vinculado à guia
      const guiaRow = await this.database.db
        .select({
          clienteId: guias.clienteId,
          cnpj: clientes.cnpj,
          cpf: clientes.cpf,
          tipoPessoa: clientes.tipoPessoa,
        })
        .from(guias)
        .innerJoin(clientes, eq(clientes.id, guias.clienteId))
        .where(eq(guias.id, input.guiaId))
        .limit(1);

      if (!guiaRow[0]) return { ok: false as const, code: 'NOT_FOUND' };

      const cnpjCpf =
        guiaRow[0].tipoPessoa === 'PF' && guiaRow[0].cpf
          ? guiaRow[0].cpf
          : guiaRow[0].cnpj;

      receiptKey = this.storage.receiptObjectKey({
        cnpjCpf,
        receiptId: crypto.randomUUID(),
        extension: input.receipt.extension,
      });
    }

    if (input.receipt && receiptKey) {
      try {
        await this.storage.upload(
          receiptKey,
          input.receipt.bytes,
          input.receipt.contentType,
        );
      } catch (error) {
        this.logger.error('payment_receipt_upload_failed', error, {
          requestId: input.requestId,
          guiaId: input.guiaId,
        });
        return { ok: false as const, code: 'STORAGE_FAILED' };
      }
    }

    try {
      const updateResult = await this.database.db.execute(sql`
        WITH updated_guia AS (
          UPDATE guias SET
            status = 'PAGO', pago_em = now(), pagamento_confirmado_por = ${input.userId},
            observacao_pagamento = ${input.observation},
            comprovante_key = CASE WHEN ${receiptKey}::text IS NOT NULL THEN ${receiptKey} ELSE comprovante_key END
          WHERE id = ${input.guiaId}::uuid AND status <> 'PAGO'
          RETURNING id
        ),
        audit_event AS (
          INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
          SELECT ${input.userId}, 'PAGAMENTO_CONFIRMADO', 'GUIA', id::text,
            jsonb_build_object('possuiComprovante', ${receiptKey}::text IS NOT NULL)
          FROM updated_guia
          RETURNING id
        )
        SELECT EXISTS (SELECT 1 FROM updated_guia) AS updated
      `);
      const updated = resultRows<{ updated: boolean }>(updateResult)[0]
        ?.updated;
      if (!updated) {
        if (receiptKey) await this.storage.delete(receiptKey).catch(() => { });
        return { ok: false as const, code: 'ALREADY_PAID' };
      }
    } catch (error) {
      if (receiptKey) await this.storage.delete(receiptKey).catch(() => { });
      this.logger.error('payment_database_failed', error, {
        requestId: input.requestId,
      });
      return { ok: false as const, code: 'DATABASE_FAILED' };
    }

    return { ok: true as const };
  }

  // ─── Notify guia ───
  async notifyGuia(input: {
    guiaId: string;
    actorUserId: string;
    requestId?: string;
  }) {
    const rows = await this.database.db
      .select({
        id: guias.id,
        type: guias.tipo,
        period: guias.periodo,
        dueDate: guias.vencimento,
        client: {
          companyName: clientes.razaoSocial,
          emails: clientes.emails,
          suspenso: clientes.suspenso,
        },
      })
      .from(guias)
      .leftJoin(clientes, eq(guias.clienteId, clientes.id))
      .where(eq(guias.id, input.guiaId))
      .limit(1);

    const guia = rows[0];
    if (!guia) return { ok: false as const, code: 'GUIA_NOT_FOUND' };
    if (guia.client?.suspenso) {
      await this.updateNotificationStatus({
        ...input,
        status: 'SUSPENSO',
        error: 'Cliente suspenso — notificações desativadas.',
        action: 'NOTIFICACAO_CLIENTE_SUSPENSO',
      });
      return { ok: false as const, code: 'CLIENT_SUSPENDED' };
    }
    if (!guia.client?.emails?.length) {
      await this.updateNotificationStatus({
        ...input,
        status: 'SEM_EMAIL',
        error: 'Cliente não possui e-mail cadastrado.',
        action: 'NOTIFICACAO_SEM_EMAIL',
      });
      return { ok: false as const, code: 'CLIENT_WITHOUT_EMAIL' };
    }

    let sent = false;
    try {
      sent = await this.mail.sendDocumentNotificationEmail({
        to: guia.client.emails,
        clientName: guia.client.companyName,
        documentType: guia.type,
        period: guia.period,
        dueDate: guia.dueDate,
      });
    } catch (error) {
      this.logger.error('guia_notification_provider_failed', error, {
        requestId: input.requestId,
      });
    }

    await this.updateNotificationStatus({
      ...input,
      status: sent ? 'ENVIADO' : 'FALHOU',
      error: sent ? null : 'Falha ao enviar a notificação.',
      action: sent ? 'NOTIFICACAO_ENVIADA' : 'NOTIFICACAO_FALHOU',
    });

    return sent
      ? { ok: true as const, status: 'ENVIADO' }
      : { ok: false as const, code: 'NOTIFICATION_FAILED' };
  }

  private async updateNotificationStatus(input: {
    guiaId: string;
    actorUserId: string;
    status: string;
    error: string | null;
    action: string;
  }) {
    await this.database.db.execute(sql`
      WITH updated_guia AS (
        UPDATE guias SET email_status = ${input.status}, email_erro = ${input.error} WHERE id = ${input.guiaId}::uuid RETURNING id
      )
      INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
      SELECT ${input.actorUserId}, ${input.action}, 'GUIA', id::text, jsonb_build_object('status', ${input.status}::text) FROM updated_guia
    `);
  }

  private guiaPeriodCondition(period: string, periodType?: string) {
    if (!period) return null;
    if (periodType !== 'vencimento') return eq(guias.periodo, period);
    const [month, year] = period.split('/');
    if (!month || !year || year.length !== 4) return null;
    const numericMonth = Number.parseInt(month, 10);
    const numericYear = Number.parseInt(year, 10);
    const nextMonth = numericMonth === 12 ? 1 : numericMonth + 1;
    const nextYear = numericMonth === 12 ? numericYear + 1 : numericYear;
    const startDate = `${year}-${month}-01`;
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    return sql`${guias.vencimento} >= ${startDate} AND ${guias.vencimento} < ${endDate}`;
  }

  private isUniqueViolation(error: unknown) {
    const candidate = error as {
      code?: string;
      cause?: { code?: string };
    } | null;
    return candidate?.code === '23505' || candidate?.cause?.code === '23505';
  }
}
