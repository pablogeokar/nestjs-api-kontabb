import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { StaffOnly } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { AppLogger } from '../../common/logger.service';
import {
  buildPaginatedResponse,
  parsePaginationParams,
} from '../../common/pagination';
import { FinanceiroTiposService } from '../services/financeiro-tipos.service';
import { FinanceiroContratosService } from '../services/financeiro-contratos.service';
import { FinanceiroLancamentosService } from '../services/financeiro-lancamentos.service';
import { FinanceiroFaturasService } from '../services/financeiro-faturas.service';
import { FinanceiroBaixasService } from '../services/financeiro-baixas.service';
import { FinanceiroDashboardService } from '../services/financeiro-dashboard.service';
import {
  CreateTipoLancamentoDto,
  UpdateTipoLancamentoDto,
} from '../dto/tipo-lancamento.dto';
import { UpsertContratoDto } from '../dto/contrato.dto';
import {
  CreateLancamentoDto,
  FiltroLancamentosDto,
} from '../dto/lancamento.dto';
import {
  CancelarFaturaDto,
  FiltroFaturasDto,
  GerarFaturaAvulsaDto,
  GerarFaturasLoteDto,
} from '../dto/fatura.dto';
import { EstornarBaixaDto, RegistrarBaixaDto } from '../dto/baixa.dto';
import { DashboardQueryDto, ListContratosQueryDto } from '../dto/dashboard.dto';

@ApiTags('Financeiro (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/financeiro')
@UseGuards(AuthGuard)
@StaffOnly()
export class FinanceiroAdminController {
  constructor(
    private readonly tipos: FinanceiroTiposService,
    private readonly contratos: FinanceiroContratosService,
    private readonly lancamentos: FinanceiroLancamentosService,
    private readonly faturas: FinanceiroFaturasService,
    private readonly baixas: FinanceiroBaixasService,
    private readonly dashboard: FinanceiroDashboardService,
    private readonly logger: AppLogger,
  ) {}

  // ── Catálogo de tipos ──

  @Get('tipos-lancamento')
  @ApiOperation({ summary: 'Listar tipos de lançamento' })
  listTipos() {
    return this.tipos.list();
  }

  @Post('tipos-lancamento')
  @ApiOperation({ summary: 'Criar tipo de lançamento' })
  @ApiResponse({ status: 409, description: 'Código já cadastrado.' })
  createTipo(@Body() dto: CreateTipoLancamentoDto) {
    return this.tipos.create(dto);
  }

  @Patch('tipos-lancamento/:id')
  @ApiOperation({ summary: 'Editar tipo de lançamento' })
  updateTipo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTipoLancamentoDto,
  ) {
    return this.tipos.update(id, dto);
  }

  // ── Contratos ──

  @Get('contratos')
  @ApiOperation({ summary: 'Listar contratos financeiros' })
  async listContratos(@Query() query: ListContratosQueryDto) {
    const pagination = parsePaginationParams(query);
    const result = await this.contratos.list({
      search: query.search,
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('contratos/cliente/:clienteId')
  @ApiOperation({ summary: 'Obter contrato financeiro do cliente' })
  getContrato(@Param('clienteId', ParseUUIDPipe) clienteId: string) {
    return this.contratos.getByCliente(clienteId);
  }

  @Put('contratos/cliente/:clienteId')
  @ApiOperation({
    summary: 'Criar ou atualizar contrato financeiro do cliente',
  })
  upsertContrato(
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @Body() dto: UpsertContratoDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.contratos.upsert(clienteId, dto, user.id);
  }

  // ── Lançamentos ──

  @Get('lancamentos')
  @ApiOperation({ summary: 'Listar lançamentos (conta-corrente do cliente)' })
  async listLancamentos(@Query() query: FiltroLancamentosDto) {
    const pagination = parsePaginationParams(query);
    const result = await this.lancamentos.list(query, pagination);
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Post('lancamentos')
  @ApiOperation({ summary: 'Registrar cobrança avulsa ou desconto' })
  createLancamento(
    @Body() dto: CreateLancamentoDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.lancamentos.create(dto, user.id);
  }

  @Patch('lancamentos/:id/cancelar')
  @ApiOperation({ summary: 'Cancelar lançamento pendente' })
  cancelarLancamento(@Param('id', ParseUUIDPipe) id: string) {
    return this.lancamentos.cancelar(id);
  }

  // ── Faturas ──

  @Get('faturas')
  @ApiOperation({ summary: 'Listar faturas' })
  async listFaturas(@Query() query: FiltroFaturasDto) {
    const pagination = parsePaginationParams(query);
    const result = await this.faturas.list(query, pagination);
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Post('faturas/gerar-lote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gerar faturas em lote para uma competência',
    description:
      'Idempotente: clientes que já possuem fatura ativa na competência são pulados.',
  })
  gerarLote(
    @Body() dto: GerarFaturasLoteDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.faturas.gerarFaturasCompetencia(
      dto,
      user.id,
      this.logger.generateRequestId(),
    );
  }

  @Post('faturas/avulsa')
  @ApiOperation({ summary: 'Emitir fatura avulsa imediata' })
  gerarAvulsa(
    @Body() dto: GerarFaturaAvulsaDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.faturas.gerarFaturaAvulsa(dto, user.id);
  }

  @Get('faturas/:id')
  @ApiOperation({ summary: 'Detalhar fatura com lançamentos e baixas' })
  getFatura(@Param('id', ParseUUIDPipe) id: string) {
    return this.faturas.getById(id);
  }

  @Post('faturas/:id/cancelar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar fatura sem baixas ativas' })
  cancelarFatura(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelarFaturaDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.faturas.cancelar(id, dto, user.id);
  }

  // ── Baixas ──

  @Post('faturas/:id/baixas')
  @ApiOperation({ summary: 'Registrar baixa (total ou parcial)' })
  registrarBaixa(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarBaixaDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.baixas.registrarBaixa(
      id,
      dto,
      user.id,
      this.logger.generateRequestId(),
    );
  }

  @Post('baixas/:id/estornar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Estornar baixa' })
  estornarBaixa(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EstornarBaixaDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.baixas.estornarBaixa(
      id,
      dto,
      user.id,
      this.logger.generateRequestId(),
    );
  }

  // ── Painel ──

  @Get('dashboard')
  @ApiOperation({ summary: 'KPIs financeiros da competência' })
  getDashboard(@Query() query: DashboardQueryDto) {
    return this.dashboard.getDashboard(query.competencia);
  }
}
