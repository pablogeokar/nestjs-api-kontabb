import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import type { ColaboradorTokenPayload } from './colaborador-session.service';

type ColaboradorRequest = Request & { colaborador?: ColaboradorTokenPayload };

/**
 * Blocks colaborador portal routes until the employee changes the initial
 * password. Must run AFTER ColaboradorAuthGuard so that request.colaborador is
 * already populated.
 */
@Injectable()
export class ColaboradorRequirePasswordChangedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ColaboradorRequest>();
    const payload = request.colaborador;

    if (payload?.primeiroAcesso) {
      throw new UnauthorizedException(
        'É necessário alterar a senha antes de acessar o sistema.',
      );
    }

    return true;
  }
}
