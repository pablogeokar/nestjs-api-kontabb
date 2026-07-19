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
    const extract = jest.fn();
    const getAllAndOverride = jest.fn();
    const guard = new AuthGuard(
        { validateSession } as unknown as AuthService,
        { getAllAndOverride } as unknown as Reflector,
        { extract } as unknown as SessionTokenService,
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

            await expect(
                guard.canActivate(executionContext(request)),
            ).resolves.toBe(true);
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
});
