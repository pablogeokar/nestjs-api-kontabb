import { Injectable } from '@nestjs/common';
import { and, asc, eq, lt } from 'drizzle-orm';
import { AppLogger } from '../common/logger.service';
import { getBahiaDate } from '../common/document-status';
import { DatabaseService } from '../database/database.service';
import { clientes, guias } from '../database/schema';
import { MailService } from '../mail/mail.service';

export const CLIENT_PROVISIONAL_PASSWORD = '123456';

type WelcomeEmailFailureCode =
  'CLIENTE_NAO_ENCONTRADO' | 'SEM_EMAIL' | 'ENVIO_FALHOU';

export type WelcomeEmailResult =
  { ok: true } | { ok: false; code: WelcomeEmailFailureCode };

export type OverdueEmailResult =
  | { ok: true; total: number }
  | {
      ok: false;
      code: WelcomeEmailFailureCode | 'SEM_OBRIGACOES_VENCIDAS';
    };

export interface OverdueBatchSummary {
  candidatos: number;
  enviados: number;
  ignorados: number;
  falhas: number;
}

export interface WelcomeEmailClientData {
  clienteId: string;
  clientName: string;
  emails: string[];
  tipoPessoa: string;
  cnpj: string;
  cpf: string | null;
  suspenso: boolean;
  provisionalPassword?: string;
  requestId?: string;
  actorUserId?: string;
}

@Injectable()
export class CrmService {
  constructor(
    private readonly database: DatabaseService,
    private readonly mailService: MailService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Reenvia o e-mail de boas-vindas a partir do identificador do cliente.
   * Usado pelo endpoint administrativo.
   */
  async enviarEmailBoasVindas(input: {
    clienteId: string;
    requestId?: string;
    actorUserId?: string;
    provisionalPassword?: string;
  }): Promise<WelcomeEmailResult> {
    try {
      const rows = await this.database.db
        .select({
          clienteId: clientes.id,
          clientName: clientes.razaoSocial,
          emails: clientes.emails,
          tipoPessoa: clientes.tipoPessoa,
          cnpj: clientes.cnpj,
          cpf: clientes.cpf,
          suspenso: clientes.suspenso,
        })
        .from(clientes)
        .where(eq(clientes.id, input.clienteId))
        .limit(1);
      const cliente = rows[0];

      if (!cliente) {
        this.logger.warn('crm_welcome_email_skipped', {
          requestId: input.requestId,
          userId: input.actorUserId,
          entityType: 'CLIENTE',
          entityId: input.clienteId,
          operation: 'crm_welcome_email',
          result: 'client_not_found',
        });
        return { ok: false, code: 'CLIENTE_NAO_ENCONTRADO' };
      }

      return this.enviarEmailBoasVindasParaDados({
        ...cliente,
        requestId: input.requestId,
        actorUserId: input.actorUserId,
        provisionalPassword: input.provisionalPassword,
      });
    } catch (error) {
      this.logger.error('crm_welcome_email_failed', error, {
        requestId: input.requestId,
        userId: input.actorUserId,
        entityType: 'CLIENTE',
        entityId: input.clienteId,
        operation: 'crm_welcome_email',
        result: 'database_failed',
      });
      return { ok: false, code: 'ENVIO_FALHOU' };
    }
  }

  /**
   * Varre as guias vencidas do cliente (pendentes com vencimento anterior a
   * hoje, mesmo critério do status VENCIDO) e envia o aviso por e-mail.
   */
  async enviarEmailObrigacoesVencidas(input: {
    clienteId: string;
    requestId?: string;
    actorUserId?: string;
  }): Promise<OverdueEmailResult> {
    const logContext = {
      requestId: input.requestId,
      userId: input.actorUserId,
      entityType: 'CLIENTE',
      entityId: input.clienteId,
      operation: 'crm_overdue_obligations_email',
    };

    try {
      const rows = await this.database.db
        .select({
          clientName: clientes.razaoSocial,
          emails: clientes.emails,
          suspenso: clientes.suspenso,
        })
        .from(clientes)
        .where(eq(clientes.id, input.clienteId))
        .limit(1);
      const cliente = rows[0];

      if (!cliente) {
        this.logger.warn('crm_overdue_email_skipped', {
          ...logContext,
          result: 'client_not_found',
        });
        return { ok: false, code: 'CLIENTE_NAO_ENCONTRADO' };
      }

      const emails = cliente.emails.map((e) => e.trim()).filter(Boolean);
      if (!emails.length || cliente.suspenso) {
        this.logger.warn('crm_overdue_email_skipped', {
          ...logContext,
          result: cliente.suspenso ? 'client_suspended' : 'missing_recipient',
        });
        return { ok: false, code: 'SEM_EMAIL' };
      }

      const vencidas = await this.database.db
        .select({
          tipo: guias.tipo,
          periodo: guias.periodo,
          vencimento: guias.vencimento,
          valor: guias.valor,
        })
        .from(guias)
        .where(
          and(
            eq(guias.clienteId, input.clienteId),
            eq(guias.status, 'PENDENTE'),
            lt(guias.vencimento, getBahiaDate()),
          ),
        )
        .orderBy(asc(guias.vencimento));

      if (!vencidas.length) {
        this.logger.info('crm_overdue_email_skipped', {
          ...logContext,
          result: 'no_overdue_obligations',
        });
        return { ok: false, code: 'SEM_OBRIGACOES_VENCIDAS' };
      }

      const sent = await this.mailService.sendOverdueObligationsEmail({
        to: emails,
        clientName: cliente.clientName,
        obligations: vencidas,
      });
      if (!sent) {
        this.logger.warn('crm_overdue_email_failed', {
          ...logContext,
          result: 'delivery_failed',
        });
        return { ok: false, code: 'ENVIO_FALHOU' };
      }

      this.logger.info('crm_overdue_email_completed', {
        ...logContext,
        result: 'success',
      });
      return { ok: true, total: vencidas.length };
    } catch (error) {
      this.logger.error('crm_overdue_email_failed', error, {
        ...logContext,
        result: 'failed',
      });
      return { ok: false, code: 'ENVIO_FALHOU' };
    }
  }

  /**
   * Varredura mensal (cron): envia o aviso de obrigações vencidas a cada
   * cliente ativo que possua guias vencidas. Falhas individuais não
   * interrompem o lote.
   */
  async enviarAvisosMensaisObrigacoesVencidas(input?: {
    requestId?: string;
  }): Promise<OverdueBatchSummary> {
    const rows = await this.database.db
      .selectDistinct({ clienteId: guias.clienteId })
      .from(guias)
      .innerJoin(clientes, eq(clientes.id, guias.clienteId))
      .where(
        and(
          eq(clientes.suspenso, false),
          eq(guias.status, 'PENDENTE'),
          lt(guias.vencimento, getBahiaDate()),
        ),
      );

    const summary: OverdueBatchSummary = {
      candidatos: rows.length,
      enviados: 0,
      ignorados: 0,
      falhas: 0,
    };

    const BATCH_SIZE = 5;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const results = await Promise.all(
        rows.slice(i, i + BATCH_SIZE).map(({ clienteId }) =>
          this.enviarEmailObrigacoesVencidas({
            clienteId,
            requestId: input?.requestId,
          }),
        ),
      );
      for (const result of results) {
        if (result.ok) summary.enviados += 1;
        else if (result.code === 'ENVIO_FALHOU') summary.falhas += 1;
        else summary.ignorados += 1;
      }
    }

    this.logger.info('crm_overdue_monthly_completed', {
      requestId: input?.requestId,
      operation: 'crm_overdue_monthly',
      result: 'success',
      ...summary,
    });
    return summary;
  }

