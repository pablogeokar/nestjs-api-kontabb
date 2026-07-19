import 'reflect-metadata';
import { validate } from './env.validation';

const baseConfig = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:password@localhost:5432/kontabb_test',
    APP_URL: 'http://localhost:3000',
    R2_ACCOUNT_ID: 'account',
    R2_ACCESS_KEY_ID: 'access-key',
    R2_SECRET_ACCESS_KEY: 'secret-key',
    R2_BUCKET_NAME: 'bucket',
};

describe('environment validation', () => {
    it('uses BETTER_AUTH_SECRET as the canonical setting', () => {
        const result = validate({
            ...baseConfig,
            BETTER_AUTH_SECRET: 'canonical-secret-with-at-least-32-chars',
        });

        expect(result.BETTER_AUTH_SECRET).toBe(
            'canonical-secret-with-at-least-32-chars',
        );
    });

    it('supports JWT_SECRET as a deprecated fallback', () => {
        const result = validate({
            ...baseConfig,
            JWT_SECRET: 'legacy-secret-with-at-least-32-characters',
        });

        expect(result.BETTER_AUTH_SECRET).toBe(
            'legacy-secret-with-at-least-32-characters',
        );
    });

    it('rejects conflicting current and legacy secrets', () => {
        expect(() =>
            validate({
                ...baseConfig,
                BETTER_AUTH_SECRET:
                    'canonical-secret-with-at-least-32-chars',
                JWT_SECRET: 'different-legacy-secret-with-32-characters',
            }),
        ).toThrow('valores diferentes');
    });
});
