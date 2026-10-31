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
import { StaffOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import {
  isAllowedUploadType,
  hasValidFileSignature,
  extensionForMime,
} from '../common/file-validation';
import type { CurrentUser as CurrentUserType } from '../common/types';
import { RateLimitService } from '../common/rate-limit.service';
import { getBahiaDate } from '../common/document-status';
import { isValidPaymentDate } from './payment-date';

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

    // The access record is part of the document-delivery flow. Do not return a
    // usable URL unless the event has been persisted for the client user.
    if (!isStaff) {
      await this.guiasService.recordGuiaView(id, currentUser.id);
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
        paid_at: {
          type: 'string',
          format: 'date',
          description:
            'Data real do pagamento (YYYY-MM-DD); disponível apenas para equipe.',
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
    @Body() body: { observation?: string; paid_at?: string },
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

    if (body.paid_at !== undefined && typeof body.paid_at !== 'string') {
      throw new BadRequestException('Data de pagamento inválida.');
    }
    const paidAtDate = body.paid_at?.trim() || null;
    if (paidAtDate) {
      if (currentUser.role !== 'ADMIN' && currentUser.role !== 'COLABORADOR') {
        throw new ForbiddenException(
          'Data retroativa disponível apenas para equipe.',
        );
      }
      if (!isValidPaymentDate(paidAtDate, getBahiaDate())) {
        throw new BadRequestException('Data de pagamento inválida ou futura.');
      }
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
      paidAtDate,
      receipt: receiptData,
    });

    if (!result.ok) {
      if (result.code === 'ALREADY_PAID') {
        throw new BadRequestException('Esta guia já foi marcada como paga.');
      }
      if (result.code === 'FISCAL_ALREADY_SETTLED') {
        throw new BadRequestException(
          'A obrigação fiscal vinculada já está quitada. Revise a conciliação antes de confirmar esta guia.',
        );
      }
      throw new BadRequestException(
        result.code === 'STORAGE_FAILED'
          ? 'Falha ao enviar comprovante.'
          : 'Falha ao registrar o pagamento.',
      );
    }

    return { success: true, message: 'Pagamento registrado com sucesso.' };
  }

  @Patch(':id/comprovante')
  @HttpCode(HttpStatus.OK)
  @StaffOnly()
  @UseInterceptors(FileInterceptor('receipt'))
  @ApiOperation({
    summary: 'Anexar comprovante a guia já paga',
    description:
      'Aceita um PDF ou imagem de até 10 MB somente se a guia já estiver paga e ainda não tiver comprovante. Preserva a data e o status do pagamento.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['receipt'],
      properties: {
        receipt: { type: 'string', format: 'binary' },
        observation: { type: 'string' },
      },
    },
  })
  async attachReceiptToPaidGuia(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { observation?: string },
    @UploadedFile() receiptFile: Express.Multer.File | undefined,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    await this.consumeRateLimit('payment', currentUser, 10);
    const { guia, authorized } = await this.guiasService.getAccessibleGuia(
      id,
      currentUser,
    );
    if (!guia) throw new NotFoundException('Guia não encontrada.');
    if (!authorized) throw new ForbiddenException('Sem permissão.');
    if (guia.status !== 'PAGO')
      throw new BadRequestException('A guia ainda não está paga.');
    if (guia.comprovanteKey)
      throw new BadRequestException('A guia já possui comprovante.');
    if (!receiptFile || receiptFile.size === 0)
      throw new BadRequestException('Informe o comprovante.');
    if (
      !isAllowedUploadType(receiptFile.mimetype) ||
      receiptFile.size > 10 * 1024 * 1024 ||
      !hasValidFileSignature(
        new Uint8Array(receiptFile.buffer),
        receiptFile.mimetype,
      )
    ) {
      throw new BadRequestException('Comprovante inválido ou maior que 10 MB.');
    }

    const result = await this.guiasService.attachReceiptToPaidGuia({
      requestId: this.logger.generateRequestId(),
      guiaId: id,
      userId: currentUser.id,
      observation: body.observation?.trim() || null,
      receipt: {
        bytes: receiptFile.buffer,
        contentType: receiptFile.mimetype,
        extension: extensionForMime(receiptFile.mimetype),
      },
    });
    if (!result.ok) {
      if (result.code === 'NOT_FOUND')
        throw new NotFoundException('Guia não encontrada.');
      if (result.code === 'NOT_ELIGIBLE')
        throw new BadRequestException(
          'A guia não está mais apta a receber comprovante.',
        );
      throw new BadRequestException(
        result.code === 'STORAGE_FAILED'
          ? 'Falha ao enviar comprovante.'
          : 'Falha ao anexar comprovante.',
      );
    }
    return { success: true, message: 'Comprovante anexado à guia já paga.' };
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
