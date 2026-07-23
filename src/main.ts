import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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

  // Swagger / OpenAPI documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Kontabb API')
    .setDescription(
      'API do sistema Kontabb — gestão de obrigações fiscais, clientes e documentos contábeis.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'Token' },
      'session-token',
    )
    .addTag('Health', 'Verificação de saúde da API')
    .addTag('Dashboard', 'Dados do painel administrativo')
    .addTag('Clientes (Admin)', 'CRUD de clientes — acesso staff')
    .addTag('Cliente', 'Operações do próprio cliente autenticado')
    .addTag('Documentos', 'Acesso a documentos e confirmação de pagamento')
    .addTag('Documentos (Admin)', 'Gestão administrativa de documentos')
    .addTag('Documentos (Cliente)', 'Listagem de documentos do cliente')
    .addTag('Upload', 'Upload de documentos fiscais — acesso staff')
    .addTag('Usuários', 'CRUD de usuários do sistema — acesso admin')
    .addTag('Storage', 'Operações de limpeza de armazenamento — acesso admin')
    .addTag('Cron', 'Endpoints de rotinas automatizadas')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'method',
    },
  });

  const port = configService.get<string>('PORT') ?? '3001';
  await app.listen(port);
  appLogger.info('api_started', { port: Number(port) });
}

bootstrap().catch((error) => {
  Logger.error('Falha ao iniciar a API.', error, 'Bootstrap');
  process.exitCode = 1;
});
