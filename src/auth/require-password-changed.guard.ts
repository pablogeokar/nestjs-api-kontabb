import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ClientesService } from '../clientes/clientes.service';
import type { CurrentUser } from '../common/types';

type AuthenticatedRequest = Request & { user?: CurrentUser };

/**
 * Guard that blocks CLIENTE users who have not yet changed their provisional password.
 * Must be applied AFTER AuthGuard so that request.user is already populated.
 *
 * For non-CLIENTE roles this guard always passes through.
 */
@Injectable()
export class RequirePasswordChangedGuard implements CanActivate {
  constructor(private readonly clientesService: ClientesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    // If no user or not a CLIENTE, allow through
    if (!user || user.role !== 'CLIENTE') {
      return true;
    }

    const isFirstLogin = await this.clientesService.isFirstLogin(user.id);
    if (isFirstLogin) {
      throw new UnauthorizedException(
        'É necessário alterar a senha provisória antes de acessar o sistema.',
      );
    }

    return true;
  }
}
