import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SessionTokenService } from './session-token.service';
import { verifyBetterAuthSessionCookie } from './session-token';

const SECRET = 'test-secret-with-at-least-thirty-two-characters';
const TOKEN = 'database-session-token';

function signedCookie(token = TOKEN) {
    const signature = createHmac('sha256', SECRET).update(token).digest('base64');
    return `${token}.${signature}`;
}

function request(input: {
    cookies?: Record<string, string>;
    authorization?: string;
}): Request {
    return {
        cookies: input.cookies ?? {},
        headers: { authorization: input.authorization },
    } as Request;
}

describe('verifyBetterAuthSessionCookie', () => {
    it('returns the raw token for a valid Better Auth signature', () => {
        expect(verifyBetterAuthSessionCookie(signedCookie(), SECRET)).toBe(TOKEN);
    });

    it('accepts the URL-encoded cookie emitted in an HTTP header', () => {
        expect(
            verifyBetterAuthSessionCookie(
                encodeURIComponent(signedCookie()),
                SECRET,
            ),
        ).toBe(TOKEN);
    });

    it.each([
        '',
        TOKEN,
        `${TOKEN}.invalid`,
        `${TOKEN}.${createHmac('sha256', 'another-secret').update(TOKEN).digest('base64')}`,
        '%E0%A4%A',
    ])('rejects malformed or invalid cookie value %#', (value) => {
        expect(verifyBetterAuthSessionCookie(value, SECRET)).toBeNull();
    });
});

describe('SessionTokenService', () => {
    const service = new SessionTokenService(
        new ConfigService({ BETTER_AUTH_SECRET: SECRET }),
    );

    it.each([
        'better-auth.session_token',
        '__Secure-better-auth.session_token',
    ])('accepts the signed %s cookie', (cookieName) => {
        expect(
            service.extract(
                request({ cookies: { [cookieName]: signedCookie() } }),
            ),
        ).toBe(TOKEN);
    });

    it('rejects an unsigned browser cookie', () => {
        expect(
            service.extract(
                request({
                    cookies: { 'better-auth.session_token': TOKEN },
                }),
            ),
        ).toBeNull();
    });

    it('accepts a valid secure cookie when the non-secure cookie is invalid', () => {
        expect(
            service.extract(
                request({
                    cookies: {
                        'better-auth.session_token': 'invalid-cookie',
                        '__Secure-better-auth.session_token': signedCookie(),
                    },
                }),
            ),
        ).toBe(TOKEN);
    });

    it('accepts an explicitly raw Bearer session token', () => {
        expect(
            service.extract(request({ authorization: `Bearer ${TOKEN}` })),
        ).toBe(TOKEN);
    });

    it('returns null when no supported credential exists', () => {
        expect(service.extract(request({}))).toBeNull();
    });
});
