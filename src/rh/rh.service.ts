import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  clientes,
  folhasPagamento,
  funcionariosRh,
  itensFolhaPagamento,
  user,
  visualizacoesFolhas,
} from '../database/schema';
import { StorageService } from '../storage/storage.service';
import { StorageCleanupService } from '../storage/storage-cleanup.service';
import { AppLogger } from '../common/logger.service';
import { resultRows } from '../common/db-result';
import type { DadosFolhaPagamento } from '../common/pdf-extraction-rh';
import type { PaginationParams } from '../common/types';

@Injectable()
export class RhService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
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

    const codigos = dados.funcionarios.map((func) => func.codigoFuncionario);
    if (
      dados.totalFuncionarios !== dados.funcionarios.length ||
      new Set(codigos).size !== codigos.length
    ) {
      this.logger.warn('rh_folha_inconsistent_employee_count', {
        requestId: input.requestId,
        clienteId,
        totalInformado: dados.totalFuncionarios,
        totalExtraido: dados.funcionarios.length,
      });
      return { ok: false, code: 'DADOS_INCONSISTENTES' };
    }

    try {
      const folhaId = crypto.randomUUID();
      const funcionariosPayload = JSON.stringify(
        dados.funcionarios.map((func) => ({
          codigo_funcionario: func.codigoFuncionario,
          nome_completo: func.nomeCompleto,
          data_admissao: func.dataAdmissao
            ? this.parseDataAdmissao(func.dataAdmissao)
            : null,
          cargo: func.cargo,
          salario_base: func.salarioBase,
          total_proventos: func.totalProventos,
          total_descontos: func.totalDescontos,
          salario_liquido: func.salarioLiquido,
          base_inss: func.baseInss,
          aliquota_inss: func.aliquotaInss,
          valor_inss: func.valorInss,
          base_fgts: func.baseFgts,
          valor_fgts: func.valorFgts,
          base_irrf: func.baseIrrf,
          valor_irrf: func.valorIrrf,
          referencia: func.referencia,
          codigo_folha: func.codigoFolha,
          dependentes_ir: func.dependentesIr,
          dependentes_sf: func.dependentesSf,
          rubricas: func.rubricas,
        })),
      );

      // Uma unica instrucao SQL mantem folha, funcionarios, itens e auditoria
      // atomicos inclusive no driver HTTP do Neon, que nao oferece transacoes
      // interativas.
      const result = await this.database.db.execute(sql`
        WITH input_funcionarios AS MATERIALIZED (
          SELECT *
          FROM jsonb_to_recordset(${funcionariosPayload}::jsonb) AS f(
            codigo_funcionario text,
            nome_completo text,
            data_admissao date,
            cargo text,
            salario_base numeric,
            total_proventos numeric,
            total_descontos numeric,
            salario_liquido numeric,
            base_inss numeric,
            aliquota_inss numeric,
            valor_inss numeric,
            base_fgts numeric,
            valor_fgts numeric,
            base_irrf numeric,
            valor_irrf numeric,
            referencia text,
            codigo_folha text,
            dependentes_ir integer,
            dependentes_sf integer,
            rubricas jsonb
          )
        ),
        inserted_folha AS (
          INSERT INTO folhas_pagamento (
            id, cliente_id, arquivo_key, arquivo_nome, competencia,
            periodo_inicio, periodo_fim, total_bruto, total_descontos,
            total_liquido, total_funcionarios, total_inss, total_fgts,
            total_irrf, total_salario_familia, uploadado_por
          ) VALUES (
            ${folhaId}::uuid, ${clienteId}::uuid, ${r2Key}, ${fileName},
            ${dados.competencia}, ${dados.periodoInicio}::date,
            ${dados.periodoFim}::date, ${dados.totalBruto}::numeric,
            ${dados.totalDescontos}::numeric, ${dados.totalLiquido}::numeric,
            ${dados.totalFuncionarios}, ${dados.totalInss}::numeric,
            ${dados.totalFgts}::numeric, ${dados.totalIrrf}::numeric,
            ${dados.totalSalarioFamilia}::numeric, ${actorUserId}
          )
          RETURNING id, cliente_id
        ),
        upserted_funcionarios AS (
          INSERT INTO funcionarios_rh (
            id, cliente_id, codigo_funcionario, nome_completo,
            data_admissao, cargo
          )
          SELECT
            gen_random_uuid(), folha.cliente_id, f.codigo_funcionario,
            f.nome_completo, f.data_admissao, f.cargo
          FROM input_funcionarios f
          CROSS JOIN inserted_folha folha
          ON CONFLICT (cliente_id, codigo_funcionario) DO UPDATE SET
            nome_completo = EXCLUDED.nome_completo,
            data_admissao = COALESCE(
              EXCLUDED.data_admissao,
              funcionarios_rh.data_admissao
            ),
            cargo = EXCLUDED.cargo,
            atualizado_em = now()
          RETURNING id, cliente_id, codigo_funcionario
        ),
        inserted_itens AS (
          INSERT INTO itens_folha_pagamento (
            folha_id, funcionario_id, cliente_id, salario_base,
            total_proventos, total_descontos, salario_liquido, base_inss,
            aliquota_inss, valor_inss, base_fgts, valor_fgts, base_irrf,
            valor_irrf, referencia, codigo_folha, dependentes_ir,
            dependentes_sf, rubricas
          )
          SELECT
            folha.id, funcionario.id, folha.cliente_id, f.salario_base,
            f.total_proventos, f.total_descontos, f.salario_liquido,
            f.base_inss, f.aliquota_inss, f.valor_inss, f.base_fgts,
            f.valor_fgts, f.base_irrf, f.valor_irrf, f.referencia,
            f.codigo_folha, f.dependentes_ir, f.dependentes_sf, f.rubricas
          FROM input_funcionarios f
          JOIN upserted_funcionarios funcionario
            ON funcionario.codigo_funcionario = f.codigo_funcionario
          CROSS JOIN inserted_folha folha
          RETURNING id
        ),
        audit_event AS (
          INSERT INTO eventos_auditoria (
            ator_user_id, acao, entidade_tipo, entidade_id, dados
          )
          SELECT
            ${actorUserId}, 'FOLHA_PAGAMENTO_UPLOADADA', 'FOLHA_PAGAMENTO',
            folha.id::text,
            jsonb_build_object(
              'clienteId', folha.cliente_id::text,
              'competencia', ${dados.competencia}::text,
              'totalFuncionarios', ${dados.totalFuncionarios}::integer
            )
          FROM inserted_folha folha
          RETURNING id
        )
        SELECT
          EXISTS (SELECT 1 FROM inserted_folha) AS inserted,
          (SELECT count(*)::integer FROM inserted_itens) AS item_count
      `);

      const persisted = resultRows<{
        inserted: boolean;
        item_count: number;
      }>(result)[0];
      if (
        !persisted?.inserted ||
        Number(persisted.item_count) !== dados.totalFuncionarios
      ) {
        throw new Error('FOLHA_INSERT_INCOMPLETE');
      }

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
          visualizado:
            sql<boolean>`EXISTS (SELECT 1 FROM visualizacoes_folhas WHERE visualizacoes_folhas.folha_id = ${folhasPagamento.id})`.as(
              'visualizado',
            ),
          primeiraVisualizacao: sql<
            string | null
          >`(SELECT MIN(visualizado_em) FROM visualizacoes_folhas WHERE visualizacoes_folhas.folha_id = ${folhasPagamento.id})`.as(
            'primeira_visualizacao',
          ),
          totalVisualizacoes:
            sql<number>`(SELECT COUNT(*) FROM visualizacoes_folhas WHERE visualizacoes_folhas.folha_id = ${folhasPagamento.id})`.as(
              'total_visualizacoes',
            ),
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
        visualizado: r.visualizado ?? false,
        primeiraVisualizacao: r.primeiraVisualizacao ?? null,
        totalVisualizacoes: Number(r.totalVisualizacoes ?? 0),
      })),
    };
  }

  // ─── Record folha view (when client generates recibos) ───
  async recordFolhaView(folhaId: string, userId: string) {
    await this.database.db
      .insert(visualizacoesFolhas)
      .values({ folhaId, userId });
  }

  // ─── List folha views (admin) ───
  async listFolhaVisualizacoes(folhaId: string) {
    const rows = await this.database.db
      .select({
        id: visualizacoesFolhas.id,
        viewedAt: visualizacoesFolhas.visualizadoEm,
        viewer: { id: user.id, name: user.name, email: user.email },
      })
      .from(visualizacoesFolhas)
      .leftJoin(user, eq(visualizacoesFolhas.userId, user.id))
      .where(eq(visualizacoesFolhas.folhaId, folhaId))
      .orderBy(desc(visualizacoesFolhas.visualizadoEm));

    return rows.map((view) => ({
      id: view.id,
      viewedAt: view.viewedAt.toISOString(),
      viewer: view.viewer
        ? {
            id: view.viewer.id,
            name: view.viewer.name,
            email: view.viewer.email,
          }
        : null,
    }));
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
          logoKey: clientes.logoKey,
          logradouro: clientes.logradouro,
          numero: clientes.numero,
          complemento: clientes.complemento,
          bairro: clientes.bairro,
          municipio: clientes.municipio,
          uf: clientes.uf,
          cep: clientes.cep,
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

    let logoUrl: string | null = null;
    try {
      const logoKey = row.empresa?.logoKey ?? null;
      logoUrl = logoKey ? await this.storage.getSignedUrl(logoKey) : null;
    } catch {
      // non-critical — continue without logo
    }

    return {
      empresa: {
        razaoSocial: row.empresa?.razaoSocial ?? '',
        cnpj: row.empresa?.cnpj ?? '',
        endereco: this.buildEndereco(row.empresa),
        logoUrl,
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
        SELECT id, cliente_id, arquivo_key, competencia
        FROM folhas_pagamento WHERE id = ${input.folhaId}::uuid
        FOR UPDATE
      ),
      deleted_folha AS (
        DELETE FROM folhas_pagamento f USING target_folha t WHERE f.id = t.id
        RETURNING f.id, f.competencia, f.arquivo_key
      ),
      cleanup_jobs AS (
        INSERT INTO storage_cleanup_jobs (object_key, entidade_tipo, entidade_id)
        SELECT arquivo_key, 'FOLHA_PAGAMENTO', id::text FROM deleted_folha
        WHERE arquivo_key IS NOT NULL
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

  // ─── Get folha download URL ───
  async getFolhaDocumentoKey(folhaId: string): Promise<string | null> {
    const result = await this.database.db
      .select({ arquivoKey: folhasPagamento.arquivoKey })
      .from(folhasPagamento)
      .where(eq(folhasPagamento.id, folhaId))
      .limit(1);
    return result[0]?.arquivoKey ?? null;
  }

  // ─── Get all recibos for a folha (for bulk PDF generation) ───
  async getAllRecibosByFolha(folhaId: string) {
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
          logoKey: clientes.logoKey,
          logradouro: clientes.logradouro,
          numero: clientes.numero,
          complemento: clientes.complemento,
          bairro: clientes.bairro,
          municipio: clientes.municipio,
          uf: clientes.uf,
          cep: clientes.cep,
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
      .where(eq(itensFolhaPagamento.folhaId, folhaId))
      .orderBy(funcionariosRh.nomeCompleto);

    // Generate logo URL once (all rows share the same client)
    let logoUrl: string | null = null;
    try {
      const logoKey = rows[0]?.empresa?.logoKey ?? null;
      logoUrl = logoKey ? await this.storage.getSignedUrl(logoKey) : null;
    } catch {
      // non-critical — continue without logo
    }

    return rows.map((row) => ({
      empresa: {
        razaoSocial: row.empresa?.razaoSocial ?? '',
        cnpj: row.empresa?.cnpj ?? '',
        endereco: this.buildEndereco(row.empresa),
        logoUrl,
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
    }));
  }

  // ─── Build formatted address from empresa fields ───
  private buildEndereco(
    empresa: {
      logradouro?: string | null;
      numero?: string | null;
      complemento?: string | null;
      bairro?: string | null;
      municipio?: string | null;
      uf?: string | null;
      cep?: string | null;
    } | null,
  ): string {
    if (!empresa) return '';
    const parts: string[] = [];

    // Logradouro, Nº complemento
    const rua = [
      empresa.logradouro,
      empresa.numero ? `Nº ${empresa.numero}` : null,
      empresa.complemento,
    ]
      .filter(Boolean)
      .join(', ');
    if (rua) parts.push(rua);

    // Bairro
    if (empresa.bairro) parts.push(empresa.bairro);

    // Município - UF
    const cidadeUf = [empresa.municipio, empresa.uf]
      .filter(Boolean)
      .join(' - ');
    if (cidadeUf) parts.push(cidadeUf);

    // CEP
    if (empresa.cep) {
      const cepFormatted = empresa.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2');
      parts.push(`CEP ${cepFormatted}`);
    }

    return parts.join(', ');
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
