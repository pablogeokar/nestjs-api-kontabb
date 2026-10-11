import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
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
  AdminCompetenciaSimplesDto,
  CompetenciaSimplesDto,
  FecharSimplesDto,
} from '../dto/simples-nacional.dto';
import { SimplesNacionalService } from '../services/simples-nacional.service';

@ApiTags('Fiscal — Simples Nacional (Cliente)')
@ApiBearerAuth('session-token')
@Controller('fiscal/simples')
@UseGuards(AuthGuard)
export class ClienteSimplesNacionalController {
  constructor(
    private readonly service: SimplesNacionalService,
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
    return { data: await this.service.obterApuracao(cliente.id, query.competencia) };
  }

  @Get('elegibilidade')
  @ApiOperation({ summary: 'Informa o enquadramento da empresa no Simples Nacional' })
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
  constructor(private readonly service: SimplesNacionalService) {}

  @Get('apuracao')
  @ApiOperation({ summary: 'Obtém a apuração ou prévia do DAS de uma empresa' })
  async obterApuracao(@Query() query: AdminCompetenciaSimplesDto) {
    return { data: await this.service.obterApuracao(query.clienteId, query.competencia) };
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
