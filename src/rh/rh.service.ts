import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  clientes,
  documentos,
  eventosAuditoria,
  folhasPagamento,
  funcionariosRh,
  itensFolhaPagamento,
} from '../database/schema';
import { StorageCleanupService } from '../storage/storage-cleanup.service';
import { AppLogger } from '../common/logger.service';
import { resultRows } from '../common/db-result';
import type { DadosFolhaPagamento } from '../common/pdf-extraction-rh';
import type { PaginationParams } from '../common/types';

@Injectable()
export class RhService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storageCleanup: StorageCleanupService,
    private readonly logger: AppLogger,
  ) {}

  // ─── Process payroll upload ───
  async processarFolhaPagamento(input: {
    dados: DadosFolhaPagamento;
    clienteId: string;
    r2Key: string;
    fileName: string;
    actorUserId: string;
    requestId?: string;
  }): Promise<{ ok: boolean; folhaId?: string; code?: string }> {
    const { dados, clienteId, r2Key, fileName, actorUserId } = input;

    try {
      // 1. Insert document record
      const docId = crypto.randomUUID();
      await this.database.db.insert(documentos).values({
        id: docId,
        clienteId,
        tipo: 'FOLHA-PAGAMENTO',
        periodo: dados.competencia,
        vencimento: null,
        valor: null,
        arquivoKey: r2Key,
        arquivoNome: fileName,
        status: 'PENDENTE',
        emailStatus: 'SEM_EMAIL',
      });

      // 2. Insert folha_pagamento
      const folhaId = crypto.randomUUID();
      await this.database.db.insert(folhasPagamento).values({
        id: folhaId,
        clienteId,
        documentoId: docId,
        competencia: dados.competencia,
        periodoInicio: dados.periodoInicio,
        periodoFim: dados.periodoFim,
        totalBruto: String(dados.totalBruto),
        totalDescontos: String(dados.totalDescontos),
        totalLiquido: String(dados.totalLiquido),
        totalFuncionarios: dados.totalFuncionarios,
        totalInss: String(dados.totalInss),
        totalFgts: String(dados.totalFgts),
        totalIrrf: String(dados.totalIrrf),
        totalSalarioFamilia: String(dados.totalSalarioFamilia),
        uploadadoPor: actorUserId,
      });

      // 3. Upsert funcionarios and insert itens
      for (const func of dados.funcionarios) {
        // Upsert funcionario
        const existingFunc = await this.database.db
          .select({ id: funcionariosRh.id })
          .from(funcionariosRh)
          .where(
            and(
              eq(funcionariosRh.clienteId, clienteId),
              eq(funcionariosRh.codigoFuncionario, func.codigoFuncionario),
            ),
          )
          .limit(1);

        let funcionarioId: string;

        if (existingFunc[0]) {
          funcionarioId = existingFunc[0].id;
          await this.database.db
            .update(funcionariosRh)
            .set({
              nomeCompleto: func.nomeCompleto,
              cargo: func.cargo,
              dataAdmissao: func.dataAdmissao
                ? this.parseDataAdmissao(func.dataAdmissao)
                : undefined,
              atualizadoEm: new Date(),
            })
            .where(eq(funcionariosRh.id, funcionarioId));
        } else {
          funcionarioId = crypto.randomUUID();
          await this.database.db.insert(funcionariosRh).values({
            id: funcionarioId,
            clienteId,
            codigoFuncionario: func.codigoFuncionario,
            nomeCompleto: func.nomeCompleto,
            cargo: func.cargo,
            dataAdmissao: func.dataAdmissao
              ? this.parseDataAdmissao(func.dataAdmissao)
              : null,
          });
        }

        // Insert item
        await this.database.db.insert(itensFolhaPagamento).values({
          folhaId,
          funcionarioId,
          clienteId,
          salarioBase: String(func.salarioBase),
          totalProventos: String(func.totalProventos),
          totalDescontos: String(func.totalDescontos),
          salarioLiquido: String(func.salarioLiquido),
          baseInss: func.baseInss != null ? String(func.baseInss) : null,
          aliquotaInss:
            func.aliquotaInss != null ? String(func.aliquotaInss) : null,
          valorInss: func.valorInss != null ? String(func.valorInss) : null,
          baseFgts: func.baseFgts != null ? String(func.baseFgts) : null,
          valorFgts: func.valorFgts != null ? String(func.valorFgts) : null,
          baseIrrf: func.baseIrrf != null ? String(func.baseIrrf) : null,
          valorIrrf: func.valorIrrf != null ? String(func.valorIrrf) : null,
          referencia: func.referencia,
          codigoFolha: func.codigoFolha,
          dependentesIr: func.dependentesIr,
          dependentesSf: func.dependentesSf,
          rubricas: func.rubricas,
        });
      }

      // 4. Audit event
      await this.database.db.insert(eventosAuditoria).values({
        atorUserId: actorUserId,
        acao: 'FOLHA_PAGAMENTO_UPLOADADA',
        entidadeTipo: 'FOLHA_PAGAMENTO',
        entidadeId: folhaId,
        dados: {
          clienteId,
          competencia: dados.competencia,
          totalFuncionarios: dados.totalFuncionarios,
        },
      });

      return { ok: true, folhaId };
    } catch (error) {
      this.logger.error('rh_processar_folha_failed', error, {
        requestId: input.requestId,
        clienteId,
      });
      if (this.isUniqueViolation(error)) {
        return { ok: false, code: 'FOLHA_DUPLICADA' };
      }
      return { ok: false, code: 'DATABASE_FAILED' };
    }
  }

  // ─── Check duplicate ───
  async checkDuplicateFolha(clienteId: string, competencia: string) {
    const result = await this.database.db
      .select({ id: folhasPagamento.id })
      .from(folhasPagamento)
      .where(
        and(
          eq(folhasPagamento.clienteId, clienteId),
          eq(folhasPagamento.competencia, competencia),
        ),
      )
      .limit(1);
    return result[0] ?? null;
  }

  // ─── List folhas (admin) ───
  async listFolhas(input: {
    clienteId?: string;
    competencia?: string;
    search?: string;
    pagination: PaginationParams;
  }) {
    const conditions: SQL[] = [];
    if (input.clienteId)
      conditions.push(eq(folhasPagamento.clienteId, input.clienteId));
    if (input.competencia)
      conditions.push(eq(folhasPagamento.competencia, input.competencia));
    if (input.search) {
      const digits = input.search.replace(/\D/g, '');
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM clientes c
          WHERE c.id = ${folhasPagamento.clienteId}
          AND (c.razao_social ILIKE ${'%' + input.search + '%'}
            ${digits ? sql`OR c.cnpj ILIKE ${'%' + digits + '%'}` : sql``})
        )`,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(folhasPagamento)
        .where(where),
      this.database.db
        .select({
          id: folhasPagamento.id,
          clienteId: folhasPagamento.clienteId,
          competencia: folhasPagamento.competencia,
          periodoInicio: folhasPagamento.periodoInicio,
          periodoFim: folhasPagamento.periodoFim,
          totalBruto: folhasPagamento.totalBruto,
          totalDescontos: folhasPagamento.totalDescontos,
          totalLiquido: folhasPagamento.totalLiquido,
          totalFuncionarios: folhasPagamento.totalFuncionarios,
          criadoEm: folhasPagamento.criadoEm,
          cliente: {
            razaoSocial: clientes.razaoSocial,
            cnpj: clientes.cnpj,
          },
        })
        .from(folhasPagamento)
        .leftJoin(clientes, eq(folhasPagamento.clienteId, clientes.id))
        .where(where)
        .orderBy(desc(folhasPagamento.criadoEm))
        .limit(input.pagination.limit)
        .offset(input.pagination.offset),
    ]);

    return {
      total: Number(countResult[0]?.count ?? 0),
      data: rows.map((r) => ({
        id: r.id,
        clienteId: r.clienteId,
        competencia: r.competencia,
        periodoInicio: r.periodoInicio,
        periodoFim: r.periodoFim,
        totalBruto: Number(r.totalBruto),
        totalDescontos: Number(r.totalDescontos),
        totalLiquido: Number(r.totalLiquido),
        totalFuncionarios: r.totalFuncionarios,
        criadoEm: r.criadoEm.toISOString(),
        cliente: r.cliente
          ? { razaoSocial: r.cliente.razaoSocial, cnpj: r.cliente.cnpj }
          : null,
      })),
    };
  }

  // ─── Get folha detail ───
  async getFolhaDetail(folhaId: string) {
    const rows = await this.database.db
      .select({
        id: folhasPagamento.id,
        clienteId: folhasPagamento.clienteId,
        competencia: folhasPagamento.competencia,
        periodoInicio: folhasPagamento.periodoInicio,
        periodoFim: folhasPagamento.periodoFim,
        totalBruto: folhasPagamento.totalBruto,
        totalDescontos: folhasPagamento.totalDescontos,
        totalLiquido: folhasPagamento.totalLiquido,
        totalFuncionarios: folhasPagamento.totalFuncionarios,
        totalInss: folhasPagamento.totalInss,
        totalFgts: folhasPagamento.totalFgts,
        totalIrrf: folhasPagamento.totalIrrf,
        totalSalarioFamilia: folhasPagamento.totalSalarioFamilia,
        criadoEm: folhasPagamento.criadoEm,
        cliente: { razaoSocial: clientes.razaoSocial, cnpj: clientes.cnpj },
      })
      .from(folhasPagamento)
      .leftJoin(clientes, eq(folhasPagamento.clienteId, clientes.id))
      .where(eq(folhasPagamento.id, folhaId))
      .limit(1);

    const folha = rows[0];
    if (!folha) return null;

    return {
      id: folha.id,
      clienteId: folha.clienteId,
      competencia: folha.competencia,
      periodoInicio: folha.periodoInicio,
      periodoFim: folha.periodoFim,
      totalBruto: Number(folha.totalBruto),
      totalDescontos: Number(folha.totalDescontos),
      totalLiquido: Number(folha.totalLiquido),
      totalFuncionarios: folha.totalFuncionarios,
      totalInss: Number(folha.totalInss),
      totalFgts: Number(folha.totalFgts),
      totalIrrf: Number(folha.totalIrrf),
      totalSalarioFamilia: Number(folha.totalSalarioFamilia),
      criadoEm: folha.criadoEm.toISOString(),
      cliente: folha.cliente
        ? { razaoSocial: folha.cliente.razaoSocial, cnpj: folha.cliente.cnpj }
        : null,
    };
  }

  // ─── List itens (funcionarios) de uma folha ───
  async listItensFolha(folhaId: string, pagination: PaginationParams) {
    const where = eq(itensFolhaPagamento.folhaId, folhaId);

    const [countResult, rows] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(itensFolhaPagamento)
        .where(where),
      this.database.db
        .select({
          id: itensFolhaPagamento.id,
          salarioBase: itensFolhaPagamento.salarioBase,
          totalProventos: itensFolhaPagamento.totalProventos,
          totalDescontos: itensFolhaPagamento.totalDescontos,
          salarioLiquido: itensFolhaPagamento.salarioLiquido,
          funcionario: {
            id: funcionariosRh.id,
            codigoFuncionario: funcionariosRh.codigoFuncionario,
            nomeCompleto: funcionariosRh.nomeCompleto,
            cargo: funcionariosRh.cargo,
          },
        })
        .from(itensFolhaPagamento)
        .leftJoin(
          funcionariosRh,
          eq(itensFolhaPagamento.funcionarioId, funcionariosRh.id),
        )
        .where(where)
        .orderBy(funcionariosRh.nomeCompleto)
        .limit(pagination.limit)
        .offset(pagination.offset),
    ]);

    return {
      total: Number(countResult[0]?.count ?? 0),
      data: rows.map((r) => ({
        id: r.id,
        salarioBase: Number(r.salarioBase),
        totalProventos: Number(r.totalProventos),
        totalDescontos: Number(r.totalDescontos),
        salarioLiquido: Number(r.salarioLiquido),
        funcionario: r.funcionario
          ? {
              id: r.funcionario.id,
              codigoFuncionario: r.funcionario.codigoFuncionario,
              nomeCompleto: r.funcionario.nomeCompleto,
              cargo: r.funcionario.cargo,
            }
          : null,
      })),
    };
  }

  // ─── List funcionarios de um cliente ───
  async listFuncionarios(clienteId: string, pagination: PaginationParams) {
    const where = eq(funcionariosRh.clienteId, clienteId);

    const [countResult, rows] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(funcionariosRh)
        .where(where),
      this.database.db
        .select({
          id: funcionariosRh.id,
          codigoFuncionario: funcionariosRh.codigoFuncionario,
          nomeCompleto: funcionariosRh.nomeCompleto,
          cargo: funcionariosRh.cargo,
          dataAdmissao: funcionariosRh.dataAdmissao,
          ativo: funcionariosRh.ativo,
        })
        .from(funcionariosRh)
        .where(where)
        .orderBy(funcionariosRh.nomeCompleto)
        .limit(pagination.limit)
        .offset(pagination.offset),
    ]);

    return {
      total: Number(countResult[0]?.count ?? 0),
      data: rows,
    };
  }

  // ─── Get recibo individual ───
  async getRecibo(itemFolhaId: string) {
    const rows = await this.database.db
      .select({
        item: {
          id: itensFolhaPagamento.id,
          salarioBase: itensFolhaPagamento.salarioBase,
          totalProventos: itensFolhaPagamento.totalProventos,
          totalDescontos: itensFolhaPagamento.totalDescontos,
          salarioLiquido: itensFolhaPagamento.salarioLiquido,
          baseInss: itensFolhaPagamento.baseInss,
          aliquotaInss: itensFolhaPagamento.aliquotaInss,
          valorInss: itensFolhaPagamento.valorInss,
          baseFgts: itensFolhaPagamento.baseFgts,
          valorFgts: itensFolhaPagamento.valorFgts,
          baseIrrf: itensFolhaPagamento.baseIrrf,
          valorIrrf: itensFolhaPagamento.valorIrrf,
          referencia: itensFolhaPagamento.referencia,
          dependentesIr: itensFolhaPagamento.dependentesIr,
          dependentesSf: itensFolhaPagamento.dependentesSf,
          rubricas: itensFolhaPagamento.rubricas,
        },
        funcionario: {
          codigoFuncionario: funcionariosRh.codigoFuncionario,
          nomeCompleto: funcionariosRh.nomeCompleto,
          cargo: funcionariosRh.cargo,
          dataAdmissao: funcionariosRh.dataAdmissao,
        },
        folha: {
          competencia: folhasPagamento.competencia,
          periodoInicio: folhasPagamento.periodoInicio,
          periodoFim: folhasPagamento.periodoFim,
        },
        empresa: {
          razaoSocial: clientes.razaoSocial,
          cnpj: clientes.cnpj,
        },
      })
      .from(itensFolhaPagamento)
      .leftJoin(
        funcionariosRh,
        eq(itensFolhaPagamento.funcionarioId, funcionariosRh.id),
      )
      .leftJoin(
        folhasPagamento,
        eq(itensFolhaPagamento.folhaId, folhasPagamento.id),
      )
      .leftJoin(clientes, eq(itensFolhaPagamento.clienteId, clientes.id))
      .where(eq(itensFolhaPagamento.id, itemFolhaId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      empresa: {
        razaoSocial: row.empresa?.razaoSocial ?? '',
        cnpj: row.empresa?.cnpj ?? '',
      },
      competencia: row.folha?.competencia ?? '',
      periodoInicio: row.folha?.periodoInicio ?? '',
      periodoFim: row.folha?.periodoFim ?? '',
      funcionario: {
        codigoFuncionario: row.funcionario?.codigoFuncionario ?? '',
        nomeCompleto: row.funcionario?.nomeCompleto ?? '',
        cargo: row.funcionario?.cargo ?? null,
        dataAdmissao: row.funcionario?.dataAdmissao ?? null,
        dependentesIr: row.item.dependentesIr ?? 0,
        dependentesSf: row.item.dependentesSf ?? 0,
        referencia: row.item.referencia,
      },
      valores: {
        salarioBase: Number(row.item.salarioBase),
        totalProventos: Number(row.item.totalProventos),
        totalDescontos: Number(row.item.totalDescontos),
        salarioLiquido: Number(row.item.salarioLiquido),
        baseInss: row.item.baseInss ? Number(row.item.baseInss) : null,
        aliquotaInss: row.item.aliquotaInss
          ? Number(row.item.aliquotaInss)
          : null,
        valorInss: row.item.valorInss ? Number(row.item.valorInss) : null,
        baseFgts: row.item.baseFgts ? Number(row.item.baseFgts) : null,
        valorFgts: row.item.valorFgts ? Number(row.item.valorFgts) : null,
        baseIrrf: row.item.baseIrrf ? Number(row.item.baseIrrf) : null,
        valorIrrf: row.item.valorIrrf ? Number(row.item.valorIrrf) : null,
      },
      rubricas: row.item.rubricas ?? [],
    };
  }

  // ─── Historico de um funcionario ───
  async getHistoricoFuncionario(
    funcionarioId: string,
    pagination: PaginationParams,
  ) {
    const where = eq(itensFolhaPagamento.funcionarioId, funcionarioId);

    const [countResult, rows] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(itensFolhaPagamento)
        .where(where),
      this.database.db
        .select({
          id: itensFolhaPagamento.id,
          salarioBase: itensFolhaPagamento.salarioBase,
          totalProventos: itensFolhaPagamento.totalProventos,
          totalDescontos: itensFolhaPagamento.totalDescontos,
          salarioLiquido: itensFolhaPagamento.salarioLiquido,
          competencia: folhasPagamento.competencia,
          criadoEm: itensFolhaPagamento.criadoEm,
        })
        .from(itensFolhaPagamento)
        .leftJoin(
          folhasPagamento,
          eq(itensFolhaPagamento.folhaId, folhasPagamento.id),
        )
        .where(where)
        .orderBy(desc(folhasPagamento.competencia))
        .limit(pagination.limit)
        .offset(pagination.offset),
    ]);

    return {
      total: Number(countResult[0]?.count ?? 0),
      data: rows.map((r) => ({
        id: r.id,
        competencia: r.competencia,
        salarioBase: Number(r.salarioBase),
        totalProventos: Number(r.totalProventos),
        totalDescontos: Number(r.totalDescontos),
        salarioLiquido: Number(r.salarioLiquido),
        criadoEm: r.criadoEm.toISOString(),
      })),
    };
  }

  // ─── Dashboard/Resumo ───
  async getResumo(clienteId: string, ano: number) {
    const rows = await this.database.db
      .select({
        competencia: folhasPagamento.competencia,
        totalBruto: folhasPagamento.totalBruto,
        totalDescontos: folhasPagamento.totalDescontos,
        totalLiquido: folhasPagamento.totalLiquido,
        totalFuncionarios: folhasPagamento.totalFuncionarios,
        totalInss: folhasPagamento.totalInss,
        totalFgts: folhasPagamento.totalFgts,
        totalIrrf: folhasPagamento.totalIrrf,
      })
      .from(folhasPagamento)
      .where(
        and(
          eq(folhasPagamento.clienteId, clienteId),
          sql`${folhasPagamento.competencia} LIKE ${'%/' + ano}`,
        ),
      )
      .orderBy(folhasPagamento.competencia);

    const [funcCount] = await this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(funcionariosRh)
      .where(
        and(
          eq(funcionariosRh.clienteId, clienteId),
          eq(funcionariosRh.ativo, true),
        ),
      );

    return {
      ano,
      totalFuncionariosAtivos: Number(funcCount?.count ?? 0),
      resumoPorMes: rows.map((r) => {
        const [mes] = r.competencia.split('/');
        return {
          competencia: r.competencia,
          mes: parseInt(mes, 10),
          ano,
          totalBruto: Number(r.totalBruto),
          totalDescontos: Number(r.totalDescontos),
          totalLiquido: Number(r.totalLiquido),
          totalFuncionarios: r.totalFuncionarios,
          totalInss: Number(r.totalInss),
          totalFgts: Number(r.totalFgts),
          totalIrrf: Number(r.totalIrrf),
        };
      }),
    };
  }

  // ─── Delete folha ───
  async deleteFolha(input: {
    folhaId: string;
    actorUserId: string;
    requestId?: string;
  }) {
    const result = await this.database.db.execute(sql`
      WITH target_folha AS MATERIALIZED (
        SELECT id, cliente_id, documento_id, competencia
        FROM folhas_pagamento WHERE id = ${input.folhaId}::uuid
        FOR UPDATE
      ),
      target_doc AS MATERIALIZED (
        SELECT d.id, d.arquivo_key
        FROM documentos d INNER JOIN target_folha f ON d.id = f.documento_id
      ),
      deleted_folha AS (
        DELETE FROM folhas_pagamento f USING target_folha t WHERE f.id = t.id
        RETURNING f.id, f.competencia
      ),
      deleted_doc AS (
        DELETE FROM documentos d USING target_doc t WHERE d.id = t.id
        RETURNING d.id, d.arquivo_key
      ),
      cleanup_jobs AS (
        INSERT INTO storage_cleanup_jobs (object_key, entidade_tipo, entidade_id)
        SELECT arquivo_key, 'FOLHA_PAGAMENTO', id::text FROM deleted_doc
        ON CONFLICT (object_key) DO NOTHING
        RETURNING id
      ),
      audit_event AS (
        INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
        SELECT ${input.actorUserId}, 'FOLHA_PAGAMENTO_EXCLUIDA', 'FOLHA_PAGAMENTO', id::text,
          jsonb_build_object('competencia', competencia)
        FROM deleted_folha
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM deleted_folha) AS deleted,
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

  // ─── Get folha owner (for client access check) ───
  async getFolhaClienteId(folhaId: string): Promise<string | null> {
    const result = await this.database.db
      .select({ clienteId: folhasPagamento.clienteId })
      .from(folhasPagamento)
      .where(eq(folhasPagamento.id, folhaId))
      .limit(1);
    return result[0]?.clienteId ?? null;
  }

  // ─── Get item owner (for client access check) ───
  async getItemClienteId(itemFolhaId: string): Promise<string | null> {
    const result = await this.database.db
      .select({ clienteId: itensFolhaPagamento.clienteId })
      .from(itensFolhaPagamento)
      .where(eq(itensFolhaPagamento.id, itemFolhaId))
      .limit(1);
    return result[0]?.clienteId ?? null;
  }

  // ─── Get funcionario owner (for client access check) ───
  async getFuncionarioClienteId(funcionarioId: string): Promise<string | null> {
    const result = await this.database.db
      .select({ clienteId: funcionariosRh.clienteId })
      .from(funcionariosRh)
      .where(eq(funcionariosRh.id, funcionarioId))
      .limit(1);
    return result[0]?.clienteId ?? null;
  }

  // ─── Helpers ───
  private parseDataAdmissao(dateStr: string): string {
    // Convert DD/MM/YYYY to YYYY-MM-DD
    const [dd, mm, yyyy] = dateStr.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }

  private isUniqueViolation(error: unknown) {
    const candidate = error as {
      code?: string;
      cause?: { code?: string };
    } | null;
    return candidate?.code === '23505' || candidate?.cause?.code === '23505';
  }
}
