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
  SEFAZ_AMBIENTE: 'HOMOLOGACAO',
  CERTIFICATE_ENCRYPTION_KEY: 'test-certificate-key-32-characters-long',
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
        BETTER_AUTH_SECRET: 'canonical-secret-with-at-least-32-chars',
        JWT_SECRET: 'different-legacy-secret-with-32-characters',
      }),
    ).toThrow('valores diferentes');
  });

  it.each(['HOMOLOGACAO', 'PRODUCAO'])(
    'accepts %s as SEFAZ_AMBIENTE',
    (sefazAmbiente) => {
      const result = validate({
        ...baseConfig,
        BETTER_AUTH_SECRET: 'canonical-secret-with-at-least-32-chars',
        SEFAZ_AMBIENTE: sefazAmbiente,
      });

      expect(result.SEFAZ_AMBIENTE).toBe(sefazAmbiente);
    },
  );

  it.each(['DISTRIBUICAO', 'producao', '', undefined])(
    'rejects invalid SEFAZ_AMBIENTE: %s',
    (sefazAmbiente) => {
      expect(() =>
        validate({
          ...baseConfig,
          BETTER_AUTH_SECRET: 'canonical-secret-with-at-least-32-chars',
          SEFAZ_AMBIENTE: sefazAmbiente,
        }),
      ).toThrow('SEFAZ_AMBIENTE');
    },
  );

  it.each([
    'short-key',
    'invalid certificate key with spaces and 32 chars',
    'chave-inválida-com-caracteres-não-ascii-123456',
    'your-secret-key-at-least-32-characters-long',
    undefined,
  ])('rejects invalid CERTIFICATE_ENCRYPTION_KEY', (encryptionKey) => {
    expect(() =>
      validate({
        ...baseConfig,
        BETTER_AUTH_SECRET: 'canonical-secret-with-at-least-32-chars',
        CERTIFICATE_ENCRYPTION_KEY: encryptionKey,
      }),
    ).toThrow('CERTIFICATE_ENCRYPTION_KEY');
  });

  it('treats SPED_BLOCO_G_LEIAUTE_HOMOLOGADO as optional (Fase 0 default off)', () => {
    const result = validate({
      ...baseConfig,
      BETTER_AUTH_SECRET: 'canonical-secret-with-at-least-32-chars',
    });

    expect(result.SPED_BLOCO_G_LEIAUTE_HOMOLOGADO).toBeUndefined();
  });

  it.each(['true', 'false'])(
    'accepts %s for SPED_BLOCO_G_LEIAUTE_HOMOLOGADO',
    (value) => {
      const result = validate({
        ...baseConfig,
        BETTER_AUTH_SECRET: 'canonical-secret-with-at-least-32-chars',
        SPED_BLOCO_G_LEIAUTE_HOMOLOGADO: value,
      });

      expect(result.SPED_BLOCO_G_LEIAUTE_HOMOLOGADO).toBe(value);
    },
  );

  it.each(['1', '0', 'yes', 'sim', 'TRUE'])(
    'rejects invalid SPED_BLOCO_G_LEIAUTE_HOMOLOGADO: %s',
    (value) => {
      expect(() =>
        validate({
          ...baseConfig,
          BETTER_AUTH_SECRET: 'canonical-secret-with-at-least-32-chars',
          SPED_BLOCO_G_LEIAUTE_HOMOLOGADO: value,
        }),
      ).toThrow('SPED_BLOCO_G_LEIAUTE_HOMOLOGADO');
    },
  );
});
