import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { resultRows } from './db-result';

@Injectable()
export class RateLimitService {
    constructor(private readonly database: DatabaseService) { }

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
                    message:
                        'Muitas tentativas. Aguarde antes de tentar novamente.',
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
    }
}
