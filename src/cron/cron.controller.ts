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
import { RateLimitService } from '../common/rate-limit.service';

@ApiTags('Cron')
@Controller('cron')
export class CronController {
  constructor(
    private readonly cleanupService: StorageCleanupService,
    private readonly fiscalCron: FiscalCronService,
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
    private readonly rateLimit: RateLimitService,
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
      this.logger.warn('cron_not_configured', { operation: 'storage_cleanup' });
      return {
        code: 'CRON_NOT_CONFIGURED',
        message: 'Rotina não configurada.',
      };
    }

    if (!this.hasValidAuthorization(authHeader, secret)) {
      throw new UnauthorizedException('Não autorizado.');
    }

    const requestId = this.logger.generateRequestId();
    try {
      const summary = await this.cleanupService.processJobs(undefined, {
        requestId,
        trigger: 'cron',
      });
      return { success: true, ...summary };
    } finally {
      try {
        const deleted = await this.rateLimit.cleanupExpired();
        this.logger.info('rate_limit_cleanup_completed', {
          operation: 'rate_limit_cleanup',
          requestId,
          deleted,
        });
      } catch (error) {
        this.logger.error('rate_limit_cleanup_failed', error, {
          operation: 'rate_limit_cleanup',
          requestId,
        });
      }
    }
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
      'Endpoint chamado por cron job externo a cada 24 horas para sincronizar documentos fiscais eletrônicos via Distribuição de DFe. A API respeita o intervalo mínimo da SEFAZ por cliente.',
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
      this.logger.warn('cron_not_configured', { operation: 'fiscal_sync' });
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
