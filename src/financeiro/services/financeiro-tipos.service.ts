import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { financeiroTiposLancamento } from '../../database/schema';
import { isUniqueViolation, fromCents, toCents } from '../financeiro.utils';
import type {
  CreateTipoLancamentoDto,
  UpdateTipoLancamentoDto,
} from '../dto/tipo-lancamento.dto';

@Injectable()
export class FinanceiroTiposService {
  constructor(private readonly database: DatabaseService) {}

  async list(apenasAtivos = false) {
    const query = this.database.db
      .select()
      .from(financeiroTiposLancamento)
      .orderBy(asc(financeiroTiposLancamento.nome));
    return apenasAtivos
      ? query.where(eq(financeiroTiposLancamento.ativo, true))
      : query;
  }

  async create(dto: CreateTipoLancamentoDto) {
    try {
      const [created] = await this.database.db
        .insert(financeiroTiposLancamento)
        .values({
          codigo: dto.codigo,
          nome: dto.nome.trim(),
          descricao: dto.descricao?.trim() || null,
          natureza: dto.natureza,
          valorPadrao:
            dto.valorPadrao === undefined
              ? null
              : fromCents(toCents(dto.valorPadrao)),
          permiteAvulso: dto.permiteAvulso ?? true,
        })
        .returning();
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Já existe um tipo com este código.');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateTipoLancamentoDto) {
    const values: Partial<typeof financeiroTiposLancamento.$inferInsert> = {
      atualizadoEm: new Date(),
    };
    if (dto.nome !== undefined) values.nome = dto.nome.trim();
    if (dto.descricao !== undefined) values.descricao = dto.descricao.trim();
    if (dto.natureza !== undefined) values.natureza = dto.natureza;
    if (dto.valorPadrao !== undefined) {
      values.valorPadrao = fromCents(toCents(dto.valorPadrao));
    }
    if (dto.permiteAvulso !== undefined)
      values.permiteAvulso = dto.permiteAvulso;
    if (dto.ativo !== undefined) values.ativo = dto.ativo;

    const [updated] = await this.database.db
      .update(financeiroTiposLancamento)
      .set(values)
      .where(eq(financeiroTiposLancamento.id, id))
      .returning();
    if (!updated)
      throw new NotFoundException('Tipo de lançamento não encontrado.');
    return updated;
  }
}
