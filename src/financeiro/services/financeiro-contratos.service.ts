import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, ilike, inArray, notInArray, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  financeiroContratos,
  financeiroContratosItens,
  financeiroTiposLancamento,
} from '../../database/schema';
import type { PaginationParams } from '../../common/types';
import {
  competenciaIndex,
  fromCents,
  isUniqueViolation,
  toCents,
} from '../financeiro.utils';
import type { UpsertContratoDto } from '../dto/contrato.dto';
import {
  TIPO_ENCERRAMENTO,
  TIPO_MENSALIDADE,
} from './financeiro-faturas.service';

@Injectable()
export class FinanceiroContratosService {
  constructor(private readonly database: DatabaseService) {}

  async list(input: { search?: string; pagination: PaginationParams }) {
    const term = input.search?.trim();
    const where = term
      ? or(
          ilike(clientes.razaoSocial, `%${term.replace(/[%_\\]/g, '\\$&')}%`),
          ilike(clientes.cnpj, `%${term.replace(/\D/g, '') || '\u0000'}%`),
        )
      : undefined;

    const [rows, [{ total }]] = await Promise.all([
      this.database.db
        .select({
          contrato: financeiroContratos,
          clienteRazaoSocial: clientes.razaoSocial,
          clienteCnpj: clientes.cnpj,
        })
        .from(financeiroContratos)
        .innerJoin(clientes, eq(clientes.id, financeiroContratos.clienteId))
        .where(where)
        .orderBy(asc(clientes.razaoSocial))
        .limit(input.pagination.limit)
        .offset(input.pagination.offset),
      this.database.db
        .select({ total: sql<number>`count(*)::int` })
        .from(financeiroContratos)
        .innerJoin(clientes, eq(clientes.id, financeiroContratos.clienteId))
        .where(where),
    ]);

    const contagens = rows.length
      ? await this.database.db
          .select({
            contratoId: financeiroContratosItens.contratoId,
            quantidade: sql<number>`count(*)::int`,
          })
          .from(financeiroContratosItens)
          .where(
            and(
              inArray(
                financeiroContratosItens.contratoId,
                rows.map((row) => row.contrato.id),
              ),
              eq(financeiroContratosItens.ativo, true),
            ),
          )
          .groupBy(financeiroContratosItens.contratoId)
      : [];
    const porContrato = new Map(
      contagens.map((c) => [c.contratoId, c.quantidade]),
    );

    return {
      data: rows.map((row) => ({
        ...row.contrato,
        clienteRazaoSocial: row.clienteRazaoSocial,
        clienteCnpj: row.clienteCnpj,
        qtdItensFixos: porContrato.get(row.contrato.id) ?? 0,
      })),
      total,
    };
  }

  async listarItens(contratoId: string) {
    const rows = await this.database.db
      .select({
        item: financeiroContratosItens,
        tipoNome: financeiroTiposLancamento.nome,
        natureza: financeiroTiposLancamento.natureza,
      })
      .from(financeiroContratosItens)
      .innerJoin(
        financeiroTiposLancamento,
        eq(
          financeiroTiposLancamento.id,
          financeiroContratosItens.tipoLancamentoId,
        ),
      )
      .where(eq(financeiroContratosItens.contratoId, contratoId))
      .orderBy(asc(financeiroContratosItens.criadoEm));
    return rows.map((row) => ({
      ...row.item,
      tipoNome: row.tipoNome,
      natureza: row.natureza,
    }));
  }

  async getByCliente(clienteId: string) {
    const [contrato] = await this.database.db
      .select()
      .from(financeiroContratos)
      .where(eq(financeiroContratos.clienteId, clienteId))
      .limit(1);
    if (!contrato) {
      throw new NotFoundException('Contrato financeiro não encontrado.');
    }
    return { ...contrato, itens: await this.listarItens(contrato.id) };
  }

  async upsert(clienteId: string, dto: UpsertContratoDto, userId: string) {
    const [cliente] = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!cliente) throw new NotFoundException('Cliente não encontrado.');

