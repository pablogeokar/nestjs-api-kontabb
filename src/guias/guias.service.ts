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
import {
  clientes,
  eventosAuditoria,
  fiscalApuracoesGuias,
  fiscalPagamentosEventos,
  fiscalSimplesApuracoes,
  guias,
  user,
  visualizacoesGuias,
} from '../database/schema';
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
import {
  fromScaledInteger,
  toScaledInteger,
} from '../fiscal/sped/sped-decimal';
import {
  projetarSaldoObrigacao,
  type EventoPagamentoTrilha,
} from '../fiscal/services/fiscal-pagamentos-trilha';

export type StatusVinculoGuiaUpload =
  | 'VINCULADO'
  | 'PENDENTE_CONFIRMACAO'
  | 'DIVERGENTE'
  | 'SEM_CANDIDATO'
  | 'JA_VINCULADA'
  | 'NAO_APLICAVEL';

export interface ResultadoVinculoGuiaUpload {
  status: StatusVinculoGuiaUpload;
  guiaFiscalId: string | null;
  diferenca: string | null;
  motivo: string;
}

export function avaliarVinculoGuiaSimples(input: {
  tipo: string;
  valorUpload: string | null;
  vencimentoUpload: string | null;
  candidata: {
    id: string;
    valorTotal: string;
    dataVencimento: string;
    tipoGuia: string;
    tributo: string;
    cancelada: boolean;
    guiaUploadId: string | null;
  } | null;
}): ResultadoVinculoGuiaUpload {
  if (input.tipo !== 'DAS') {
    return {
      status: 'NAO_APLICAVEL',
      guiaFiscalId: null,
      diferenca: null,
      motivo:
        'A conciliação automática desta etapa é exclusiva para o DAS mensal.',
    };
  }
  const candidata = input.candidata;
  if (
    !candidata ||
    candidata.cancelada ||
    candidata.tipoGuia !== 'DAS' ||
    candidata.tributo !== 'DAS_SIMPLES'
  ) {
    return {
      status: 'SEM_CANDIDATO',
      guiaFiscalId: null,
      diferenca: null,
      motivo:
        'Não existe uma guia DAS ativa gerada pela apuração desta competência.',
    };
  }
  if (candidata.guiaUploadId) {
    return {
      status: 'JA_VINCULADA',
      guiaFiscalId: null,
      diferenca: null,
      motivo: 'A guia calculada já possui um PDF oficial vinculado.',
    };
  }
  if (!input.valorUpload) {
    return {
      status: 'PENDENTE_CONFIRMACAO',
      guiaFiscalId: null,
      diferenca: null,
      motivo: 'O PDF não informou um valor confiável para validar o vínculo.',
    };
  }

  let upload: bigint;
  let apurado: bigint;
  try {
    upload = toScaledInteger(input.valorUpload);
    apurado = toScaledInteger(candidata.valorTotal);
  } catch {
    return {
      status: 'PENDENTE_CONFIRMACAO',
      guiaFiscalId: null,
      diferenca: null,
      motivo: 'Não foi possível comparar o valor do PDF com o valor apurado.',
    };
  }
  const diferenca = upload - apurado;
  const absoluta = diferenca < 0n ? -diferenca : diferenca;
  if (absoluta > 2n) {
    return {
      status: 'DIVERGENTE',
      guiaFiscalId: null,
      diferenca: fromScaledInteger(diferenca),
      motivo: 'O valor do PDF diverge do DAS calculado em mais de R$ 0,02.',
    };
  }
  if (
    input.vencimentoUpload &&
    input.vencimentoUpload !== candidata.dataVencimento
  ) {
    return {
      status: 'PENDENTE_CONFIRMACAO',
      guiaFiscalId: null,
      diferenca: fromScaledInteger(diferenca),
      motivo:
        'O vencimento do PDF difere da guia calculada; confirme antes de vincular.',
    };
  }
  return {
    status: 'VINCULADO',
    guiaFiscalId: candidata.id,
    diferenca: fromScaledInteger(diferenca),
    motivo: 'CNPJ, competência, tipo e valor conferem com a apuração fechada.',
  };
}

