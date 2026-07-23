import {
  Controller,
  Get,
  NotFoundException,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DocumentosService } from './documentos.service';
import { ClientesService } from '../clientes/clientes.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from '../common/pagination';
import type { CurrentUser as CurrentUserType } from '../common/types';

@ApiTags('Documentos (Cliente)')
@ApiBearerAuth('session-token')
@Controller('cliente/documentos')
@UseGuards(AuthGuard)
export class DocumentosClienteController {
  constructor(
    private readonly documentosService: DocumentosService,
    private readonly clientesService: ClientesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar meus documentos',
    description:
      'Retorna lista paginada dos documentos do cliente autenticado. Permite filtros por tipo e período.',
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
    description: 'Tipo de filtro de período',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de documentos do cliente.',
  })
  @ApiResponse({ status: 401, description: 'Não autorizado.' })
  @ApiResponse({
    status: 404,
    description: 'Cliente não encontrado para o usuário autenticado.',
  })
  async list(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      type?: string;
      period?: string;
      periodType?: string;
    },
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
