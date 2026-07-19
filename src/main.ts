import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger.service';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { requestIdMiddleware } from './common/request-id';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const appLogger = app.get(AppLogger);

  const configuredAppUrl = configService.getOrThrow<string>('APP_URL');
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'https://www.kontabb.com.br',
      'https://kontabb.com.br',
      configuredAppUrl,
    ],
    credentials: true,
  });

  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(appLogger));

  app.setGlobalPrefix('api');

  const port = configService.get<string>('PORT') ?? '3001';
  await app.listen(port);
  appLogger.info('api_started', { port: Number(port) });
}

bootstrap().catch((error) => {
  Logger.error('Falha ao iniciar a API.', error, 'Bootstrap');
  process.exitCode = 1;
});
