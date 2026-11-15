import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  financeiroLancamentos,
  financeiroTiposLancamento,
} from '../../database/schema';
import { getBahiaDate } from '../../common/document-status';
import type { PaginationParams } from '../../common/types';
import { fromCents, isValidCivilDate, toCents } from '../financeiro.utils';
import type {
  CreateLancamentoDto,
  FiltroLancamentosDto,
} from '../dto/lancamento.dto';

@Injectable()
export class FinanceiroLancamentosService {
  constructor(private readonly database: DatabaseService) {}

  async list(filtro: FiltroLancamentosDto, pagination: PaginationParams) {
    const conditions: SQL[] = [];
    if (filtro.clienteId) {
      conditions.push(eq(financeiroLancamentos.clienteId, filtro.clienteId));
    }
    if (filtro.competencia) {
      conditions.push(
        eq(financeiroLancamentos.competencia, filtro.competencia),
      );
    }
    if (filtro.status) {
      conditions.push(eq(financeiroLancamentos.status, filtro.status));
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [data, [{ total }]] = await Promise.all([
      this.database.db
        .select({
          lancamento: financeiroLancamentos,
          clienteRazaoSocial: clientes.razaoSocial,
          tipoCodigo: financeiroTiposLancamento.codigo,
          tipoNome: financeiroTiposLancamento.nome,
        })
        .from(financeiroLancamentos)
        .innerJoin(clientes, eq(clientes.id, financeiroLancamentos.clienteId))
        .innerJoin(
          financeiroTiposLancamento,
          eq(
            financeiroTiposLancamento.id,
            financeiroLancamentos.tipoLancamentoId,
          ),
        )
        .where(where)
        .orderBy(
          desc(financeiroLancamentos.dataLancamento),
          desc(financeiroLancamentos.criadoEm),
        )
        .limit(pagination.limit)
        .offset(pagination.offset),
      this.database.db
        .select({ total: sql<number>`count(*)::int` })
        .from(financeiroLancamentos)
        .where(where),
    ]);

    return {
      data: data.map((row) => ({
        ...row.lancamento,
        clienteRazaoSocial: row.clienteRazaoSocial,
        tipoCodigo: row.tipoCodigo,
        tipoNome: row.tipoNome,
      })),
      total,
    };
  }

  async create(dto: CreateLancamentoDto, userId: string) {
    if (dto.dataLancamento && !isValidCivilDate(dto.dataLancamento)) {
      throw new BadRequestException('Data do lançamento inválida.');
    }
    const [cliente] = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, dto.clienteId))
      .limit(1);
    if (!cliente) throw new NotFoundException('Cliente não encontrado.');

    const [tipo] = await this.database.db
      .select()
      .from(financeiroTiposLancamento)
      .where(eq(financeiroTiposLancamento.id, dto.tipoLancamentoId))
      .limit(1);
    if (!tipo)
      throw new NotFoundException('Tipo de lançamento não encontrado.');
    if (!tipo.ativo) {
      throw new BadRequestException('Tipo de lançamento inativo.');
    }
    if (!tipo.permiteAvulso) {
      throw new BadRequestException(
        'Este tipo de lançamento não permite lançamento avulso.',
      );
    }

    const [created] = await this.database.db
      .insert(financeiroLancamentos)
      .values({
        clienteId: dto.clienteId,
        tipoLancamentoId: tipo.id,
        competencia: dto.competencia,
        descricao: dto.descricao.trim(),
        natureza: tipo.natureza,
        valor: fromCents(toCents(dto.valor)),
        dataLancamento: dto.dataLancamento ?? getBahiaDate(),
        status: 'PENDENTE',
        criadoPor: userId,
      })
      .returning();
    return created;
  }

  async cancelar(id: string) {
    const [updated] = await this.database.db
      .update(financeiroLancamentos)
      .set({ status: 'CANCELADO', atualizadoEm: sql`NOW()` })
      .where(
        and(
          eq(financeiroLancamentos.id, id),
          eq(financeiroLancamentos.status, 'PENDENTE'),
        ),
      )
      .returning();
    if (updated) return updated;

    const [existing] = await this.database.db
      .select({ status: financeiroLancamentos.status })
      .from(financeiroLancamentos)
      .where(eq(financeiroLancamentos.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Lançamento não encontrado.');
    throw new BadRequestException(
      'Apenas lançamentos pendentes podem ser cancelados.',
    );
  }
}
