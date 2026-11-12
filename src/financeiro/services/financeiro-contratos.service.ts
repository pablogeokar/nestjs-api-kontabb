import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, ilike, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { clientes, financeiroContratos } from '../../database/schema';
import type { PaginationParams } from '../../common/types';
import { fromCents, toCents } from '../financeiro.utils';
import type { UpsertContratoDto } from '../dto/contrato.dto';

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

    return {
      data: rows.map((row) => ({
        ...row.contrato,
        clienteRazaoSocial: row.clienteRazaoSocial,
        clienteCnpj: row.clienteCnpj,
      })),
      total,
    };
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
    return contrato;
  }

  async upsert(clienteId: string, dto: UpsertContratoDto, userId: string) {
    const [cliente] = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!cliente) throw new NotFoundException('Cliente não encontrado.');

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

    const [contrato] = await this.database.db
      .insert(financeiroContratos)
      .values({ clienteId, ...values })
      .onConflictDoUpdate({
        target: financeiroContratos.clienteId,
        set: { ...values, atualizadoEm: sql`NOW()` },
      })
      .returning();
    return contrato;
  }
}
