import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @ApiOperation({
    summary: 'Verificar saúde da API',
    description: 'Retorna o status da API e conexão com o banco de dados.',
  })
  @ApiResponse({
    status: 200,
    description: 'Status da API.',
    schema: {
      properties: {
        status: { type: 'string', enum: ['ok', 'error'] },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  async check() {
    try {
      await this.database.db.execute(sql`SELECT 1`);
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'error', timestamp: new Date().toISOString() };
    }
  }
}
