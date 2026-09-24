import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AppLogger } from '../common/logger.service';
import { DatabaseService } from '../database/database.service';
import { clientes } from '../database/schema';
import { MailService } from '../mail/mail.service';

export const CLIENT_PROVISIONAL_PASSWORD = '123456';

type WelcomeEmailFailureCode =
  | 'CLIENTE_NAO_ENCONTRADO'
  | 'SEM_EMAIL'
  | 'ENVIO_FALHOU';

export type WelcomeEmailResult =
  | { ok: true }
  | { ok: false; code: WelcomeEmailFailureCode };

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
   * Dispara usando os dados já disponíveis no cadastro, sem nova consulta ao
   * banco. Isso mantém ClientesModule desacoplado da leitura do CRM.
   */
  async enviarEmailBoasVindasParaDados(
    input: WelcomeEmailClientData,
  ): Promise<WelcomeEmailResult> {
    const emails = input.emails
      .map((email) => email.trim())
      .filter(Boolean);

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
      input.tipoPessoa === 'PF' ? input.cpf ?? input.cnpj : input.cnpj;
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
