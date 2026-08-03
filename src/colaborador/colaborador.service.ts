import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  clientes,
  folhasPagamento,
  funcionariosRh,
  itensFolhaPagamento,
} from '../database/schema';
import type { PaginationParams } from '../common/types';

const DEFAULT_PASSWORD = '123456';

export interface ColaboradorSession {
  funcionarioId: string;
  clienteId: string;
  codigoFuncionario: string;
  nomeCompleto: string;
  cargo: string | null;
  cnpj: string;
  razaoSocial: string;
  primeiroAcesso: boolean;
}

@Injectable()
export class ColaboradorService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Authenticate an employee by CNPJ + employee code + password.
   * Returns employee session data or null if invalid.
   */
  async authenticate(input: {
    cnpj: string;
    codigoFuncionario: string;
    senha: string;
  }): Promise<ColaboradorSession | null> {
    // Find the employee joined with their company
    const rows = await this.database.db
      .select({
        id: funcionariosRh.id,
        clienteId: funcionariosRh.clienteId,
        codigoFuncionario: funcionariosRh.codigoFuncionario,
        nomeCompleto: funcionariosRh.nomeCompleto,
        cargo: funcionariosRh.cargo,
        ativo: funcionariosRh.ativo,
        senhaHash: funcionariosRh.senhaHash,
        primeiroAcesso: funcionariosRh.primeiroAcesso,
        cnpj: clientes.cnpj,
        razaoSocial: clientes.razaoSocial,
      })
      .from(funcionariosRh)
      .innerJoin(clientes, eq(funcionariosRh.clienteId, clientes.id))
      .where(
        and(
          eq(clientes.cnpj, input.cnpj),
          eq(funcionariosRh.codigoFuncionario, input.codigoFuncionario),
        ),
      )
      .limit(1);

    const employee = rows[0];
    if (!employee) return null;

    // Must be active
    if (!employee.ativo) return null;

    // Verify password
    const senhaHash = employee.senhaHash;
    if (!senhaHash) {
      // No password set yet — accept only the default password
      if (input.senha !== DEFAULT_PASSWORD) return null;

      // Hash the default password and store it for future logins
      const hash = await this.hashPassword(DEFAULT_PASSWORD);
      await this.database.db
        .update(funcionariosRh)
        .set({ senhaHash: hash, atualizadoEm: new Date() })
        .where(eq(funcionariosRh.id, employee.id));
    } else {
      const valid = await this.verifyPassword(input.senha, senhaHash);
      if (!valid) return null;
    }

    return {
      funcionarioId: employee.id,
      clienteId: employee.clienteId,
      codigoFuncionario: employee.codigoFuncionario,
      nomeCompleto: employee.nomeCompleto,
      cargo: employee.cargo,
      cnpj: employee.cnpj,
      razaoSocial: employee.razaoSocial,
      primeiroAcesso: employee.primeiroAcesso,
    };
  }

  /**
   * Change the employee's password and mark primeiro_acesso as false.
   */
  async changePassword(input: {
    funcionarioId: string;
    senhaAtual: string;
    novaSenha: string;
  }): Promise<{ ok: boolean; code?: string }> {
    const [employee] = await this.database.db
      .select({
        senhaHash: funcionariosRh.senhaHash,
        primeiroAcesso: funcionariosRh.primeiroAcesso,
      })
      .from(funcionariosRh)
      .where(eq(funcionariosRh.id, input.funcionarioId))
      .limit(1);

    if (!employee) return { ok: false, code: 'NOT_FOUND' };

    // Verify current password
    if (employee.senhaHash) {
      const valid = await this.verifyPassword(
        input.senhaAtual,
        employee.senhaHash,
      );
      if (!valid) return { ok: false, code: 'WRONG_PASSWORD' };
    } else {
      // No hash stored, accept default password
      if (input.senhaAtual !== DEFAULT_PASSWORD) {
        return { ok: false, code: 'WRONG_PASSWORD' };
      }
    }

    if (input.novaSenha === input.senhaAtual) {
      return { ok: false, code: 'SAME_PASSWORD' };
    }

    const newHash = await this.hashPassword(input.novaSenha);
    await this.database.db
      .update(funcionariosRh)
      .set({
        senhaHash: newHash,
        primeiroAcesso: false,
        atualizadoEm: new Date(),
      })
      .where(eq(funcionariosRh.id, input.funcionarioId));

    return { ok: true };
  }

  /**
   * Get employee profile info.
   */
  async getPerfil(funcionarioId: string) {
    const rows = await this.database.db
      .select({
        id: funcionariosRh.id,
        codigoFuncionario: funcionariosRh.codigoFuncionario,
        nomeCompleto: funcionariosRh.nomeCompleto,
        cargo: funcionariosRh.cargo,
        departamento: funcionariosRh.departamento,
        dataAdmissao: funcionariosRh.dataAdmissao,
        cnpj: clientes.cnpj,
        razaoSocial: clientes.razaoSocial,
      })
      .from(funcionariosRh)
      .innerJoin(clientes, eq(funcionariosRh.clienteId, clientes.id))
      .where(eq(funcionariosRh.id, funcionarioId))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * List payslips (recibos) for the authenticated employee.
   */
  async listRecibos(funcionarioId: string, pagination: PaginationParams) {
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
          periodoInicio: folhasPagamento.periodoInicio,
          periodoFim: folhasPagamento.periodoFim,
        })
        .from(itensFolhaPagamento)
        .innerJoin(
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
        salarioBase: Number(r.salarioBase),
        totalProventos: Number(r.totalProventos),
        totalDescontos: Number(r.totalDescontos),
        salarioLiquido: Number(r.salarioLiquido),
        competencia: r.competencia,
        periodoInicio: r.periodoInicio,
        periodoFim: r.periodoFim,
      })),
    };
  }

  /**
   * Get a specific payslip detail for the authenticated employee.
   */
  async getReciboDetalhe(funcionarioId: string, itemFolhaId: string) {
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
      .innerJoin(
        folhasPagamento,
        eq(itensFolhaPagamento.folhaId, folhasPagamento.id),
      )
      .innerJoin(clientes, eq(itensFolhaPagamento.clienteId, clientes.id))
      .where(
        and(
          eq(itensFolhaPagamento.id, itemFolhaId),
          eq(itensFolhaPagamento.funcionarioId, funcionarioId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.item.id,
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
      referencia: row.item.referencia,
      dependentesIr: row.item.dependentesIr,
      dependentesSf: row.item.dependentesSf,
      rubricas: row.item.rubricas,
      competencia: row.folha.competencia,
      periodoInicio: row.folha.periodoInicio,
      periodoFim: row.folha.periodoFim,
      empresa: {
        razaoSocial: row.empresa.razaoSocial,
        cnpj: row.empresa.cnpj,
      },
    };
  }

  /**
   * Get recibo in the ReciboData format used by the PDF generator.
   * Includes funcionario info, empresa, valores, and rubricas.
   */
  async getReciboPdf(funcionarioId: string, itemFolhaId: string) {
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
      .innerJoin(
        funcionariosRh,
        eq(itensFolhaPagamento.funcionarioId, funcionariosRh.id),
      )
      .innerJoin(
        folhasPagamento,
        eq(itensFolhaPagamento.folhaId, folhasPagamento.id),
      )
      .innerJoin(clientes, eq(itensFolhaPagamento.clienteId, clientes.id))
      .where(
        and(
          eq(itensFolhaPagamento.id, itemFolhaId),
          eq(itensFolhaPagamento.funcionarioId, funcionarioId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      empresa: {
        razaoSocial: row.empresa.razaoSocial,
        cnpj: row.empresa.cnpj,
        endereco: this.buildEndereco(row.empresa),
      },
      competencia: row.folha.competencia,
      periodoInicio: row.folha.periodoInicio,
      periodoFim: row.folha.periodoFim,
      funcionario: {
        codigoFuncionario: row.funcionario.codigoFuncionario,
        nomeCompleto: row.funcionario.nomeCompleto,
        cargo: row.funcionario.cargo,
        dataAdmissao: row.funcionario.dataAdmissao,
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

    const rua = [
      empresa.logradouro,
      empresa.numero ? `Nº ${empresa.numero}` : null,
      empresa.complemento,
    ]
      .filter(Boolean)
      .join(', ');
    if (rua) parts.push(rua);

    if (empresa.bairro) parts.push(empresa.bairro);

    const cidadeUf = [empresa.municipio, empresa.uf]
      .filter(Boolean)
      .join(' - ');
    if (cidadeUf) parts.push(cidadeUf);

    if (empresa.cep) {
      const cepFormatted = empresa.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2');
      parts.push(`CEP ${cepFormatted}`);
    }

    return parts.join(', ');
  }

  // ─── Password hashing (same approach as AuthService) ───

  async hashPassword(password: string): Promise<string> {
    const { scrypt, randomBytes } = await import('crypto');
    return new Promise((resolve, reject) => {
      const salt = randomBytes(16).toString('hex');
      scrypt(
        password.normalize('NFKC'),
        salt,
        64,
        { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
        (err, key) => {
          if (err) reject(err);
          else resolve(`${salt}:${key.toString('hex')}`);
        },
      );
    });
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
      const bcrypt = await import('bcrypt');
      return bcrypt.compare(password, hash);
    }

    const separatorIndex = hash.indexOf(':');
    if (separatorIndex === -1) return false;

    const salt = hash.slice(0, separatorIndex);
    const storedKey = hash.slice(separatorIndex + 1);

    const { scrypt, timingSafeEqual } = await import('crypto');
    return new Promise((resolve, reject) => {
      scrypt(
        password.normalize('NFKC'),
        salt,
        64,
        { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
        (err, derivedKey) => {
          if (err) {
            reject(err);
            return;
          }
          const storedBuffer = Buffer.from(storedKey, 'hex');
          if (storedBuffer.length !== derivedKey.length) {
            resolve(false);
            return;
          }
          resolve(timingSafeEqual(derivedKey, storedBuffer));
        },
      );
    });
  }
}
