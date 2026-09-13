import {
  BadRequestException,
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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { StaffOnly } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { ClientesService } from '../../clientes/clientes.service';
import { CiapService } from '../services/ciap.service';
import { DifalEntradaService } from '../services/difal-entrada.service';
import {
  FiscalGuiasService,
  type TributoGuia,
} from '../services/fiscal-guias.service';
import { PisCofinsService } from '../services/pis-cofins.service';
import { FiscalItensService } from '../services/fiscal-itens.service';
import { parseCompetenciaMensal } from '../fiscal-date.util';
import {
  BaixarBemCiapDto,
  CiapCompetenciaDto,
  RegistrarBemCiapDto,
} from '../dto/ciap.dto';
import {
  CriarGuiaDto,
  MarcarPagamentoGuiaDto,
} from '../dto/guias-fiscais.dto';

// ─────────────────────────────────────────────────────────────────────────────
// Controller do CLIENTE logado (escopo da própria empresa)
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Fiscal — Apuração (Cliente)')
@ApiBearerAuth('session-token')
@Controller('fiscal/apuracao')
@UseGuards(AuthGuard)
export class ClienteFiscalApuracaoController {
  constructor(
    private readonly clientesService: ClientesService,
    private readonly ciapService: CiapService,
    private readonly difalService: DifalEntradaService,
    private readonly guiasService: FiscalGuiasService,
    private readonly pisCofinsService: PisCofinsService,
    private readonly fiscalItensService: FiscalItensService,
  ) { }

  private async clienteId(userId: string): Promise<string> {
    const cliente = await this.clientesService.getClientForUser(userId);
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');
    return cliente.id;
  }

  private competenciaRange(competencia: string) {
    try {
      return parseCompetenciaMensal(competencia);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Competência inválida.',
      );
    }
  }

  // ── ICMS (apuração mensal) ────────────────────────────────────────────────
  @Get('icms')
  @ApiOperation({
    summary: 'Apura o ICMS (créditos, débitos e saldo) da competência',
  })
  async apurarIcms(
    @Query('competencia') competencia: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    const { inicio, fim } = this.competenciaRange(competencia);
    const data = await this.fiscalItensService.getApuracaoIcms({
      clienteId: await this.clienteId(user.id),
      dataInicio: inicio,
      dataFim: fim,
    });
    return { data };
  }

  // ── CIAP (Bloco G) ──────────────────────────────────────────────────────
  @Get('ciap/bens')
  @ApiOperation({ summary: 'Lista os bens do ativo no CIAP' })
  async listarBensCiap(
    @Query('status') status: 'ATIVO' | 'BAIXADO' | 'CONCLUIDO' | undefined,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.ciapService.listarBens({
      clienteId: await this.clienteId(user.id),
      status,
    });
  }

  @Get('ciap')
  @ApiOperation({ summary: 'Preview da apuração CIAP (1/48) da competência' })
  async apurarCiap(
    @Query('competencia') competencia: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.ciapService.apurarCompetencia({
      clienteId: await this.clienteId(user.id),
      competencia,
    });
  }

  // ── DIFAL de entrada ────────────────────────────────────────────────────
  @Get('difal-entrada')
  @ApiOperation({ summary: 'Apura o DIFAL de entrada da competência' })
  async apurarDifal(
    @Query('competencia') competencia: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.difalService.apurarCompetencia({
      clienteId: await this.clienteId(user.id),
      competencia,
    });
  }

  // ── PIS/COFINS ──────────────────────────────────────────────────────────
  @Get('pis-cofins')
  @ApiOperation({
    summary: 'Apura PIS/COFINS da competência conforme o regime',
  })
  async apurarPisCofins(
    @Query('competencia') competencia: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.pisCofinsService.apurarCompetencia({
      clienteId: await this.clienteId(user.id),
      competencia,
    });
  }

  // ── Guias ───────────────────────────────────────────────────────────────
  @Get('guias')
  @ApiOperation({ summary: 'Lista as guias de recolhimento apuradas' })
  async listarGuias(
    @Query('competencia') competencia: string | undefined,
    @Query('tributo') tributo: TributoGuia | undefined,
    @Query('status') status: 'PENDENTE' | 'PAGO' | 'VENCIDO' | undefined,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.guiasService.listarGuias({
      clienteId: await this.clienteId(user.id),
      competencia,
      tributo,
      statusPagamento: status,
    });
  }

  @Get('guias/resumo')
  @ApiOperation({ summary: 'Resumo consolidado de guias por competência' })
  async resumoGuias(
    @Query('competencia') competencia: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.guiasService.resumoCompetencia({
      clienteId: await this.clienteId(user.id),
      competencia,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Controller ADMIN/staff (clienteId por query) — operações de escrita e gestão
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Fiscal — Apuração (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal/apuracao')
@UseGuards(AuthGuard)
@StaffOnly()
export class AdminFiscalApuracaoController {
  constructor(
    private readonly ciapService: CiapService,
    private readonly difalService: DifalEntradaService,
    private readonly guiasService: FiscalGuiasService,
    private readonly pisCofinsService: PisCofinsService,
  ) { }

  // ── CIAP ────────────────────────────────────────────────────────────────
  @Post('ciap/importar')
  @ApiOperation({
    summary: 'Importa bens de ativo (1551/2551) escriturados para o CIAP',
  })
  async importarBens(@Body() body: CiapCompetenciaDto) {
    return this.ciapService.importarBensDoPeriodo({
      clienteId: body.clienteId,
      competencia: body.competencia,
    });
  }

  @Post('ciap/bens')
  @ApiOperation({ summary: 'Registra manualmente um bem no CIAP' })
  async registrarBem(@Body() body: RegistrarBemCiapDto) {
    return this.ciapService.registrarBem(body);
  }

  @Post('ciap/apropriar')
  @ApiOperation({ summary: 'Efetiva a apropriação CIAP (1/48) da competência' })
  async apropriarCiap(@Body() body: CiapCompetenciaDto) {
    return this.ciapService.apropriarCompetencia({
      clienteId: body.clienteId,
      competencia: body.competencia,
    });
  }

  @Patch('ciap/bens/:id/baixa')
  @ApiOperation({ summary: 'Baixa um bem do CIAP' })
  async baixarBem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BaixarBemCiapDto,
  ) {
    return this.ciapService.baixarBem({
      clienteId: body.clienteId,
      bemId: id,
      dataBaixa: body.dataBaixa,
      motivoBaixa: body.motivoBaixa,
    });
  }

  // ── Guias ───────────────────────────────────────────────────────────────
  @Post('guias')
  @ApiOperation({ summary: 'Cria uma guia de recolhimento' })
  async criarGuia(@Body() body: CriarGuiaDto) {
    return this.guiasService.criarGuia(body);
  }

  @Patch('guias/:id/pagamento')
  @ApiOperation({ summary: 'Atualiza o status de pagamento de uma guia' })
  async marcarPagamento(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MarcarPagamentoGuiaDto,
  ) {
    return this.guiasService.marcarPagamento({
      clienteId: body.clienteId,
      guiaId: id,
      statusPagamento: body.statusPagamento,
    });
  }

  @Delete('guias/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove uma guia' })
  async removerGuia(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('clienteId') clienteId: string,
  ) {
    await this.guiasService.removerGuia({ clienteId, guiaId: id });
  }
}
