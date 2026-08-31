import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
import { RhService } from './rh.service';
import { ClientesService } from '../clientes/clientes.service';
import { AuthGuard } from '../auth/auth.guard';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from '../common/pagination';
import type { CurrentUser as CurrentUserType } from '../common/types';

@ApiTags('RH (Cliente)')
@ApiBearerAuth('session-token')
@Controller('rh')
@UseGuards(AuthGuard, RequirePasswordChangedGuard)
export class RhClienteController {
  constructor(
    private readonly rhService: RhService,
    private readonly clientesService: ClientesService,
  ) {}

  @Get('folhas')
  @ApiOperation({ summary: 'Listar folhas do cliente autenticado' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Folhas do cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async listFolhas(
    @Query() query: { page?: string; pageSize?: string },
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');

    const pagination = parsePaginationParams(query);
    const result = await this.rhService.listFolhas({
      clienteId: client.id,
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('folhas/:folhaId')
  @ApiOperation({ summary: 'Detalhe de uma folha do cliente' })
  @ApiParam({ name: 'folhaId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Detalhe da folha.' })
  @ApiResponse({ status: 403, description: 'Acesso negado.' })
  @ApiResponse({ status: 404, description: 'Folha não encontrada.' })
  async getFolha(
    @Param('folhaId', new ParseUUIDPipe({ version: '4' })) folhaId: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');

    const ownerClienteId = await this.rhService.getFolhaClienteId(folhaId);
    if (!ownerClienteId) throw new NotFoundException('Folha não encontrada.');
    if (ownerClienteId !== client.id)
      throw new ForbiddenException('Acesso negado.');

    const folha = await this.rhService.getFolhaDetail(folhaId);
    if (!folha) throw new NotFoundException('Folha não encontrada.');
    return folha;
  }

  @Get('folhas/:folhaId/funcionarios')
  @ApiOperation({ summary: 'Funcionários de uma folha do cliente' })
  @ApiParam({ name: 'folhaId', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Funcionários da folha.' })
  async listFolhaFuncionarios(
    @Param('folhaId', new ParseUUIDPipe({ version: '4' })) folhaId: string,
    @Query() query: { page?: string; pageSize?: string },
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');

    const ownerClienteId = await this.rhService.getFolhaClienteId(folhaId);
    if (!ownerClienteId) throw new NotFoundException('Folha não encontrada.');
    if (ownerClienteId !== client.id)
      throw new ForbiddenException('Acesso negado.');

    const pagination = parsePaginationParams(query);
    const result = await this.rhService.listItensFolha(folhaId, pagination);
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('folhas/:folhaId/recibos')
  @ApiOperation({ summary: 'Todos os recibos de uma folha do cliente' })
  @ApiParam({ name: 'folhaId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Recibos da folha.' })
  @ApiResponse({ status: 403, description: 'Acesso negado.' })
  @ApiResponse({ status: 404, description: 'Folha não encontrada.' })
  async getAllRecibos(
    @Param('folhaId', new ParseUUIDPipe({ version: '4' })) folhaId: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');

    const ownerClienteId = await this.rhService.getFolhaClienteId(folhaId);
    if (!ownerClienteId) throw new NotFoundException('Folha não encontrada.');
    if (ownerClienteId !== client.id)
      throw new ForbiddenException('Acesso negado.');

    const recibos = await this.rhService.getAllRecibosByFolha(folhaId);

    // Record view (marks folha as "lido" for the admin listing)
    this.rhService.recordFolhaView(folhaId, currentUser.id).catch(() => {});

    return { recibos };
  }

  @Get('funcionarios')
  @ApiOperation({ summary: 'Todos os funcionários do cliente' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Funcionários do cliente.' })
  async listFuncionarios(
    @Query() query: { page?: string; pageSize?: string },
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');

    const pagination = parsePaginationParams(query);
    const result = await this.rhService.listFuncionarios(client.id, pagination);
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('funcionarios/:funcionarioId/historico')
  @ApiOperation({ summary: 'Histórico de folhas de um funcionário' })
  @ApiParam({ name: 'funcionarioId', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Histórico do funcionário.' })
  async getHistorico(
    @Param('funcionarioId', new ParseUUIDPipe({ version: '4' }))
    funcionarioId: string,
    @Query() query: { page?: string; pageSize?: string },
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');

    const ownerClienteId =
      await this.rhService.getFuncionarioClienteId(funcionarioId);
    if (!ownerClienteId)
      throw new NotFoundException('Funcionário não encontrado.');
    if (ownerClienteId !== client.id)
      throw new ForbiddenException('Acesso negado.');

    const pagination = parsePaginationParams(query);
    const result = await this.rhService.getHistoricoFuncionario(
      funcionarioId,
      pagination,
    );
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('resumo')
  @ApiOperation({ summary: 'Resumo anual do cliente' })
  @ApiQuery({ name: 'ano', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Resumo por competência.' })
  async getResumo(
    @Query('ano') anoStr: string | undefined,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');

    const ano = anoStr ? parseInt(anoStr, 10) : new Date().getFullYear();
    return this.rhService.getResumo(client.id, ano);
  }

  @Get('recibo/:itemFolhaId')
  @ApiOperation({ summary: 'Dados completos de um recibo individual' })
  @ApiParam({ name: 'itemFolhaId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Recibo individual.' })
  @ApiResponse({ status: 403, description: 'Acesso negado.' })
  @ApiResponse({ status: 404, description: 'Recibo não encontrado.' })
  async getRecibo(
    @Param('itemFolhaId', new ParseUUIDPipe({ version: '4' }))
    itemFolhaId: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');

    const ownerClienteId = await this.rhService.getItemClienteId(itemFolhaId);
    if (!ownerClienteId) throw new NotFoundException('Recibo não encontrado.');
    if (ownerClienteId !== client.id)
      throw new ForbiddenException('Acesso negado.');

    const recibo = await this.rhService.getRecibo(itemFolhaId);
    if (!recibo) throw new NotFoundException('Recibo não encontrado.');
    return recibo;
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard RH do cliente' })
  @ApiQuery({ name: 'ano', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Dashboard de RH.' })
  async dashboard(
    @Query('ano') anoStr: string | undefined,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');

    const ano = anoStr ? parseInt(anoStr, 10) : new Date().getFullYear();
    return this.rhService.getResumo(client.id, ano);
  }
}
