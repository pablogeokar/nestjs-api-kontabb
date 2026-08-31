import {
  Controller,
  Delete,
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
import { StorageService } from '../storage/storage.service';
import { AuthGuard } from '../auth/auth.guard';
import { StaffOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from '../common/pagination';
import type { CurrentUser as CurrentUserType } from '../common/types';

@ApiTags('RH (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/rh')
@UseGuards(AuthGuard)
@StaffOnly()
export class RhAdminController {
  constructor(
    private readonly rhService: RhService,
    private readonly storage: StorageService,
    private readonly logger: AppLogger,
  ) {}

  @Get('folhas')
  @ApiOperation({ summary: 'Listar todas as folhas de pagamento' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'clienteId', required: false, type: String })
  @ApiQuery({ name: 'competencia', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Lista paginada de folhas.' })
  async listFolhas(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      clienteId?: string;
      competencia?: string;
      search?: string;
    },
  ) {
    const pagination = parsePaginationParams(query);
    const result = await this.rhService.listFolhas({
      clienteId: query.clienteId?.trim() || undefined,
      competencia: query.competencia?.trim() || undefined,
      search: query.search?.trim() || undefined,
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('folhas/:folhaId')
  @ApiOperation({ summary: 'Detalhe de uma folha de pagamento' })
  @ApiParam({ name: 'folhaId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Detalhe da folha.' })
  @ApiResponse({ status: 404, description: 'Folha não encontrada.' })
  async getFolha(
    @Param('folhaId', new ParseUUIDPipe({ version: '4' })) folhaId: string,
  ) {
    const folha = await this.rhService.getFolhaDetail(folhaId);
    if (!folha) throw new NotFoundException('Folha não encontrada.');
    return folha;
  }

  @Get('folhas/:folhaId/funcionarios')
  @ApiOperation({ summary: 'Funcionários de uma folha' })
  @ApiParam({ name: 'folhaId', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Lista de funcionários da folha.' })
  async listFolhaFuncionarios(
    @Param('folhaId', new ParseUUIDPipe({ version: '4' })) folhaId: string,
    @Query() query: { page?: string; pageSize?: string },
  ) {
    const pagination = parsePaginationParams(query);
    const result = await this.rhService.listItensFolha(folhaId, pagination);
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('clientes/:clienteId/folhas')
  @ApiOperation({ summary: 'Folhas de pagamento de um cliente' })
  @ApiParam({ name: 'clienteId', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Folhas do cliente.' })
  async listClienteFolhas(
    @Param('clienteId', new ParseUUIDPipe({ version: '4' }))
    clienteId: string,
    @Query() query: { page?: string; pageSize?: string },
  ) {
    const pagination = parsePaginationParams(query);
    const result = await this.rhService.listFolhas({
      clienteId,
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('clientes/:clienteId/funcionarios')
  @ApiOperation({ summary: 'Funcionários de um cliente' })
  @ApiParam({ name: 'clienteId', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Funcionários do cliente.' })
  async listClienteFuncionarios(
    @Param('clienteId', new ParseUUIDPipe({ version: '4' }))
    clienteId: string,
    @Query() query: { page?: string; pageSize?: string },
  ) {
    const pagination = parsePaginationParams(query);
    const result = await this.rhService.listFuncionarios(clienteId, pagination);
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('clientes/:clienteId/resumo')
  @ApiOperation({ summary: 'Resumo RH de um cliente por ano' })
  @ApiParam({ name: 'clienteId', type: String, format: 'uuid' })
  @ApiQuery({ name: 'ano', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Resumo agregado por mês.' })
  async getClienteResumo(
    @Param('clienteId', new ParseUUIDPipe({ version: '4' }))
    clienteId: string,
    @Query('ano') anoStr?: string,
  ) {
    const ano = anoStr ? parseInt(anoStr, 10) : new Date().getFullYear();
    return this.rhService.getResumo(clienteId, ano);
  }

  @Get('recibo/:itemFolhaId')
  @ApiOperation({ summary: 'Dados completos de um recibo individual' })
  @ApiParam({ name: 'itemFolhaId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Recibo individual.' })
  @ApiResponse({ status: 404, description: 'Recibo não encontrado.' })
  async getRecibo(
    @Param('itemFolhaId', new ParseUUIDPipe({ version: '4' }))
    itemFolhaId: string,
  ) {
    const recibo = await this.rhService.getRecibo(itemFolhaId);
    if (!recibo) throw new NotFoundException('Recibo não encontrado.');
    return recibo;
  }

  @Delete('folhas/:folhaId')
  @ApiOperation({ summary: 'Excluir uma folha de pagamento' })
  @ApiParam({ name: 'folhaId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Folha excluída.' })
  @ApiResponse({ status: 404, description: 'Folha não encontrada.' })
  async deleteFolha(
    @Param('folhaId', new ParseUUIDPipe({ version: '4' })) folhaId: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const requestId = this.logger.generateRequestId();
    const result = await this.rhService.deleteFolha({
      folhaId,
      actorUserId: currentUser.id,
      requestId,
    });
    if (!result.deleted) throw new NotFoundException('Folha não encontrada.');
    return {
      success: true,
      message: 'Folha excluída com sucesso.',
      cleanupPending: result.cleanupPending,
    };
  }

  @Get('folhas/:folhaId/download')
  @ApiOperation({ summary: 'URL assinada para download do PDF original' })
  @ApiParam({ name: 'folhaId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'URL assinada gerada.' })
  @ApiResponse({
    status: 404,
    description: 'Folha ou documento não encontrado.',
  })
  async downloadFolha(
    @Param('folhaId', new ParseUUIDPipe({ version: '4' })) folhaId: string,
  ) {
    const key = await this.rhService.getFolhaDocumentoKey(folhaId);
    if (!key) throw new NotFoundException('Documento da folha não encontrado.');
    const url = await this.storage.getSignedUrl(key);
    return { url };
  }

  @Get('folhas/:folhaId/recibos')
  @ApiOperation({
    summary: 'Todos os recibos de uma folha (para geração de PDF)',
  })
  @ApiParam({ name: 'folhaId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Lista de recibos completos.' })
  @ApiResponse({ status: 404, description: 'Folha não encontrada.' })
  async getAllRecibos(
    @Param('folhaId', new ParseUUIDPipe({ version: '4' })) folhaId: string,
  ) {
    const folha = await this.rhService.getFolhaDetail(folhaId);
    if (!folha) throw new NotFoundException('Folha não encontrada.');
    const recibos = await this.rhService.getAllRecibosByFolha(folhaId);
    return { recibos };
  }

  @Get('folhas/:folhaId/visualizacoes')
  @ApiOperation({ summary: 'Histórico de visualizações de uma folha' })
  @ApiParam({ name: 'folhaId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Lista de visualizações.' })
  async listFolhaVisualizacoes(
    @Param('folhaId', new ParseUUIDPipe({ version: '4' })) folhaId: string,
  ) {
    return this.rhService.listFolhaVisualizacoes(folhaId);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard RH (admin)' })
  @ApiQuery({ name: 'clienteId', required: true, type: String })
  @ApiQuery({ name: 'ano', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Dashboard de RH.' })
  async dashboard(
    @Query('clienteId') clienteId: string,
    @Query('ano') anoStr?: string,
  ) {
    const ano = anoStr ? parseInt(anoStr, 10) : new Date().getFullYear();
    return this.rhService.getResumo(clienteId, ano);
  }
}
