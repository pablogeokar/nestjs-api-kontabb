import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { StaffOnly } from '../../auth/roles.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { getRequestId } from '../../common/request-id';
import { ClientesService } from '../../clientes/clientes.service';
import {
  AdminAtualizarContextoApuracaoSpedDto,
  AdminCompetenciaSpedDto,
  AtualizarContextoApuracaoSpedDto,
  CompetenciaSpedDto,
} from './dto/sped-apuracao.dto';
import {
  AdminAtualizarSpedConfiguracaoDto,
  AdminGerarEfdIcmsIpiDto,
  AdminPreviewEfdIcmsIpiDto,
  AtualizarSpedConfiguracaoDto,
  GerarEfdIcmsIpiDto,
  PreviewEfdIcmsIpiDto,
} from './dto/sped-efd.dto';
import {
  AdminDataInventarioSpedDto,
  AtualizarInventarioSpedDto,
  DataInventarioSpedDto,
} from './dto/sped-inventario.dto';
import { EfdIcmsIpiService } from './efd-icms-ipi.service';
import { SpedApuracaoContextoService } from './sped-apuracao-contexto.service';
import { SpedConfiguracaoService } from './sped-configuracao.service';
import { SpedInventarioService } from './sped-inventario.service';

@ApiTags('Fiscal SPED (Cliente)')
@ApiBearerAuth('session-token')
@Controller('fiscal/sped')
@UseGuards(AuthGuard)
export class ClienteSpedEfdController {
  constructor(
    private readonly clientesService: ClientesService,
    private readonly configuracaoService: SpedConfiguracaoService,
    private readonly apuracaoContextoService: SpedApuracaoContextoService,
    private readonly inventarioService: SpedInventarioService,
    private readonly efdService: EfdIcmsIpiService,
  ) {}

  @Get('configuracao')
  @ApiOperation({ summary: 'Obter a configuração EFD do estabelecimento' })
  async obterConfiguracao(@CurrentUser() user: CurrentUserType) {
    const cliente = await this.getCliente(user.id);
    return { data: await this.configuracaoService.obter(cliente.id) };
  }

  @Get('contexto-apuracao')
  @ApiOperation({
    summary: 'Obter saldos, ajustes e obrigações da competência',
  })
  async obterContextoApuracao(
    @Query() query: CompetenciaSpedDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.getCliente(user.id);
    return {
      data: await this.apuracaoContextoService.obter(
        cliente.id,
        query.competencia,
      ),
    };
  }

  @Put('contexto-apuracao')
  @ApiOperation({
    summary: 'Atualizar saldos, ajustes e obrigações da competência',
  })
  async atualizarContextoApuracao(
    @Body() body: AtualizarContextoApuracaoSpedDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.getCliente(user.id);
    return {
      data: await this.apuracaoContextoService.atualizar({
        clienteId: cliente.id,
        actorUserId: user.id,
        data: body,
      }),
    };
  }

  @Get('inventario')
  @ApiOperation({ summary: 'Consultar o inventário do Bloco H por data' })
  async obterInventario(
    @Query() query: DataInventarioSpedDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.getCliente(user.id);
    return {
      data: await this.inventarioService.obter(cliente.id, query.data),
    };
  }

  @Put('inventario')
  @ApiOperation({ summary: 'Salvar ou fechar o inventário do Bloco H' })
  async atualizarInventario(
    @Query() query: DataInventarioSpedDto,
    @Body() body: AtualizarInventarioSpedDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.getCliente(user.id);
    return {
      data: await this.inventarioService.atualizar({
        clienteId: cliente.id,
        actorUserId: user.id,
        dataInventario: query.data,
        data: body,
      }),
    };
  }

  @Put('configuracao')
  @ApiOperation({ summary: 'Atualizar a configuração EFD do estabelecimento' })
  async atualizarConfiguracao(
    @Body() body: AtualizarSpedConfiguracaoDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.getCliente(user.id);
    return {
      data: await this.configuracaoService.atualizar({
        clienteId: cliente.id,
        actorUserId: user.id,
        data: body,
      }),
    };
  }

  @Get('efd-icms-ipi/preview')
  @ApiOperation({ summary: 'Validar a prévia da EFD ICMS/IPI' })
  async preview(
    @Query() query: PreviewEfdIcmsIpiDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.getCliente(user.id);
    return this.efdService.preview({
      clienteId: cliente.id,
      competencia: query.competencia,
      finalidade: query.finalidade,
    });
  }

