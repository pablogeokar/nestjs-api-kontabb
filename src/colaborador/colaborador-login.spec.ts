import { BadRequestException } from '@nestjs/common';
import { ColaboradorController } from './colaborador.controller';

describe('ColaboradorController.login', () => {
  function buildController(cnpj: string) {
    const session = {
      funcionarioId: 'func-1',
      clienteId: 'cliente-1',
      codigoFuncionario: '001',
      nomeCompleto: 'Colaborador',
      cargo: null,
      cnpj,
      razaoSocial: 'Empresa',
      primeiroAcesso: false,
      tokenVersion: 1,
    };
    const authenticate = jest.fn().mockResolvedValue(session);
    const consume = jest.fn().mockResolvedValue(undefined);
    const createToken = jest.fn().mockReturnValue('token');
    const setCookie = jest.fn();
    const controller = new ColaboradorController(
      { authenticate } as never,
      { createToken, setCookie } as never,
      {} as never,
      { consume } as never,
      { info: jest.fn() } as never,
    );
    return { controller, authenticate, consume, setCookie };
  }

  it.each([
    ['12.345.678/0001-99', '12345678000199'],
    ['ab.12c.d34/ef56-78', 'AB12CD34EF5678'],
  ])(
    'autentica CNPJ %s preservando o identificador %s',
    async (input, cnpj) => {
      const { controller, authenticate, consume, setCookie } =
        buildController(cnpj);

      await expect(
        controller.login(
          { cnpj: input, codigoFuncionario: ' 001 ', senha: 'segredo' },
          {} as never,
        ),
      ).resolves.toMatchObject({ user: { cnpj } });
      expect(authenticate).toHaveBeenCalledWith({
        cnpj,
        codigoFuncionario: '001',
        senha: 'segredo',
      });
      expect(consume).toHaveBeenCalledWith({
        key: `colaborador-login:${cnpj}:001`,
        limit: 5,
        windowMs: 60_000,
      });
      expect(setCookie).toHaveBeenCalled();
    },
  );

  it('rejeita letras nas duas posições verificadoras antes de consultar credenciais', async () => {
    const { controller, authenticate, consume } = buildController('');
    await expect(
      controller.login(
        {
          cnpj: 'AB12CD34EF56GH',
          codigoFuncionario: '001',
          senha: 'segredo',
        },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(authenticate).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });
});