@Injectable()
export class GuiasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly storageCleanup: StorageCleanupService,
    private readonly mail: MailService,
    private readonly logger: AppLogger,
  ) {}

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
    const [vinculoFiscal] = await this.database.db
      .select({ id: fiscalApuracoesGuias.id })
      .from(fiscalApuracoesGuias)
      .where(eq(fiscalApuracoesGuias.guiaUploadId, input.guiaId))
      .limit(1);
    if (vinculoFiscal) {
      return {
        deleted: false,
        cleanupPending: 0,
        blockedByFiscalLink: true,
      };
    }

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
    if (!row?.deleted) {
      return {
        deleted: false,
        cleanupPending: 0,
        blockedByFiscalLink: false,
      };
    }

    const cleanup = await this.storageCleanup.processJobs(row.job_ids ?? [], {
      requestId: input.requestId,
      userId: input.actorUserId,
      trigger: 'deletion',
    });
    return {
      deleted: true,
      cleanupPending: cleanup.failed,
      blockedByFiscalLink: false,
    };
  }

  private async identificarVinculoApuracao(input: {
    clientId: string;
    tipo: string;
    periodo: string;
    valorNumerico: string | null;
    vencimento: string | null;
  }): Promise<ResultadoVinculoGuiaUpload> {
    if (input.tipo !== 'DAS') {
      return avaliarVinculoGuiaSimples({
        tipo: input.tipo,
        valorUpload: input.valorNumerico,
        vencimentoUpload: input.vencimento,
        candidata: null,
      });
    }

    const match = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(input.periodo);
    if (!match) {
      return {
        status: 'PENDENTE_CONFIRMACAO',
        guiaFiscalId: null,
        diferenca: null,
        motivo: 'A competência do PDF não está no formato MM/AAAA.',
      };
    }
    const competencia = `${match[2]}-${match[1]}-01`;
    const [candidata] = await this.database.db
      .select({
        id: fiscalApuracoesGuias.id,
        valorTotal: fiscalApuracoesGuias.valorTotal,
        dataVencimento: fiscalApuracoesGuias.dataVencimento,
        tipoGuia: fiscalApuracoesGuias.tipoGuia,
        tributo: fiscalApuracoesGuias.tributo,
        cancelada: fiscalApuracoesGuias.cancelada,
        guiaUploadId: fiscalApuracoesGuias.guiaUploadId,
      })
      .from(fiscalSimplesApuracoes)
      .innerJoin(
        fiscalApuracoesGuias,
        eq(fiscalSimplesApuracoes.guiaId, fiscalApuracoesGuias.id),
      )
      .where(
        and(
          eq(fiscalSimplesApuracoes.clienteId, input.clientId),
          eq(fiscalSimplesApuracoes.competencia, competencia),
          eq(fiscalSimplesApuracoes.corrente, true),
          eq(fiscalSimplesApuracoes.status, 'FECHADO'),
        ),
      )
      .limit(1);

    return avaliarVinculoGuiaSimples({
      tipo: input.tipo,
      valorUpload: input.valorNumerico,
      vencimentoUpload: input.vencimento,
      candidata: candidata ?? null,
    });
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

    const vinculo = await this.identificarVinculoApuracao({
      clientId: input.client.id,
      tipo: input.tipo,
      periodo: input.periodo,
      valorNumerico: input.valorNumerico,
      vencimento: input.vencimento,
    });

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
      const now = new Date();
      await this.database.db.transaction(async (tx) => {
        await tx.insert(guias).values({
          id: guiaId,
          clienteId: input.client.id,
          tipo: input.tipo,
          periodo: input.periodo,
          vencimento: input.vencimento,
          valor: input.valorNumerico,
          arquivoKey: r2Key,
          arquivoNome: fileName,
          status: 'PENDENTE',
          emailStatus,
          numeroParcelamento: input.numeroParcelamento,
        });

        if (vinculo.status === 'VINCULADO' && vinculo.guiaFiscalId) {
          const [guiaFiscal] = await tx
            .update(fiscalApuracoesGuias)
            .set({
              guiaUploadId: guiaId,
              guiaUploadVinculadaEm: now,
              guiaUploadDiferenca: vinculo.diferenca,
              arquivoGuiaKey: r2Key,
              emitidaOrgao: true,
              emitidaOrgaoEm: now,
              atualizadoEm: now,
            })
            .where(
              and(
                eq(fiscalApuracoesGuias.id, vinculo.guiaFiscalId),
                eq(fiscalApuracoesGuias.clienteId, input.client.id),
                isNull(fiscalApuracoesGuias.guiaUploadId),
              ),
            )
            .returning({ id: fiscalApuracoesGuias.id });
          if (!guiaFiscal) throw new Error('GUIA_FISCAL_ALREADY_LINKED');
        }

        await tx.insert(eventosAuditoria).values({
          atorUserId: input.actorUserId,
          acao:
            vinculo.status === 'VINCULADO'
              ? 'GUIA_ENVIADA_E_VINCULADA'
              : 'GUIA_ENVIADA',
          entidadeTipo: 'GUIA',
          entidadeId: guiaId,
          dados: {
            clienteId: input.client.id,
            tipo: input.tipo,
            periodo: input.periodo,
            vinculoStatus: vinculo.status,
            guiaFiscalId: vinculo.guiaFiscalId,
            diferenca: vinculo.diferenca,
            motivo: vinculo.motivo,
          },
        });
      });
    } catch (error) {
      await this.storage.delete(r2Key).catch(() => {});
      this.logger.error('guia_upload_database_failed', error, {
        requestId: input.requestId,
        guiaId,
      });
      const isUnique =
        this.isUniqueViolation(error) ||
        (error instanceof Error &&
          error.message === 'GUIA_FISCAL_ALREADY_LINKED');
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
            .catch(() => {});
        })
        .catch(() => {});
    }

    return { ok: true as const, obligationId: guiaId, r2Key, vinculo };
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
    paidAtDate?: string | null;
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
          ? // CPF saneado para dígitos antes de virar segmento de chave R2
            // (transparente para o formato numérico já armazenado).
            guiaRow[0].cpf.replace(/\D/g, '')
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
      const updated = await this.database.db.transaction(async (tx) => {
        // A atualização condicional bloqueia a linha até o commit. Um retry ou
        // segundo request concorrente não cria outro evento nem outra auditoria.
        const [updatedGuia] = await tx
          .update(guias)
          .set({
            status: 'PAGO',
            pagoEm: sql`COALESCE(${input.paidAtDate ?? null}::date + time '12:00', now()::timestamp)`,
            pagamentoConfirmadoPor: input.userId,
            observacaoPagamento: input.observation,
            ...(receiptKey ? { comprovanteKey: receiptKey } : {}),
          })
          .where(and(eq(guias.id, input.guiaId), ne(guias.status, 'PAGO')))
          .returning({
            id: guias.id,
            clienteId: guias.clienteId,
            valor: guias.valor,
          });
        if (!updatedGuia) return false;

        const [guiaFiscal] = await tx
          .select({
            id: fiscalApuracoesGuias.id,
            clienteId: fiscalApuracoesGuias.clienteId,
            fechamentoId: fiscalApuracoesGuias.fechamentoId,
            cancelada: fiscalApuracoesGuias.cancelada,
            valorTotal: fiscalApuracoesGuias.valorTotal,
          })
          .from(fiscalApuracoesGuias)
          .where(eq(fiscalApuracoesGuias.guiaUploadId, updatedGuia.id))
          .limit(1);

        if (guiaFiscal && !guiaFiscal.cancelada) {
          if (guiaFiscal.clienteId !== updatedGuia.clienteId) {
            throw new Error('PAYMENT_FISCAL_CLIENT_MISMATCH');
          }
          // O valor é o extraído do PDF da guia de upload. Não se usa o saldo
          // residual: a confirmação pode suceder eventos parciais anteriores.
          if (!updatedGuia.valor || toScaledInteger(updatedGuia.valor) <= 0n) {
            throw new Error('PAYMENT_FISCAL_VALUE_UNAVAILABLE');
          }
          const eventos = await tx
            .select({
              tipo: fiscalPagamentosEventos.tipo,
              valor: fiscalPagamentosEventos.valor,
              sinal: fiscalPagamentosEventos.sinal,
            })
            .from(fiscalPagamentosEventos)
            .where(eq(fiscalPagamentosEventos.guiaId, guiaFiscal.id));
          const trilha: EventoPagamentoTrilha[] = eventos.map((evento) => ({
            tipo: evento.tipo as 'PAGAMENTO' | 'PAGAMENTO_PARCIAL' | 'ESTORNO',
            valor: evento.valor,
            sinal: evento.sinal === -1 ? -1 : 1,
          }));
          const saldo = projetarSaldoObrigacao(guiaFiscal.valorTotal, [
            ...trilha,
            { tipo: 'PAGAMENTO', valor: updatedGuia.valor, sinal: 1 },
          ]);
          await tx.insert(fiscalPagamentosEventos).values({
            clienteId: updatedGuia.clienteId,
            guiaId: guiaFiscal.id,
            fechamentoId: guiaFiscal.fechamentoId,
            tipo: saldo.quitada ? 'PAGAMENTO' : 'PAGAMENTO_PARCIAL',
            origem: 'CONCILIACAO',
            valor: updatedGuia.valor,
            sinal: 1,
            dataEvento: input.paidAtDate ?? getBahiaDate(),
            comprovanteKey: receiptKey,
            declaracaoManual: !receiptKey,
            documentoExterno: `guia-upload:${updatedGuia.id}`,
            observacao: input.observation,
          });
          const [fiscalUpdated] = await tx
            .update(fiscalApuracoesGuias)
            .set({
              ...(saldo.quitada ? { statusPagamento: 'PAGO' } : {}),
              atualizadoEm: new Date(),
            })
            .where(
              and(
                eq(fiscalApuracoesGuias.id, guiaFiscal.id),
                eq(fiscalApuracoesGuias.guiaUploadId, updatedGuia.id),
                eq(fiscalApuracoesGuias.cancelada, false),
              ),
            )
            .returning({ id: fiscalApuracoesGuias.id });
          if (!fiscalUpdated) throw new Error('PAYMENT_FISCAL_LINK_CHANGED');
        }

        await tx.insert(eventosAuditoria).values({
          atorUserId: input.userId,
          acao: 'PAGAMENTO_CONFIRMADO',
          entidadeTipo: 'GUIA',
          entidadeId: updatedGuia.id,
          dados: {
            possuiComprovante: receiptKey !== null,
            dataPagamentoInformada: input.paidAtDate ?? null,
          },
        });
        return true;
      });
      if (!updated) {
        if (receiptKey) await this.storage.delete(receiptKey).catch(() => {});
        return { ok: false as const, code: 'ALREADY_PAID' };
      }
    } catch (error) {
      if (receiptKey) await this.storage.delete(receiptKey).catch(() => {});
      this.logger.error('payment_database_failed', error, {
        requestId: input.requestId,
      });
      return { ok: false as const, code: 'DATABASE_FAILED' };
    }

    return { ok: true as const };
  }

  async attachReceiptToPaidGuia(input: {
    requestId?: string;
    guiaId: string;
    userId: string;
    observation: string | null;
    receipt: { bytes: Buffer; contentType: string; extension: string };
  }) {
    const guiaRow = await this.database.db
      .select({
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
        ? guiaRow[0].cpf.replace(/\D/g, '')
        : guiaRow[0].cnpj;
    const receiptKey = this.storage.receiptObjectKey({
      cnpjCpf,
      receiptId: crypto.randomUUID(),
      extension: input.receipt.extension,
    });

    try {
      await this.storage.upload(
        receiptKey,
        input.receipt.bytes,
        input.receipt.contentType,
      );
    } catch (error) {
      this.logger.error('paid_guia_receipt_upload_failed', error, {
        requestId: input.requestId,
        guiaId: input.guiaId,
      });
      return { ok: false as const, code: 'STORAGE_FAILED' };
    }

    try {
      const updateResult = await this.database.db.execute(sql`
        WITH updated_guia AS (
          UPDATE guias SET
            comprovante_key = ${receiptKey},
            observacao_pagamento = CASE
              WHEN ${input.observation}::text IS NULL THEN observacao_pagamento
              ELSE concat_ws(chr(10), NULLIF(observacao_pagamento, ''), ${input.observation})
            END
          WHERE id = ${input.guiaId}::uuid AND status = 'PAGO' AND comprovante_key IS NULL
          RETURNING id
        ),
        audit_event AS (
          INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
          SELECT ${input.userId}, 'COMPROVANTE_ANEXADO_GUIA_PAGA', 'GUIA', id::text,
            jsonb_build_object('possuiComprovante', true)
          FROM updated_guia
          RETURNING id
        )
        SELECT EXISTS (SELECT 1 FROM updated_guia) AS updated
      `);
      const updated = resultRows<{ updated: boolean }>(updateResult)[0]
        ?.updated;
      if (!updated) {
        await this.storage.delete(receiptKey).catch(() => {});
        return { ok: false as const, code: 'NOT_ELIGIBLE' };
      }
    } catch (error) {
      await this.storage.delete(receiptKey).catch(() => {});
      this.logger.error('paid_guia_receipt_database_failed', error, {
        requestId: input.requestId,
        guiaId: input.guiaId,
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
