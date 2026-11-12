import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  like,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  eventosAuditoria,
  financeiroBaixas,
  financeiroContratos,
  financeiroContratosItens,
  financeiroFaturas,
  financeiroLancamentos,
  financeiroTiposLancamento,
} from '../../database/schema';
import { AppLogger } from '../../common/logger.service';
import { getBahiaDate } from '../../common/document-status';
import type { PaginationParams } from '../../common/types';
import {
  calcularVencimento,
  competenciaNaVigencia,
  derivarStatusFatura,
  fromCents,
  isUniqueViolation,
  isValidCivilDate,
  principalAbatidoCents,
  saldoAbertoSql,
  toCents,
} from '../financeiro.utils';
import type {
  CancelarFaturaDto,
  FiltroFaturasDto,
  GerarFaturaAvulsaDto,
  GerarFaturasLoteDto,
} from '../dto/fatura.dto';

type Database = DatabaseService['db'];
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const TIPO_MENSALIDADE = 'MENSALIDADE';
export const TIPO_ENCERRAMENTO = 'ENCERRAMENTO_EXERCICIO';

export interface ResumoGeracaoFaturas {
  totalProcessados: number;
  totalGeradas: number;
  totalPuladas: number;
  totalFalhas: number;
  faturasIds: string[];
}

interface ItemCalculo {
  natureza: string;
  valor: string;
}

function totalizar(itens: ItemCalculo[]) {
  let bruto = 0;
  let descontos = 0;
  for (const item of itens) {
    if (item.natureza === 'CREDITO') descontos += toCents(item.valor);
    else bruto += toCents(item.valor);
  }
  return { bruto, descontos, liquido: Math.max(0, bruto - descontos) };
}

