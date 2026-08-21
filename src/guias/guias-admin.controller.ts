import {
    BadGatewayException,
    BadRequestException,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiQuery,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { GuiasService } from './guias.service';
import { ClientesService } from '../clientes/clientes.service';
import { AuthGuard } from '../auth/auth.guard';
import { StaffOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import {
    parsePaginationParams,
    buildPaginatedResponse,
} from '../common/pagination';
import type { CurrentUser as CurrentUserType } from '../common/types';
import { RateLimitService } from '../common/rate-limit.service';

@ApiTags('Guias (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/guias')
@UseGuards(AuthGuard)
@StaffOnly()
export class GuiasAdminController {
    constructor(
        private readonly guiasService: GuiasService,
        private readonly clientesService: ClientesService,
        private readonly logger: AppLogger,
        private readonly rateLimit: RateLimitService,
    ) { }

    @Get()
    @ApiOperation({
        summary: 'Listar todas as guias',
        description:
            'Retorna lista paginada de todas as guias com filtros por tipo, status e busca por cliente.',
    })
    @ApiQuery({
        name: 'page',
        required: false,
        type: Number,
        description: 'Número da página',
    })
    @ApiQuery({
        name: 'pageSize',
        required: false,
        type: Number,
        description: 'Itens por página',
    })
    @ApiQuery({
        name: 'type',
        required: false,
        type: String,
        description: 'Filtrar por tipo de obrigação (FGTS, DARF, DAS, etc.)',
    })
    @ApiQuery({
        name: 'status',
        required: false,
        type: String,
        enum: ['PENDENTE', 'VENCIDO', 'PAGO'],
        description: 'Filtrar por status',
    })
    @ApiQuery({
        name: 'search',
        required: false,
        type: String,
        description: 'Busca por razão social, CNPJ ou CPF do cliente',
    })
    @ApiResponse({ status: 200, description: 'Lista paginada de guias.' })
    async list(
        @Query()
        query: {
            page?: string;
            pageSize?: string;
            type?: string;
            status?: string;
            search?: string;
        },
    ) {
        const pagination = parsePaginationParams(query);
        const result = await this.guiasService.listAdminGuias({
            type: query.type || '',
            status: query.status || '',
            search: query.search?.trim() || '',
            pagination,
        });
        return buildPaginatedResponse(result.data, result.total, pagination);
    }

    @Delete(':id')
    @ApiOperation({
        summary: 'Excluir guia',
        description:
            'Remove uma guia e agenda limpeza dos arquivos no storage.',
    })
    @ApiParam({
        name: 'id',
        type: String,
        format: 'uuid',
        description: 'ID da guia',
    })
    @ApiResponse({ status: 200, description: 'Guia excluída.' })
    @ApiResponse({ status: 404, description: 'Guia não encontrada.' })
    async delete(
        @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
        @CurrentUser() currentUser: CurrentUserType,
    ) {
        const requestId = this.logger.generateRequestId();
        const result = await this.guiasService.deleteGuia({
            requestId,
            guiaId: id,
            actorUserId: currentUser.id,
        });
        if (!result.deleted)
            throw new NotFoundException('Guia não encontrada.');
        return {
            success: true,
            message: 'Guia excluída com sucesso.',
            cleanupPending: result.cleanupPending,
        };
    }

    @Post(':id/notificar')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Enviar notificação por e-mail',
        description:
            'Reenvia a notificação de guia por e-mail para o cliente. Limitado a 10 envios/minuto por usuário.',
    })
    @ApiParam({
        name: 'id',
        type: String,
        format: 'uuid',
        description: 'ID da guia',
    })
    @ApiResponse({ status: 200, description: 'Notificação enviada.' })
    @ApiResponse({ status: 400, description: 'Cliente sem e-mail cadastrado.' })
    @ApiResponse({ status: 404, description: 'Guia não encontrada.' })
    @ApiResponse({ status: 429, description: 'Rate limit excedido.' })
    @ApiResponse({ status: 502, description: 'Falha ao enviar notificação.' })
    async notify(
        @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
        @CurrentUser() currentUser: CurrentUserType,
    ) {
        await this.rateLimit.consume({
            key: `guia-notification:${currentUser.id}`,
            limit: 10,
            windowMs: 60_000,
        });
        const requestId = this.logger.generateRequestId();
        const result = await this.guiasService.notifyGuia({
            requestId,
            guiaId: id,
            actorUserId: currentUser.id,
        });
        if (result.ok) return { success: true, status: result.status, error: null };
        if (result.code === 'GUIA_NOT_FOUND')
            throw new NotFoundException('Guia não encontrada.');
        if (result.code === 'CLIENT_WITHOUT_EMAIL') {
            throw new BadRequestException({
                code: result.code,
                message: 'Cliente não possui e-mail cadastrado no sistema.',
            });
        }
        throw new BadGatewayException({
            code: result.code,
            message: 'Falha ao enviar a notificação.',
        });
    }

    @Get(':id/visualizacoes')
    @ApiOperation({
        summary: 'Listar visualizações da guia',
        description: 'Retorna histórico de quem e quando visualizou a guia.',
    })
    @ApiParam({
        name: 'id',
        type: String,
        format: 'uuid',
        description: 'ID da guia',
    })
    @ApiResponse({ status: 200, description: 'Lista de visualizações.' })
    async views(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
        const data = await this.guiasService.listGuiaViews(id);
        return { data, total: data.length };
    }
}

// Separate controller for client-specific guia listing under admin
@ApiTags('Guias (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/clientes/:clientId/guias')
@UseGuards(AuthGuard)
@StaffOnly()
export class ClientGuiasAdminController {
    constructor(
        private readonly guiasService: GuiasService,
        private readonly clientesService: ClientesService,
    ) { }

    @Get()
    @ApiOperation({
        summary: 'Listar guias de um cliente',
        description:
            'Retorna lista paginada de guias de um cliente específico. Permite filtros por tipo e período.',
    })
    @ApiParam({
        name: 'clientId',
        type: String,
        format: 'uuid',
        description: 'ID do cliente',
    })
    @ApiQuery({
        name: 'page',
        required: false,
        type: Number,
        description: 'Número da página',
    })
    @ApiQuery({
        name: 'pageSize',
        required: false,
        type: Number,
        description: 'Itens por página',
    })
    @ApiQuery({
        name: 'type',
        required: false,
        type: String,
        description: 'Tipo de obrigação',
    })
    @ApiQuery({
        name: 'period',
        required: false,
        type: String,
        description: 'Período (MM/YYYY)',
    })
    @ApiQuery({
        name: 'periodType',
        required: false,
        type: String,
        description: 'Tipo de filtro de período: "vencimento" ou por referência',
    })
    @ApiResponse({
        status: 200,
        description: 'Lista paginada de guias do cliente.',
    })
    @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
    async list(
        @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
        @Query()
        query: {
            page?: string;
            pageSize?: string;
            type?: string;
            period?: string;
            periodType?: string;
        },
    ) {
        const client = await this.clientesService.getClientSummary(clientId);
        if (!client) throw new NotFoundException('Cliente não encontrado.');

        const pagination = parsePaginationParams(query);
        const result = await this.guiasService.listClientGuiasForStaff({
            clientId: client.id,
            type: query.type || '',
            period: query.period || '',
            periodType: query.periodType,
            pagination,
        });
        return buildPaginatedResponse(result.data, result.total, pagination);
    }
}
