import { plainToInstance } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

export enum Environment {
    Development = 'development',
    Production = 'production',
    Test = 'test',
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

    @IsString()
    @IsOptional()
    CRON_SECRET?: string;

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

    const normalizedConfig: Record<string, unknown> = {
        ...config,
        BETTER_AUTH_SECRET: currentSecret ?? legacySecret,
    };
    delete normalizedConfig.JWT_SECRET;

    const validatedConfig = plainToInstance(EnvironmentVariables, normalizedConfig, {
        enableImplicitConversion: true,
    });
    const errors = validateSync(validatedConfig, { skipMissingProperties: false });

    if (errors.length > 0) {
        throw new Error(errors.toString());
    }
    return validatedConfig;
}
