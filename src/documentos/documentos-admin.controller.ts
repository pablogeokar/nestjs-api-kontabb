import {
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { DocumentosService } from './documentos.service';
import { ClientesService } from '../clientes/clientes.service';
import { AuthGuard } from '../auth/auth.guard';
import { StaffOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import { parsePaginationParams, buildPaginatedResponse } from '../common/pagination';
import type { CurrentUser as CurrentUserType } from '../common/types';

@Controller('admin/documentos')
@UseGuards(AuthGuard)
@StaffOnly()
export class DocumentosAdminController {
    constructor(
        private readonly documentosService: DocumentosService,
        private readonly clientesService: ClientesService,
        private readonly logger: AppLogger,
    ) { }

    @Get()
    async list(
        @Query() query: { page?: string; pageSize?: string; type?: string; status?: string; search?: string },
    ) {
        const pagination = parsePaginationParams(query);
        const result = await this.documentosService.listAdminDocuments({
            type: query.type || '',
            status: query.status || '',
            search: query.search?.trim() || '',
            pagination,
        });
        return buildPaginatedResponse(result.data, result.total, pagination);
    }

    @Delete(':id')
    async delete(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
        const requestId = this.logger.generateRequestId();
        const result = await this.documentosService.deleteDocument({
            requestId,
            documentId: id,
            actorUserId: currentUser.id,
        });
        if (!result.deleted) throw new NotFoundException('Documento não encontrado.');
        return { success: true, message: 'Documento excluído com sucesso.', cleanupPending: result.cleanupPending };
    }

    @Post(':id/notificar')
    @HttpCode(HttpStatus.OK)
    async notify(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
        const requestId = this.logger.generateRequestId();
        const result = await this.documentosService.notifyDocument({
            requestId,
            documentId: id,
            actorUserId: currentUser.id,
        });
        if (result.ok) return { success: true, status: result.status, error: null };
        if (result.code === 'DOCUMENT_NOT_FOUND') throw new NotFoundException('Documento não encontrado.');
        if (result.code === 'CLIENT_WITHOUT_EMAIL') {
            return { code: result.code, error: 'Cliente não possui e-mail cadastrado no sistema.', statusCode: 400 };
        }
        return { code: result.code, error: 'Falha ao enviar a notificação.', statusCode: 502 };
    }

    @Get(':id/visualizacoes')
    async views(@Param('id') id: string) {
        const data = await this.documentosService.listDocumentViews(id);
        return { data, total: data.length };
    }
}

// Separate controller for client-specific document listing under admin
@Controller('admin/clientes/:clientId/documentos')
@UseGuards(AuthGuard)
@StaffOnly()
export class ClientDocumentsAdminController {
    constructor(
        private readonly documentosService: DocumentosService,
        private readonly clientesService: ClientesService,
    ) { }

    @Get()
    async list(
        @Param('clientId') clientId: string,
        @Query() query: { page?: string; pageSize?: string; type?: string; period?: string; periodType?: string },
    ) {
        const client = await this.clientesService.getClientSummary(clientId);
        if (!client) throw new NotFoundException('Cliente não encontrado.');

        const pagination = parsePaginationParams(query);
        const result = await this.documentosService.listClientDocumentsForStaff({
            clientId: client.id,
            type: query.type || '',
            period: query.period || '',
            periodType: query.periodType,
            pagination,
        });
        return buildPaginatedResponse(result.data, result.total, pagination);
    }
}
