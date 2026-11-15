import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  eventosAuditoria,
  financeiroBaixas,
  financeiroFaturas,
} from '../../database/schema';
import { AppLogger } from '../../common/logger.service';
import { getBahiaDate } from '../../common/document-status';
import {
  fromCents,
  isValidCivilDate,
  principalAbatidoCents,
  resolverStatusFatura,
  toCents,
} from '../financeiro.utils';
import type { EstornarBaixaDto, RegistrarBaixaDto } from '../dto/baixa.dto';

type Database = DatabaseService['db'];
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class FinanceiroBaixasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Registra uma baixa (total ou parcial). `valorRecebido` é o valor efetivamente
   * recebido, incluindo multa e juros e já líquido do desconto concedido; o
   * principal abatido é recebido − multa − juros + desconto.
   */
  async registrarBaixa(
    faturaId: string,
    dto: RegistrarBaixaDto,
    userId: string,
    requestId?: string,
  ) {
    const hoje = getBahiaDate();
    if (!isValidCivilDate(dto.dataPagamento)) {
      throw new BadRequestException('Data de pagamento inválida.');
    }
    if (dto.dataPagamento > hoje) {
      throw new BadRequestException('A data de pagamento não pode ser futura.');
    }

    const recebido = toCents(dto.valorRecebido);
    const multa = toCents(dto.valorMulta);
    const juros = toCents(dto.valorJuros);
    const desconto = toCents(dto.valorDesconto);
    const principal = recebido - multa - juros + desconto;
    if (principal <= 0) {
      throw new BadRequestException(
        'O valor recebido deve cobrir mais que multa e juros informados.',
      );
    }

    const baixaId = await this.database.db.transaction(async (tx) => {
      const [fatura] = await tx
        .select()
        .from(financeiroFaturas)
        .where(eq(financeiroFaturas.id, faturaId))
        .for('update')
        .limit(1);
      if (!fatura) throw new NotFoundException('Fatura não encontrada.');
      if (fatura.status === 'CANCELADA') {
        throw new BadRequestException('Fatura cancelada não aceita baixa.');
      }
      if (fatura.status === 'PAGA') {
        throw new BadRequestException('Fatura já está paga.');
      }

      const { abatido } = await this.somarBaixasAtivas(tx, faturaId);
      const saldo = toCents(fatura.valorLiquido) - abatido;
      if (principal > saldo) {
        throw new BadRequestException(
          `O valor excede o saldo em aberto da fatura (${fromCents(Math.max(0, saldo))}).`,
        );
      }

      const [baixa] = await tx
        .insert(financeiroBaixas)
        .values({
          faturaId,
          valorRecebido: fromCents(recebido),
          dataPagamento: dto.dataPagamento,
          formaPagamento: dto.formaPagamento,
          valorMulta: fromCents(multa),
          valorJuros: fromCents(juros),
          valorDesconto: fromCents(desconto),
          comprovanteKey: dto.comprovanteKey ?? null,
          comprovanteNome: dto.comprovanteNome ?? null,
          observacao: dto.observacao?.trim() || null,
          registradoPor: userId,
        })
        .returning({ id: financeiroBaixas.id });

      await this.recalcularFatura(tx, fatura, hoje);

      await tx.insert(eventosAuditoria).values({
        atorUserId: userId,
        acao: 'FINANCEIRO_BAIXA_REGISTRADA',
        entidadeTipo: 'FINANCEIRO_FATURA',
        entidadeId: faturaId,
        dados: {
          baixaId: baixa.id,
          numero: fatura.numero,
          valorRecebido: fromCents(recebido),
          formaPagamento: dto.formaPagamento,
        },
      });
      return baixa.id;
    });

    this.logger.info('financeiro_baixa_registrada', {
      requestId,
      userId,
      operation: 'registrar_baixa',
      entityType: 'FINANCEIRO_FATURA',
      entityId: faturaId,
      baixaId,
    });
    return this.obterFatura(faturaId);
  }

  async estornarBaixa(
    baixaId: string,
    dto: EstornarBaixaDto,
    userId: string,
    requestId?: string,
  ) {
    const hoje = getBahiaDate();
    const faturaId = await this.database.db.transaction(async (tx) => {
      const [baixa] = await tx
        .select()
        .from(financeiroBaixas)
        .where(eq(financeiroBaixas.id, baixaId))
        .limit(1);
      if (!baixa) throw new NotFoundException('Baixa não encontrada.');

      // Trava a fatura antes de alterar a baixa para serializar com novos registros.
      const [fatura] = await tx
        .select()
        .from(financeiroFaturas)
        .where(eq(financeiroFaturas.id, baixa.faturaId))
        .for('update')
        .limit(1);
      if (!fatura) throw new NotFoundException('Fatura não encontrada.');

      const motivo = dto.motivo.trim();
      const [estornada] = await tx
        .update(financeiroBaixas)
        .set({
          estornado: true,
          estornadoEm: sql`NOW()`,
          estornadoPor: userId,
          motivoEstorno: motivo,
        })
        .where(
          and(
            eq(financeiroBaixas.id, baixaId),
            eq(financeiroBaixas.estornado, false),
          ),
        )
        .returning({ id: financeiroBaixas.id });
      if (!estornada) {
        throw new BadRequestException('Baixa já estornada.');
      }

      if (fatura.status !== 'CANCELADA') {
        await this.recalcularFatura(tx, fatura, hoje);
      }

      await tx.insert(eventosAuditoria).values({
        atorUserId: userId,
        acao: 'FINANCEIRO_BAIXA_ESTORNADA',
        entidadeTipo: 'FINANCEIRO_FATURA',
        entidadeId: fatura.id,
        dados: {
          baixaId,
          numero: fatura.numero,
          valorRecebido: baixa.valorRecebido,
          motivo,
        },
      });
      return fatura.id;
    });

    this.logger.info('financeiro_baixa_estornada', {
      requestId,
      userId,
      operation: 'estornar_baixa',
      entityType: 'FINANCEIRO_FATURA',
      entityId: faturaId,
      baixaId,
    });
    return this.obterFatura(faturaId);
  }

  private async somarBaixasAtivas(tx: Tx, faturaId: string) {
    const baixas = await tx
      .select({
        valorRecebido: financeiroBaixas.valorRecebido,
        valorMulta: financeiroBaixas.valorMulta,
        valorJuros: financeiroBaixas.valorJuros,
        valorDesconto: financeiroBaixas.valorDesconto,
      })
      .from(financeiroBaixas)
      .where(
        and(
          eq(financeiroBaixas.faturaId, faturaId),
          eq(financeiroBaixas.estornado, false),
        ),
      );
    let recebido = 0;
    let abatido = 0;
    let acrescimos = 0;
    for (const baixa of baixas) {
      recebido += toCents(baixa.valorRecebido);
      abatido += principalAbatidoCents(baixa);
      acrescimos += toCents(baixa.valorMulta) + toCents(baixa.valorJuros);
    }
    return { recebido, abatido, acrescimos };
  }

  /** Recalcula valor pago, acréscimos e status a partir das baixas ativas. */
  private async recalcularFatura(
    tx: Tx,
    fatura: typeof financeiroFaturas.$inferSelect,
    hoje: string,
  ) {
    const { recebido, abatido, acrescimos } = await this.somarBaixasAtivas(
      tx,
      fatura.id,
    );
    const status = resolverStatusFatura({
      abatidoCents: abatido,
      liquidoCents: toCents(fatura.valorLiquido),
      dataVencimento: fatura.dataVencimento,
      hoje,
    });
    await tx
      .update(financeiroFaturas)
      .set({
        valorPago: fromCents(recebido),
        valorAcrescimos: fromCents(acrescimos),
        status,
        atualizadoEm: sql`NOW()`,
      })
      .where(eq(financeiroFaturas.id, fatura.id));
    return status;
  }

  private async obterFatura(faturaId: string) {
    const [fatura] = await this.database.db
      .select()
      .from(financeiroFaturas)
      .where(eq(financeiroFaturas.id, faturaId))
      .limit(1);
    return fatura;
  }
}
