import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  spedAjustesApuracao,
  spedObrigacoesRecolhimento,
  spedResponsabilidadesTributarias,
  spedSaldosApuracao,
} from '../../database/schema';
import type { AtualizarContextoApuracaoSpedDto } from './dto/sped-apuracao.dto';

@Injectable()
export class SpedApuracaoContextoService {
  constructor(private readonly database: DatabaseService) {}

  async obter(clienteId: string, competencia: string) {
    const period = parseCompetencia(competencia);
    await this.assertCliente(clienteId);

    const [saldos, ajustes, obrigacoes, responsabilidades] = await Promise.all([
      this.database.db
        .select()
        .from(spedSaldosApuracao)
        .where(
          and(
            eq(spedSaldosApuracao.clienteId, clienteId),
            eq(spedSaldosApuracao.competencia, period.competencia),
          ),
        )
        .orderBy(asc(spedSaldosApuracao.tipo), asc(spedSaldosApuracao.uf)),
      this.database.db
        .select()
        .from(spedAjustesApuracao)
        .where(
          and(
            eq(spedAjustesApuracao.clienteId, clienteId),
            eq(spedAjustesApuracao.competencia, period.competencia),
          ),
        )
        .orderBy(
          asc(spedAjustesApuracao.registro),
          asc(spedAjustesApuracao.codigoAjuste),
          asc(spedAjustesApuracao.id),
        ),
      this.database.db
        .select()
        .from(spedObrigacoesRecolhimento)
        .where(
          and(
            eq(spedObrigacoesRecolhimento.clienteId, clienteId),
            eq(spedObrigacoesRecolhimento.competencia, period.competencia),
          ),
        )
        .orderBy(
          asc(spedObrigacoesRecolhimento.tipo),
          asc(spedObrigacoesRecolhimento.uf),
        ),
      this.database.db
        .select()
        .from(spedResponsabilidadesTributarias)
        .where(
          and(
            eq(spedResponsabilidadesTributarias.clienteId, clienteId),
            lte(spedResponsabilidadesTributarias.vigenciaInicio, period.end),
            or(
              isNull(spedResponsabilidadesTributarias.vigenciaFim),
              gte(spedResponsabilidadesTributarias.vigenciaFim, period.start),
            ),
          ),
        )
        .orderBy(
          asc(spedResponsabilidadesTributarias.tipo),
          asc(spedResponsabilidadesTributarias.uf),
          asc(spedResponsabilidadesTributarias.vigenciaInicio),
        ),
    ]);

    return {
      competencia,
      saldos: saldos.map(stripAuditColumns),
      ajustes: ajustes.map(stripAuditColumns),
      obrigacoes: obrigacoes.map(stripAuditColumns),
      responsabilidades: responsabilidades.map(stripAuditColumns),
    };
  }

  async atualizar(input: {
    clienteId: string;
    actorUserId: string;
    data: AtualizarContextoApuracaoSpedDto;
  }) {
    const period = parseCompetencia(input.data.competencia);
    await this.assertCliente(input.clienteId);
    this.validarSemantica(input.data);
    const now = new Date();

    await this.database.db.transaction(async (tx) => {
      await tx
        .delete(spedSaldosApuracao)
        .where(
          and(
            eq(spedSaldosApuracao.clienteId, input.clienteId),
            eq(spedSaldosApuracao.competencia, period.competencia),
          ),
        );
      await tx
        .delete(spedAjustesApuracao)
        .where(
          and(
            eq(spedAjustesApuracao.clienteId, input.clienteId),
            eq(spedAjustesApuracao.competencia, period.competencia),
          ),
        );
      await tx
        .delete(spedObrigacoesRecolhimento)
        .where(
          and(
            eq(spedObrigacoesRecolhimento.clienteId, input.clienteId),
            eq(spedObrigacoesRecolhimento.competencia, period.competencia),
          ),
        );

      if (input.data.saldos.length > 0) {
        await tx.insert(spedSaldosApuracao).values(
          input.data.saldos.map((row) => ({
            clienteId: input.clienteId,
            competencia: period.competencia,
            tipo: row.tipo,
            uf: row.uf ?? null,
            saldoCredorAnterior: row.saldoCredorAnterior,
            atualizadoPor: input.actorUserId,
            atualizadoEm: now,
          })),
        );
      }
      if (input.data.ajustes.length > 0) {
        await tx.insert(spedAjustesApuracao).values(
          input.data.ajustes.map((row) => ({
            clienteId: input.clienteId,
            competencia: period.competencia,
            registro: row.registro,
            codigoAjuste: row.codigoAjuste.trim(),
            descricao: row.descricao?.trim() || null,
            valor: row.valor,
            indicador: row.indicador,
            uf: row.uf ?? null,
            numeroDocumento: row.numeroDocumento?.trim() || null,
            atualizadoPor: input.actorUserId,
            atualizadoEm: now,
          })),
        );
      }
      if (input.data.obrigacoes.length > 0) {
        await tx.insert(spedObrigacoesRecolhimento).values(
          input.data.obrigacoes.map((row) => ({
            clienteId: input.clienteId,
            competencia: period.competencia,
            tipo: row.tipo,
            uf: row.uf ?? null,
            codigoObrigacao: row.codigoObrigacao.trim(),
            valor: row.valor,
            dataVencimento: row.dataVencimento,
            codigoReceita: row.codigoReceita.trim(),
            numeroProcesso: row.numeroProcesso?.trim() || null,
            indicadorProcesso: row.indicadorProcesso ?? null,
            processo: row.processo?.trim() || null,
            textoComplementar: row.textoComplementar?.trim() || null,
            mesReferencia: row.mesReferencia,
            atualizadoPor: input.actorUserId,
            atualizadoEm: now,
          })),
        );
      }

      for (const row of input.data.responsabilidades ?? []) {
        await tx
          .insert(spedResponsabilidadesTributarias)
          .values({
            clienteId: input.clienteId,
            tipo: row.tipo,
            uf: row.uf,
            vigenciaInicio: row.vigenciaInicio,
            vigenciaFim: row.vigenciaFim ?? null,
            ativo: row.ativo,
            atualizadoEm: now,
          })
          .onConflictDoUpdate({
            target: [
              spedResponsabilidadesTributarias.clienteId,
              spedResponsabilidadesTributarias.tipo,
              spedResponsabilidadesTributarias.uf,
              spedResponsabilidadesTributarias.vigenciaInicio,
            ],
            set: {
              vigenciaFim: row.vigenciaFim ?? null,
              ativo: row.ativo,
              atualizadoEm: now,
            },
          });
      }
    });

    return this.obter(input.clienteId, input.data.competencia);
  }

