import { MailService } from './mail.service';

function makeService(configValues: Record<string, string | undefined>) {
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = configValues[key];
      if (!value) throw new Error(`Missing configuration: ${key}`);
      return value;
    }),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const layout = {
    wrap: jest.fn((body: string) => `<html>${body}</html>`),
  };

  return {
    service: new MailService(
      configService as never,
      logger as never,
      layout as never,
    ),
    logger,
  };
}

describe('MailService - e-mail de boas-vindas', () => {
  it('não lança quando o Mailtrap não está configurado', async () => {
    const { service, logger } = makeService({
      APP_URL: 'https://app.kontabb.example',
    });

    await expect(
      service.sendWelcomeEmail({
        to: 'contato@empresa.example',
        clientName: 'Empresa Exemplo',
        loginIdentifier: '09157533000156',
        provisionalPassword: '123456',
      }),
    ).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('mailtrap_not_configured', {
      operation: 'welcome_email',
      result: 'skipped',
    });
  });

  it('normaliza destinatários e gera o HTML com imagens públicas', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as typeof fetch;
    try {
      const { service } = makeService({
        APP_URL: 'https://app.kontabb.example',
        EMAIL_ASSETS_BASE_URL: 'https://assets.kontabb.example/',
        MAILTRAP_API_TOKEN: 'mailtrap-token',
      });

      await expect(
        service.sendWelcomeEmail({
          to: ['financeiro@empresa.example', '  ', 'contato@empresa.example'],
          clientName: 'Empresa <Exemplo>',
          loginIdentifier: '09157533000156',
          provisionalPassword: 'senha<inicial>',
        }),
      ).resolves.toBe(true);

      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const payload = JSON.parse(String(request.body)) as {
        to: Array<{ email: string }>;
        html: string;
      };
      expect(payload.to).toEqual([
        { email: 'financeiro@empresa.example' },
        { email: 'contato@empresa.example' },
      ]);
      expect(payload.html).toContain('Empresa &lt;Exemplo&gt;');
      expect(payload.html).toContain('senha&lt;inicial&gt;');
      expect(payload.html).toContain(
        'https://assets.kontabb.example/email/login_area_do_cliente.jpg',
      );
      expect(payload.html).toContain(
        'https://assets.kontabb.example/email/painel_do_cliente_obrigacoes.jpg',
      );
      expect(payload.html).toContain(
        'https://assets.kontabb.example/email/painel_do_cliente_folhas_de_pagamento.jpg',
      );
      expect(payload.html).toContain(
        'https://assets.kontabb.example/email/modal_quitar_pagamento.jpg',
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
