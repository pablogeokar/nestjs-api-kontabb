import {
    ArgumentsHost,
    Catch,
    HttpException,
    HttpStatus,
    type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppLogger } from './logger.service';
import { getRequestId, type RequestWithId } from './request-id';

type HttpErrorBody = {
    code?: unknown;
    message?: unknown;
};

const STATUS_CODES: Partial<Record<number, string>> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
    [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
    [HttpStatus.BAD_GATEWAY]: 'BAD_GATEWAY',
    [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    constructor(private readonly logger: AppLogger) { }

    catch(exception: unknown, host: ArgumentsHost) {
        const context = host.switchToHttp();
        const request = context.getRequest<RequestWithId>();
        const response = context.getResponse<Response>();
        const requestId = getRequestId(request);

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const body = exception.getResponse();
            const normalized = this.normalizeHttpException(body, status);

            response.status(status).json({
                code: normalized.code,
                message: normalized.message,
                requestId,
            });
            return;
        }

        this.logger.error('unhandled_http_exception', exception, {
            requestId,
            operation: `${request.method} ${request.path}`,
            result: 'error',
        });
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Erro interno do servidor.',
            requestId,
        });
    }

    private normalizeHttpException(
        body: string | object,
        status: number,
    ): { code: string; message: string } {
        if (typeof body === 'string') {
            return {
                code: STATUS_CODES[status] ?? 'HTTP_ERROR',
                message: body,
            };
        }

        const errorBody = body as HttpErrorBody;
        const rawMessage = errorBody.message;
        const message = Array.isArray(rawMessage)
            ? rawMessage.filter((item): item is string => typeof item === 'string').join(' ')
            : typeof rawMessage === 'string'
                ? rawMessage
                : 'Não foi possível concluir a solicitação.';

        return {
            code:
                typeof errorBody.code === 'string'
                    ? errorBody.code
                    : status === 400 && Array.isArray(rawMessage)
                        ? 'VALIDATION_ERROR'
                        : STATUS_CODES[status] ?? 'HTTP_ERROR',
            message,
        };
    }
}
