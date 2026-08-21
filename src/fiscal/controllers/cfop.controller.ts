import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AdminOnly, StaffOnly } from '../../auth/roles.decorator';
import {
  buildPaginatedResponse,
  parsePaginationParams,
} from '../../common/pagination';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { ClientesService } from '../../clientes/clientes.service';
import {
  CreateCfopDto,
  CreateCfopEquivalenciaDto,
  QueryCfopEquivalenciasDto,
  QueryCfopsDto,
  ReprocessarEscrituracaoDto,
  UpdateCfopDto,
  UpdateCfopEquivalenciaDto,
} from '../dto/cfop.dto';
import { parseFiscalEndDate, parseFiscalStartDate } from '../fiscal-date.util';
import { CfopService } from '../services/cfop.service';
import { EscrituracaoFiscalService } from '../services/escrituracao-fiscal.service';

@ApiTags('Fiscal - CFOP (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal/cfops')
@UseGuards(AuthGuard)
@StaffOnly()
export class AdminCfopController {
  constructor(private readonly cfopService: CfopService) {}

  @Get()
  @ApiOperation({ summary: 'Listar a tabela canônica de CFOPs' })
  async list(@Query() query: QueryCfopsDto) {
    const pagination = parsePaginationParams(query);
    const result = await this.cfopService.listCfops({
      q: query.q,
      tipoOperacao: query.tipoOperacao,
      abrangencia: query.abrangencia,
      ativo: parseOptionalBoolean(query.ativo),
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('equivalencias')
  @ApiOperation({ summary: 'Listar equivalências de CFOP' })
  async listEquivalencias(@Query() query: QueryCfopEquivalenciasDto) {
    const pagination = parsePaginationParams(query);
    const result = await this.cfopService.listEquivalencias({
      clienteId: query.clienteId,
      includeGlobal: parseOptionalBoolean(query.includeGlobal),
      ativo: parseOptionalBoolean(query.ativo),
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get(':codigo')
  @ApiOperation({ summary: 'Consultar um CFOP' })
  @ApiParam({ name: 'codigo', example: '1102' })
  async get(@Param('codigo') codigo: string) {
    return { data: await this.cfopService.getCfop(codigo) };
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Cadastrar um CFOP' })
  async create(@Body() body: CreateCfopDto) {
    return { data: await this.cfopService.createCfop(body) };
  }

  @Put(':codigo')
  @AdminOnly()
  @ApiOperation({ summary: 'Atualizar um CFOP' })
  async update(@Param('codigo') codigo: string, @Body() body: UpdateCfopDto) {
    return { data: await this.cfopService.updateCfop(codigo, body) };
  }

  @Post('equivalencias')
  @AdminOnly()
  @ApiOperation({ summary: 'Cadastrar uma equivalência de CFOP' })
  async createEquivalencia(@Body() body: CreateCfopEquivalenciaDto) {
    return { data: await this.cfopService.createEquivalencia(body) };
  }

  @Put('equivalencias/:id')
  @AdminOnly()
  @ApiOperation({ summary: 'Atualizar uma equivalência de CFOP' })
  async updateEquivalencia(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateCfopEquivalenciaDto,
  ) {
    return { data: await this.cfopService.updateEquivalencia(id, body) };
  }

  @Delete('equivalencias/:id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover uma equivalência de CFOP' })
  async deleteEquivalencia(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    await this.cfopService.deleteEquivalencia(id);
  }
}

@ApiTags('Fiscal - CFOP (Cliente)')
@ApiBearerAuth('session-token')
@Controller('fiscal/cfops')
@UseGuards(AuthGuard)
export class ClienteCfopController {
  constructor(
    private readonly cfopService: CfopService,
    private readonly clientesService: ClientesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar a tabela canônica de CFOPs' })
  async list(@Query() query: QueryCfopsDto) {
    const pagination = parsePaginationParams(query);
    const result = await this.cfopService.listCfops({
      q: query.q,
      tipoOperacao: query.tipoOperacao,
      abrangencia: query.abrangencia,
      ativo: parseOptionalBoolean(query.ativo) ?? true,
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('equivalencias')
  @ApiOperation({ summary: 'Listar equivalências aplicáveis à empresa' })
  async listEquivalencias(
    @Query() query: QueryCfopEquivalenciasDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');
    const pagination = parsePaginationParams(query);
    const result = await this.cfopService.listEquivalencias({
      clienteId: cliente.id,
      includeGlobal: true,
      ativo: true,
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get(':codigo')
  @ApiOperation({ summary: 'Consultar um CFOP' })
  async get(@Param('codigo') codigo: string) {
    return { data: await this.cfopService.getCfop(codigo) };
  }
}

@ApiTags('Fiscal - Escrituração (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal')
@UseGuards(AuthGuard)
@StaffOnly()
export class AdminEscrituracaoFiscalController {
  constructor(private readonly escrituracao: EscrituracaoFiscalService) {}

  @Post('reprocessar-escrituracao')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reprocessar a escrituração fiscal de uma empresa' })
  async reprocessar(@Body() body: ReprocessarEscrituracaoDto) {
    return {
      data: await this.escrituracao.reprocessar({
        clienteId: body.clienteId,
        dataInicio: parseFiscalStartDate(body.dataInicio),
        dataFim: parseFiscalEndDate(body.dataFim),
      }),
    };
  }
}

function parseOptionalBoolean(value?: string) {
  return value === undefined ? undefined : value === 'true';
}
