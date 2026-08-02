import { Injectable } from '@nestjs/common';

/**
 * Serviço responsável pelo layout padronizado dos e-mails da Kontabb.
 *
 * Componentes reutilizáveis:
 * - Header: logo da Kontabb centralizada
 * - Body: card branco com conteúdo dinâmico
 * - Footer: informações da empresa + termo de confidencialidade
 *
 * Uso:
 *   this.layout.wrap(bodyHtml)  → e-mail completo com header + body + footer
 */
@Injectable()
export class MailLayoutService {
  private readonly logoUrl =
    'https://www.kontabb.com.br/imgs/kontabb-logo.png';

  /**
   * Envolve o conteúdo HTML do corpo do e-mail com o layout padrão:
   * header (logo) + card de conteúdo + footer (confidencialidade).
   */
  wrap(bodyContent: string): string {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kontabb</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;">
          ${this.buildHeader()}
          ${this.buildBody(bodyContent)}
          ${this.buildFooter()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Header: logo centralizada com espaçamento inferior.
   */
  private buildHeader(): string {
    return `
          <!-- Header -->
          <tr>
            <td align="center" style="padding:0 0 24px 0;">
              <img
                src="${this.logoUrl}"
                alt="Kontabb"
                width="160"
                style="display:block;max-width:160px;height:auto;border:0;"
              />
            </td>
          </tr>`;
  }

  /**
   * Body: card branco com bordas arredondadas.
   */
  private buildBody(content: string): string {
    return `
          <!-- Body -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;border:1px solid #e8ecf2;padding:40px 36px;">
              ${content}
            </td>
          </tr>`;
  }

  /**
   * Footer: informações da empresa + termo de confidencialidade.
   */
  private buildFooter(): string {
    return `
          <!-- Footer -->
          <tr>
            <td style="padding:24px 36px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-top:16px;">
                    <p style="margin:0;font-size:11px;color:#8896A6;line-height:1.5;max-width:480px;">
                      <strong>Aviso de Confidencialidade:</strong> Esta mensagem e seus anexos são destinados
                      exclusivamente ao destinatário indicado e podem conter informações confidenciais protegidas
                      por sigilo profissional. Se você não é o destinatário pretendido, fica notificado de que
                      qualquer uso, divulgação, reprodução ou ação tomada com base neste e-mail é estritamente
                      proibida. Caso tenha recebido esta mensagem por engano, por favor notifique o remetente
                      imediatamente e exclua a mensagem de seu sistema.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
  }
}
