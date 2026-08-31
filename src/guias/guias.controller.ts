import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GuiasService } from './guias.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import {
  isAllowedUploadType,
  hasValidFileSignature,
  extensionForMime,
} from '../common/file-validation';
import type { CurrentUser as CurrentUserType } from '../common/types';
import { RateLimitService } from '../common/rate-limit.service';

@ApiTags('Guias')
@ApiBearerAuth('session-token')
@Controller('guias')
@UseGuards(AuthGuard)
export class GuiasController {
  constructor(
    private readonly guiasService: GuiasService,
    private readonly logger: AppLogger,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Obter URL assinada da guia',
    description:
      'Gera uma URL assinada temporária para download do arquivo. Registra visualização para clientes.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID da guia',
  })
  @ApiResponse({
    status: 200,
    description: 'URL assinada gerada.',
    schema: { properties: { url: { type: 'string', format: 'uri' } } },
  })
  @ApiResponse({ status: 404, description: 'Guia não encontrada.' })
  @ApiResponse({
    status: 403,
    description: 'Sem permissão para acessar esta guia.',
  })
  @ApiResponse({ status: 429, description: 'Rate limit excedido.' })
  async getSignedUrl(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    await this.consumeRateLimit('guia-url', currentUser, 60);
    const { guia, isStaff, authorized } =
      await this.guiasService.getAccessibleGuia(id, currentUser);
    if (!guia) throw new NotFoundException('Guia não encontrada.');
    if (!authorized) throw new ForbiddenException('Sem permissão.');

    const url = await this.guiasService.getSignedUrl(guia.arquivoKey);

    // Record view for client users
    if (!isStaff) {
      this.guiasService.recordGuiaView(id, currentUser.id).catch(() => {});
    }

    return { url };
  }

  @Get(':id/comprovante')
  @ApiOperation({
    summary: 'Obter URL do comprovante',
    description:
      'Gera URL assinada temporária para download do comprovante de pagamento.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID da guia',
  })
  @ApiResponse({
    status: 200,
    description: 'URL assinada do comprovante.',
    schema: { properties: { url: { type: 'string', format: 'uri' } } },
  })
  @ApiResponse({
    status: 404,
    description: 'Guia ou comprovante não encontrado.',
  })
  @ApiResponse({ status: 403, description: 'Sem permissão.' })
  async getReceiptSignedUrl(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    await this.consumeRateLimit('receipt-url', currentUser, 60);
    const { guia, authorized } = await this.guiasService.getAccessibleGuia(
      id,
      currentUser,
    );
    if (!guia) throw new NotFoundException('Guia não encontrada.');
    if (!authorized) throw new ForbiddenException('Sem permissão.');
    if (!guia.comprovanteKey) {
      throw new NotFoundException('Comprovante não encontrado.');
    }

    const url = await this.guiasService.getSignedUrl(guia.comprovanteKey);
    return { url };
  }

  @Patch(':id/pagar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('receipt'))
  @ApiOperation({
    summary: 'Confirmar pagamento',
    description:
      'Marca a guia como paga. Opcionalmente aceita um comprovante (PDF ou imagem, máx 10MB) e observação.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID da guia',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        observation: {
          type: 'string',
          description: 'Observação sobre o pagamento',
        },
        receipt: {
          type: 'string',
          format: 'binary',
          description: 'Comprovante (PDF ou imagem)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Pagamento registrado com sucesso.',
    schema: {
      properties: { success: { type: 'boolean' }, message: { type: 'string' } },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Guia já paga ou arquivo inválido.',
  })
  @ApiResponse({ status: 404, description: 'Guia não encontrada.' })
  @ApiResponse({ status: 403, description: 'Sem permissão.' })
  @ApiResponse({ status: 429, description: 'Rate limit excedido.' })
  async confirmPayment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { observation?: string },
    @UploadedFile() receiptFile: Express.Multer.File | undefined,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    await this.consumeRateLimit('payment', currentUser, 10);
    const requestId = this.logger.generateRequestId();

    const { guia, authorized } = await this.guiasService.getAccessibleGuia(
      id,
      currentUser,
    );
    if (!guia) throw new NotFoundException('Guia não encontrada.');
    if (!authorized) throw new ForbiddenException('Sem permissão.');
    if (guia.status === 'PAGO') {
      throw new BadRequestException('Esta guia já foi marcada como paga.');
    }

    let receiptData:
      { bytes: Buffer; contentType: string; extension: string } | undefined;
    if (receiptFile && receiptFile.size > 0) {
      if (!isAllowedUploadType(receiptFile.mimetype)) {
        throw new BadRequestException('Comprovante deve ser PDF ou imagem.');
      }
      if (receiptFile.size > 10 * 1024 * 1024) {
        throw new BadRequestException('Comprovante muito grande (máx 10MB).');
      }
      const bytes = receiptFile.buffer;
      if (!hasValidFileSignature(new Uint8Array(bytes), receiptFile.mimetype)) {
        throw new BadRequestException(
          'Conteúdo do comprovante não corresponde ao tipo enviado.',
        );
      }
      receiptData = {
        bytes,
        contentType: receiptFile.mimetype,
        extension: extensionForMime(receiptFile.mimetype),
      };
    }

    const result = await this.guiasService.confirmPayment({
      requestId,
      guiaId: id,
      userId: currentUser.id,
      observation: body.observation?.trim() || null,
      receipt: receiptData,
    });

    if (!result.ok) {
      if (result.code === 'ALREADY_PAID') {
        throw new BadRequestException('Esta guia já foi marcada como paga.');
      }
      throw new BadRequestException(
        result.code === 'STORAGE_FAILED'
          ? 'Falha ao enviar comprovante.'
          : 'Falha ao registrar o pagamento.',
      );
    }

    return { success: true, message: 'Pagamento registrado com sucesso.' };
  }

  private async consumeRateLimit(
    operation: string,
    currentUser: CurrentUserType,
    limit: number,
  ) {
    await this.rateLimit.consume({
      key: `${operation}:${currentUser.id}`,
      limit: currentUser.role === 'ADMIN' ? limit * 2 : limit,
      windowMs: 60_000,
    });
  }
}
