import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { clientes, funcionariosRh } from '../database/schema';
import { StorageService } from '../storage/storage.service';
import { AppLogger } from '../common/logger.service';
import { hasValidFileSignature } from '../common/file-validation';
import type { ColaboradorTokenPayload } from './colaborador-session.service';

@Injectable()
export class ColaboradorLogoService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly logger: AppLogger,
  ) {}

  async getImagem(actor: ColaboradorTokenPayload) {
    const [row] = await this.database.db
      .select({ logoKey: clientes.logoKey })
      .from(funcionariosRh)
      .innerJoin(clientes, eq(funcionariosRh.clienteId, clientes.id))
      .where(
        and(
          eq(funcionariosRh.id, actor.funcionarioId),
          eq(funcionariosRh.clienteId, actor.clienteId),
          eq(funcionariosRh.ativo, true),
          eq(funcionariosRh.primeiroAcesso, false),
          eq(funcionariosRh.tokenVersion, actor.tokenVersion),
        ),
      )
      .limit(1);
    if (!row) throw new UnauthorizedException('Não autorizado.');
    if (!row.logoKey) throw new NotFoundException('Logo não cadastrada.');
    try {
      const bytes = await this.storage.download(row.logoKey);
      const contentType = ['image/jpeg', 'image/png', 'image/webp'].find(
        (type) => hasValidFileSignature(bytes, type),
      );
      if (!contentType) throw new Error('Invalid stored logo');
      return { bytes, contentType };
    } catch (error) {
      this.logger.error('colaborador_logo_read_failed', error, {
        entityId: actor.clienteId,
        operation: 'colaborador_logo_read',
      });
      throw new ServiceUnavailableException(
        'Não foi possível carregar a logo.',
      );
    }
  }
}
