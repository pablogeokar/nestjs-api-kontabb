import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ColaboradorAuthGuard } from './colaborador-auth.guard';
import type { ColaboradorService } from './colaborador.service';
import type { ColaboradorSessionService } from './colaborador-session.service';
import type { ColaboradorTokenPayload } from './colaborador-session.service';

/**
 * Covers FEAT-003 (now enforced by ColaboradorAuthGuard, not the controller):
 * the guard rejects an authenticated request when the token's version diverges
 * from the stored one, when the employee is inactive, or when the employee no
 * longer exists (getRevocationState returns null). Routes marked
 * @ColaboradorPublic() are allowed through without any auth.
 */
describe('ColaboradorAuthGuard revocation (FEAT-003)', () => {
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

  function buildGuard(opts: {
    payload: ColaboradorTokenPayload | null;
    revocation: { ativo: boolean; tokenVersion: number } | null;
    isPublic?: boolean;
  }) {
    const request = {} as Request & { colaborador?: ColaboradorTokenPayload };

    const sessionService = {
      extractFromRequest: jest.fn().mockReturnValue(opts.payload),
    } as unknown as ColaboradorSessionService;

    const colaboradorService = {
      getRevocationState: jest.fn().mockResolvedValue(opts.revocation),
    } as unknown as ColaboradorService;

    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(opts.isPublic ?? false),
    } as unknown as Reflector;

    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;

    const guard = new ColaboradorAuthGuard(
      sessionService,
      colaboradorService,
      reflector,
    );

    return { guard, context, request, sessionService };
  }

  it('rejects when the token version diverges from the stored version', async () => {
    const { guard, context } = buildGuard({
      payload: basePayload,
      revocation: { ativo: true, tokenVersion: 4 },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the employee is inactive', async () => {
    const { guard, context } = buildGuard({
      payload: basePayload,
      revocation: { ativo: false, tokenVersion: 3 },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the employee no longer exists', async () => {
    const { guard, context } = buildGuard({
      payload: basePayload,
      revocation: null,
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when no token is present', async () => {
    const { guard, context } = buildGuard({
      payload: null,
      revocation: null,
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows access and attaches the payload when version matches and employee is active', async () => {
    const { guard, context, request } = buildGuard({
      payload: basePayload,
      revocation: { ativo: true, tokenVersion: 3 },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.colaborador).toEqual(basePayload);
  });

  it('allows @ColaboradorPublic() routes without any auth', async () => {
    const { guard, context, request, sessionService } = buildGuard({
      payload: null,
      revocation: null,
      isPublic: true,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessionService.extractFromRequest).not.toHaveBeenCalled();
    expect(request.colaborador).toBeUndefined();
  });
});
