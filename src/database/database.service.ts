import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';
import * as schema from './schema';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
    public readonly db: ReturnType<typeof drizzle> | ReturnType<typeof drizzlePostgres>;
    private pgClient?: ReturnType<typeof postgres>;

    constructor(private configService: ConfigService) {
        const databaseUrl = this.configService.getOrThrow<string>('DATABASE_URL');
        const isNeon = databaseUrl.includes('neon.tech') || databaseUrl.includes('neon.com');

        if (isNeon) {
            this.db = drizzle(neon(databaseUrl), { schema });
        } else {
            this.pgClient = postgres(databaseUrl);
            this.db = drizzlePostgres(this.pgClient, { schema });
        }
    }

    async onModuleDestroy() {
        if (this.pgClient) {
            await this.pgClient.end();
        }
    }
}
