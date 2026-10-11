import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ColaboradorService } from './colaborador.service';
import {
  ColaboradorSessionService,
  type ColaboradorTokenPayload,
} from './colaborador-session.service';
import { COLABORADOR_PUBLIC_KEY } from './colaborador-public.decorator';

type ColaboradorRequest = Request & { colaborador?: ColaboradorTokenPayload };

/**
 * Authenticates colaborador portal requests declaratively.
 *
 * Routes marked with @ColaboradorPublic() are skipped. Otherwise the signed
 * session token is extracted and, preserving the FEAT-003 tokenVersion
 * revocation check, the request is rejected when the employee no longer exists,
 * is inactive, or the token version diverges from the stored one.
 */
@Injectable()
export class ColaboradorAuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: ColaboradorSessionService,
    private readonly colaboradorService: ColaboradorService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      COLABORADOR_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ColaboradorRequest>();
    const payload = this.sessionService.extractFromRequest(request);
    if (!payload) {
      throw new UnauthorizedException('Não autorizado.');
    }

    const revocation = await this.colaboradorService.getRevocationState(
      payload.funcionarioId,
    );
    if (
      !revocation ||
      !revocation.ativo ||
      revocation.tokenVersion !== payload.tokenVersion
    ) {
      throw new UnauthorizedException('Não autorizado.');
    }

    request.colaborador = payload;
    return true;
  }
}
