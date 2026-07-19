import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend communication
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'https://www.kontabb.com.br',
      'https://kontabb.com.br',
    ],
    credentials: true,
  });

  // Parse cookies (for better-auth session token)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cookieParser = require('cookie-parser');
  app.use(cookieParser());

  // Global prefix: all routes are under /api
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`🚀 API running on http://localhost:${port}/api`);
}
bootstrap();
