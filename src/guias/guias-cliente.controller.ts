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
import { GuiasService } from './guias.service';
import { ClientesService } from '../clientes/clientes.service';
import { AuthGuard } from '../auth/auth.guard';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from '../common/pagination';
import type { CurrentUser as CurrentUserType } from '../common/types';

@ApiTags('Guias (Cliente)')
@ApiBearerAuth('session-token')
@Controller('cliente/guias')
@UseGuards(AuthGuard, RequirePasswordChangedGuard)
export class GuiasClienteController {
  constructor(
    private readonly guiasService: GuiasService,
    private readonly clientesService: ClientesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar minhas guias',
    description:
      'Retorna lista paginada das guias do cliente autenticado. Permite filtros por tipo e período.',
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
    description: 'Lista paginada de guias do cliente.',
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
    const result = await this.guiasService.listClientGuias({
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