  /**
   * Dispara usando os dados já disponíveis no cadastro, sem nova consulta ao
   * banco. Isso mantém ClientesModule desacoplado da leitura do CRM.
   */
  async enviarEmailBoasVindasParaDados(
    input: WelcomeEmailClientData,
  ): Promise<WelcomeEmailResult> {
    const emails = input.emails.map((email) => email.trim()).filter(Boolean);

    // Nesta v1, cliente suspenso compartilha SEM_EMAIL para não expor um novo
    // contrato de erro; o log diferencia a razão da não entrega.
    if (!emails.length || input.suspenso) {
      this.logger.warn('crm_welcome_email_skipped', {
        requestId: input.requestId,
        userId: input.actorUserId,
        entityType: 'CLIENTE',
        entityId: input.clienteId,
        operation: 'crm_welcome_email',
        result: input.suspenso ? 'client_suspended' : 'missing_recipient',
      });
      return { ok: false, code: 'SEM_EMAIL' };
    }

    const loginIdentifier =
      input.tipoPessoa === 'PF' ? (input.cpf ?? input.cnpj) : input.cnpj;
    const provisionalPassword =
      input.provisionalPassword ?? CLIENT_PROVISIONAL_PASSWORD;

    try {
      const sent = await this.mailService.sendWelcomeEmail({
        to: emails,
        clientName: input.clientName,
        loginIdentifier,
        loginEmail: `${loginIdentifier}@kontabb.local`,
        provisionalPassword,
      });
      if (!sent) {
        this.logger.warn('crm_welcome_email_failed', {
          requestId: input.requestId,
          userId: input.actorUserId,
          entityType: 'CLIENTE',
          entityId: input.clienteId,
          operation: 'crm_welcome_email',
          result: 'delivery_failed',
        });
        return { ok: false, code: 'ENVIO_FALHOU' };
      }
    } catch (error) {
      this.logger.error('crm_welcome_email_failed', error, {
        requestId: input.requestId,
        userId: input.actorUserId,
        entityType: 'CLIENTE',
        entityId: input.clienteId,
        operation: 'crm_welcome_email',
        result: 'delivery_failed',
      });
      return { ok: false, code: 'ENVIO_FALHOU' };
    }

    this.logger.info('crm_welcome_email_completed', {
      requestId: input.requestId,
      userId: input.actorUserId,
      entityType: 'CLIENTE',
      entityId: input.clienteId,
      operation: 'crm_welcome_email',
      result: 'success',
    });
    return { ok: true };
  }
}
