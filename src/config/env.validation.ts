import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum SefazAmbiente {
  Homologacao = 'HOMOLOGACAO',
  Producao = 'PRODUCAO',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  @MinLength(32)
  BETTER_AUTH_SECRET: string;

  @IsString()
  @IsOptional()
  PORT?: string;

  @IsString()
  APP_URL: string;

  @IsString()
  R2_ACCOUNT_ID: string;

  @IsString()
  R2_ACCESS_KEY_ID: string;

  @IsString()
  R2_SECRET_ACCESS_KEY: string;

  @IsString()
  R2_BUCKET_NAME: string;

  @IsEnum(SefazAmbiente, {
    message: 'SEFAZ_AMBIENTE deve ser HOMOLOGACAO ou PRODUCAO',
  })
  SEFAZ_AMBIENTE: SefazAmbiente;

  @IsString()
  @MinLength(32, {
    message: 'CERTIFICATE_ENCRYPTION_KEY deve ter no mínimo 32 caracteres',
  })
  @Matches(/^[\x21-\x7e]+$/, {
    message:
      'CERTIFICATE_ENCRYPTION_KEY deve conter apenas caracteres ASCII visíveis, sem espaços',
  })
  @IsNotIn(['your-secret-key-at-least-32-characters-long'], {
    message: 'CERTIFICATE_ENCRYPTION_KEY não pode usar o valor de exemplo',
  })
  CERTIFICATE_ENCRYPTION_KEY: string;

  @IsString()
  @IsOptional()
  CRON_SECRET?: string;

  // F07: feature flag `sped.blocoG.leiauteHomologado`. Fonte única de verdade
  // consumida por efd-icms-ipi.service.ts.
  //
  // Gate de liberação (Fase 2, tarefa 6.1): o default permanece `false`; só
  // deve ser `true` DEPOIS que ambas as pré-condições fiscais estiverem
  // satisfeitas — fixtures normativas verdes (tarefa 5, concluída) E validação
  // no PVA por UF/perfil (tarefa 6.2, pendente). A liberação é config-driven de
  // propósito (sem hardcode): um humano vira a chave após o aceite do PVA.
  // Enquanto `false`, a geração de arquivos EFD que exijam Bloco G é bloqueada.
  @IsString()
  @IsOptional()
  @IsIn(['true', 'false'], {
    message: 'SPED_BLOCO_G_LEIAUTE_HOMOLOGADO deve ser "true" ou "false"',
  })
  SPED_BLOCO_G_LEIAUTE_HOMOLOGADO?: string;

  @IsString()
  @IsOptional()
  MAILTRAP_API_URL?: string;

  @IsString()
  @IsOptional()
  MAILTRAP_API_TOKEN?: string;

  @IsString()
  @IsOptional()
  MAILTRAP_SENDER_EMAIL?: string;

  @IsString()
  @IsOptional()
  MAILTRAP_SENDER_NAME?: string;

  @IsString()
  @IsOptional()
  EMAIL_ASSETS_BASE_URL?: string;
}

export function validate(config: Record<string, unknown>) {
  const currentSecret = config.BETTER_AUTH_SECRET;
  const legacySecret = config.JWT_SECRET;

  if (
    typeof currentSecret === 'string' &&
    typeof legacySecret === 'string' &&
    currentSecret !== legacySecret
  ) {
    throw new Error(
      'BETTER_AUTH_SECRET e JWT_SECRET estão configurados com valores diferentes.',
    );
  }

  if (config.NODE_ENV === 'production') {
    const cronSecret = config.CRON_SECRET;
    if (typeof cronSecret !== 'string' || cronSecret.length < 32) {
      throw new Error(
        'CRON_SECRET é obrigatório em produção e deve ter no mínimo 32 caracteres.',
      );
    }
  }

  const normalizedConfig: Record<string, unknown> = {
    ...config,
    BETTER_AUTH_SECRET: currentSecret ?? legacySecret,
  };
  delete normalizedConfig.JWT_SECRET;

  const validatedConfig = plainToInstance(
    EnvironmentVariables,
    normalizedConfig,
    {
      enableImplicitConversion: true,
    },
  );
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
