import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
    constructor(private readonly database: DatabaseService) { }

    @Get()
    async check() {
        try {
            await this.database.db.execute(sql`SELECT 1`);
            return { status: 'ok', timestamp: new Date().toISOString() };
        } catch {
            return { status: 'error', timestamp: new Date().toISOString() };
        }
    }
}
