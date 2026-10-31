import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { appRateLimits } from '../database/schema';
import { resultRows } from './db-result';

const EXPIRED_GRACE_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 1000;

@Injectable()
export class RateLimitService {
  constructor(private readonly database: DatabaseService) {}

  async cleanupExpired(): Promise<number> {
    // O mesmo armazenamento contém as janelas de consulta da SEFAZ. A margem
    // evita apagar uma reserva ativa ou recém-expirada durante concorrência.
    const cutoff = Date.now() - EXPIRED_GRACE_MS;
    const result = await this.database.db.execute(sql`
      WITH expired AS (
        SELECT ${appRateLimits.key} AS key
        FROM ${appRateLimits}
        WHERE ${appRateLimits.resetAt} < ${cutoff}
        ORDER BY ${appRateLimits.resetAt}
        FOR UPDATE SKIP LOCKED
        LIMIT ${CLEANUP_BATCH_SIZE}
      ), deleted AS (
        DELETE FROM ${appRateLimits} AS limits
        USING expired
        WHERE limits.key = expired.key AND limits.reset_at < ${cutoff}
        RETURNING 1
      )
      SELECT count(*)::int AS deleted FROM deleted
    `);
    return Number(resultRows<{ deleted: number }>(result)[0]?.deleted ?? 0);
  }

  async consume(input: {
    key: string;
    limit: number;
    windowMs: number;
  }): Promise<void> {
    const now = Date.now();
    const resetAt = now + input.windowMs;
    const result = await this.database.db.execute(sql`
            INSERT INTO app_rate_limits (key, count, reset_at)
            VALUES (${input.key}, 1, ${resetAt})
            ON CONFLICT (key) DO UPDATE SET
                count = CASE
                    WHEN app_rate_limits.reset_at <= ${now} THEN 1
                    ELSE app_rate_limits.count + 1
                END,
                reset_at = CASE
                    WHEN app_rate_limits.reset_at <= ${now} THEN ${resetAt}
                    ELSE app_rate_limits.reset_at
                END
            RETURNING count, reset_at
        `);

    const row = resultRows<{ count: number; reset_at: number }>(result)[0];
    if (Number(row?.count ?? 1) > input.limit) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Muitas tentativas. Aguarde antes de tentar novamente.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
