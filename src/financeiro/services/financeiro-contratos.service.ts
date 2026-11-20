import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  notInArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  contadores,
  financeiroContratos,
  financeiroContratosItens,
  financeiroTiposLancamento,
  financeiroContratosAditivos,
  financeiroFaturas,
} from '../../database/schema';
import type { PaginationParams } from '../../common/types';
import {
  competenciaIndex,
  competenciaNaVigencia,
  fromCents,
  isValidCivilDate,
  isUniqueViolation,
  toCents,
  competenciaDeData,
} from '../financeiro.utils';
import type {
  ReajusteContratoDto,
  UpsertContratoDto,
} from '../dto/contrato.dto';
import { getBahiaDate } from '../../common/document-status';
import {
  alteracoesDoContrato,
  capturarEstadoContrato,
  contratoFormalizado,
  proximoReajuste,
  reajustarValor,
} from '../contrato-historico';
import {
  TIPO_ENCERRAMENTO,
  TIPO_MENSALIDADE,
} from './financeiro-faturas.service';
import { SERVICOS_CONTRATO } from '../financeiro-servicos.catalogo';

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
          clienteTipoPessoa: clientes.tipoPessoa,
          clienteResponsavelNome: clientes.responsavelNome,
          contadorNome: contadores.nome,
        })
        .from(financeiroContratos)
        .innerJoin(clientes, eq(clientes.id, financeiroContratos.clienteId))
        .leftJoin(contadores, eq(contadores.id, clientes.contadorId))
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

    const fixos = rows.length
      ? await this.database.db
          .select({
            contratoId: financeiroContratosItens.contratoId,
            valor: financeiroContratosItens.valor,
            competenciaInicio: financeiroContratosItens.competenciaInicio,
            competenciaFim: financeiroContratosItens.competenciaFim,
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
              inArray(
                financeiroContratosItens.contratoId,
                rows.map((row) => row.contrato.id),
              ),
              eq(financeiroContratosItens.ativo, true),
              isNull(financeiroContratosItens.removidoEm),
            ),
          )
      : [];
    // Mensalidade efetiva: base + débitos - créditos dos lançamentos fixos
    // ativos e vigentes na competência atual (mesma regra da geração de fatura).
    const competenciaAtual = competenciaDeData(getBahiaDate());
    const competenciasPorContrato = new Map(
      rows.map((row) => [
        row.contrato.id,
        row.contrato.competenciaVigencia &&
        competenciaIndex(row.contrato.competenciaVigencia) >
          competenciaIndex(competenciaAtual)
          ? row.contrato.competenciaVigencia
          : competenciaAtual,
      ]),
    );
    const porContrato = new Map<string, number>();
    const ajusteCents = new Map<string, number>();
    for (const item of fixos) {
      porContrato.set(
        item.contratoId,
        (porContrato.get(item.contratoId) ?? 0) + 1,
      );
      if (
        !competenciaNaVigencia(
          competenciasPorContrato.get(item.contratoId) ?? competenciaAtual,
          item.competenciaInicio,
          item.competenciaFim,
        )
      ) {
        continue;
      }
      const cents =
        toCents(item.valor) * (item.natureza === 'CREDITO' ? -1 : 1);
      ajusteCents.set(
        item.contratoId,
        (ajusteCents.get(item.contratoId) ?? 0) + cents,
      );
    }
    return {
      data: rows.map((row) => ({
        ...row.contrato,
        proximoReajuste: proximoReajuste(
          row.contrato.dataUltimoReajuste ?? row.contrato.dataInicio,
        ),
        clienteRazaoSocial: row.clienteRazaoSocial,
        clienteCnpj: row.clienteCnpj,
        clienteTipoPessoa: row.clienteTipoPessoa,
        clienteResponsavelNome: row.clienteResponsavelNome,
        contadorNome: row.contadorNome,
        podeImprimir: Boolean(
          row.contadorNome &&
          row.contrato.dataInicio &&
          row.contrato.localAssinatura?.trim() &&
          row.contrato.dataAssinatura &&
          row.contrato.servicosContratados.length &&
          (row.clienteTipoPessoa !== 'PJ' ||
            row.clienteResponsavelNome?.trim()),
        ),
        qtdItensFixos: porContrato.get(row.contrato.id) ?? 0,
        valorMensalidadeTotal: fromCents(
          toCents(row.contrato.valorMensalidade) +
            (ajusteCents.get(row.contrato.id) ?? 0),
        ),
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
      .where(
        and(
          eq(financeiroContratosItens.contratoId, contratoId),
          isNull(financeiroContratosItens.removidoEm),
        ),
      )
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
    return {
      ...contrato,
      proximoReajuste: proximoReajuste(
        contrato.dataUltimoReajuste ?? contrato.dataInicio,
      ),
      itens: await this.listarItens(contrato.id),
    };
  }

  async listarAditivos(clienteId: string) {
    const contrato = await this.getByCliente(clienteId);
    const rows = await this.database.db
      .select()
      .from(financeiroContratosAditivos)
      .where(eq(financeiroContratosAditivos.contratoId, contrato.id))
      .orderBy(desc(financeiroContratosAditivos.numero));
    return rows.map(({ anterior, posterior, ...row }) => ({
      ...row,
      valorAnterior: anterior.contrato.valorMensalidade,
      valorNovo: posterior.contrato.valorMensalidade,
    }));
  }

  async obterOriginal(clienteId: string) {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`financeiro_contrato:${clienteId}`}))`,
      );
      const [contrato] = await tx
        .select()
        .from(financeiroContratos)
        .where(eq(financeiroContratos.clienteId, clienteId))
        .limit(1);
      if (!contrato)
        throw new NotFoundException('Contrato financeiro não encontrado.');
      const [primeiro] = await tx
        .select({ anterior: financeiroContratosAditivos.anterior })
        .from(financeiroContratosAditivos)
        .where(eq(financeiroContratosAditivos.contratoId, contrato.id))
        .orderBy(asc(financeiroContratosAditivos.numero))
        .limit(1);
      return primeiro?.anterior ?? capturarEstadoContrato(tx, contrato);
    });
  }

  async previaReajuste(clienteId: string, dto: ReajusteContratoDto) {
    if (dto.motivo.trim().length < 3)
      throw new BadRequestException(
        'Informe o índice, o período e a justificativa do reajuste.',
      );
    const contrato = await this.getByCliente(clienteId);
    if (contrato.versao !== dto.versaoEsperada)
      throw new ConflictException(
        'O contrato foi alterado. Recarregue os dados e revise o reajuste.',
      );
    if (!contrato.ativo)
      throw new BadRequestException(
        'Ative o contrato antes de registrar um reajuste anual.',
      );
    if (!contrato.servicosContratados.length || !contrato.dataAssinatura)
      throw new BadRequestException(
        'Complete os serviços e a assinatura do contrato original antes de registrar um reajuste anual.',
      );
    const [partes] = await this.database.db
      .select({ cliente: clientes, contador: contadores })
      .from(clientes)
      .leftJoin(contadores, eq(contadores.id, clientes.contadorId))
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (
      !partes?.contador?.nome ||
      !partes.contador.crc ||
      !(partes.contador.cpf || partes.contador.cnpj) ||
      (partes.cliente.tipoPessoa === 'PJ' &&
        !partes.cliente.responsavelNome?.trim()) ||
      !(dto.localAssinatura || contrato.localAssinatura)?.trim()
    )
      throw new BadRequestException(
        'Complete o contador vinculado, o responsável da empresa e o local de assinatura antes de reajustar e gerar o aditivo.',
      );
    if (dto.dataAssinatura && !isValidCivilDate(dto.dataAssinatura))
      throw new BadRequestException('Data de assinatura do aditivo inválida.');
    const dataMinima = proximoReajuste(
      contrato.dataUltimoReajuste ?? contrato.dataInicio,
    );
    if (!dataMinima)
      throw new BadRequestException(
        'Informe a data de início do contrato antes de reajustar.',
      );
    const [mes, ano] = dto.competenciaInicio.split('/');
    const dataEfeito = `${ano}-${mes}-01`;
    if (dataEfeito < dataMinima)
      throw new BadRequestException(
        `O próximo reajuste anual poderá vigorar a partir de ${dataMinima}.`,
      );
    if (
      competenciaIndex(dto.competenciaInicio) <
      competenciaIndex(competenciaDeData(getBahiaDate()))
    )
      throw new BadRequestException(
        'Não é permitido aplicar reajuste em competência passada.',
      );
    let servicos: typeof contrato.servicosContratados;
    let valorNovo: string;
    try {
      servicos = contrato.servicosContratados.map((s) => ({
        ...s,
        valorMensal: reajustarValor(s.valorMensal, dto.percentual),
      }));
      valorNovo = servicos.length
        ? fromCents(
            servicos.reduce((total, s) => total + toCents(s.valorMensal), 0),
          )
        : reajustarValor(contrato.valorMensalidade, dto.percentual);
    } catch {
      throw new BadRequestException(
        'O valor reajustado excede o limite permitido.',
      );
    }
    if (
      toCents(valorNovo) <= toCents(contrato.valorMensalidade) ||
      toCents(valorNovo) > 999_999_999_999
    )
      throw new BadRequestException(
        'O percentual informado não produz um reajuste válido em centavos.',
      );
    return {
      versao: contrato.versao,
      percentual: dto.percentual,
      competenciaInicio: dto.competenciaInicio,
      dataMinima,
      valorAnterior: contrato.valorMensalidade,
      valorNovo,
      servicos,
    };
  }

  async reajustar(clienteId: string, dto: ReajusteContratoDto, userId: string) {
    const previa = await this.previaReajuste(clienteId, dto);
    const contrato = await this.getByCliente(clienteId);
    return this.upsert(
      clienteId,
      {
        valorMensalidade: Number(previa.valorNovo),
        diaVencimento: contrato.diaVencimento,
        diaFechamento: contrato.diaFechamento,
        gera13o: contrato.gera13o,
        mes13o: contrato.mes13o,
        ativo: contrato.ativo,
        observacoes: contrato.observacoes ?? undefined,
        ...(previa.servicos.length
          ? {
              servicos: previa.servicos.map((s) => ({
                ...s,
                valorMensal: Number(s.valorMensal),
              })),
            }
          : {}),
        versaoEsperada: dto.versaoEsperada,
        competenciaInicioAditivo: dto.competenciaInicio,
        motivoAditivo: dto.motivo,
        dataAssinaturaAditivo: dto.dataAssinatura,
        localAssinaturaAditivo: dto.localAssinatura,
      },
      userId,
      dto.percentual,
    );
  }

  async upsert(
    clienteId: string,
    dto: UpsertContratoDto,
    userId: string,
    percentualAnual?: number,
  ) {
    const [cliente] = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!cliente) throw new NotFoundException('Cliente não encontrado.');

    if (dto.itens) await this.validarItens(dto.itens);
    if (dto.dataInicio && !isValidCivilDate(dto.dataInicio)) {
      throw new BadRequestException('Data de início inválida.');
    }
    if (
      dto.dataAssinaturaAditivo &&
      !isValidCivilDate(dto.dataAssinaturaAditivo)
    )
      throw new BadRequestException('Data de assinatura do aditivo inválida.');
    if (dto.dataAssinatura && !isValidCivilDate(dto.dataAssinatura)) {
      throw new BadRequestException('Data de assinatura inválida.');
    }
    if (dto.servicos) {
      if (dto.servicos.length === 0) {
        throw new BadRequestException(
          'Selecione pelo menos um serviço contratado.',
        );
      }
      const codigos = dto.servicos.map((servico) => servico.codigo);
      if (new Set(codigos).size !== codigos.length) {
        throw new BadRequestException(
          'Cada serviço deve aparecer uma única vez.',
        );
      }
      for (const servico of dto.servicos) {
        if (
          !SERVICOS_CONTRATO.some((opcao) => opcao.codigo === servico.codigo)
        ) {
          throw new BadRequestException('Serviço contratual inválido.');
        }
        if (servico.codigo === 'OUTROS' && !servico.descricao?.trim()) {
          throw new BadRequestException(
            'Descreva o serviço adicional contratado.',
          );
        }
      }
      const totalCents = dto.servicos.reduce(
        (total, servico) => total + toCents(servico.valorMensal),
        0,
      );
      if (totalCents !== toCents(dto.valorMensalidade)) {
        throw new BadRequestException(
          'A mensalidade deve ser igual à soma dos serviços contratados.',
        );
      }
    } else {
      const [atual] = await this.database.db
        .select({ servicos: financeiroContratos.servicosContratados })
        .from(financeiroContratos)
        .where(eq(financeiroContratos.clienteId, clienteId))
        .limit(1);
      if (
        atual?.servicos.length &&
        atual.servicos.reduce(
          (total, servico) => total + toCents(servico.valorMensal),
          0,
        ) !== toCents(dto.valorMensalidade)
      ) {
        throw new BadRequestException(
          'Atualize os valores dos serviços contratados junto com a mensalidade.',
        );
      }
    }

    const values = {
      valorMensalidade: fromCents(toCents(dto.valorMensalidade)),
      diaVencimento: dto.diaVencimento,
      diaFechamento: dto.diaFechamento ?? 25,
      gera13o: dto.gera13o ?? true,
      mes13o: dto.mes13o ?? 12,
      ativo: dto.ativo ?? true,
      observacoes: dto.observacoes?.trim() || null,
      ...(dto.servicos !== undefined && {
        servicosContratados: dto.servicos.map((servico) => ({
          codigo: servico.codigo,
          ...(servico.codigo === 'OUTROS'
            ? { descricao: servico.descricao?.trim() }
            : {}),
          valorMensal: fromCents(toCents(servico.valorMensal)),
        })),
      }),
      ...(dto.dataInicio !== undefined && {
        dataInicio: dto.dataInicio || null,
      }),
      ...(dto.localAssinatura !== undefined && {
        localAssinatura: dto.localAssinatura.trim() || null,
      }),
      ...(dto.dataAssinatura !== undefined && {
        dataAssinatura: dto.dataAssinatura || null,
      }),
      ...(dto.avisoPrevioDias !== undefined && {
        avisoPrevioDias: dto.avisoPrevioDias,
      }),
      ...(dto.condicoesContratuais !== undefined && {
        condicoesContratuais: dto.condicoesContratuais.trim() || null,
      }),
      atualizadoPor: userId,
    };

    try {
      const contratoId = await this.database.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`financeiro_contrato:${clienteId}`}))`,
        );
        const [atual] = await tx
          .select()
          .from(financeiroContratos)
          .where(eq(financeiroContratos.clienteId, clienteId))
          .for('update');
        if (
          atual &&
          dto.versaoEsperada !== undefined &&
          atual.versao !== dto.versaoEsperada
        )
          throw new ConflictException(
            'O contrato foi alterado. Recarregue os dados antes de salvar.',
          );
        if (
          atual?.dataInicio &&
          dto.dataInicio &&
          atual.dataInicio !== dto.dataInicio
        )
          throw new BadRequestException(
            'A data de início do contrato original não pode ser alterada.',
          );
        const anterior = atual ? await capturarEstadoContrato(tx, atual) : null;
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
            .update(financeiroContratosItens)
            .set({ removidoEm: new Date() })
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
              removidoEm: null,
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
        const [salvo] = await tx
          .select()
          .from(financeiroContratos)
          .where(eq(financeiroContratos.id, contrato.id));
        if (
          salvo.servicosContratados.length &&
          salvo.servicosContratados.reduce(
            (total, s) => total + toCents(s.valorMensal),
            0,
          ) !== toCents(salvo.valorMensalidade)
        )
          throw new ConflictException(
            'Os serviços e a mensalidade não correspondem. Recarregue o contrato antes de salvar.',
          );
        if (
          anterior &&
          atual &&
          (percentualAnual !== undefined || contratoFormalizado(anterior))
        ) {
          const posterior = await capturarEstadoContrato(tx, salvo);
          if (percentualAnual !== undefined && !contratoFormalizado(posterior))
            throw new BadRequestException(
              'Complete o instrumento contratual e as partes antes de gerar o reajuste anual.',
            );
          const alteracoes = alteracoesDoContrato(anterior, posterior);
          if (alteracoes.length) {
            const hoje = getBahiaDate();
            const competencia =
              dto.competenciaInicioAditivo ?? competenciaDeData(hoje);
            if (
              salvo.dataInicio &&
              competenciaIndex(competencia) <
                competenciaIndex(competenciaDeData(salvo.dataInicio))
            )
              throw new BadRequestException(
                'A vigência do aditivo não pode anteceder o início do contrato.',
              );
            if (
              competenciaIndex(competencia) <
                competenciaIndex(competenciaDeData(hoje)) ||
              (atual.competenciaVigencia &&
                competenciaIndex(competencia) <
                  competenciaIndex(atual.competenciaVigencia))
            )
              throw new BadRequestException(
                'A vigência do aditivo não pode ser anterior à competência atual ou ao último aditivo.',
              );
            const [faturada] = await tx
              .select({ id: financeiroFaturas.id })
              .from(financeiroFaturas)
              .where(
                and(
                  eq(financeiroFaturas.clienteId, clienteId),
                  sql`(substring(${financeiroFaturas.competencia}, 4, 4)::int * 12 + substring(${financeiroFaturas.competencia}, 1, 2)::int) >= ${competenciaIndex(competencia)}`,
                ),
              )
              .limit(1);
            if (faturada)
              throw new ConflictException(
                'Já existe fatura emitida a partir dessa competência. Escolha uma vigência posterior às faturas emitidas.',
              );
            const [mes, ano] = competencia.split('/');
            const dataBase = `${ano}-${mes}-01`;
            if (percentualAnual !== undefined) {
              const minima = proximoReajuste(
                atual.dataUltimoReajuste ?? atual.dataInicio,
              );
              if (!minima || dataBase < minima)
                throw new ConflictException(
                  'Ainda não completou o intervalo anual para reajuste.',
                );
            }
            posterior.contrato.versao = atual.versao + 1;
            posterior.contrato.competenciaVigencia = competencia;
            posterior.contrato.dataUltimoReajuste =
              percentualAnual !== undefined
                ? dataBase
                : atual.dataUltimoReajuste;
            await tx
              .update(financeiroContratos)
              .set({
                versao: posterior.contrato.versao,
                competenciaVigencia: competencia,
                dataUltimoReajuste: posterior.contrato.dataUltimoReajuste,
              })
              .where(eq(financeiroContratos.id, contrato.id));
            await tx.insert(financeiroContratosAditivos).values({
              contratoId: contrato.id,
              numero: atual.versao,
              tipo:
                percentualAnual === undefined ? 'ALTERACAO' : 'REAJUSTE_ANUAL',
              competenciaInicio: competencia,
              motivo:
                dto.motivoAditivo?.trim() ||
                'Atualização dos parâmetros contratuais',
              percentual:
                percentualAnual === undefined ? null : String(percentualAnual),
              dataAssinatura: dto.dataAssinaturaAditivo ?? hoje,
              localAssinatura:
                dto.localAssinaturaAditivo?.trim() ||
                salvo.localAssinatura ||
                'Não informado',
              anterior,
              posterior,
              alteracoes,
              criadoPor: userId ?? null,
            });
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
