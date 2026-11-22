import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  clientes,
  eventosAuditoria,
  funcionariosRh,
  storageCleanupJobs,
} from '../database/schema';
import { StorageService } from '../storage/storage.service';
import { StorageCleanupService } from '../storage/storage-cleanup.service';
import { AppLogger } from '../common/logger.service';
import type { ColaboradorTokenPayload } from './colaborador-session.service';
import { normalizeColaboradorFoto } from './colaborador-foto-image';

type PhotoActor = Pick<
  ColaboradorTokenPayload,
  'funcionarioId' | 'clienteId' | 'tokenVersion'
>;

/** Same-origin authenticated URL: no expiring texture or public bucket/CORS required. */
export function colaboradorFotoUrl(key: string | null): string | null {
  if (!key) return null;
  const version = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return `/api/colaborador/foto/imagem?v=${version}`;
}

@Injectable()
export class ColaboradorFotoService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly cleanup: StorageCleanupService,
    private readonly logger: AppLogger,
  ) {}

  private whereActor(actor: PhotoActor) {
    return and(
      eq(funcionariosRh.id, actor.funcionarioId),
      eq(funcionariosRh.clienteId, actor.clienteId),
      eq(funcionariosRh.ativo, true),
      eq(funcionariosRh.primeiroAcesso, false),
      eq(funcionariosRh.tokenVersion, actor.tokenVersion),
    );
  }

  async getFoto(actor: PhotoActor) {
    const [row] = await this.database.db
      .select({ fotoKey: funcionariosRh.fotoKey })
      .from(funcionariosRh)
      .where(this.whereActor(actor))
      .limit(1);
    if (!row) throw new UnauthorizedException('Não autorizado.');
    return { fotoUrl: colaboradorFotoUrl(row.fotoKey) };
  }

  async getImagem(actor: PhotoActor): Promise<Buffer> {
    const [row] = await this.database.db
      .select({ fotoKey: funcionariosRh.fotoKey })
      .from(funcionariosRh)
      .where(this.whereActor(actor))
      .limit(1);
    if (!row) throw new UnauthorizedException('Não autorizado.');
    if (!row.fotoKey) throw new NotFoundException('Foto não cadastrada.');
    try {
      return await this.storage.download(row.fotoKey);
    } catch (error) {
      this.logger.error('colaborador_foto_read_failed', error, {
        entityId: actor.funcionarioId,
        operation: 'colaborador_foto_read',
      });
      throw new ServiceUnavailableException(
        'Não foi possível carregar a foto.',
      );
    }
  }

  async upload(actor: PhotoActor, file?: Express.Multer.File) {
    const bytes = await normalizeColaboradorFoto(file);
    // Re-check identity before touching R2; re-check again under the write lock.
    await this.getFoto(actor);
    const key = this.storage.funcionarioFotoObjectKey({
      clienteId: actor.clienteId,
      funcionarioId: actor.funcionarioId,
      fotoId: randomUUID(),
    });
    try {
      await this.storage.upload(key, bytes, 'image/webp');
      await this.replace(actor, key);
    } catch (error) {
      await this.compensate(actor, key);
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error('colaborador_foto_upload_failed', error, {
        entityId: actor.funcionarioId,
        operation: 'colaborador_foto_upload',
      });
      throw new ServiceUnavailableException(
        'Não foi possível salvar a foto. Tente novamente.',
      );
    }
    return { fotoUrl: colaboradorFotoUrl(key) };
  }

  async remove(actor: PhotoActor) {
    await this.replace(actor, null);
    return { fotoUrl: null };
  }

  private async replace(actor: PhotoActor, key: string | null) {
    await this.database.db.transaction(async (tx) => {
      // Same parent-first order as deleteClient: serialize with cascade deletion.
      const [client] = await tx
        .select({ id: clientes.id })
        .from(clientes)
        .where(eq(clientes.id, actor.clienteId))
        .for('update');
      if (!client) throw new UnauthorizedException('Não autorizado.');
      const [employee] = await tx
        .select({ fotoKey: funcionariosRh.fotoKey })
        .from(funcionariosRh)
        .where(this.whereActor(actor))
        .for('update');
      if (!employee) throw new UnauthorizedException('Não autorizado.');
      if (employee.fotoKey === key) return;
      await tx
        .update(funcionariosRh)
        .set({ fotoKey: key, atualizadoEm: new Date() })
        .where(this.whereActor(actor));
      if (employee.fotoKey) {
        await tx
          .insert(storageCleanupJobs)
          .values({
            objectKey: employee.fotoKey,
            entidadeTipo: 'FUNCIONARIO_FOTO',
            entidadeId: actor.funcionarioId,
          })
          .onConflictDoNothing();
      }
      // Employee identities are not rows in `user`; never assign their UUID to ator_user_id.
      await tx.insert(eventosAuditoria).values({
        acao: key ? 'FUNCIONARIO_FOTO_ATUALIZADA' : 'FUNCIONARIO_FOTO_REMOVIDA',
        entidadeTipo: 'FUNCIONARIO',
        entidadeId: actor.funcionarioId,
        dados: { atorTipo: 'COLABORADOR', funcionarioId: actor.funcionarioId },
      });
    });
  }

  private async compensate(actor: PhotoActor, key: string) {
    try {
      // An ambiguous COMMIT error must never delete a photo that was attached.
      const [attached] = await this.database.db
        .select({ id: funcionariosRh.id })
        .from(funcionariosRh)
        .where(eq(funcionariosRh.fotoKey, key))
        .limit(1);
      if (attached) return;
      const jobs = await this.database.db
        .insert(storageCleanupJobs)
        .values({
          objectKey: key,
          entidadeTipo: 'FUNCIONARIO_FOTO',
          entidadeId: actor.funcionarioId,
        })
        .onConflictDoNothing()
        .returning({ id: storageCleanupJobs.id });
      await this.cleanup.processJobs(
        jobs.map((job) => job.id),
        {
          trigger: 'colaborador_foto_compensation',
        },
      );
    } catch (error) {
      // Keep the immutable key for operator recovery if the database is unavailable.
      this.logger.error('colaborador_foto_compensation_failed', error, {
        entityId: actor.funcionarioId,
        objectKey: key,
        operation: 'colaborador_foto_compensation',
      });
    }
  }
}
