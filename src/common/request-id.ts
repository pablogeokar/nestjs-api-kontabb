import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;

export type RequestWithId = Request & { requestId?: string };

export function requestIdMiddleware(
    request: RequestWithId,
    response: Response,
    next: NextFunction,
) {
    const incomingRequestId =
        request.header('x-request-id') ?? request.header('x-vercel-id');
    const requestId =
        incomingRequestId && REQUEST_ID_PATTERN.test(incomingRequestId)
            ? incomingRequestId
            : randomUUID();

    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
}

export function getRequestId(request: RequestWithId): string {
    return request.requestId ?? randomUUID();
}
