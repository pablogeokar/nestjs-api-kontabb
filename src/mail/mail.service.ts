import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../common/logger.service';
import { OBLIGATION_TYPE_LABELS, type ObligationType } from '../common/types';
import { MailLayoutService } from './mail-layout.service';

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
  private readonly emailAssetsBaseUrl: string;

  constructor(
    private configService: ConfigService,
    private logger: AppLogger,
    private layout: MailLayoutService,
  ) {
    this.apiToken = this.configService.get<string>('MAILTRAP_API_TOKEN');
    this.senderEmail =
      this.configService.get<string>('MAILTRAP_SENDER_EMAIL') ||
      'no-reply@demomailtrap.com';
    this.senderName =
      this.configService.get<string>('MAILTRAP_SENDER_NAME') ||
      'Kontabb Notificações';
    this.apiUrl =
      this.configService.get<string>('MAILTRAP_API_URL') ||
      'https://send.api.mailtrap.io/api/send';
    this.portalUrl = this.configService.getOrThrow<string>('APP_URL');
    this.emailAssetsBaseUrl =
      this.configService.get<string>('EMAIL_ASSETS_BASE_URL')?.trim() ||
      this.portalUrl;
  }

  async sendDocumentNotificationEmail(
    params: SendEmailParams,
  ): Promise<boolean> {
    const { to, clientName, documentType, period, dueDate, valor, parcela } =
      params;

    if (!this.apiToken) {
      this.logger.warn('mailtrap_not_configured', {
        operation: 'document_notification',
        result: 'skipped',
      });
      return false;
    }

    const documentLabel =
      OBLIGATION_TYPE_LABELS[documentType as ObligationType] || documentType;
    const formattedDueDate = this.formatDueDate(dueDate);
    const recipients = Array.isArray(to)
      ? to.map((email) => ({ email }))
      : [{ email: to }];

    const valorText = valor ? `\nValor: R$ ${valor}` : '';
    const parcelaText = parcela ? `\nParcela: ${parcela}` : '';

    const payload = {
      from: { email: this.senderEmail, name: this.senderName },
      to: recipients,
      subject: `${documentLabel} disponível · Período ${period}`,
      text: `Olá, ${clientName}\n\nUma nova guia de pagamento está disponível na sua área de cliente.\n\nDocumento: ${documentLabel}\nCompetência: ${period}\nVencimento: ${formattedDueDate}${valorText}${parcelaText}\n\nAcesse o portal para baixar: ${this.portalUrl}/cliente\n\nAviso: Nunca enviamos documentos em anexo por e-mail.\n\n—\nKontabb · Contabilidade Borges`,
      html: this.buildDocumentNotificationHtml({
        clientName,
        documentLabel,
        period,
        formattedDueDate,
        valor,
        parcela,
      }),
    };

    return this.sendEmail(payload, 'document_notification');
  }

  /**
   * Send password reset email with a link containing the token.
   */
  async sendPasswordResetEmail(params: {
    to: string;
    resetLink: string;
  }): Promise<boolean> {
    const { to, resetLink } = params;

    if (!this.apiToken) {
      this.logger.warn('mailtrap_not_configured', {
        operation: 'password_reset',
        result: 'skipped',
      });
      return false;
    }

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const bodyContent = `
      <p style="font-size:20px;font-weight:700;color:#0B1F3A;">Redefinição de Senha</p>
      <p style="color:#5F6B7A;line-height:1.6;">Recebemos uma solicitação para redefinir sua senha no Kontabb. Clique no botão abaixo para criar uma nova senha:</p>
      <p style="text-align:center;margin:32px 0;">
        <a href="${esc(resetLink)}" style="display:inline-block;background:#1456A3;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;">Redefinir Senha</a>
      </p>
      <p style="color:#8896A6;font-size:13px;">Este link expira em 1 hora. Se você não solicitou essa alteração, ignore este e-mail.</p>
    `;

    const payload = {
      from: { email: this.senderEmail, name: this.senderName },
      to: [{ email: to }],
      subject: 'Redefinição de Senha — Kontabb',
      text: `Olá,\n\nRecebemos uma solicitação para redefinir sua senha no Kontabb.\n\nClique no link abaixo para criar uma nova senha:\n${resetLink}\n\nEste link expira em 1 hora.\n\nSe você não solicitou essa alteração, ignore este e-mail.\n\n—\nKontabb · Contabilidade Borges`,
      html: this.layout.wrap(bodyContent),
    };

    return this.sendEmail(payload, 'password_reset');
  }

  /**
   * Send notification when a payroll document (folha de pagamento) is uploaded via the RH module.
   */
  async sendFolhaPagamentoNotificationEmail(params: {
    to: string | string[];
    clientName: string;
    competencia: string;
    totalFuncionarios: number;
    totalLiquido: string;
  }): Promise<boolean> {
    const { to, clientName, competencia, totalFuncionarios, totalLiquido } =
      params;

    if (!this.apiToken) {
      this.logger.warn('mailtrap_not_configured', {
        operation: 'folha_pagamento_notification',
        result: 'skipped',
      });
      return false;
    }

    const recipients = Array.isArray(to)
      ? to.map((email) => ({ email }))
      : [{ email: to }];

    if (recipients.length === 0) return false;

    const payload = {
      from: { email: this.senderEmail, name: this.senderName },
      to: recipients,
      subject: `Folha de Pagamento disponível · Competência ${competencia}`,
      text: `Olá, ${clientName}\n\nSua folha de pagamento referente à competência ${competencia} está disponível na área de RH do portal.\n\nResumo:\n• Competência: ${competencia}\n• Total de funcionários: ${totalFuncionarios}\n• Total líquido: R$ ${this.formatCurrency(totalLiquido)}\n\nAcesse o portal para consultar: ${this.portalUrl}/cliente\n\nAviso: Nunca enviamos documentos em anexo por e-mail.\n\n—\nKontabb · Contabilidade Borges`,
      html: this.buildFolhaPagamentoHtml({
        clientName,
        competencia,
        totalFuncionarios,
        totalLiquido,
      }),
    };

    return this.sendEmail(payload, 'folha_pagamento_notification');
  }

  async sendFeriasNotificationEmail(params: {
    to: string | string[];
    clientName: string;
    funcionarioNome: string;
    competencia: string;
    periodoGozo: string;
    totalLiquido: string;
  }): Promise<boolean> {
    const {
      to,
      clientName,
      funcionarioNome,
      competencia,
      periodoGozo,
      totalLiquido,
    } = params;

    if (!this.apiToken) {
      this.logger.warn('mailtrap_not_configured', {
        operation: 'ferias_notification',
        result: 'skipped',
      });
      return false;
    }

    const recipients = Array.isArray(to)
      ? to.map((email) => ({ email }))
      : [{ email: to }];

    if (recipients.length === 0) return false;

    const payload = {
      from: { email: this.senderEmail, name: this.senderName },
      to: recipients,
      subject: `Recibo de Férias disponível · ${funcionarioNome}`,
      text: `Olá, ${clientName}\n\nO recibo de férias do colaborador ${funcionarioNome} referente ao período ${periodoGozo} (${competencia}) está disponível na área de RH do portal.\n\nResumo:\n• Colaborador: ${funcionarioNome}\n• Período de gozo: ${periodoGozo}\n• Total líquido: R$ ${this.formatCurrency(totalLiquido)}\n\nAcesse o portal para consultar e baixar o documento: ${this.portalUrl}/cliente\n\nAviso: Nunca enviamos documentos em anexo por e-mail.\n\n—\nKontabb · Contabilidade Borges`,
      html: this.buildFeriasHtml({
        clientName,
        funcionarioNome,
        competencia,
        periodoGozo,
        totalLiquido,
      }),
    };

    return this.sendEmail(payload, 'ferias_notification');
  }

  async sendWelcomeEmail(params: {
    to: string | string[];
    clientName: string;
    loginIdentifier: string;
    loginEmail?: string;
    provisionalPassword: string;
    panelUrl?: string;
  }): Promise<boolean> {
    const {
      to,
      clientName,
      loginIdentifier,
      loginEmail,
      provisionalPassword,
    } = params;

    if (!this.apiToken) {
      this.logger.warn('mailtrap_not_configured', {
        operation: 'welcome_email',
        result: 'skipped',
      });
      return false;
    }

    const recipients = (Array.isArray(to) ? to : [to])
      .map((email) => email.trim())
      .filter(Boolean)
      .map((email) => ({ email }));
    if (!recipients.length) {
      this.logger.warn('welcome_email_without_recipients', {
        operation: 'welcome_email',
        result: 'skipped',
      });
      return false;
    }

    const panelUrl =
      params.panelUrl ?? `${this.portalUrl.replace(/\/+$/, '')}/cliente`;
    const loginEmailText = loginEmail
      ? `\nE-mail técnico de acesso: ${loginEmail}`
      : '';
    const payload = {
      from: { email: this.senderEmail, name: this.senderName },
      to: recipients,
      subject: 'Bem-vindo(a) à Kontabb · Acesso ao seu painel',
      text: `Olá, ${clientName}\n\nBem-vindo(a) à Kontabb. Seu painel do cliente reúne obrigações, folhas de pagamento e o acompanhamento da sua rotina contábil.\n\nAcesse o painel: ${panelUrl}\nIdentificador de login: ${loginIdentifier}${loginEmailText}\nSenha provisória: ${provisionalPassword}\n\nNo primeiro acesso, será obrigatório trocar a senha provisória por uma senha nova e segura.\n\nConte com a nossa equipe sempre que precisar.\n\n—\nKontabb · Contabilidade Borges`,
      html: this.buildWelcomeHtml({
        clientName,
        loginIdentifier,
        loginEmail,
        provisionalPassword,
        panelUrl,
      }),
    };

    return this.sendEmail(payload, 'welcome_email');
  }

  // ──────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────

  private async sendEmail(
    payload: Record<string, unknown>,
    operation: string,
  ): Promise<boolean> {
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
        this.logger.error(
          'mailtrap_request_failed',
          new Error(`MAILTRAP_HTTP_${response.status}`),
          { operation, result: 'failed' },
        );
        return false;
      }

      this.logger.info('mailtrap_request_completed', {
        operation,
        result: 'success',
      });
      return true;
    } catch (error) {
      this.logger.error('mailtrap_request_failed', error, {
        operation,
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

  /**
   * Formats a numeric string as BRL currency: "12345.67" → "12.345,67"
   */
  private formatCurrency(value: string): string {
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return num.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private buildWelcomeHtml(params: {
    clientName: string;
    loginIdentifier: string;
    loginEmail?: string;
    provisionalPassword: string;
    panelUrl: string;
  }): string {
    const {
      clientName,
      loginIdentifier,
      loginEmail,
      provisionalPassword,
      panelUrl,
    } = params;
    const esc = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const loginEmailRow = loginEmail
      ? `<tr>
          <td style="padding:0 0 16px;">
            <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">E-mail técnico</span><br>
            <span style="font-size:15px;font-weight:600;color:#0B1F3A;">${esc(loginEmail)}</span>
          </td>
        </tr>`
      : '';
    const feature = (params: {
      title: string;
      description: string;
      image: string;
      alt: string;
    }) => `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
        <tr>
          <td style="padding:0;">
            <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#0B1F3A;">${params.title}</p>
            <p style="margin:0 0 14px;color:#5F6B7A;line-height:1.6;">${params.description}</p>
            <img
              src="${esc(this.emailAssetUrl(params.image))}"
              alt="${params.alt}"
              width="508"
              style="display:block;max-width:100%;height:auto;border:0;"
            />
          </td>
        </tr>
      </table>`;

    const bodyContent = `
      <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0B1F3A;">Olá, ${esc(clientName)}</p>
      <p style="margin:0;color:#5F6B7A;line-height:1.6;">Seja bem-vindo(a) à Kontabb. No seu painel do cliente, você acompanha obrigações, documentos e informações importantes da sua rotina contábil em um só lugar.</p>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;background:#f5f7fa;border:1px solid #e8ecf2;border-radius:12px;">
        <tr>
          <td style="padding:24px;">
            <p style="margin:0 0 18px;font-size:16px;font-weight:700;color:#0B1F3A;">Como acessar seu painel</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:0 0 16px;">
                  <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Endereço</span><br>
                  <a href="${esc(panelUrl)}" style="font-size:15px;font-weight:600;color:#1456A3;text-decoration:none;">${esc(panelUrl)}</a>
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 16px;">
                  <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Identificador de login</span><br>
                  <span style="font-size:15px;font-weight:600;color:#0B1F3A;">${esc(loginIdentifier)}</span>
                </td>
              </tr>
              ${loginEmailRow}
              <tr>
                <td>
                  <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Senha provisória</span><br>
                  <span style="display:inline-block;margin-top:4px;padding:8px 12px;background:#ffffff;border:1px solid #dce4ee;border-radius:6px;font-size:18px;font-weight:700;color:#0B1F3A;letter-spacing:1px;">${esc(provisionalPassword)}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px;background:#fff7e6;border:1px solid #f2d59c;border-radius:10px;">
        <tr>
          <td style="padding:16px 18px;color:#5F6B7A;line-height:1.6;">
            <strong style="color:#0B1F3A;">Importante no primeiro acesso:</strong> depois de entrar com a senha provisória, o sistema pedirá que você defina uma senha nova e segura. Essa etapa é obrigatória para continuar.
          </td>
        </tr>
      </table>

      <p style="margin:28px 0 0;font-size:18px;font-weight:700;color:#0B1F3A;">Conheça o painel</p>
      ${feature({
        title: 'Acesso à área do cliente',
        description:
          'Entre com seu identificador e senha para acompanhar todas as informações da sua empresa.',
        image: 'login_area_do_cliente.jpg',
        alt: 'Tela de login da área do cliente Kontabb',
      })}
      ${feature({
        title: 'Obrigações',
        description:
          'Consulte as obrigações disponíveis, seus vencimentos e os documentos necessários para cada competência.',
        image: 'painel_do_cliente_obrigacoes.jpg',
        alt: 'Painel de obrigações do cliente Kontabb',
      })}
      ${feature({
        title: 'Folhas de pagamento',
        description:
          'Acesse as folhas de pagamento e os documentos relacionados à sua equipe sempre que precisar.',
        image: 'painel_do_cliente_folhas_de_pagamento.jpg',
        alt: 'Painel de folhas de pagamento do cliente Kontabb',
      })}
      ${feature({
        title: 'Quitação de obrigações',
        description:
          'Informe pagamentos pelo painel para manter o acompanhamento das suas obrigações atualizado.',
        image: 'modal_quitar_pagamento.jpg',
        alt: 'Modal para informar a quitação de uma obrigação no Kontabb',
      })}

      <p style="margin:32px 0;text-align:center;">
        <a href="${esc(panelUrl)}" style="display:inline-block;background:#1456A3;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;">Acessar o painel</a>
      </p>
      <p style="margin:0;color:#5F6B7A;line-height:1.6;">Se precisar de ajuda, conte com a nossa equipe. Estamos à disposição para apoiar você no uso do painel.</p>
    `;

    return this.layout.wrap(bodyContent);
  }

  private emailAssetUrl(fileName: string): string {
    return `${this.emailAssetsBaseUrl.replace(/\/+$/, '')}/email/${fileName}`;
  }

  private buildDocumentNotificationHtml(params: {
    clientName: string;
    documentLabel: string;
    period: string;
    formattedDueDate: string;
    valor?: string | null;
    parcela?: string | null;
  }): string {
    const {
      clientName,
      documentLabel,
      period,
      formattedDueDate,
      valor,
      parcela,
    } = params;
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const valorRow = valor
      ? `<tr><td style="padding:12px 0 0;border-top:1px solid #e8ecf2;">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Valor</span><br>
          <span style="font-size:18px;font-weight:700;color:#0B1F3A;">R$ ${esc(valor)}</span>
          ${parcela ? `&nbsp;&nbsp;<span style="font-size:14px;color:#5F6B7A;">Parcela ${esc(parcela)}</span>` : ''}
        </td></tr>`
      : '';

    const bodyContent = `
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
      <p style="text-align:center;">
        <a href="${esc(this.portalUrl)}/cliente" style="display:inline-block;background:#1456A3;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;">Acessar Portal</a>
      </p>
    `;

    return this.layout.wrap(bodyContent);
  }

  private buildFolhaPagamentoHtml(params: {
    clientName: string;
    competencia: string;
    totalFuncionarios: number;
    totalLiquido: string;
  }): string {
    const { clientName, competencia, totalFuncionarios, totalLiquido } = params;
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const bodyContent = `
      <p style="font-size:20px;font-weight:700;color:#0B1F3A;">Olá, ${esc(clientName)}</p>
      <p style="color:#5F6B7A;line-height:1.6;">Sua folha de pagamento está disponível para consulta na área de RH do portal.</p>
      <table width="100%" style="background:#f5f7fa;border:1px solid #e8ecf2;border-radius:12px;margin:20px 0;"><tr><td style="padding:24px;">
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Folha de Pagamento</span><br>
        <span style="font-size:16px;font-weight:700;color:#0B1F3A;">Competência ${esc(competencia)}</span>
        <table width="100%" style="margin-top:16px;"><tr>
          <td width="50%"><span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Funcionários</span><br><span style="font-size:15px;font-weight:600;color:#0B1F3A;">${totalFuncionarios}</span></td>
          <td width="50%"><span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Total Líquido</span><br><span style="font-size:15px;font-weight:600;color:#0B1F3A;">R$ ${esc(this.formatCurrency(totalLiquido))}</span></td>
        </tr></table>
      </td></tr></table>
      <p style="text-align:center;">
        <a href="${esc(this.portalUrl)}/cliente" style="display:inline-block;background:#1456A3;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;">Acessar Portal</a>
      </p>
    `;

    return this.layout.wrap(bodyContent);
  }

  private buildFeriasHtml(params: {
    clientName: string;
    funcionarioNome: string;
    competencia: string;
    periodoGozo: string;
    totalLiquido: string;
  }): string {
    const {
      clientName,
      funcionarioNome,
      competencia,
      periodoGozo,
      totalLiquido,
    } = params;
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const bodyContent = `
      <p style="font-size:20px;font-weight:700;color:#0B1F3A;">Olá, ${esc(clientName)}</p>
      <p style="color:#5F6B7A;line-height:1.6;">O recibo de férias de <strong>${esc(funcionarioNome)}</strong> está disponível para consulta e download no portal.</p>
      <table width="100%" style="background:#f5f7fa;border:1px solid #e8ecf2;border-radius:12px;margin:20px 0;"><tr><td style="padding:24px;">
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Documento de Férias</span><br>
        <span style="font-size:16px;font-weight:700;color:#0B1F3A;">${esc(funcionarioNome)} · Competência ${esc(competencia)}</span>
        <table width="100%" style="margin-top:16px;"><tr>
          <td width="50%"><span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Período de Gozo</span><br><span style="font-size:15px;font-weight:600;color:#0B1F3A;">${esc(periodoGozo)}</span></td>
          <td width="50%"><span style="font-size:11px;font-weight:600;text-transform:uppercase;color:#8896A6;">Total Líquido</span><br><span style="font-size:15px;font-weight:600;color:#0B1F3A;">R$ ${esc(this.formatCurrency(totalLiquido))}</span></td>
        </tr></table>
      </td></tr></table>
      <p style="text-align:center;">
        <a href="${esc(this.portalUrl)}/cliente" style="display:inline-block;background:#1456A3;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;">Acessar Portal</a>
      </p>
    `;

    return this.layout.wrap(bodyContent);
  }
}
