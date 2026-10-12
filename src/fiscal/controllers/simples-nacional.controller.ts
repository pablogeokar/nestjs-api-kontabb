import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AdminOnly, StaffOnly } from '../../auth/roles.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { ClientesService } from '../../clientes/clientes.service';
import {
  AdminCompetenciaSimplesDto,
  CompetenciaSimplesDto,
  FecharSimplesDto,
  HistoricoSimplesQueryDto,
  SalvarHistoricoSimplesDto,
  SalvarSimplesTabelaDto,
} from '../dto/simples-nacional.dto';
import { SimplesNacionalService } from '../services/simples-nacional.service';
import { SimplesNacionalRelatorioService } from '../services/simples-nacional-relatorio.service';

@ApiTags('Fiscal — Simples Nacional (Cliente)')
@ApiBearerAuth('session-token')
@Controller('fiscal/simples')
@UseGuards(AuthGuard)
export class ClienteSimplesNacionalController {
  constructor(
    private readonly service: SimplesNacionalService,
    private readonly relatorioService: SimplesNacionalRelatorioService,
    private readonly clientesService: ClientesService,
  ) {}

  @Get('tabelas')
  @ApiOperation({ summary: 'Lista as tabelas normativas do Simples Nacional' })
  async listarTabelas() {
    return { data: await this.service.listarTabelas() };
  }

  @Get('apuracao')
  @ApiOperation({ summary: 'Obtém a apuração ou prévia do DAS da competência' })
  async obterApuracao(
    @Query() query: CompetenciaSimplesDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');
    return {
      data: await this.service.obterApuracao(cliente.id, query.competencia),
    };
  }

  @Get('apuracao/pdf')
  @ApiOperation({ summary: 'Exporta a memória de cálculo do DAS em PDF' })
  async gerarRelatorioApuracao(
    @Query() query: CompetenciaSimplesDto,
    @CurrentUser() user: CurrentUserType,
    @Res() res: Response,
  ) {
    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');
    const buffer = await this.relatorioService.gerarPdf({
      clienteId: cliente.id,
      competencia: query.competencia,
    });
    sendPdf(res, buffer, query.competencia);
  }

  @Get('elegibilidade')
  @ApiOperation({
    summary: 'Informa o enquadramento da empresa no Simples Nacional',
  })
  async elegibilidade(@CurrentUser() user: CurrentUserType) {
    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');
    return {
      data: {
        regime_tributario: cliente.regimeTributario,
        apura_icms: cliente.apuraIcms,
        is_simples_nacional: cliente.regimeTributario === 'SIMPLES_NACIONAL',
      },
    };
  }
}

@ApiTags('Fiscal — Simples Nacional (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal/simples')
@UseGuards(AuthGuard)
@StaffOnly()
export class AdminSimplesNacionalController {
  constructor(
    private readonly service: SimplesNacionalService,
    private readonly relatorioService: SimplesNacionalRelatorioService,
  ) {}

  @Get('tabelas')
  @AdminOnly()
  @ApiOperation({
    summary: 'Consulta todas as versões normativas do Simples Nacional',
  })
  async listarTabelas() {
    return { data: await this.service.listarTabelas() };
  }

  @Post('tabelas')
  @AdminOnly()
  @ApiOperation({
    summary: 'Cadastra uma versão normativa do Simples Nacional',
  })
  async criarTabela(@Body() body: SalvarSimplesTabelaDto) {
    return { data: await this.service.criarTabela(body) };
  }

  @Put('tabelas/:id')
  @AdminOnly()
  @ApiOperation({
    summary: 'Edita uma versão normativa ainda não utilizada em apurações',
  })
  async editarTabela(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: SalvarSimplesTabelaDto,
  ) {
    return { data: await this.service.editarTabela(id, body) };
  }

  @Get('historico')
  @ApiOperation({
    summary: 'Consulta receitas e folhas dos 12 meses anteriores',
  })
  async listarHistorico(@Query() query: HistoricoSimplesQueryDto) {
    return { data: await this.service.listarHistorico(query) };
  }

  @Put('historico')
  @ApiOperation({
    summary: 'Informa ou remove valores manuais mensais de receita e folha',
  })
  async salvarHistorico(
    @Body() body: SalvarHistoricoSimplesDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return { data: await this.service.salvarHistorico(body, user.id) };
  }

  @Get('apuracao')
  @ApiOperation({ summary: 'Obtém a apuração ou prévia do DAS de uma empresa' })
  async obterApuracao(@Query() query: AdminCompetenciaSimplesDto) {
    return {
      data: await this.service.obterApuracao(
        query.clienteId,
        query.competencia,
      ),
    };
  }

  @Get('apuracao/pdf')
  @ApiOperation({ summary: 'Exporta a memória de cálculo do DAS em PDF' })
  async gerarRelatorioApuracao(
    @Query() query: AdminCompetenciaSimplesDto,
    @Res() res: Response,
  ) {
    const buffer = await this.relatorioService.gerarPdf({
      clienteId: query.clienteId,
      competencia: query.competencia,
    });
    sendPdf(res, buffer, query.competencia);
  }

  @Post('apurar')
  @ApiOperation({ summary: 'Calcula e grava uma versão de rascunho do DAS' })
  async apurar(@Body() body: AdminCompetenciaSimplesDto) {
    return { data: await this.service.apurar(body) };
  }

  @Post('fechar')
  @ApiOperation({ summary: 'Fecha a apuração e registra a guia DAS vinculada' })
  async fechar(
    @Body() body: FecharSimplesDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return {
      data: await this.service.fechar({ ...body, actorUserId: user.id }),
    };
  }
}

function sendPdf(res: Response, buffer: Buffer, competencia: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="apuracao-simples-${competencia}.pdf"`,
  );
  res.send(buffer);
}
