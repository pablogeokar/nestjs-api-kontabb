import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { RequirePasswordChangedGuard } from '../../auth/require-password-changed.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { ClientesService } from '../../clientes/clientes.service';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import {
  buildPaginatedResponse,
  parsePaginationParams,
} from '../../common/pagination';
import { FinanceiroFaturasService } from '../services/financeiro-faturas.service';
import { FiltroFaturasDto } from '../dto/fatura.dto';
import { ExtratoQueryDto } from '../dto/dashboard.dto';

@ApiTags('Financeiro (Cliente)')
@ApiBearerAuth('session-token')
@Controller('cliente/financeiro')
@UseGuards(AuthGuard, RequirePasswordChangedGuard)
export class FinanceiroClienteController {
  constructor(
    private readonly faturas: FinanceiroFaturasService,
    private readonly clientesService: ClientesService,
  ) {}

  private async resolverCliente(userId: string) {
    const client = await this.clientesService.getClientForUser(userId);
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    return client;
  }

  @Get('faturas')
  @ApiOperation({ summary: 'Listar minhas faturas' })
  async listFaturas(
    @Query() query: FiltroFaturasDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const client = await this.resolverCliente(user.id);
    const pagination = parsePaginationParams(query);
    const result = await this.faturas.list(query, pagination, client.id);
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('faturas/:id')
  @ApiOperation({ summary: 'Detalhar minha fatura' })
  async getFatura(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    const client = await this.resolverCliente(user.id);
    return this.faturas.getById(id, client.id);
  }

  @Get('extrato')
  @ApiOperation({ summary: 'Extrato de serviços lançados e faturados' })
  async extrato(
    @Query() query: ExtratoQueryDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const client = await this.resolverCliente(user.id);
    const pagination = parsePaginationParams(query);
    const result = await this.faturas.extrato(
      client.id,
      query.meses ?? 12,
      pagination,
    );
    return buildPaginatedResponse(result.data, result.total, pagination);
  }
}
