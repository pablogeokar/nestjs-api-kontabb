import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  eventosAuditoria,
  folhasPagamento,
  rescisaoDocumentos,
  rescisoes,
  storageCleanupJobs,
} from '../database/schema';
import { StorageCleanupService } from '../storage/storage-cleanup.service';
import { AppLogger } from '../common/logger.service';
import {
  normalizeForMatch,
  type DadosTrct,
  type RescisaoDocumentoTipo,
} from '../common/pdf-extraction-rescisao';

export type RescisaoResult =
  | { ok: true; folhaId: string; rescisaoId: string }
  | { ok: false; code: 'RESCISAO_DUPLICADA' | 'DATABASE_FAILED' };

export type AnexoResult =
  | { ok: true; documentoId: string }
  | { ok: false; code: 'DOCUMENTO_DUPLICADO' | 'DATABASE_FAILED' };

@Injectable()
export class RhRescisaoService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storageCleanup: StorageCleanupService,
    private readonly logger: AppLogger,
  ) {}

  // ─── Cria a rescisão a partir do TRCT ───
  async processarTrct(input: {
    dados: DadosTrct;
    clienteId: string;
    r2Key: string;
    fileName: string;
    actorUserId: string;
    requestId?: string;
  }): Promise<RescisaoResult> {
    const { dados, clienteId, r2Key, fileName, actorUserId } = input;
    try {
      return await this.database.db.transaction(async (tx) => {
        const [folha] = await tx
          .insert(folhasPagamento)
          .values({
            clienteId,
            arquivoKey: r2Key,
            arquivoNome: fileName,
            tipo: 'RESCISAO',
            competencia: dados.competencia,
            periodoInicio: dados.dataAdmissao,
            periodoFim: dados.dataDesligamento,
            totalBruto: dados.totalBruto.toFixed(2),
            totalDescontos: dados.totalDescontos.toFixed(2),
            totalLiquido: dados.totalLiquido.toFixed(2),
            totalFuncionarios: 1,
            uploadadoPor: actorUserId,
          })
          .returning({ id: folhasPagamento.id });

        const [rescisao] = await tx
          .insert(rescisoes)
          .values({
            folhaId: folha.id,
            clienteId,
            funcionarioNome: dados.funcionarioNome,
            funcionarioCpf: dados.funcionarioCpf,
            dataAdmissao: dados.dataAdmissao,
            dataDesligamento: dados.dataDesligamento,
            causaAfastamento: dados.causaAfastamento,
          })
          .returning({ id: rescisoes.id });

        await tx.insert(rescisaoDocumentos).values({
          rescisaoId: rescisao.id,
          tipoDocumento: 'TRCT',
          arquivoKey: r2Key,
          arquivoNome: fileName,
          uploadadoPor: actorUserId,
        });

        await tx.insert(eventosAuditoria).values({
          atorUserId: actorUserId,
          acao: 'RESCISAO_UPLOADADA',
          entidadeTipo: 'FOLHA_PAGAMENTO',
          entidadeId: folha.id,
          dados: {
            clienteId,
            competencia: dados.competencia,
            tipo: 'RESCISAO',
            funcionarioNome: dados.funcionarioNome,
            dataDesligamento: dados.dataDesligamento,
          },
        });

        return {
          ok: true as const,
          folhaId: folha.id,
          rescisaoId: rescisao.id,
        };
      });
    } catch (error) {
      this.logger.error('rh_processar_rescisao_failed', error, {
        requestId: input.requestId,
        clienteId,
      });
      if (this.isUniqueViolation(error)) {
        return { ok: false, code: 'RESCISAO_DUPLICADA' };
      }
      return { ok: false, code: 'DATABASE_FAILED' };
    }
  }

  async checkDuplicate(
    clienteId: string,
    funcionarioCpf: string,
    dataDesligamento: string,
  ) {
    const rows = await this.database.db
      .select({ id: rescisoes.id })
      .from(rescisoes)
      .where(
        and(
          eq(rescisoes.clienteId, clienteId),
          eq(rescisoes.funcionarioCpf, funcionarioCpf),
          eq(rescisoes.dataDesligamento, dataDesligamento),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Encontra as rescisões do cliente cujo trabalhador (nome ou CPF) é citado
   * no texto do documento. Usado para anexar os demais documentos ao TRCT.
   */
  async findByDocumentText(clienteId: string, text: string) {
    const rows = await this.database.db
      .select({
        id: rescisoes.id,
        folhaId: rescisoes.folhaId,
        funcionarioNome: rescisoes.funcionarioNome,
        funcionarioCpf: rescisoes.funcionarioCpf,
        dataDesligamento: rescisoes.dataDesligamento,
      })
      .from(rescisoes)
      .where(eq(rescisoes.clienteId, clienteId));

    const haystack = normalizeForMatch(text);
    const digits = text.replace(/\D/g, '');
    return rows.filter(
      (row) =>
        haystack.includes(normalizeForMatch(row.funcionarioNome)) ||
        digits.includes(row.funcionarioCpf),
    );
  }

  async getRescisaoByFolha(folhaId: string) {
    const rows = await this.database.db
      .select({
        id: rescisoes.id,
        clienteId: rescisoes.clienteId,
        funcionarioNome: rescisoes.funcionarioNome,
        funcionarioCpf: rescisoes.funcionarioCpf,
        dataAdmissao: rescisoes.dataAdmissao,
        dataDesligamento: rescisoes.dataDesligamento,
        causaAfastamento: rescisoes.causaAfastamento,
      })
      .from(rescisoes)
      .where(eq(rescisoes.folhaId, folhaId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listDocumentos(rescisaoId: string) {
    const rows = await this.database.db
      .select({
        id: rescisaoDocumentos.id,
        tipoDocumento: rescisaoDocumentos.tipoDocumento,
        arquivoNome: rescisaoDocumentos.arquivoNome,
        criadoEm: rescisaoDocumentos.criadoEm,
      })
      .from(rescisaoDocumentos)
      .where(eq(rescisaoDocumentos.rescisaoId, rescisaoId))
      .orderBy(asc(rescisaoDocumentos.criadoEm));
    return rows.map((row) => ({
      id: row.id,
      tipoDocumento: row.tipoDocumento as RescisaoDocumentoTipo,
      arquivoNome: row.arquivoNome,
      criadoEm: row.criadoEm.toISOString(),
    }));
  }

  /** Detalhe da rescisão de uma folha: trabalhador + documentos anexados. */
  async getDetalhe(folhaId: string) {
    const rescisao = await this.getRescisaoByFolha(folhaId);
    if (!rescisao) return null;
    const documentos = await this.listDocumentos(rescisao.id);
    return {
      funcionarioNome: rescisao.funcionarioNome,
      funcionarioCpf: rescisao.funcionarioCpf,
      dataAdmissao: rescisao.dataAdmissao,
      dataDesligamento: rescisao.dataDesligamento,
      causaAfastamento: rescisao.causaAfastamento,
      documentos,
    };
  }

  async anexarDocumento(input: {
    rescisaoId: string;
    tipo: RescisaoDocumentoTipo;
    r2Key: string;
    fileName: string;
    actorUserId: string;
    requestId?: string;
  }): Promise<AnexoResult> {
    try {
      return await this.database.db.transaction(async (tx) => {
        const [documento] = await tx
          .insert(rescisaoDocumentos)
          .values({
            rescisaoId: input.rescisaoId,
            tipoDocumento: input.tipo,
            arquivoKey: input.r2Key,
            arquivoNome: input.fileName,
            uploadadoPor: input.actorUserId,
          })
          .returning({ id: rescisaoDocumentos.id });

        await tx.insert(eventosAuditoria).values({
          atorUserId: input.actorUserId,
          acao: 'RESCISAO_DOCUMENTO_UPLOADADO',
          entidadeTipo: 'RESCISAO',
          entidadeId: input.rescisaoId,
          dados: { tipoDocumento: input.tipo, arquivoNome: input.fileName },
        });

        return { ok: true as const, documentoId: documento.id };
      });
    } catch (error) {
      this.logger.error('rh_rescisao_anexar_documento_failed', error, {
        requestId: input.requestId,
        rescisaoId: input.rescisaoId,
      });
      if (this.isUniqueViolation(error)) {
        return { ok: false, code: 'DOCUMENTO_DUPLICADO' };
      }
      return { ok: false, code: 'DATABASE_FAILED' };
    }
  }

  /** Chave de storage de um documento, validando que pertence à folha. */
  async getDocumentoKey(folhaId: string, documentoId: string) {
    const rows = await this.database.db
      .select({
        arquivoKey: rescisaoDocumentos.arquivoKey,
        arquivoNome: rescisaoDocumentos.arquivoNome,
      })
      .from(rescisaoDocumentos)
      .innerJoin(rescisoes, eq(rescisoes.id, rescisaoDocumentos.rescisaoId))
      .where(
        and(
          eq(rescisaoDocumentos.id, documentoId),
          eq(rescisoes.folhaId, folhaId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Remove um documento (exceto o TRCT, que é excluído junto da rescisão). */
  async deleteDocumento(input: {
    folhaId: string;
    documentoId: string;
    actorUserId: string;
    requestId?: string;
  }): Promise<
    | { ok: true; cleanupPending: number }
    | { ok: false; code: 'NOT_FOUND' | 'TRCT_PROTEGIDO' }
  > {
    const jobId = await this.database.db.transaction(async (tx) => {
      const [documento] = await tx
        .select({
          id: rescisaoDocumentos.id,
          rescisaoId: rescisaoDocumentos.rescisaoId,
          tipoDocumento: rescisaoDocumentos.tipoDocumento,
          arquivoKey: rescisaoDocumentos.arquivoKey,
        })
        .from(rescisaoDocumentos)
        .innerJoin(rescisoes, eq(rescisoes.id, rescisaoDocumentos.rescisaoId))
        .where(
          and(
            eq(rescisaoDocumentos.id, input.documentoId),
            eq(rescisoes.folhaId, input.folhaId),
          ),
        )
        .for('update', { of: rescisaoDocumentos })
        .limit(1);
      if (!documento) return 'NOT_FOUND' as const;
      if (documento.tipoDocumento === 'TRCT') return 'TRCT_PROTEGIDO' as const;

      await tx
        .delete(rescisaoDocumentos)
        .where(eq(rescisaoDocumentos.id, documento.id));
      const [job] = await tx
        .insert(storageCleanupJobs)
        .values({
          objectKey: documento.arquivoKey,
          entidadeTipo: 'RESCISAO_DOCUMENTO',
          entidadeId: documento.id,
        })
        .onConflictDoNothing()
        .returning({ id: storageCleanupJobs.id });
      await tx.insert(eventosAuditoria).values({
        atorUserId: input.actorUserId,
        acao: 'RESCISAO_DOCUMENTO_EXCLUIDO',
        entidadeTipo: 'RESCISAO',
        entidadeId: documento.rescisaoId,
        dados: { tipoDocumento: documento.tipoDocumento },
      });
      return job?.id ?? null;
    });

    if (jobId === 'NOT_FOUND' || jobId === 'TRCT_PROTEGIDO') {
      return { ok: false, code: jobId };
    }
    const cleanup = await this.storageCleanup.processJobs(
      jobId ? [jobId] : [],
      {
        requestId: input.requestId,
        userId: input.actorUserId,
        trigger: 'deletion',
      },
    );
    return { ok: true, cleanupPending: cleanup.failed };
  }

  private isUniqueViolation(error: unknown) {
    const candidate = error as {
      code?: string;
      cause?: { code?: string };
    } | null;
    return candidate?.code === '23505' || candidate?.cause?.code === '23505';
  }
}