  @Post('efd-icms-ipi/gerar')
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/plain')
  @ApiOperation({ summary: 'Gerar e baixar a EFD ICMS/IPI em Latin-1' })
  async gerar(
    @Body() body: GerarEfdIcmsIpiDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const cliente = await this.getCliente(user.id);
    const file = await this.efdService.gerar({
      clienteId: cliente.id,
      competencia: body.competencia,
      finalidade: body.finalidade,
      actorUserId: user.id,
      requestId: getRequestId(request),
    });
    sendSpedFile(response, file);
  }

  private async getCliente(userId: string) {
    const cliente = await this.clientesService.getClientForUser(userId);
    if (!cliente) {
      throw new NotFoundException(
        'Empresa não encontrada para o usuário logado.',
      );
    }
    return cliente;
  }
}

@ApiTags('Fiscal SPED (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal/sped')
@UseGuards(AuthGuard)
@StaffOnly()
export class AdminSpedEfdController {
  constructor(
    private readonly configuracaoService: SpedConfiguracaoService,
    private readonly apuracaoContextoService: SpedApuracaoContextoService,
    private readonly inventarioService: SpedInventarioService,
    private readonly efdService: EfdIcmsIpiService,
  ) {}

  @Get('configuracao')
  @ApiOperation({ summary: 'Obter a configuração EFD de uma empresa' })
  async obterConfiguracao(
    @Query('clienteId', new ParseUUIDPipe({ version: '4' })) clienteId: string,
  ) {
    return { data: await this.configuracaoService.obter(clienteId) };
  }

  @Get('contexto-apuracao')
  @ApiOperation({
    summary: 'Obter saldos, ajustes e obrigações de uma empresa',
  })
  async obterContextoApuracao(@Query() query: AdminCompetenciaSpedDto) {
    return {
      data: await this.apuracaoContextoService.obter(
        query.clienteId,
        query.competencia,
      ),
    };
  }

  @Put('contexto-apuracao')
  @ApiOperation({
    summary: 'Atualizar saldos, ajustes e obrigações de uma empresa',
  })
  async atualizarContextoApuracao(
    @Body() body: AdminAtualizarContextoApuracaoSpedDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const { clienteId, ...data } = body;
    return {
      data: await this.apuracaoContextoService.atualizar({
        clienteId,
        actorUserId: user.id,
        data,
      }),
    };
  }

  @Get('inventario')
  @ApiOperation({ summary: 'Consultar o inventário do Bloco H de uma empresa' })
  async obterInventario(@Query() query: AdminDataInventarioSpedDto) {
    return {
      data: await this.inventarioService.obter(query.clienteId, query.data),
    };
  }

  @Put('inventario')
  @ApiOperation({ summary: 'Salvar ou fechar o inventário de uma empresa' })
  async atualizarInventario(
    @Query() query: AdminDataInventarioSpedDto,
    @Body() body: AtualizarInventarioSpedDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return {
      data: await this.inventarioService.atualizar({
        clienteId: query.clienteId,
        actorUserId: user.id,
        dataInventario: query.data,
        data: body,
      }),
    };
  }

  @Put('configuracao')
  @ApiOperation({ summary: 'Atualizar a configuração EFD de uma empresa' })
  async atualizarConfiguracao(
    @Body() body: AdminAtualizarSpedConfiguracaoDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const { clienteId, ...data } = body;
    return {
      data: await this.configuracaoService.atualizar({
        clienteId,
        actorUserId: user.id,
        data,
      }),
    };
  }

  @Get('efd-icms-ipi/preview')
  @ApiOperation({ summary: 'Validar a prévia da EFD ICMS/IPI de uma empresa' })
  async preview(@Query() query: AdminPreviewEfdIcmsIpiDto) {
    return this.efdService.preview({
      clienteId: query.clienteId,
      competencia: query.competencia,
      finalidade: query.finalidade,
    });
  }

  @Post('efd-icms-ipi/gerar')
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/plain')
  @ApiOperation({ summary: 'Gerar e baixar a EFD ICMS/IPI de uma empresa' })
  async gerar(
    @Body() body: AdminGerarEfdIcmsIpiDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const file = await this.efdService.gerar({
      clienteId: body.clienteId,
      competencia: body.competencia,
      finalidade: body.finalidade,
      actorUserId: user.id,
      requestId: getRequestId(request),
    });
    sendSpedFile(response, file);
  }
}

function sendSpedFile(
  response: Response,
  file: { buffer: Buffer; filename: string; hashSha256: string; id: string },
) {
  response.setHeader('Content-Type', 'text/plain; charset=ISO-8859-1');
  response.setHeader('Content-Length', file.buffer.length);
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-SPED-Generation-Id', file.id);
  response.setHeader('ETag', `"${file.hashSha256}"`);
  response.end(file.buffer);
}
