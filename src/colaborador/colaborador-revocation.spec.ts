import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ColaboradorController } from './colaborador.controller';
import type { ColaboradorService } from './colaborador.service';
import type { ColaboradorSessionService } from './colaborador-session.service';
import type { ColaboradorTokenPayload } from './colaborador-session.service';

/**
 * Covers FEAT-003: the controller rejects an authenticated request when the
 * token's version diverges from the stored one, when the employee is inactive,
 * or when the employee no longer exists (getRevocationState returns null).
 */
describe('ColaboradorController revocation (FEAT-003)', () => {
  const basePayload: ColaboradorTokenPayload = {
    funcionarioId: 'func-1',
    clienteId: 'cli-1',
    codigoFuncionario: '001',
    nomeCompleto: 'Fulano',
    cargo: 'Analista',
    cnpj: '00000000000000',
    razaoSocial: 'Empresa LTDA',
    primeiroAcesso: false,
    tokenVersion: 3,
    exp: Date.now() + 60_000,
  };

  function buildController(opts: {
    payload: ColaboradorTokenPayload | null;
    revocation: { ativo: boolean; tokenVersion: number } | null;
  }) {
    const sessionService = {
      extractFromRequest: jest.fn().mockReturnValue(opts.payload),
    } as unknown as ColaboradorSessionService;

    const colaboradorService = {
      getRevocationState: jest.fn().mockResolvedValue(opts.revocation),
      getPerfil: jest.fn().mockResolvedValue({ id: 'func-1' }),
    } as unknown as ColaboradorService;

    const controller = new ColaboradorController(
      colaboradorService,
      sessionService,
      {} as never,
      {} as never,
      {} as never,
    );

    return { controller, colaboradorService };
  }

  const req = {} as Request;

  it('rejects when the token version diverges from the stored version', async () => {
    const { controller } = buildController({
      payload: basePayload,
      revocation: { ativo: true, tokenVersion: 4 },
    });

    await expect(controller.getPerfil(req)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the employee is inactive', async () => {
    const { controller } = buildController({
      payload: basePayload,
      revocation: { ativo: false, tokenVersion: 3 },
    });

    await expect(controller.getPerfil(req)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the employee no longer exists', async () => {
    const { controller } = buildController({
      payload: basePayload,
      revocation: null,
    });

    await expect(controller.getPerfil(req)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows access when version matches and employee is active', async () => {
    const { controller, colaboradorService } = buildController({
      payload: basePayload,
      revocation: { ativo: true, tokenVersion: 3 },
    });

    await expect(controller.getPerfil(req)).resolves.toEqual({ id: 'func-1' });
    expect(colaboradorService.getPerfil).toHaveBeenCalledWith('func-1');
  });

  it('getSession returns null user when the token is revoked', async () => {
    const { controller } = buildController({
      payload: basePayload,
      revocation: { ativo: true, tokenVersion: 99 },
    });

    await expect(controller.getSession(req)).resolves.toEqual({ user: null });
  });
});
