import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { ROLES_KEY } from './roles.decorator';
import type { CurrentUser, UserRole } from '../common/types';
import { SessionTokenService } from './session-token.service';

type AuthenticatedRequest = Request & { user?: CurrentUser };

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(
        private readonly authService: AuthService,
        private readonly reflector: Reflector,
        private readonly sessionTokenService: SessionTokenService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const token = this.sessionTokenService.extract(request);

        if (!token) {
            throw new UnauthorizedException('Não autorizado.');
        }

        const user = await this.authService.validateSession(token);
        if (!user) {
            throw new UnauthorizedException('Sessão inválida ou expirada.');
        }

        // Check roles if specified
        const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (requiredRoles && requiredRoles.length > 0) {
            if (!requiredRoles.includes(user.role)) {
                throw new ForbiddenException('Sem permissão.');
            }
        }

        request.user = user;
        return true;
    }
}