  private async assertCliente(clienteId: string) {
    const rows = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
  }

  private validarSemantica(data: AtualizarContextoApuracaoSpedDto) {
    assertUnique(
      data.saldos.map((row) => `${row.tipo}:${row.uf ?? ''}`),
      'Há saldos anteriores duplicados para o mesmo tributo e UF.',
    );
    assertUnique(
      data.obrigacoes.map((row) => `${row.tipo}:${row.uf ?? ''}`),
      'Há obrigações duplicadas para o mesmo tributo e UF.',
    );
    assertUnique(
      (data.responsabilidades ?? []).map(
        (row) => `${row.tipo}:${row.uf}:${row.vigenciaInicio}`,
      ),
      'Há responsabilidades tributárias duplicadas para a mesma vigência.',
    );

    for (const row of data.saldos) {
      const exigeUf = row.tipo === 'ICMS_ST';
      if (exigeUf !== Boolean(row.uf)) {
        throw new BadRequestException(
          'Informe UF somente para saldo anterior de ICMS-ST.',
        );
      }
    }
    for (const row of data.ajustes) {
      const exigeUf = row.registro === 'E220' || row.registro === 'E311';
      if (exigeUf !== Boolean(row.uf)) {
        throw new BadRequestException(
          `O ajuste ${row.registro} ${exigeUf ? 'exige' : 'não aceita'} UF.`,
        );
      }
      const codigo = row.codigoAjuste.trim().toUpperCase();
      if (row.registro !== 'E530' && !/^[A-Z0-9]{8}$/.test(codigo)) {
        throw new BadRequestException(
          `O código do ajuste ${row.registro} deve possuir 8 caracteres alfanuméricos.`,
        );
      }
      if (row.registro === 'E220' && codigo.slice(0, 2) !== row.uf) {
        throw new BadRequestException(
          'O código E220 deve iniciar com a UF informada.',
        );
      }
      if (
        row.registro === 'E311' &&
        (codigo.slice(0, 2) !== row.uf || !['2', '3'].includes(codigo[2]))
      ) {
        throw new BadRequestException(
          'O código E311 deve iniciar com a UF e identificar ajuste DIFAL (2) ou FCP (3).',
        );
      }
      if (
        row.registro === 'E530' &&
        !['DEBITO', 'CREDITO'].includes(row.indicador)
      ) {
        throw new BadRequestException(
          'O ajuste E530 aceita somente débito ou crédito.',
        );
      }
    }
    for (const row of data.obrigacoes) {
      const exigeUf = row.tipo !== 'ICMS_PROPRIO';
      if (exigeUf !== Boolean(row.uf)) {
        throw new BadRequestException(
          `A obrigação ${row.tipo} ${exigeUf ? 'exige' : 'não aceita'} UF.`,
        );
      }
      assertValidDate(row.dataVencimento, 'data de vencimento');
    }
    for (const row of data.responsabilidades ?? []) {
      assertValidDate(row.vigenciaInicio, 'início da vigência');
      if (row.vigenciaFim) {
        assertValidDate(row.vigenciaFim, 'fim da vigência');
        if (row.vigenciaFim < row.vigenciaInicio) {
          throw new BadRequestException(
            'O fim da vigência não pode ser anterior ao início.',
          );
        }
      }
    }
  }
}

function parseCompetencia(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) {
    throw new BadRequestException('Competência deve estar no formato YYYY-MM.');
  }
  const lastDay = new Date(
    Date.UTC(Number(match[1]), Number(match[2]), 0),
  ).getUTCDate();
  return {
    competencia: `${match[1]}-${match[2]}-01`,
    start: `${match[1]}-${match[2]}-01`,
    end: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

function assertUnique(keys: string[], message: string) {
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException(message);
  }
}

function assertValidDate(value: string, field: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`A ${field} é inválida.`);
  }
}

function stripAuditColumns<T extends Record<string, unknown>>(row: T) {
  const {
    clienteId: _clienteId,
    atualizadoPor: _atualizadoPor,
    criadoEm: _criadoEm,
    atualizadoEm: _atualizadoEm,
    ...data
  } = row;
  return data;
}
