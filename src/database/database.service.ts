import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  public readonly db: ReturnType<typeof drizzlePostgres>;
  private readonly pgClient: ReturnType<typeof postgres>;

  constructor(private configService: ConfigService) {
    const databaseUrl = this.configService.getOrThrow<string>('DATABASE_URL');
    this.pgClient = postgres(databaseUrl);
    this.db = drizzlePostgres(this.pgClient, { schema });
  }

  async onModuleDestroy() {
    await this.pgClient.end();
  }
}
