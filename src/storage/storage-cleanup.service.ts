import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { storageCleanupJobs } from '../database/schema';
import { StorageService } from './storage.service';
import { AppLogger } from '../common/logger.service';
import { resultRows } from '../common/db-result';

const CLEANUP_BATCH_SIZE = 50;
const CLEANUP_CONCURRENCY = 5;
const PROCESSING_LEASE_MINUTES = 15;

interface ClaimedCleanupJob {
    id: string;
    object_key: string;
    tentativas: number;
}

export interface CleanupSummary {
    processed: number;
    completed: number;
    failed: number;
}

@Injectable()
export class StorageCleanupService {
    constructor(
        private readonly database: DatabaseService,
        private readonly storage: StorageService,
        private readonly logger: AppLogger,
    ) { }

    async processJobs(
        jobIds?: string[],
        context: { requestId?: string; userId?: string; trigger?: string } = {},
    ): Promise<CleanupSummary> {
        if (jobIds && jobIds.length === 0) {
            return { processed: 0, completed: 0, failed: 0 };
        }

        const requestedJobs = jobIds?.length
            ? sql`AND id IN (${sql.join(jobIds.map((id) => sql`${id}::uuid`), sql`, `)})`
            : sql``;

        const claimResult = await this.database.db.execute(sql`
      WITH candidates AS (
        SELECT id
        FROM storage_cleanup_jobs
        WHERE (
          status IN ('PENDENTE', 'FALHOU')
          OR (
            status = 'PROCESSANDO'
            AND atualizado_em <= now() - (${PROCESSING_LEASE_MINUTES} * interval '1 minute')
          )
        )
        ${requestedJobs}
        ORDER BY criado_em
        FOR UPDATE SKIP LOCKED
        LIMIT ${CLEANUP_BATCH_SIZE}
      )
      UPDATE storage_cleanup_jobs AS job
      SET
        status = 'PROCESSANDO',
        tentativas = job.tentativas + 1,
        ultimo_erro = NULL,
        atualizado_em = now(),
        concluido_em = NULL
      FROM candidates
      WHERE job.id = candidates.id
      RETURNING job.id::text, job.object_key, job.tentativas
    `);

        const jobs = resultRows<ClaimedCleanupJob>(claimResult);
        let completed = 0;
        let failed = 0;

        for (let offset = 0; offset < jobs.length; offset += CLEANUP_CONCURRENCY) {
            const batch = jobs.slice(offset, offset + CLEANUP_CONCURRENCY);
            const results = await Promise.all(batch.map((job) => this.processJob(job, context)));
            completed += results.filter((r) => r === 'completed').length;
            failed += results.filter((r) => r === 'failed').length;
        }

        this.logger.info('storage_cleanup_completed', {
            ...context,
            operation: 'storage_cleanup',
            result: failed ? 'partial' : 'success',
            processed: jobs.length,
            completed,
            failed,
        });

        return { processed: jobs.length, completed, failed };
    }

    private async processJob(
        job: ClaimedCleanupJob,
        context: { requestId?: string; userId?: string },
    ): Promise<'completed' | 'failed'> {
        try {
            await this.storage.delete(job.object_key);
            await this.database.db
                .update(storageCleanupJobs)
                .set({
                    status: 'CONCLUIDO',
                    ultimoErro: null,
                    atualizadoEm: new Date(),
                    concluidoEm: new Date(),
                })
                .where(
                    and(
                        eq(storageCleanupJobs.id, job.id),
                        eq(storageCleanupJobs.status, 'PROCESSANDO'),
                        eq(storageCleanupJobs.tentativas, job.tentativas),
                    ),
                );
            return 'completed';
        } catch (error) {
            const errorCode = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
            await this.database.db
                .update(storageCleanupJobs)
                .set({
                    status: 'FALHOU',
                    ultimoErro: errorCode.slice(0, 160),
                    atualizadoEm: new Date(),
                })
                .where(
                    and(
                        eq(storageCleanupJobs.id, job.id),
                        eq(storageCleanupJobs.status, 'PROCESSANDO'),
                        eq(storageCleanupJobs.tentativas, job.tentativas),
                    ),
                );
            this.logger.error('storage_cleanup_job_failed', error, {
                ...context,
                entityType: 'STORAGE_CLEANUP_JOB',
                entityId: job.id,
                operation: 'storage_cleanup',
                result: 'failed',
            });
            return 'failed';
        }
    }
}
