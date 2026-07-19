import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { ROLES_KEY } from './roles.decorator';
import type { UserRole } from '../common/types';

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(
        private readonly authService: AuthService,
        private readonly reflector: Reflector,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();
        const token = this.extractToken(request);

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
                throw new UnauthorizedException('Sem permissão.');
            }
        }

        // Attach user to request
        (request as any).user = user;
        return true;
    }

    private extractToken(request: Request): string | null {
        // 1. Authorization header: Bearer <token>
        const authHeader = request.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            return authHeader.slice(7);
        }

        // 2. better-auth session cookie
        const cookieToken =
            request.cookies?.['better-auth.session_token'] ??
            request.cookies?.['__Secure-better-auth.session_token'];
        if (cookieToken) {
            return cookieToken;
        }

        return null;
    }
}
