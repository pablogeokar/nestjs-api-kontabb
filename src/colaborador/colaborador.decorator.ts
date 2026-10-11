import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ColaboradorTokenPayload } from './colaborador-session.service';

export const Colaborador = createParamDecorator(
  (data: keyof ColaboradorTokenPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ colaborador?: ColaboradorTokenPayload }>();
    const colaborador = request.colaborador;
    return data ? colaborador?.[data] : colaborador;
  },
);
