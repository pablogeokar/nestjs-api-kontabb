/** API HTTP isolada para Playwright; nunca usa .env ou DATABASE_URL. */
import 'reflect-metadata';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Request, Response } from 'express';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { SimplesBeneficiosController } from '../src/fiscal/controllers/simples-beneficios.controller';
import { SimplesBeneficiosService } from '../src/fiscal/services/simples-beneficios.service';
import { DatabaseService } from '../src/database/database.service';
import { AuthService } from '../src/auth/auth.service';
import { SessionTokenService } from '../src/auth/session-token.service';
import { AppLogger } from '../src/common/logger.service';
import { AuthGuard } from '../src/auth/auth.guard';
import * as schema from '../src/database/schema';

const url = process.env.SIMPLES_BENEFICIOS_TEST_URL;
if (!url) throw new Error('SIMPLES_BENEFICIOS_TEST_URL é obrigatória.');
const parsed = new URL(url);
if (
  !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
  parsed.pathname !== '/kontabb_beneficios_test'
)
  throw new Error(
    'Permitido somente banco local descartável kontabb_beneficios_test.',
  );
const client = postgres(url, { max: 3 });
@Module({
  controllers: [SimplesBeneficiosController],
  providers: [
    SimplesBeneficiosService,
    AuthGuard,
    { provide: DatabaseService, useValue: { db: drizzle(client, { schema }) } },
    {
      provide: SessionTokenService,
      useValue: {
        extract: (request: Request) =>
          request.headers.authorization?.replace(/^Bearer /, ''),
      },
    },
    {
      provide: AuthService,
      useValue: {
        validateSession: (token: string) =>
          Promise.resolve(
            ['ADMIN', 'COLABORADOR', 'CLIENTE'].includes(token)
              ? {
                  id: 'contador-beneficios-test',
                  name: 'Contador Teste',
                  email: 'beneficios@test.invalid',
                  role: token,
                }
              : null,
          ),
      },
    },
    { provide: AppLogger, useValue: { info: () => undefined } },
  ],
})
class TestBeneficiosModule {}
async function main() {
  const app = await NestFactory.create(TestBeneficiosModule, {
    logger: ['error'],
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const web = resolve(process.cwd(), '../web');
  const adapter = app.getHttpAdapter();
  adapter.get('/fixture', (_request: Request, response: Response) => {
    const cssPath = resolve(web, '.next/static/chunks');
    const css = readdirSync(cssPath)
      .filter((name) => name.endsWith('.css'))
      .map((name) => readFileSync(resolve(cssPath, name), 'utf8'))
      .join('\n');
    response
      .type('html')
      .send(
        `<html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`,
      );
  });
  adapter.get('/fixture.js', (_request: Request, response: Response) =>
    response
      .type('application/javascript')
      .send(
        readFileSync(resolve(web, 'tests/.artifacts/beneficios/fixture.js')),
      ),
  );
  await app.listen(4319, '127.0.0.1');
  process.stdout.write('API de teste de benefícios em http://127.0.0.1:4319\n');
  const stop = () => {
    void app
      .close()
      .then(() => client.end())
      .then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
void main();
