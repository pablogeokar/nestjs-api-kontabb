import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthGuard } from './auth.guard';
import type { AuthService } from './auth.service';
import type { SessionTokenService } from './session-token.service';
import type { AppLogger } from '../common/logger.service';
import type { CurrentUser, UserRole } from '../common/types';

function executionContext(request: Request): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: jest.fn(),
      getNext: jest.fn(),
    }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;
}

function currentUser(role: UserRole): CurrentUser {
  return {
    id: 'user-id',
    name: 'User',
    email: 'user@example.com',
    role,
  };
}

describe('AuthGuard', () => {
  const validateSession = jest.fn();
  const getClientPreviewUser = jest.fn();
  const extract = jest.fn();
  const getAllAndOverride = jest.fn();
  const info = jest.fn();
  const guard = new AuthGuard(
    { validateSession, getClientPreviewUser } as unknown as AuthService,
    { getAllAndOverride } as unknown as Reflector,
    { extract } as unknown as SessionTokenService,
    { info } as unknown as AppLogger,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getAllAndOverride.mockReturnValue(undefined);
  });

  it('returns 401 when the request has no valid credential', async () => {
    extract.mockReturnValue(null);

    await expect(
      guard.canActivate(executionContext({} as Request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns 401 for a missing or expired database session', async () => {
    extract.mockReturnValue('raw-token');
    validateSession.mockResolvedValue(null);

    await expect(
      guard.canActivate(executionContext({} as Request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each<UserRole>(['ADMIN', 'COLABORADOR', 'CLIENTE'])(
    'accepts authenticated role %s when the route has no role restriction',
    async (role) => {
      const request = {} as Request & { user?: CurrentUser };
      extract.mockReturnValue('raw-token');
      validateSession.mockResolvedValue(currentUser(role));

      await expect(guard.canActivate(executionContext(request))).resolves.toBe(
        true,
      );
      expect(request.user?.role).toBe(role);
    },
  );

  it('returns 403 when a valid session lacks the required role', async () => {
    extract.mockReturnValue('raw-token');
    validateSession.mockResolvedValue(currentUser('CLIENTE'));
    getAllAndOverride.mockReturnValue(['ADMIN', 'COLABORADOR']);

    await expect(
      guard.canActivate(executionContext({} as Request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  const previewId = 'b79d52a5-cc3f-40bb-aae2-40a266c20967';

  it('uses the selected client identity on a client portal route for staff', async () => {
    const request = {
      headers: { 'x-client-preview-id': previewId },
      path: '/api/fiscal/documentos',
      method: 'GET',
    } as unknown as Request & { user?: CurrentUser };
    extract.mockReturnValue('raw-token');
    validateSession.mockResolvedValue(currentUser('ADMIN'));
    getClientPreviewUser.mockResolvedValue({
      ...currentUser('CLIENTE'),
      id: 'client-user-id',
    });

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(
      true,
    );
    expect(getClientPreviewUser).toHaveBeenCalledWith(previewId);
    expect(request.user).toMatchObject({
      id: 'client-user-id',
      role: 'CLIENTE',
      impersonatedBy: 'user-id',
    });
  });

  it('rejects preview headers from clients and on administrative routes', async () => {
    extract.mockReturnValue('raw-token');
    const request = {
      headers: { 'x-client-preview-id': previewId },
      path: '/api/fiscal/documentos',
      method: 'GET',
    } as unknown as Request;
    validateSession.mockResolvedValue(currentUser('CLIENTE'));
    await expect(
      guard.canActivate(executionContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);

    validateSession.mockResolvedValue(currentUser('ADMIN'));
    const adminRequest = {
      ...request,
      path: '/api/admin/clientes',
    } as Request;
    await expect(
      guard.canActivate(executionContext(adminRequest)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getClientPreviewUser).not.toHaveBeenCalled();
  });

  it('logs mutating preview actions with the staff identity', async () => {
    const request = {
      headers: { 'x-client-preview-id': previewId },
      path: '/api/guias/123/pagar',
      method: 'PATCH',
    } as unknown as Request;
    extract.mockReturnValue('raw-token');
    validateSession.mockResolvedValue(currentUser('COLABORADOR'));
    getClientPreviewUser.mockResolvedValue(currentUser('CLIENTE'));

    await guard.canActivate(executionContext(request));
    expect(info).toHaveBeenCalledWith(
      'client_preview_action',
      expect.objectContaining({
        userId: 'user-id',
        entityId: previewId,
        operation: 'PATCH /api/guias/123/pagar',
      }),
    );
  });
});
