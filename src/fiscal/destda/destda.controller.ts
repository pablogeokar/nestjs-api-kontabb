import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
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
import { DestdaConfiguracaoService } from './destda-configuracao.service';
import { DestdaService } from './destda.service';
import {
  AdminAtualizarDestdaConfiguracaoDto,
  AdminGerarDestdaDto,
  AdminHistoricoDestdaDto,
  AdminPreviewDestdaDto,
  AtualizarDestdaConfiguracaoDto,
  GerarDestdaDto,
  HistoricoDestdaDto,
  PreviewDestdaDto,
} from './dto/destda.dto';

@ApiTags('Fiscal DeSTDA (Cliente)')
@ApiBearerAuth('session-token')
@Controller('fiscal/destda')
@UseGuards(AuthGuard)
export class ClienteDestdaController {
  constructor(
    private readonly clientesService: ClientesService,
    private readonly configuracaoService: DestdaConfiguracaoService,
    private readonly destdaService: DestdaService,
  ) {}

  @Get('configuracao')
  @ApiOperation({ summary: 'Obter a configuração da DeSTDA da empresa' })
  async obterConfiguracao(@CurrentUser() user: CurrentUserType) {
    const cliente = await this.getCliente(user.id);
    return { data: await this.configuracaoService.obter(cliente.id) };
  }

  @Put('configuracao')
  @ApiOperation({ summary: 'Atualizar a configuração da DeSTDA da empresa' })
  async atualizarConfiguracao(
    @Body() body: AtualizarDestdaConfiguracaoDto,
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

  @Get('preview')
  @ApiOperation({ summary: 'Validar a prévia da DeSTDA da competência' })
  async preview(
    @Query() query: PreviewDestdaDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.getCliente(user.id);
    return {
      data: await this.destdaService.preview({
        clienteId: cliente.id,
        competencia: query.competencia,
        finalidade: query.finalidade,
      }),
    };
  }

  @Post('gerar')
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/plain')
  @ApiOperation({ summary: 'Gerar e baixar o arquivo TXT da DeSTDA (Latin-1)' })
  async gerar(
    @Body() body: GerarDestdaDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const cliente = await this.getCliente(user.id);
    const file = await this.destdaService.gerar({
      clienteId: cliente.id,
      competencia: body.competencia,
      finalidade: body.finalidade,
      actorUserId: user.id,
      requestId: getRequestId(request),
    });
    sendDestdaFile(response, file);
  }

  @Get('historico')
  @ApiOperation({ summary: 'Listar os arquivos da DeSTDA já gerados' })
  async historico(
    @Query() query: HistoricoDestdaDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.getCliente(user.id);
    return this.destdaService.historico(cliente.id, query.competencia);
  }

  @Get('arquivos/:id/download')
  @ApiProduces('text/plain')
  @ApiOperation({ summary: 'Baixar novamente um arquivo da DeSTDA gerado' })
  async baixar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: CurrentUserType,
    @Res() response: Response,
  ) {
    const cliente = await this.getCliente(user.id);
    sendDestdaFile(response, await this.destdaService.baixar(cliente.id, id));
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

@ApiTags('Fiscal DeSTDA (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal/destda')
@UseGuards(AuthGuard)
@StaffOnly()
export class AdminDestdaController {
  constructor(
    private readonly configuracaoService: DestdaConfiguracaoService,
    private readonly destdaService: DestdaService,
  ) {}

  @Get('configuracao')
  @ApiOperation({ summary: 'Obter a configuração da DeSTDA de uma empresa' })
  async obterConfiguracao(
    @Query('clienteId', new ParseUUIDPipe({ version: '4' })) clienteId: string,
  ) {
    return { data: await this.configuracaoService.obter(clienteId) };
  }

  @Put('configuracao')
  @ApiOperation({
    summary: 'Atualizar a configuração da DeSTDA de uma empresa',
  })
  async atualizarConfiguracao(
    @Body() body: AdminAtualizarDestdaConfiguracaoDto,
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

  @Get('preview')
  @ApiOperation({ summary: 'Validar a prévia da DeSTDA de uma empresa' })
  async preview(@Query() query: AdminPreviewDestdaDto) {
    return {
      data: await this.destdaService.preview({
        clienteId: query.clienteId,
        competencia: query.competencia,
        finalidade: query.finalidade,
      }),
    };
  }

  @Post('gerar')
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/plain')
  @ApiOperation({ summary: 'Gerar e baixar o arquivo TXT da DeSTDA' })
  async gerar(
    @Body() body: AdminGerarDestdaDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const file = await this.destdaService.gerar({
      clienteId: body.clienteId,
      competencia: body.competencia,
      finalidade: body.finalidade,
      actorUserId: user.id,
      requestId: getRequestId(request),
    });
    sendDestdaFile(response, file);
  }

  @Get('historico')
  @ApiOperation({ summary: 'Listar os arquivos da DeSTDA de uma empresa' })
  async historico(@Query() query: AdminHistoricoDestdaDto) {
    return this.destdaService.historico(query.clienteId, query.competencia);
  }

  @Get('arquivos/:id/download')
  @ApiProduces('text/plain')
  @ApiOperation({ summary: 'Baixar novamente um arquivo da DeSTDA gerado' })
  async baixar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('clienteId', new ParseUUIDPipe({ version: '4' })) clienteId: string,
    @Res() response: Response,
  ) {
    sendDestdaFile(response, await this.destdaService.baixar(clienteId, id));
  }
}

function sendDestdaFile(
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
  response.setHeader('X-DeSTDA-Generation-Id', file.id);
  response.setHeader('ETag', `"${file.hashSha256}"`);
  response.end(file.buffer);
}
