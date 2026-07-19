import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../common/logger.service';
import { OBLIGATION_TYPE_LABELS, type ObligationType } from '../common/types';

interface SendEmailParams {
    to: string | string[];
    clientName: string;
    documentType: string;
    period: string;
    dueDate?: string | null;
    valor?: string | null;
    parcela?: string | null;
}

@Injectable()
export class MailService {
    private readonly apiToken?: string;
    private readonly senderEmail: string;
    private readonly senderName: string;
    private readonly apiUrl: string;
    private readonly portalUrl: string;

    constructor(
        private configService: ConfigService,
        private logger: AppLogger,
    ) {
        this.apiToken = this.configService.get<string>('MAILTRAP_API_TOKEN');
        this.senderEmail = this.configService.get<string>('MAILTRAP_SENDER_EMAIL') || 'no-reply@demomailtrap.com';
        this.senderName = this.configService.get<string>('MAILTRAP_SENDER_NAME') || 'Kontabb Notificações';
        this.apiUrl = this.configService.get<string>('MAILTRAP_API_URL') || 'https://send.api.mailtrap.io/api/send';
        this.portalUrl = this.configService.getOrThrow<string>('APP_URL');
    }

    async sendDocumentNotificationEmail(params: SendEmailParams): Promise<boolean> {
        const { to, clientName, documentType, period, dueDate, valor, parcela } = params;

        if (!this.apiToken) {
            this.logger.warn('mailtrap_not_configured', {
                operation: 'document_notification',
                result: 'skipped',
            });
            return false;
        }

        const documentLabel = OBLIGATION_TYPE_LABELS[documentType as ObligationType] || documentType;
        const formattedDueDate = this.formatDueDate(dueDate);
        const recipients = Array.isArray(to) ? to.map((email) => ({ email })) : [{ email: to }];

        const valorText = valor ? `\nValor: R$ ${valor}` : '';
        const parcelaText = parcela ? `\nParcela: ${parcela}` : '';

        const payload = {
            from: { email: this.senderEmail, name: this.senderName },
            to: recipients,
            subject: `${documentLabel} disponível · Período ${period}`,
            text: `Olá, ${clientName}\n\nUma nova guia de pagamento está disponível na sua área de cliente.\n\nDocumento: ${documentLabel}\nCompetência: ${period}\nVencimento: ${formattedDueDate}${valorText}${parcelaText}\n\nAcesse o portal para baixar: ${this.portalUrl}/cliente\n\nAviso: Nunca enviamos documentos em anexo por e-mail.\n\n—\nKontabb · Contabilidade Borges`,
            html: this.buildHtml({ clientName, documentLabel, period, formattedDueDate, valor, parcela }),
        };

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiToken}`,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                this.logger.error('mailtrap_request_failed', new Error(`MAILTRAP_HTTP_${response.status}`), {
                    operation: 'document_notification',
                    result: 'failed',
                });
                return false;
            }

            this.logger.info('mailtrap_request_completed', {
                operation: 'document_notification',
                result: 'success',
            });
            return true;
        } catch (error) {
            this.logger.error('mailtrap_request_failed', error, {
                operation: 'document_notification',
                result: 'failed',
            });
            return false;
        }
    }

    private formatDueDate(isoDate?: string | null): string {
        if (!isoDate) return 'Não informado';
        try {
            const [year, month, day] = isoDate.split('-');
            if (!year || !month || !day) return isoDate;
            return `${day}/${month}/${year}`;
        } catch {
            return isoDate;
        }
    }

    private buildHtml(params: {
        clientName: string;
        documentLabel: string;
        period: string;
        formattedDueDate: string;
        valor?: string | null;
        parcela?: string | null;
    }): string {
        const { clientName, documentLabel, period, formattedDueDate, valor, parcela } = params;
        const esc = (s: string) =>
            s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const valorRow = valor
            ? `<tr><td style="padding:12px 0 0;border-top:1px solid #e8ecf2;">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Valor</span><br>
          <span style="font-size:18px;font-weight:700;color:#0B1F3A;">R$ ${esc(valor)}</span>
          ${parcela ? `&nbsp;&nbsp;<span style="font-size:14px;color:#5F6B7A;">Parcela ${esc(parcela)}</span>` : ''}
        </td></tr>`
            : '';

        return `<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
      <table width="100%" style="max-width:580px;">
        <tr><td style="background:#fff;border-radius:16px;border:1px solid #e8ecf2;padding:40px 36px;">
          <p style="font-size:20px;font-weight:700;color:#0B1F3A;">Olá, ${esc(clientName)}</p>
          <p style="color:#5F6B7A;">Uma nova guia de pagamento está disponível.</p>
          <table width="100%" style="background:#f5f7fa;border:1px solid #e8ecf2;border-radius:12px;margin:20px 0;"><tr><td style="padding:24px;">
            <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Documento</span><br>
            <span style="font-size:16px;font-weight:700;color:#0B1F3A;">${esc(documentLabel)}</span>
            <table width="100%" style="margin-top:12px;"><tr>
              <td width="50%"><span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Competência</span><br><span style="font-size:15px;font-weight:600;color:#0B1F3A;">${esc(period)}</span></td>
              <td width="50%"><span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Vencimento</span><br><span style="font-size:15px;font-weight:600;color:#0B1F3A;">${esc(formattedDueDate)}</span></td>
            </tr></table>
            ${valorRow}
          </td></tr></table>
          <p style="text-align:center;"><a href="${esc(this.portalUrl)}/cliente" style="display:inline-block;background:#1456A3;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;">Acessar Portal</a></p>
        </td></tr>
      </table>
      </td></tr></table></body></html>`;
    }
}
