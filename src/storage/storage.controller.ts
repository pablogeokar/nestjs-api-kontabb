import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { StorageCleanupService } from './storage-cleanup.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import type { CurrentUser as CurrentUserType } from '../common/types';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

class ReconcileStorageDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@ApiTags('Storage')
@ApiBearerAuth('session-token')
@Controller('admin/storage')
@UseGuards(AuthGuard)
@AdminOnly()
export class StorageAdminController {
  constructor(
    private readonly storageCleanup: StorageCleanupService,
    private readonly logger: AppLogger,
  ) {}

  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Executar limpeza de storage',
    description:
      'Processa jobs pendentes de limpeza de arquivos órfãos no storage (R2/S3).',
  })
  @ApiResponse({ status: 200, description: 'Resultado da limpeza.' })
  @ApiResponse({ status: 401, description: 'Não autorizado.' })
  @ApiResponse({ status: 403, description: 'Sem permissão (apenas admin).' })
  async cleanup(@CurrentUser() currentUser: CurrentUserType) {
    const requestId = this.logger.generateRequestId();
    const summary = await this.storageCleanup.processJobs(undefined, {
      requestId,
      userId: currentUser.id,
      trigger: 'manual',
    });
    return { success: true, ...summary, requestId };
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Processar fila de limpeza do storage',
    description:
      'Processa até 50 jobs pendentes de limpeza. Não compara objetos do R2 com referências no banco.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Limite de jobs a processar',
        },
      },
    },
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Resultado da limpeza.' })
  async reconcile(
    @Body() body: ReconcileStorageDto,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const requestId = this.logger.generateRequestId();
    const summary = await this.storageCleanup.processJobs(
      undefined,
      {
        requestId,
        userId: currentUser.id,
        trigger: 'manual',
      },
      body?.limit,
    );
    return { success: true, ...summary, requestId };
  }
}
