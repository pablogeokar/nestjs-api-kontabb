import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';

describe('login da extensão', () => {
  const authenticateUser = jest.fn();
  const createSession = jest.fn();
  const consume = jest.fn();
  const info = jest.fn();
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    createSession.mockResolvedValue(undefined);
    consume.mockResolvedValue(undefined);
    controller = new AuthController(
      { authenticateUser, createSession } as never,
      {} as never,
      { getOrThrow: () => 'test-secret', get: () => 'test' } as never,
      { consume } as never,
      { info } as never,
      {} as never,
      {} as never,
    );
  });

  const request = {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'Kontabb extension' },
  } as never;

  it.each(['ADMIN', 'COLABORADOR'])(
    'emite sessão curta e revogável para %s',
    async (role) => {
      authenticateUser.mockResolvedValue({
        id: 'user-1',
        name: 'Operador',
        email: 'operador@kontabb.com.br',
        role,
      });

      const before = Date.now();
      const result = await controller.extensionLogin(
        { email: 'OPERADOR@KONTABB.COM.BR', password: 'senha' },
        request,
      );
      const session = createSession.mock.calls[0][0];

      expect(authenticateUser).toHaveBeenCalledWith(
        'operador@kontabb.com.br',
        'senha',
      );
      expect(result.user.role).toBe(role);
      expect(result.session.token).toBe(session.token);
      expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 60 * 60 * 1000,
      );
      expect(session.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 60 * 60 * 1000,
      );
    },
  );

  it('nega acesso ao perfil CLIENTE sem criar sessão', async () => {
    authenticateUser.mockResolvedValue({
      id: 'client-1',
      name: 'Cliente',
      email: 'cliente@exemplo.com',
      role: 'CLIENTE',
    });
    await expect(
      controller.extensionLogin(
        { email: 'cliente@exemplo.com', password: 'senha' },
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('nega credenciais incorretas sem criar sessão', async () => {
    authenticateUser.mockResolvedValue(null);
    await expect(
      controller.extensionLogin(
        { email: 'operador@exemplo.com', password: 'errada' },
        request,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(createSession).not.toHaveBeenCalled();
  });
});
