import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq, ilike, or, sql } from 'drizzle-orm';
import type { PaginationParams } from '../../common/types';
import { DatabaseService } from '../../database/database.service';
import { clientes, contadores } from '../../database/schema';
import type { AtualizarContadorDto, CriarContadorDto } from './contadores.dto';

@Injectable()
export class ContadoresService {
  constructor(private readonly database: DatabaseService) {}

  async listar(input: { search: string; pagination: PaginationParams }) {
    const where = input.search
      ? or(
          ilike(contadores.nome, `%${input.search}%`),
          ilike(contadores.crc, `%${input.search}%`),
          ilike(contadores.cpf, `%${this.documento(input.search)}%`),
          ilike(contadores.cnpj, `%${this.documento(input.search)}%`),
        )
      : undefined;
    const [countRows, rows] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(contadores)
        .where(where),
      this.database.db
        .select({
          id: contadores.id,
          nome: contadores.nome,
          cpf: contadores.cpf,
          crc: contadores.crc,
          cnpj: contadores.cnpj,
          cep: contadores.cep,
          logradouro: contadores.logradouro,
          numero: contadores.numero,
          complemento: contadores.complemento,
          bairro: contadores.bairro,
          telefone: contadores.telefone,
          fax: contadores.fax,
          email: contadores.email,
          codigoMunicipioIbge: contadores.codigoMunicipioIbge,
          criadoEm: contadores.criadoEm,
          atualizadoEm: contadores.atualizadoEm,
          clientesVinculados: sql<number>`(
            SELECT count(*)::int FROM clientes
            WHERE clientes.contador_id = ${contadores.id}
          )`,
        })
        .from(contadores)
        .where(where)
        .orderBy(asc(contadores.nome), asc(contadores.crc))
        .limit(input.pagination.limit)
        .offset(input.pagination.offset),
    ]);

    return {
      total: Number(countRows[0]?.count ?? 0),
      data: rows.map((row) => this.publico(row)),
    };
  }

  async obter(id: string) {
    const rows = await this.database.db
      .select({
        id: contadores.id,
        nome: contadores.nome,
        cpf: contadores.cpf,
        crc: contadores.crc,
        cnpj: contadores.cnpj,
        cep: contadores.cep,
        logradouro: contadores.logradouro,
        numero: contadores.numero,
        complemento: contadores.complemento,
        bairro: contadores.bairro,
        telefone: contadores.telefone,
        fax: contadores.fax,
        email: contadores.email,
        codigoMunicipioIbge: contadores.codigoMunicipioIbge,
        criadoEm: contadores.criadoEm,
        atualizadoEm: contadores.atualizadoEm,
        clientesVinculados: sql<number>`(
          SELECT count(*)::int FROM clientes
          WHERE clientes.contador_id = ${contadores.id}
        )`,
      })
      .from(contadores)
      .where(eq(contadores.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Contador não encontrado.');
    return this.publico(rows[0]);
  }

  async criar(data: CriarContadorDto, actorUserId: string) {
    try {
      const rows = await this.database.db
        .insert(contadores)
        .values({
          ...this.valores(data),
          atualizadoPor: actorUserId,
        } as typeof contadores.$inferInsert)
        .returning({ id: contadores.id });
      return this.obter(rows[0].id);
    } catch (error) {
      this.rethrowConstraint(error);
    }
  }

  async atualizar(id: string, data: AtualizarContadorDto, actorUserId: string) {
    const current = await this.database.db
      .select()
      .from(contadores)
      .where(eq(contadores.id, id))
      .limit(1);
    if (!current[0]) throw new NotFoundException('Contador não encontrado.');

    const merged = { ...current[0], ...data };
    if (!merged.cpf && !merged.cnpj) {
      throw new ConflictException({
        code: 'CONTADOR_DOCUMENTO_AUSENTE',
        message: 'Informe o CPF ou o CNPJ do contador.',
      });
    }
    try {
      await this.database.db
        .update(contadores)
        .set({
          ...this.valores(data),
          atualizadoPor: actorUserId,
          atualizadoEm: new Date(),
        })
        .where(eq(contadores.id, id));
      return this.obter(id);
    } catch (error) {
      this.rethrowConstraint(error);
    }
  }

  async excluir(id: string) {
    const result = await this.database.db.execute(sql`
      DELETE FROM contadores contador
      WHERE contador.id = ${id}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM clientes cliente WHERE cliente.contador_id = contador.id
        )
      RETURNING contador.id
    `);
    const deleted = Array.from(result as Iterable<{ id: string }>)[0];
    if (deleted) return;

    const linked = await this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(clientes)
      .where(eq(clientes.contadorId, id));
    if (Number(linked[0]?.count ?? 0) > 0) {
      throw new ConflictException({
        code: 'CONTADOR_VINCULADO',
        message:
          'Este contador está vinculado a clientes. Substitua ou remova os vínculos antes de excluí-lo.',
      });
    }
    throw new NotFoundException('Contador não encontrado.');
  }

  private valores(data: Partial<CriarContadorDto>) {
    return Object.fromEntries(
      Object.entries({
        nome: data.nome?.trim(),
        cpf: data.cpf || null,
        crc: data.crc?.trim().toUpperCase(),
        cnpj: data.cnpj || null,
        cep: data.cep || null,
        logradouro: data.logradouro || null,
        numero: data.numero || null,
        complemento: data.complemento || null,
        bairro: data.bairro || null,
        telefone: data.telefone || null,
        fax: data.fax || null,
        email: data.email?.toLowerCase() || null,
        codigoMunicipioIbge: data.codigoMunicipioIbge,
      }).filter(([, value]) => value !== undefined),
    );
  }

  private publico(row: Record<string, unknown>) {
    return {
      ...row,
      criadoEm:
        row.criadoEm instanceof Date
          ? row.criadoEm.toISOString()
          : row.criadoEm,
      atualizadoEm:
        row.atualizadoEm instanceof Date
          ? row.atualizadoEm.toISOString()
          : row.atualizadoEm,
    };
  }

  private documento(value: string) {
    return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  }

  private rethrowConstraint(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    ) {
      throw new ConflictException({
        code: 'CONTADOR_DUPLICADO',
        message: 'Já existe um contador com o mesmo documento e CRC.',
      });
    }
    throw error;
  }
}
