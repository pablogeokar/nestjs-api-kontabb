import { createHmac, timingSafeEqual } from 'crypto';

const BETTER_AUTH_SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

function decodeCookieValue(value: string): string | null {
    try {
        return value.includes('%') ? decodeURIComponent(value) : value;
    } catch {
        return null;
    }
}

/**
 * Validates the signed cookie format emitted by better-call/better-auth 1.6.x.
 * Returns only the raw database session token after the HMAC is verified.
 */
export function verifyBetterAuthSessionCookie(
    cookieValue: string,
    secret: string,
): string | null {
    const decodedValue = decodeCookieValue(cookieValue);
    if (!decodedValue) return null;

    const separatorIndex = decodedValue.lastIndexOf('.');
    if (separatorIndex < 1) return null;

    const token = decodedValue.slice(0, separatorIndex);
    const signature = decodedValue.slice(separatorIndex + 1);
    if (!token || !BETTER_AUTH_SIGNATURE_PATTERN.test(signature)) return null;

    const receivedSignature = Buffer.from(signature, 'base64');
    const expectedSignature = createHmac('sha256', secret).update(token).digest();

    if (
        receivedSignature.length !== expectedSignature.length ||
        !timingSafeEqual(receivedSignature, expectedSignature)
    ) {
        return null;
    }

    return token;
}
