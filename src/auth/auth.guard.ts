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
import { AppLogger } from '../common/logger.service';
import { SessionTokenService } from './session-token.service';

type AuthenticatedRequest = Request & { user?: CurrentUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
    private readonly sessionTokenService: SessionTokenService,
    private readonly logger: AppLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.sessionTokenService.extract(request);

    if (!token) {
      throw new UnauthorizedException('Não autorizado.');
    }

    let user = await this.authService.validateSession(token);
    if (!user) {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    const previewClientId = request.headers?.['x-client-preview-id'];
    if (previewClientId !== undefined) {
      const path = request.path ?? '';
      const isClientRoute = /^\/api\/(cliente|fiscal|guias|rh)(\/|$)/.test(path);
      if (
        typeof previewClientId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previewClientId) ||
        !isClientRoute ||
        (user.role !== 'ADMIN' && user.role !== 'COLABORADOR')
      ) {
        throw new ForbiddenException('Prévia do cliente não autorizada.');
      }

      const previewUser = await this.authService.getClientPreviewUser(previewClientId);
      if (!previewUser) {
        throw new ForbiddenException('Cliente indisponível para prévia.');
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        this.logger.info('client_preview_action', {
          userId: user.id,
          entityType: 'cliente',
          entityId: previewClientId,
          operation: `${request.method} ${path}`,
        });
      }
      user = { ...previewUser, impersonatedBy: user.id };
    }

    // Check roles if specified
    const requiredRoles = this.reflector.getAllAndOverride<
      UserRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (requiredRoles && requiredRoles.length > 0) {
      if (!requiredRoles.includes(user.role)) {
        throw new ForbiddenException('Sem permissão.');
      }
    }

    request.user = user;
    return true;
  }
}
