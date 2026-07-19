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
    Patch,
    UseGuards,
    UseInterceptors,
    UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentosService } from './documentos.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import { isAllowedUploadType, hasValidFileSignature, extensionForMime, type AllowedUploadType } from '../common/file-validation';
import type { CurrentUser as CurrentUserType } from '../common/types';

@Controller('documentos')
@UseGuards(AuthGuard)
export class DocumentosController {
    constructor(
        private readonly documentosService: DocumentosService,
        private readonly logger: AppLogger,
    ) { }

    @Get(':id')
    async getSignedUrl(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
        const { document, isStaff, authorized } = await this.documentosService.getAccessibleDocument(id, currentUser);
        if (!document) throw new NotFoundException('Documento não encontrado.');
        if (!authorized) throw new ForbiddenException('Sem permissão.');

        const url = await this.documentosService.getSignedUrl(document.arquivoKey);

        // Record view for client users
        if (!isStaff) {
            this.documentosService.recordDocumentView(id, currentUser.id).catch(() => { });
        }

        return { url };
    }

    @Patch(':id/pagar')
    @HttpCode(HttpStatus.OK)
    @UseInterceptors(FileInterceptor('receipt'))
    async confirmPayment(
        @Param('id') id: string,
        @Body() body: { observation?: string },
        @UploadedFile() receiptFile: Express.Multer.File | undefined,
        @CurrentUser() currentUser: CurrentUserType,
    ) {
        const requestId = this.logger.generateRequestId();

        const { document, authorized } = await this.documentosService.getAccessibleDocument(id, currentUser);
        if (!document) throw new NotFoundException('Documento não encontrado.');
        if (!authorized) throw new ForbiddenException('Sem permissão.');
        if (document.status === 'PAGO') {
            throw new BadRequestException('Este documento já foi marcado como pago.');
        }

        let receiptData: { bytes: Buffer; contentType: string; extension: string } | undefined;
        if (receiptFile && receiptFile.size > 0) {
            if (!isAllowedUploadType(receiptFile.mimetype)) {
                throw new BadRequestException('Comprovante deve ser PDF ou imagem.');
            }
            if (receiptFile.size > 10 * 1024 * 1024) {
                throw new BadRequestException('Comprovante muito grande (máx 10MB).');
            }
            const bytes = receiptFile.buffer;
            if (!hasValidFileSignature(new Uint8Array(bytes), receiptFile.mimetype)) {
                throw new BadRequestException('Conteúdo do comprovante não corresponde ao tipo enviado.');
            }
            receiptData = {
                bytes,
                contentType: receiptFile.mimetype,
                extension: extensionForMime(receiptFile.mimetype as AllowedUploadType),
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
                throw new BadRequestException('Este documento já foi marcado como pago.');
            }
            throw new BadRequestException(
                result.code === 'STORAGE_FAILED' ? 'Falha ao enviar comprovante.' : 'Falha ao registrar o pagamento.',
            );
        }

        return { success: true, message: 'Pagamento registrado com sucesso.' };
    }
}
