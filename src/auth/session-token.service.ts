import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { verifyBetterAuthSessionCookie } from './session-token';

const SESSION_COOKIE_NAMES = [
    'better-auth.session_token',
    '__Secure-better-auth.session_token',
] as const;

@Injectable()
export class SessionTokenService {
    private readonly secret: string;

    constructor(configService: ConfigService) {
        this.secret = configService.getOrThrow<string>('BETTER_AUTH_SECRET');
    }

    extract(request: Request): string | null {
        const bearerToken = this.extractBearerToken(request);
        if (bearerToken) return bearerToken;

        const cookies = (request.cookies ?? {}) as Record<string, unknown>;
        for (const cookieName of SESSION_COOKIE_NAMES) {
            const cookieValue = cookies[cookieName];
            if (typeof cookieValue !== 'string' || !cookieValue) continue;

            const token = verifyBetterAuthSessionCookie(
                cookieValue,
                this.secret,
            );
            if (token) return token;
        }

        return null;
    }

    private extractBearerToken(request: Request): string | null {
        const authorization = request.headers.authorization;
        if (!authorization) return null;

        const match = authorization.match(/^Bearer\s+(.+)$/i);
        const token = match?.[1]?.trim();

        // Bearer authentication intentionally accepts the raw database session
        // token. Browser authentication must use a signed Better Auth cookie.
        return token || null;
    }
}
