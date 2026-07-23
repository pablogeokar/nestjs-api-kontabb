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
import { DocumentosService } from './documentos.service';
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

@ApiTags('Documentos')
@ApiBearerAuth('session-token')
@Controller('documentos')
@UseGuards(AuthGuard)
export class DocumentosController {
  constructor(
    private readonly documentosService: DocumentosService,
    private readonly logger: AppLogger,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Obter URL assinada do documento',
    description:
      'Gera uma URL assinada temporária para download do arquivo. Registra visualização para clientes.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID do documento',
  })
  @ApiResponse({
    status: 200,
    description: 'URL assinada gerada.',
    schema: { properties: { url: { type: 'string', format: 'uri' } } },
  })
  @ApiResponse({ status: 404, description: 'Documento não encontrado.' })
  @ApiResponse({
    status: 403,
    description: 'Sem permissão para acessar este documento.',
  })
  @ApiResponse({ status: 429, description: 'Rate limit excedido.' })
  async getSignedUrl(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    await this.consumeRateLimit('document-url', currentUser, 60);
    const { document, isStaff, authorized } =
      await this.documentosService.getAccessibleDocument(id, currentUser);
    if (!document) throw new NotFoundException('Documento não encontrado.');
    if (!authorized) throw new ForbiddenException('Sem permissão.');

    const url = await this.documentosService.getSignedUrl(document.arquivoKey);

    // Record view for client users
    if (!isStaff) {
      this.documentosService
        .recordDocumentView(id, currentUser.id)
        .catch(() => {});
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
    description: 'ID do documento',
  })
  @ApiResponse({
    status: 200,
    description: 'URL assinada do comprovante.',
    schema: { properties: { url: { type: 'string', format: 'uri' } } },
  })
  @ApiResponse({
    status: 404,
    description: 'Documento ou comprovante não encontrado.',
  })
  @ApiResponse({ status: 403, description: 'Sem permissão.' })
  async getReceiptSignedUrl(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    await this.consumeRateLimit('receipt-url', currentUser, 60);
    const { document, authorized } =
      await this.documentosService.getAccessibleDocument(id, currentUser);
    if (!document) throw new NotFoundException('Documento não encontrado.');
    if (!authorized) throw new ForbiddenException('Sem permissão.');
    if (!document.comprovanteKey) {
      throw new NotFoundException('Comprovante não encontrado.');
    }

    const url = await this.documentosService.getSignedUrl(
      document.comprovanteKey,
    );
    return { url };
  }

  @Patch(':id/pagar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('receipt'))
  @ApiOperation({
    summary: 'Confirmar pagamento',
    description:
      'Marca o documento como pago. Opcionalmente aceita um comprovante (PDF ou imagem, máx 10MB) e observação.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID do documento',
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
    description: 'Documento já pago ou arquivo inválido.',
  })
  @ApiResponse({ status: 404, description: 'Documento não encontrado.' })
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

    const { document, authorized } =
      await this.documentosService.getAccessibleDocument(id, currentUser);
    if (!document) throw new NotFoundException('Documento não encontrado.');
    if (!authorized) throw new ForbiddenException('Sem permissão.');
    if (document.status === 'PAGO') {
      throw new BadRequestException('Este documento já foi marcado como pago.');
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

    const result = await this.documentosService.confirmPayment({
      requestId,
      obligationId: id,
      userId: currentUser.id,
      observation: body.observation?.trim() || null,
      receipt: receiptData,
    });

    if (!result.ok) {
      if (result.code === 'ALREADY_PAID') {
        throw new BadRequestException(
          'Este documento já foi marcado como pago.',
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
