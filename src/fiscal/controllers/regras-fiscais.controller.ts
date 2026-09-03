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
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { StaffOnly } from '../../auth/roles.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { ClientesService } from '../../clientes/clientes.service';
import {
  CreateRegraFiscalDto,
  DefinirDestinacaoItemDto,
  SimularCfopDto,
  UpdateRegraFiscalDto,
} from '../dto/regras-fiscais.dto';
import { RegrasFiscaisService } from '../services/regras-fiscais.service';

// ─────────────────────────────────────────────────────────────────────────────
// Cliente logado (regras e simulação da própria empresa)
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Fiscal - Regras (Cliente)')
@ApiBearerAuth('session-token')
@Controller('fiscal/regras')
@UseGuards(AuthGuard)
export class ClienteRegrasFiscaisController {
  constructor(
    private readonly regras: RegrasFiscaisService,
    private readonly clientesService: ClientesService,
  ) {}

  private async clienteId(userId: string): Promise<string> {
    const cliente = await this.clientesService.getClientForUser(userId);
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');
    return cliente.id;
  }

  @Post('simular')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Simular a resolução de CFOP pelo motor de regras' })
  async simular(
    @Body() body: SimularCfopDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return {
      data: await this.regras.simular({
        clienteId: await this.clienteId(user.id),
        tipoOperacaoEscriturada: body.tipoOperacaoEscriturada,
        cfopXml: body.cfopXml,
        ncm: body.ncm,
        destinacaoMercadoria: body.destinacaoMercadoria,
        emitenteCnpjCpf: body.emitenteCnpjCpf,
        emitenteUf: body.emitenteUf,
        cstIcmsXml: body.cstIcmsXml,
        csosnXml: body.csosnXml,
      }),
    };
  }

  @Get()
  @ApiOperation({ summary: 'Listar as regras fiscais da empresa (e globais)' })
  async listar(@CurrentUser() user: CurrentUserType) {
    return this.regras.listar({
      clienteId: await this.clienteId(user.id),
      includeGlobal: true,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Criar uma regra fiscal da empresa' })
  async criar(
    @Body() body: CreateRegraFiscalDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return {
      data: await this.regras.criar({
        ...body,
        clienteId: await this.clienteId(user.id),
      }),
    };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar uma regra fiscal da empresa' })
  async atualizar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateRegraFiscalDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return {
      data: await this.regras.atualizar({
        id,
        clienteId: await this.clienteId(user.id),
        patch: body,
      }),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover uma regra fiscal da empresa' })
  async remover(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    await this.regras.remover({
      id,
      clienteId: await this.clienteId(user.id),
    });
  }

  @Patch('itens/:itemId/destinacao')
  @ApiOperation({
    summary: 'Definir a destinação de um item e re-resolver o CFOP',
  })
  async definirDestinacao(
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body() body: DefinirDestinacaoItemDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return {
      data: await this.regras.definirDestinacaoItem({
        clienteId: await this.clienteId(user.id),
        itemId,
        destinacao: body.destinacaoMercadoria,
      }),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin/staff (regras globais + simulação/destinação por cliente via query)
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Fiscal - Regras (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal/regras')
@UseGuards(AuthGuard)
@StaffOnly()
export class AdminRegrasFiscaisController {
  constructor(private readonly regras: RegrasFiscaisService) {}

  @Post('simular')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Simular a resolução de CFOP para uma empresa' })
  async simular(
    @Query('clienteId', new ParseUUIDPipe({ version: '4' })) clienteId: string,
    @Body() body: SimularCfopDto,
  ) {
    return {
      data: await this.regras.simular({
        clienteId,
        tipoOperacaoEscriturada: body.tipoOperacaoEscriturada,
        cfopXml: body.cfopXml,
        ncm: body.ncm,
        destinacaoMercadoria: body.destinacaoMercadoria,
        emitenteCnpjCpf: body.emitenteCnpjCpf,
        emitenteUf: body.emitenteUf,
        cstIcmsXml: body.cstIcmsXml,
        csosnXml: body.csosnXml,
      }),
    };
  }

  @Get('globais')
  @ApiOperation({ summary: 'Listar as regras fiscais globais' })
  async listarGlobais() {
    return this.regras.listarGlobais();
  }

  @Post('globais')
  @ApiOperation({ summary: 'Criar uma regra fiscal global' })
  async criarGlobal(@Body() body: CreateRegraFiscalDto) {
    return {
      data: await this.regras.criar({ ...body, clienteId: null }),
    };
  }

  @Put('globais/:id')
  @ApiOperation({ summary: 'Atualizar uma regra fiscal global' })
  async atualizarGlobal(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateRegraFiscalDto,
  ) {
    return {
      data: await this.regras.atualizar({ id, clienteId: null, patch: body }),
    };
  }

  @Delete('globais/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover uma regra fiscal global' })
  async removerGlobal(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    await this.regras.remover({ id, clienteId: null });
  }
}