@Injectable()
export class FinanceiroFaturasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly logger: AppLogger,
  ) {}

  private get db() {
    return this.database.db;
  }

  // ───────────────────────────── Geração em lote ─────────────────────────────

  async gerarFaturasCompetencia(
    dto: GerarFaturasLoteDto,
    userId?: string,
    requestId?: string,
  ): Promise<ResumoGeracaoFaturas> {
    const [mesStr, anoStr] = dto.competencia.split('/');
    if (
      !mesStr ||
      !anoStr ||
      !/^(0[1-9]|1[0-2])\/[0-9]{4}$/.test(dto.competencia)
    ) {
      throw new BadRequestException('Competência inválida. Use MM/AAAA.');
    }
    const hoje = getBahiaDate();
    const clienteIds = await this.resolverClientesElegiveis(
      dto.competencia,
      dto.clienteIds,
    );

    const resumo: ResumoGeracaoFaturas = {
      totalProcessados: 0,
      totalGeradas: 0,
      totalPuladas: 0,
      totalFalhas: 0,
      faturasIds: [],
    };

    for (const clienteId of clienteIds) {
      resumo.totalProcessados += 1;

      const [existente] = await this.db
        .select({ id: financeiroFaturas.id })
        .from(financeiroFaturas)
        .where(
          and(
            eq(financeiroFaturas.clienteId, clienteId),
            eq(financeiroFaturas.competencia, dto.competencia),
            ne(financeiroFaturas.status, 'CANCELADA'),
          ),
        )
        .limit(1);
      if (existente) {
        this.logger.info('financeiro_fatura_ja_existente', {
          requestId,
          operation: 'gerar_faturas_competencia',
          entityType: 'CLIENTE',
          entityId: clienteId,
          competencia: dto.competencia,
        });
        resumo.totalPuladas += 1;
        continue;
      }

      try {
        const faturaId = await this.db.transaction((tx) =>
          this.gerarFaturaCliente(tx, clienteId, dto.competencia, hoje, userId),
        );
        if (faturaId) {
          resumo.totalGeradas += 1;
          resumo.faturasIds.push(faturaId);
        } else {
          resumo.totalPuladas += 1;
        }
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Outra execução concorrente gerou a fatura: idempotência preservada.
          resumo.totalPuladas += 1;
          continue;
        }
        resumo.totalFalhas += 1;
        this.logger.error('financeiro_fatura_falha', error, {
          requestId,
          operation: 'gerar_faturas_competencia',
          entityType: 'CLIENTE',
          entityId: clienteId,
          competencia: dto.competencia,
        });
      }
    }

    this.logger.info('financeiro_faturas_geradas', {
      requestId,
      userId,
      operation: 'gerar_faturas_competencia',
      competencia: dto.competencia,
      totalProcessados: resumo.totalProcessados,
      totalGeradas: resumo.totalGeradas,
      totalPuladas: resumo.totalPuladas,
      totalFalhas: resumo.totalFalhas,
    });
    return resumo;
  }

  /**
   * Pré-gera as faturas da competência corrente dos contratos cujo dia de
   * fechamento é hoje (ou, no último dia do mês, os com fechamento posterior).
   */
  async gerarFaturasFechamentoDoDia(
    hoje = getBahiaDate(),
    requestId?: string,
  ): Promise<ResumoGeracaoFaturas & { competencia: string }> {
    const ano = Number(hoje.slice(0, 4));
    const mes = Number(hoje.slice(5, 7));
    const dia = Number(hoje.slice(8, 10));
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const competencia = `${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`;

    const contratos = await this.db
      .select({ clienteId: financeiroContratos.clienteId })
      .from(financeiroContratos)
      .where(
        and(
          eq(financeiroContratos.ativo, true),
          dia === ultimoDia
            ? gte(financeiroContratos.diaFechamento, dia)
            : eq(financeiroContratos.diaFechamento, dia),
        ),
      );

    if (contratos.length === 0) {
      return {
        competencia,
        totalProcessados: 0,
        totalGeradas: 0,
        totalPuladas: 0,
        totalFalhas: 0,
        faturasIds: [],
      };
    }
    const resumo = await this.gerarFaturasCompetencia(
      { competencia, clienteIds: contratos.map((c) => c.clienteId) },
      undefined,
      requestId,
    );
    return { competencia, ...resumo };
  }

  /** Clientes elegíveis à fatura da competência que ainda não possuem fatura ativa. */
  async contarClientesSemFatura(competencia: string): Promise<number> {
    const elegiveis = await this.resolverClientesElegiveis(competencia);
    if (elegiveis.length === 0) return 0;
    const faturados = await this.db
      .select({ clienteId: financeiroFaturas.clienteId })
      .from(financeiroFaturas)
      .where(
        and(
          eq(financeiroFaturas.competencia, competencia),
          ne(financeiroFaturas.status, 'CANCELADA'),
          inArray(financeiroFaturas.clienteId, elegiveis),
        ),
      );
    const comFatura = new Set(faturados.map((f) => f.clienteId));
    return elegiveis.filter((id) => !comFatura.has(id)).length;
  }

  private async resolverClientesElegiveis(
    competencia: string,
    clienteIds?: string[],
  ): Promise<string[]> {
    const filtroClientes = clienteIds?.length
      ? inArray(clientes.id, clienteIds)
      : undefined;

    const comContrato = this.db
      .select({ id: financeiroContratos.clienteId })
      .from(financeiroContratos)
      .where(
        and(
          eq(financeiroContratos.ativo, true),
          or(
            sql`${financeiroContratos.valorMensalidade} > 0`,
            inArray(
              financeiroContratos.id,
              this.db
                .select({ id: financeiroContratosItens.contratoId })
                .from(financeiroContratosItens)
                .where(eq(financeiroContratosItens.ativo, true)),
            ),
          ),
        ),
      );
    const comPendentes = this.db
      .select({ id: financeiroLancamentos.clienteId })
      .from(financeiroLancamentos)
      .where(
        and(
          eq(financeiroLancamentos.competencia, competencia),
          eq(financeiroLancamentos.status, 'PENDENTE'),
        ),
      );

    const rows = await this.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(
        and(
          eq(clientes.suspenso, false),
          filtroClientes,
          or(
            inArray(clientes.id, comContrato),
            inArray(clientes.id, comPendentes),
          ),
        ),
      )
      .orderBy(asc(clientes.razaoSocial));
    return rows.map((row) => row.id);
  }

  private async obterTiposPorCodigo(tx: Tx, codigos: string[]) {
    const rows = await tx
      .select()
      .from(financeiroTiposLancamento)
      .where(inArray(financeiroTiposLancamento.codigo, codigos));
    return new Map(rows.map((row) => [row.codigo, row]));
  }

  /** Gera a fatura de um cliente. Retorna null quando não há nada a faturar. */
  private async gerarFaturaCliente(
    tx: Tx,
    clienteId: string,
    competencia: string,
    hoje: string,
    userId?: string,
  ): Promise<string | null> {
    const mes = Number(competencia.slice(0, 2));

    const [contrato] = await tx
      .select()
      .from(financeiroContratos)
      .where(
        and(
          eq(financeiroContratos.clienteId, clienteId),
          eq(financeiroContratos.ativo, true),
        ),
      )
      .limit(1);

    const pendentes = await tx
      .select()
      .from(financeiroLancamentos)
      .where(
        and(
          eq(financeiroLancamentos.clienteId, clienteId),
          eq(financeiroLancamentos.competencia, competencia),
          eq(financeiroLancamentos.status, 'PENDENTE'),
        ),
      )
      .for('update');

    const mensalidadeCents = toCents(contrato?.valorMensalidade);
    const automaticos: Array<typeof financeiroLancamentos.$inferInsert> = [];

    if (contrato && mensalidadeCents > 0) {
      const tipos = await this.obterTiposPorCodigo(tx, [
        TIPO_MENSALIDADE,
        TIPO_ENCERRAMENTO,
      ]);
      const mensalidade = tipos.get(TIPO_MENSALIDADE);
      const encerramento = tipos.get(TIPO_ENCERRAMENTO);
      if (!mensalidade) {
        throw new BadRequestException(
          'Tipo de lançamento MENSALIDADE não cadastrado. Execute o seed financeiro.',
        );
      }
      const base = {
        clienteId,
        competencia,
        natureza: 'DEBITO',
        valor: fromCents(mensalidadeCents),
        dataLancamento: hoje,
        status: 'PENDENTE',
        criadoPor: userId ?? null,
      };
      if (!pendentes.some((l) => l.tipoLancamentoId === mensalidade.id)) {
        automaticos.push({
          ...base,
          tipoLancamentoId: mensalidade.id,
          descricao: `Honorários contábeis - ${competencia}`,
        });
      }
      if (contrato.gera13o && contrato.mes13o === mes) {
        if (!encerramento) {
          throw new BadRequestException(
            'Tipo de lançamento ENCERRAMENTO_EXERCICIO não cadastrado. Execute o seed financeiro.',
          );
        }
        if (!pendentes.some((l) => l.tipoLancamentoId === encerramento.id)) {
          automaticos.push({
            ...base,
            tipoLancamentoId: encerramento.id,
            descricao: `Encerramento de exercício (13º) - ${competencia}`,
          });
        }
      }
    }

    if (contrato) {
      const fixos = await tx
        .select({
          item: financeiroContratosItens,
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
        .where(
          and(
            eq(financeiroContratosItens.contratoId, contrato.id),
            eq(financeiroContratosItens.ativo, true),
          ),
        )
        .orderBy(asc(financeiroContratosItens.criadoEm));
      for (const { item, natureza } of fixos) {
        if (
          !competenciaNaVigencia(
            competencia,
            item.competenciaInicio,
            item.competenciaFim,
          ) ||
          pendentes.some((l) => l.contratoItemId === item.id)
        ) {
          continue;
        }
        automaticos.push({
          clienteId,
          competencia,
          tipoLancamentoId: item.tipoLancamentoId,
          contratoItemId: item.id,
          descricao: item.descricao,
          natureza,
          valor: item.valor,
          dataLancamento: hoje,
          status: 'PENDENTE',
          criadoPor: userId ?? null,
        });
      }
    }

    const itens: ItemCalculo[] = [...pendentes, ...automaticos].map((l) => ({
      natureza: l.natureza ?? 'DEBITO',
      valor: String(l.valor),
    }));
    const totais = totalizar(itens);
    if (itens.length === 0 || totais.liquido === 0) return null;

    const diaVencimento = contrato?.diaVencimento ?? 10;
    const dataVencimento = calcularVencimento(competencia, diaVencimento);
    const numero = await this.proximoNumero(tx, competencia);

    const [fatura] = await tx
      .insert(financeiroFaturas)
      .values({
        numero,
        clienteId,
        competencia,
        dataEmissao: hoje,
        dataVencimento,
        valorBruto: fromCents(totais.bruto),
        valorDescontos: fromCents(totais.descontos),
        valorLiquido: fromCents(totais.liquido),
        status: dataVencimento < hoje ? 'VENCIDA' : 'PENDENTE',
        criadoPor: userId ?? null,
      })
      .returning({ id: financeiroFaturas.id });

    const criados = automaticos.length
      ? await tx
          .insert(financeiroLancamentos)
          .values(automaticos)
          .returning({ id: financeiroLancamentos.id })
      : [];
    const lancamentoIds = [
      ...pendentes.map((l) => l.id),
      ...criados.map((l) => l.id),
    ];

    await tx
      .update(financeiroLancamentos)
      .set({
        status: 'FATURADO',
        faturaId: fatura.id,
        atualizadoEm: sql`NOW()`,
      })
      .where(inArray(financeiroLancamentos.id, lancamentoIds));

    return fatura.id;
  }

  /** Número sequencial por competência: FAT-AAAAMM-0001 (serializado por lock). */
  private async proximoNumero(tx: Tx, competencia: string): Promise<string> {
    const [mes, ano] = competencia.split('/');
    const prefixo = `FAT-${ano}${mes}`;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`financeiro_fatura_numero:${prefixo}`}))`,
    );
    const [row] = await tx
      .select({
        maximo: sql<
          number | null
        >`max(substring(${financeiroFaturas.numero} from '[0-9]+$')::int)`,
      })
      .from(financeiroFaturas)
      .where(like(financeiroFaturas.numero, `${prefixo}-%`));
    const sequencia = (row?.maximo ?? 0) + 1;
    return `${prefixo}-${String(sequencia).padStart(4, '0')}`;
  }

  // ───────────────────────────── Fatura avulsa ─────────────────────────────

  async gerarFaturaAvulsa(dto: GerarFaturaAvulsaDto, userId: string) {
    const hoje = getBahiaDate();
    if (!isValidCivilDate(dto.dataVencimento)) {
      throw new BadRequestException('Data de vencimento inválida.');
    }
    const [cliente] = await this.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, dto.clienteId))
      .limit(1);
    if (!cliente) throw new NotFoundException('Cliente não encontrado.');

    const tipoIds = [
      ...new Set(dto.itens.map((item) => item.tipoLancamentoId)),
    ];
    const tipos = await this.db
      .select()
      .from(financeiroTiposLancamento)
      .where(inArray(financeiroTiposLancamento.id, tipoIds));
    if (tipos.length !== tipoIds.length) {
      throw new NotFoundException('Tipo de lançamento não encontrado.');
    }
    if (tipos.some((tipo) => !tipo.ativo)) {
      throw new BadRequestException('Há itens com tipo de lançamento inativo.');
    }

    const itens = dto.itens.map((item) => ({
      tipoLancamentoId: item.tipoLancamentoId,
      descricao: item.descricao.trim(),
      natureza: item.natureza,
      valor: fromCents(toCents(item.valor)),
    }));
    const totais = totalizar(itens);
    if (totais.liquido === 0) {
      throw new BadRequestException(
        'O valor líquido da fatura deve ser maior que zero.',
      );
    }

    try {
      const faturaId = await this.db.transaction(async (tx) => {
        const [existente] = await tx
          .select({ id: financeiroFaturas.id })
          .from(financeiroFaturas)
          .where(
            and(
              eq(financeiroFaturas.clienteId, dto.clienteId),
              eq(financeiroFaturas.competencia, dto.competencia),
              ne(financeiroFaturas.status, 'CANCELADA'),
            ),
          )
          .limit(1);
        if (existente) throw new ConflictException(MSG_FATURA_EXISTENTE);

        const numero = await this.proximoNumero(tx, dto.competencia);
        const [fatura] = await tx
          .insert(financeiroFaturas)
          .values({
            numero,
            clienteId: dto.clienteId,
            competencia: dto.competencia,
            dataEmissao: hoje,
            dataVencimento: dto.dataVencimento,
            valorBruto: fromCents(totais.bruto),
            valorDescontos: fromCents(totais.descontos),
            valorLiquido: fromCents(totais.liquido),
            status: dto.dataVencimento < hoje ? 'VENCIDA' : 'PENDENTE',
            observacoes: dto.observacoes?.trim() || null,
            criadoPor: userId,
          })
          .returning({ id: financeiroFaturas.id });

        await tx.insert(financeiroLancamentos).values(
          itens.map((item) => ({
            clienteId: dto.clienteId,
            tipoLancamentoId: item.tipoLancamentoId,
            faturaId: fatura.id,
            competencia: dto.competencia,
            descricao: item.descricao,
            natureza: item.natureza,
            valor: item.valor,
            dataLancamento: hoje,
            status: 'FATURADO',
            criadoPor: userId,
          })),
        );
        return fatura.id;
      });
      return this.getById(faturaId);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(MSG_FATURA_EXISTENTE);
      throw error;
    }
  }

  // ───────────────────────────── Consultas ─────────────────────────────

  private condicaoStatus(status: string, hoje: string): SQL | undefined {
    const emAberto = (alvo: string) =>
      and(
        eq(financeiroFaturas.status, alvo),
        gte(financeiroFaturas.dataVencimento, hoje),
      );
    switch (status) {
      case 'VENCIDA':
        return or(
          eq(financeiroFaturas.status, 'VENCIDA'),
          and(
            inArray(financeiroFaturas.status, [
              'PENDENTE',
              'PARCIALMENTE_PAGA',
            ]),
            sql`${financeiroFaturas.dataVencimento} < ${hoje}`,
          ),
        );
      case 'PENDENTE':
      case 'PARCIALMENTE_PAGA':
        return emAberto(status);
      default:
        return eq(financeiroFaturas.status, status);
    }
  }

  async list(
    filtro: FiltroFaturasDto,
    pagination: PaginationParams,
    escopoClienteId?: string,
  ) {
    const hoje = getBahiaDate();
    const conditions: SQL[] = [];
    const clienteId = escopoClienteId ?? filtro.clienteId;
    if (clienteId) conditions.push(eq(financeiroFaturas.clienteId, clienteId));
    if (filtro.competencia) {
      conditions.push(eq(financeiroFaturas.competencia, filtro.competencia));
    }
    if (filtro.status) {
      const condition = this.condicaoStatus(filtro.status, hoje);
      if (condition) conditions.push(condition);
    }
    if (filtro.vencimentoInicio) {
      conditions.push(
        gte(financeiroFaturas.dataVencimento, filtro.vencimentoInicio),
      );
    }
    if (filtro.vencimentoFim) {
      conditions.push(
        lte(financeiroFaturas.dataVencimento, filtro.vencimentoFim),
      );
    }
    // O cliente não enxerga faturas canceladas.
    if (escopoClienteId)
      conditions.push(ne(financeiroFaturas.status, 'CANCELADA'));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          fatura: financeiroFaturas,
          clienteRazaoSocial: clientes.razaoSocial,
          saldoAberto: saldoAbertoSql,
        })
        .from(financeiroFaturas)
        .innerJoin(clientes, eq(clientes.id, financeiroFaturas.clienteId))
        .where(where)
        .orderBy(
          desc(financeiroFaturas.dataVencimento),
          desc(financeiroFaturas.numero),
        )
        .limit(pagination.limit)
        .offset(pagination.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(financeiroFaturas)
        .where(where),
    ]);

    return {
      data: rows.map((row) => ({
        ...this.omitirDadosInternos(row.fatura, escopoClienteId !== undefined),
        status: derivarStatusFatura(
          row.fatura.status,
          row.fatura.dataVencimento,
          hoje,
        ),
        clienteRazaoSocial: row.clienteRazaoSocial,
        saldoAberto: row.saldoAberto,
      })),
      total,
    };
  }

  private omitirDadosInternos<T extends { criadoPor: string | null }>(
    fatura: T,
    paraCliente: boolean,
  ) {
    if (!paraCliente) return fatura;
    const { criadoPor, ...rest } = fatura;
    void criadoPor;
    return rest;
  }

  async getById(id: string, escopoClienteId?: string) {
    const hoje = getBahiaDate();
    const [row] = await this.db
      .select({
        fatura: financeiroFaturas,
        clienteRazaoSocial: clientes.razaoSocial,
      })
      .from(financeiroFaturas)
      .innerJoin(clientes, eq(clientes.id, financeiroFaturas.clienteId))
      .where(
        and(
          eq(financeiroFaturas.id, id),
          escopoClienteId
            ? eq(financeiroFaturas.clienteId, escopoClienteId)
            : undefined,
          escopoClienteId
            ? ne(financeiroFaturas.status, 'CANCELADA')
            : undefined,
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Fatura não encontrada.');

    const paraCliente = escopoClienteId !== undefined;
    const [lancamentos, baixas] = await Promise.all([
      this.db
        .select({
          id: financeiroLancamentos.id,
          descricao: financeiroLancamentos.descricao,
          natureza: financeiroLancamentos.natureza,
          valor: financeiroLancamentos.valor,
          dataLancamento: financeiroLancamentos.dataLancamento,
          tipoCodigo: financeiroTiposLancamento.codigo,
          tipoNome: financeiroTiposLancamento.nome,
        })
        .from(financeiroLancamentos)
        .innerJoin(
          financeiroTiposLancamento,
          eq(
            financeiroTiposLancamento.id,
            financeiroLancamentos.tipoLancamentoId,
          ),
        )
        .where(eq(financeiroLancamentos.faturaId, id))
        .orderBy(asc(financeiroLancamentos.criadoEm)),
      this.db
        .select()
        .from(financeiroBaixas)
        .where(
          and(
            eq(financeiroBaixas.faturaId, id),
            paraCliente ? eq(financeiroBaixas.estornado, false) : undefined,
          ),
        )
        .orderBy(
          asc(financeiroBaixas.dataPagamento),
          asc(financeiroBaixas.criadoEm),
        ),
    ]);

    const abatido = baixas
      .filter((b) => !b.estornado)
      .reduce((acc, b) => acc + principalAbatidoCents(b), 0);
    const saldoAberto = Math.max(0, toCents(row.fatura.valorLiquido) - abatido);

    return {
      ...this.omitirDadosInternos(row.fatura, paraCliente),
      status: derivarStatusFatura(
        row.fatura.status,
        row.fatura.dataVencimento,
        hoje,
      ),
      clienteRazaoSocial: row.clienteRazaoSocial,
      saldoAberto: fromCents(saldoAberto),
      lancamentos,
      baixas: paraCliente
        ? baixas.map((b) => ({
            id: b.id,
            valorRecebido: b.valorRecebido,
            dataPagamento: b.dataPagamento,
            formaPagamento: b.formaPagamento,
            valorMulta: b.valorMulta,
            valorJuros: b.valorJuros,
            valorDesconto: b.valorDesconto,
          }))
        : baixas,
    };
  }

  /** Extrato de serviços lançados e faturados nos últimos `meses` meses. */
  async extrato(clienteId: string, meses = 12, pagination: PaginationParams) {
    const hoje = getBahiaDate();
    const total = Math.min(60, Math.max(1, meses));
    const ano = Number(hoje.slice(0, 4));
    const mes = Number(hoje.slice(5, 7)) - total;
    const inicio = new Date(Date.UTC(ano, mes - 1, 1))
      .toISOString()
      .slice(0, 10);

    const where = and(
      eq(financeiroLancamentos.clienteId, clienteId),
      ne(financeiroLancamentos.status, 'CANCELADO'),
      gte(financeiroLancamentos.dataLancamento, inicio),
    );

    const [data, [{ count }]] = await Promise.all([
      this.db
        .select({
          id: financeiroLancamentos.id,
          competencia: financeiroLancamentos.competencia,
          descricao: financeiroLancamentos.descricao,
          natureza: financeiroLancamentos.natureza,
          valor: financeiroLancamentos.valor,
          dataLancamento: financeiroLancamentos.dataLancamento,
          status: financeiroLancamentos.status,
          tipoNome: financeiroTiposLancamento.nome,
          faturaId: financeiroFaturas.id,
          faturaNumero: financeiroFaturas.numero,
        })
        .from(financeiroLancamentos)
        .innerJoin(
          financeiroTiposLancamento,
          eq(
            financeiroTiposLancamento.id,
            financeiroLancamentos.tipoLancamentoId,
          ),
        )
        .leftJoin(
          financeiroFaturas,
          eq(financeiroFaturas.id, financeiroLancamentos.faturaId),
        )
        .where(where)
        .orderBy(
          desc(financeiroLancamentos.dataLancamento),
          desc(financeiroLancamentos.criadoEm),
        )
        .limit(pagination.limit)
        .offset(pagination.offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(financeiroLancamentos)
        .where(where),
    ]);
    return { data, total: count };
  }

  // ───────────────────────────── Cancelamento ─────────────────────────────

  async cancelar(id: string, dto: CancelarFaturaDto, userId: string) {
    await this.db.transaction(async (tx) => {
      const [fatura] = await tx
        .select()
        .from(financeiroFaturas)
        .where(eq(financeiroFaturas.id, id))
        .for('update')
        .limit(1);
      if (!fatura) throw new NotFoundException('Fatura não encontrada.');
      if (fatura.status === 'CANCELADA') {
        throw new BadRequestException('Fatura já cancelada.');
      }

      const [{ ativas }] = await tx
        .select({ ativas: sql<number>`count(*)::int` })
        .from(financeiroBaixas)
        .where(
          and(
            eq(financeiroBaixas.faturaId, id),
            eq(financeiroBaixas.estornado, false),
          ),
        );
      if (ativas > 0) {
        throw new BadRequestException(
          'Não é possível cancelar uma fatura com baixas ativas. Estorne as baixas antes.',
        );
      }

      const motivo = dto.motivo.trim();
      await tx
        .update(financeiroFaturas)
        .set({
          status: 'CANCELADA',
          observacoes: [fatura.observacoes, `Cancelada: ${motivo}`]
            .filter(Boolean)
            .join('\n'),
          atualizadoEm: sql`NOW()`,
        })
        .where(eq(financeiroFaturas.id, id));

      // Lançamentos automáticos (mensalidade/13º) são descartados; os demais
      // voltam a ficar pendentes para a próxima fatura.
      const automaticos = await tx
        .select({ id: financeiroTiposLancamento.id })
        .from(financeiroTiposLancamento)
        .where(
          inArray(financeiroTiposLancamento.codigo, [
            TIPO_MENSALIDADE,
            TIPO_ENCERRAMENTO,
          ]),
        );
      const automaticoIds = automaticos.map((tipo) => tipo.id);
      await tx
        .update(financeiroLancamentos)
        .set({
          status: 'CANCELADO',
          atualizadoEm: sql`NOW()`,
        })
        .where(
          and(
            eq(financeiroLancamentos.faturaId, id),
            or(
              automaticoIds.length
                ? inArray(financeiroLancamentos.tipoLancamentoId, automaticoIds)
                : undefined,
              sql`${financeiroLancamentos.contratoItemId} IS NOT NULL`,
            ),
          ),
        );
      await tx
        .update(financeiroLancamentos)
        .set({
          status: 'PENDENTE',
          faturaId: null,
          atualizadoEm: sql`NOW()`,
        })
        .where(
          and(
            eq(financeiroLancamentos.faturaId, id),
            eq(financeiroLancamentos.status, 'FATURADO'),
          ),
        );

      await tx.insert(eventosAuditoria).values({
        atorUserId: userId,
        acao: 'FINANCEIRO_FATURA_CANCELADA',
        entidadeTipo: 'FINANCEIRO_FATURA',
        entidadeId: id,
        dados: { numero: fatura.numero, motivo },
      });
    });
    return this.getById(id);
  }

  // ───────────────────────────── Vencidas ─────────────────────────────

  /** Persiste o status VENCIDA nas faturas em aberto com vencimento passado. */
  async marcarFaturasVencidas(hoje = getBahiaDate()): Promise<number> {
    const rows = await this.db
      .update(financeiroFaturas)
      .set({ status: 'VENCIDA', atualizadoEm: sql`NOW()` })
      .where(
        and(
          inArray(financeiroFaturas.status, ['PENDENTE', 'PARCIALMENTE_PAGA']),
          sql`${financeiroFaturas.dataVencimento} < ${hoje}`,
        ),
      )
      .returning({ id: financeiroFaturas.id });
    return rows.length;
  }
}

const MSG_FATURA_EXISTENTE =
  'Já existe uma fatura ativa para este cliente nesta competência.';