    if (dto.itens) await this.validarItens(dto.itens);

    const values = {
      valorMensalidade: fromCents(toCents(dto.valorMensalidade)),
      diaVencimento: dto.diaVencimento,
      diaFechamento: dto.diaFechamento ?? 25,
      gera13o: dto.gera13o ?? true,
      mes13o: dto.mes13o ?? 12,
      ativo: dto.ativo ?? true,
      observacoes: dto.observacoes?.trim() || null,
      atualizadoPor: userId,
    };

    try {
      const contratoId = await this.database.db.transaction(async (tx) => {
        const [contrato] = await tx
          .insert(financeiroContratos)
          .values({ clienteId, ...values })
          .onConflictDoUpdate({
            target: financeiroContratos.clienteId,
            set: { ...values, atualizadoEm: sql`NOW()` },
          })
          .returning({ id: financeiroContratos.id });

        if (dto.itens) {
          const existentes = await tx
            .select({ id: financeiroContratosItens.id })
            .from(financeiroContratosItens)
            .where(eq(financeiroContratosItens.contratoId, contrato.id));
          const idsExistentes = new Set(existentes.map((e) => e.id));
          const idsInformados = dto.itens.flatMap((i) => (i.id ? [i.id] : []));
          if (idsInformados.some((id) => !idsExistentes.has(id))) {
            throw new BadRequestException(
              'Há itens fixos que não pertencem a este contrato.',
            );
          }

          // Remove os itens ausentes da lista enviada.
          await tx
            .delete(financeiroContratosItens)
            .where(
              and(
                eq(financeiroContratosItens.contratoId, contrato.id),
                idsInformados.length
                  ? notInArray(financeiroContratosItens.id, idsInformados)
                  : undefined,
              ),
            );

          for (const item of dto.itens) {
            const campos = {
              tipoLancamentoId: item.tipoLancamentoId,
              descricao: item.descricao.trim(),
              valor: fromCents(toCents(item.valor)),
              competenciaInicio: item.competenciaInicio ?? null,
              competenciaFim: item.competenciaFim ?? null,
              ativo: item.ativo ?? true,
            };
            if (item.id) {
              await tx
                .update(financeiroContratosItens)
                .set({ ...campos, atualizadoEm: sql`NOW()` })
                .where(eq(financeiroContratosItens.id, item.id));
            } else {
              await tx
                .insert(financeiroContratosItens)
                .values({ contratoId: contrato.id, ...campos });
            }
          }
        }
        return contrato.id;
      });
      void contratoId;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException('Não foi possível salvar o contrato.');
      }
      throw error;
    }
    return this.getByCliente(clienteId);
  }

  private async validarItens(itens: NonNullable<UpsertContratoDto['itens']>) {
    for (const item of itens) {
      if (
        item.competenciaInicio &&
        item.competenciaFim &&
        competenciaIndex(item.competenciaInicio) >
          competenciaIndex(item.competenciaFim)
      ) {
        throw new BadRequestException(
          `A vigência do item "${item.descricao}" é inválida: o início é posterior ao fim.`,
        );
      }
    }
    const tipoIds = [...new Set(itens.map((i) => i.tipoLancamentoId))];
    if (tipoIds.length === 0) return;
    const tipos = await this.database.db
      .select()
      .from(financeiroTiposLancamento)
      .where(inArray(financeiroTiposLancamento.id, tipoIds));
    if (tipos.length !== tipoIds.length) {
      throw new NotFoundException('Tipo de lançamento não encontrado.');
    }
    for (const tipo of tipos) {
      if (!tipo.ativo) {
        throw new BadRequestException(`O tipo "${tipo.nome}" está inativo.`);
      }
      if (
        tipo.codigo === TIPO_MENSALIDADE ||
        tipo.codigo === TIPO_ENCERRAMENTO
      ) {
        throw new BadRequestException(
          `O tipo "${tipo.nome}" é gerado pelo contrato e não pode ser um item fixo.`,
        );
      }
    }
  }
}
