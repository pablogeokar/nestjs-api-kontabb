import { CrmService } from './crm.service';

const cliente = {
  clienteId: '11111111-1111-4111-8111-111111111111',
  clientName: 'Empresa Exemplo Ltda.',
  emails: ['contato@empresa.example'],
  tipoPessoa: 'PJ',
  cnpj: '09157533000156',
  cpf: null,
  suspenso: false,
};

function makeService(input: {
  rows: typeof cliente[];
  sent?: boolean;
}) {
  const database = {
    db: {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(input.rows),
          }),
        }),
      }),
    },
  };
  const mailService = {
    sendWelcomeEmail: jest.fn().mockResolvedValue(input.sent ?? true),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  return {
    service: new CrmService(database as never, mailService as never, logger as never),
    mailService,
  };
}

describe('CrmService - e-mail de boas-vindas', () => {
  it('envia o e-mail com os dados do cliente encontrado', async () => {
    const { service, mailService } = makeService({ rows: [cliente] });

    await expect(
      service.enviarEmailBoasVindas({ clienteId: cliente.clienteId }),
    ).resolves.toEqual({ ok: true });
    expect(mailService.sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: cliente.emails,
        clientName: cliente.clientName,
        loginIdentifier: cliente.cnpj,
        loginEmail: `${cliente.cnpj}@kontabb.local`,
        provisionalPassword: '123456',
      }),
    );
  });

  it('retorna CLIENTE_NAO_ENCONTRADO sem tentar enviar', async () => {
    const { service, mailService } = makeService({ rows: [] });

    await expect(
      service.enviarEmailBoasVindas({ clienteId: cliente.clienteId }),
    ).resolves.toEqual({ ok: false, code: 'CLIENTE_NAO_ENCONTRADO' });
    expect(mailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('retorna SEM_EMAIL quando o cliente não tem destinatários', async () => {
    const { service, mailService } = makeService({
      rows: [{ ...cliente, emails: [] }],
    });

    await expect(
      service.enviarEmailBoasVindas({ clienteId: cliente.clienteId }),
    ).resolves.toEqual({ ok: false, code: 'SEM_EMAIL' });
    expect(mailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('retorna ENVIO_FALHOU quando o provedor não entrega o e-mail', async () => {
    const { service } = makeService({ rows: [cliente], sent: false });

    await expect(
      service.enviarEmailBoasVindas({ clienteId: cliente.clienteId }),
    ).resolves.toEqual({ ok: false, code: 'ENVIO_FALHOU' });
  });

  it('não envia para cliente suspenso', async () => {
    const { service, mailService } = makeService({
      rows: [{ ...cliente, suspenso: true }],
    });

    await expect(
      service.enviarEmailBoasVindas({ clienteId: cliente.clienteId }),
    ).resolves.toEqual({ ok: false, code: 'SEM_EMAIL' });
    expect(mailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});
