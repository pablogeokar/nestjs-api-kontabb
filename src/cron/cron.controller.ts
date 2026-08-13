import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { StorageCleanupService } from '../storage/storage-cleanup.service';
import { FiscalCronService } from '../fiscal/services/fiscal-cron.service';
import { AppLogger } from '../common/logger.service';

@ApiTags('Cron')
@Controller('cron')
export class CronController {
  constructor(
    private readonly cleanupService: StorageCleanupService,
    private readonly fiscalCron: FiscalCronService,
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  @Get('storage-cleanup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotina de limpeza de storage (cron)',
    description:
      'Endpoint chamado por cron job externo para executar limpeza de arquivos órfãos. Requer header Authorization com Bearer token (CRON_SECRET).',
  })
  @ApiHeader({
    name: 'authorization',
    required: true,
    description: 'Bearer <CRON_SECRET>',
  })
  @ApiResponse({ status: 200, description: 'Limpeza executada com sucesso.' })
  @ApiResponse({ status: 401, description: 'Token inválido ou ausente.' })
  async runStorageCleanup(@Headers('authorization') authHeader: string) {
    const secret = this.configService.get<string>('CRON_SECRET');
    if (!secret) {
      return {
        code: 'CRON_NOT_CONFIGURED',
        message: 'Rotina não configurada.',
      };
    }

    if (!this.hasValidAuthorization(authHeader, secret)) {
      throw new UnauthorizedException('Não autorizado.');
    }

    const requestId = this.logger.generateRequestId();
    const summary = await this.cleanupService.processJobs(undefined, {
      requestId,
      trigger: 'cron',
    });
    return { success: true, ...summary };
  }

  private hasValidAuthorization(
    authHeader: string | undefined,
    secret: string,
  ): boolean {
    if (!authHeader) return false;
    const received = Buffer.from(authHeader);
    const expected = Buffer.from(`Bearer ${secret}`);
    return (
      received.length === expected.length && timingSafeEqual(received, expected)
    );
  }

  @Get('fiscal-sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sincronização fiscal com SEFAZ (cron)',
    description:
      'Endpoint chamado por cron job externo (a cada 4-6h) para sincronizar documentos fiscais eletrônicos via Distribuição de DFe. Atualiza status de certificados e consulta NSU de todos os clientes ativos.',
  })
  @ApiHeader({
    name: 'authorization',
    required: true,
    description: 'Bearer <CRON_SECRET>',
  })
  @ApiResponse({ status: 200, description: 'Sincronização executada.' })
  @ApiResponse({ status: 401, description: 'Token inválido ou ausente.' })
  async runFiscalSync(@Headers('authorization') authHeader: string) {
    const secret = this.configService.get<string>('CRON_SECRET');
    if (!secret) {
      return {
        code: 'CRON_NOT_CONFIGURED',
        message: 'Rotina não configurada.',
      };
    }

    if (!this.hasValidAuthorization(authHeader, secret)) {
      throw new UnauthorizedException('Não autorizado.');
    }

    this.logger.info('fiscal_cron_triggered', { operation: 'fiscal_sync' });
    const resultado = await this.fiscalCron.executarSincronizacao();
    return resultado;
  }
}
