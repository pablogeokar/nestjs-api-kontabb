import { SetMetadata } from '@nestjs/common';

export const COLABORADOR_PUBLIC_KEY = 'colaborador_public';

/** Marks a colaborador route as publicly reachable (skips ColaboradorAuthGuard). */
export const ColaboradorPublic = () =>
  SetMetadata(COLABORADOR_PUBLIC_KEY, true);
