import {
    Controller,
    Get,
    NotFoundException,
    Query,
    UseGuards,
} from '@nestjs/common';
import { DocumentosService } from './documentos.service';
import { ClientesService } from '../clientes/clientes.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { parsePaginationParams, buildPaginatedResponse } from '../common/pagination';
import type { CurrentUser as CurrentUserType } from '../common/types';

@Controller('cliente/documentos')
@UseGuards(AuthGuard)
export class DocumentosClienteController {
    constructor(
        private readonly documentosService: DocumentosService,
        private readonly clientesService: ClientesService,
    ) { }

    @Get()
    async list(
        @Query() query: { page?: string; pageSize?: string; type?: string; period?: string; periodType?: string },
        @CurrentUser() currentUser: CurrentUserType,
    ) {
        const client = await this.clientesService.getClientForUser(currentUser.id);
        if (!client) throw new NotFoundException('Cliente não encontrado.');

        const pagination = parsePaginationParams(query);
        const result = await this.documentosService.listClientDocuments({
            clientId: client.id,
            userId: currentUser.id,
            type: query.type || '',
            period: query.period || '',
            periodType: query.periodType,
            pagination,
        });
        return buildPaginatedResponse(result.data, result.total, pagination);
    }
}
