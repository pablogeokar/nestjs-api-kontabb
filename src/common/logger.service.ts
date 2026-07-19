import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface LogContext {
    requestId?: string;
    userId?: string;
    entityType?: string;
    entityId?: string;
    operation?: string;
    result?: string;
    durationMs?: number;
    [key: string]: string | number | boolean | null | undefined;
}

@Injectable()
export class AppLogger {
    private readonly logger = new Logger('App');

    info(event: string, context: LogContext = {}) {
        this.logger.log(JSON.stringify({ event, ...context }));
    }

    warn(event: string, context: LogContext = {}) {
        this.logger.warn(JSON.stringify({ event, ...context }));
    }

    error(event: string, error: unknown, context: LogContext = {}) {
        const candidate = error as { name?: string; code?: string; cause?: { code?: string } } | null;
        const errorCode =
            candidate?.code ?? candidate?.cause?.code ?? candidate?.name ?? 'UNKNOWN_ERROR';
        this.logger.error(JSON.stringify({ event, ...context, errorCode }));
    }

    generateRequestId(): string {
        return randomUUID();
    }
}
