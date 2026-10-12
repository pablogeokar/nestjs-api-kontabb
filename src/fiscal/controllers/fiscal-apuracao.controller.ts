import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
import {
  FiscalEntregasService,
  type ObrigacaoEntrega,
} from '../services/fiscal-entregas.service';
import { PisCofinsService } from '../services/pis-cofins.service';
import { FiscalItensService } from '../services/fiscal-itens.service';
import { FiscalClosingService } from '../services/fiscal-closing.service';
import { OnboardingMatrizService } from '../services/onboarding-matriz.service';
import { RolloutInventarioService } from '../services/rollout-inventario.service';
import { RolloutMetricasService } from '../services/rollout-metricas.service';
import { parsePaginationParams } from '../../common/pagination';
import { parseCompetenciaMensal } from '../fiscal-date.util';
import {
  BaixarBemCiapDto,
  CiapClienteDto,
  CiapCompetenciaDto,
  CorrigirApropriacaoCiapDto,
  RegistrarBemCiapDto,
} from '../dto/ciap.dto';
import {
  CancelarGuiaDto,
  CriarGuiaDto,
  MarcarEmitidaOrgaoDto,
  MarcarPagamentoGuiaDto,
  RegistrarEventoPagamentoDto,
} from '../dto/guias-fiscais.dto';
import {
  RegistrarEntregaDto,
  RetificarEntregaDto,
} from '../dto/entregas-fiscais.dto';

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
    private readonly entregasService: FiscalEntregasService,
    private readonly pisCofinsService: PisCofinsService,
    private readonly fiscalItensService: FiscalItensService,
    private readonly closingService: FiscalClosingService,
    private readonly onboardingMatrizService: OnboardingMatrizService,
    private readonly rolloutInventarioService: RolloutInventarioService,
    private readonly rolloutMetricasService: RolloutMetricasService,
  ) {}

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

  // Valida a competência 'YYYY-MM' no HTTP (BadRequest) e a devolve inalterada —
  // o serviço a reparseia internamente, mas a validação aqui dá erro 400 limpo.
  private competenciaMensal(competencia: string): string {
    this.competenciaRange(competencia);
    return competencia;
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

  // ── ResultadoApuracao (projeção do fechamento versionado) ─────────────────
  // Endpoint ADITIVO (Tarefa 3.3): projeta o contrato ResultadoApuracao (plano
  // §6.3) de uma versão de fechamento, com detalhamento PAGINADO a partir do
  // snapshot congelado (R2.2). Não substitui nem altera `GET icms` acima — é um
  // novo caminho de leitura sobre o fechamento versionado. O escopo do cliente
  // é verificado: só é possível projetar fechamentos da própria empresa.
  @Get('resultado/:fechamentoId')
  @ApiOperation({
    summary:
      'Projeta o ResultadoApuracao de uma versão de fechamento (detalhamento paginado)',
  })
  async projetarResultado(
    @Param('fechamentoId', ParseUUIDPipe) fechamentoId: string,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @CurrentUser() user: CurrentUserType,
  ) {
    const clienteId = await this.clienteId(user.id);
    const { offset, limit } = parsePaginationParams({ page, pageSize });
    const resultado = await this.closingService.projetarApuracao(fechamentoId, {
      pagination: { offset, limit },
    });
    if (resultado.clienteId !== clienteId) {
      throw new NotFoundException('Fechamento não encontrado.');
    }
    return { data: resultado };
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

  @Get('ciap/diagnostico')
  @ApiOperation({
    summary:
      'Diagnóstico read-only das fichas CIAP (identidade por SKU e risco de reemissão)',
  })
  async diagnosticarCiap(@CurrentUser() user: CurrentUserType) {
    return this.ciapService.diagnosticarFichas({
      clienteId: await this.clienteId(user.id),
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

  // R1.3 (tarefa 1.4): trilha append-only de pagamentos/estornos de uma guia e
  // o saldo da obrigação reconstruído dela (nunca de um status mutável).
  @Get('guias/:id/trilha')
  @ApiOperation({
    summary: 'Trilha de pagamentos/estornos de uma guia e saldo da obrigação',
  })
  async trilhaGuia(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.guiasService.trilhaPagamentos({
      clienteId: await this.clienteId(user.id),
      guiaId: id,
    });
  }

  // ── Entregas (R2.1/R2.2) ──────────────────────────────────────────────────
  // Trilha original → retificações de uma competência/obrigação. Escopado à
  // própria empresa; a entrega anterior permanece na trilha (nunca sobrescrita).
  @Get('entregas')
  @ApiOperation({
    summary: 'Lista as entregas (originais e retificações) da empresa',
  })
  async listarEntregas(
    @Query('competencia') competencia: string | undefined,
    @Query('obrigacao') obrigacao: ObrigacaoEntrega | undefined,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.entregasService.listarEntregas({
      clienteId: await this.clienteId(user.id),
      competencia,
      obrigacao,
    });
  }

  // ── Onboarding: matriz de cobertura por estabelecimento (R4.1) ─────────────
  // Projeção READ-ONLY montada a partir de dados fiscais já existentes: modelos
  // usados, perfil, setor, regime especial, Blocos B/K/1, 1601, combustíveis/
  // monofásicos, inventário por motivo e controles ST. Escopada à própria
  // empresa. Não decide impedimento (4.2) nem status "pronto para entrega" (4.3).
  @Get('onboarding/matriz')
  @ApiOperation({
    summary:
      'Matriz de onboarding do estabelecimento (modelos/perfil/setor/Blocos/ST, R4.1)',
  })
  async matrizOnboarding(
    @Query('competencia') competencia: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    const data = await this.onboardingMatrizService.montar({
      clienteId: await this.clienteId(user.id),
      competencia: this.competenciaMensal(competencia),
    });
    return { data };
  }

  // ── Rollout: inventário read-only antes de ativar correções (R5.2) ─────────
  // Projeção ESTRITAMENTE READ-ONLY do design (§Rollout §13): versões entregues,
  // competências abertas e operações afetadas (CIAP, CT-e de saída, créditos
  // vedados, PIS misto). Escopada à própria empresa. Não ativa correção nem
  // decide "homologado" (5.2); apenas inventaria o estado atual.
  @Get('rollout/inventario')
  @ApiOperation({
    summary:
      'Inventário read-only de rollout (versões entregues/competências abertas/operações, R5.2)',
  })
  async inventarioRollout(@CurrentUser() user: CurrentUserType) {
    const data = await this.rolloutInventarioService.inventariar({
      clienteId: await this.clienteId(user.id),
    });
    return { data };
  }

  // ── Rollout: métricas de §13.3 read-only (R5.5) ────────────────────────────
  // Painel ESTRITAMENTE READ-ONLY do design (§Rollout §13.3): diferença por
  // tributo, créditos com/sem fundamento, pendências, repetições bloqueadas,
  // rejeições PVA, guias sem vínculo, mudanças pós-fechamento e consultas por
  // documento. Escopado à própria empresa. Apenas instrumenta o estado atual.
  @Get('rollout/metricas')
  @ApiOperation({
    summary:
      'Métricas de rollout §13.3 (diferença/créditos/pendências/repetições/PVA/vínculo/pós-fechamento/consultas, R5.5)',
  })
  async metricasRollout(@CurrentUser() user: CurrentUserType) {
    const data = await this.rolloutMetricasService.medir({
      clienteId: await this.clienteId(user.id),
    });
    return { data };
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
    private readonly entregasService: FiscalEntregasService,
    private readonly pisCofinsService: PisCofinsService,
    private readonly onboardingMatrizService: OnboardingMatrizService,
    private readonly rolloutInventarioService: RolloutInventarioService,
    private readonly rolloutMetricasService: RolloutMetricasService,
  ) {}

  // ── Rollout: inventário read-only antes de ativar correções (R5.2) ─────────
  // Mesma projeção read-only do controller do cliente, escopada por `clienteId`
  // (query) para a operação staff do rollout. Não ativa correção nem decide
  // "homologado" (5.2): apenas inventaria versões entregues, competências
  // abertas e operações afetadas antes de ativar.
  @Get('rollout/inventario')
  @ApiOperation({
    summary:
      'Inventário read-only de rollout de um estabelecimento (admin, por clienteId, R5.2)',
  })
  async inventarioRollout(
    @Query('clienteId', ParseUUIDPipe) clienteId: string,
  ) {
    const data = await this.rolloutInventarioService.inventariar({ clienteId });
    return { data };
  }

  // ── Rollout: métricas de §13.3 read-only (R5.5) ────────────────────────────
  // Mesmo painel read-only do controller do cliente, escopado por `clienteId`
  // (query) para a operação staff do rollout. Apenas instrumenta o §13.3 do
  // estabelecimento; não ativa correção, não retifica, não reconstrói nada.
  @Get('rollout/metricas')
  @ApiOperation({
    summary:
      'Métricas de rollout §13.3 de um estabelecimento (admin, por clienteId, R5.5)',
  })
  async metricasRollout(@Query('clienteId', ParseUUIDPipe) clienteId: string) {
    const data = await this.rolloutMetricasService.medir({ clienteId });
    return { data };
  }

  // ── Onboarding: matriz de cobertura por estabelecimento (R4.1) ─────────────
  // Mesma projeção read-only do controller do cliente, mas escopada por
  // `clienteId` (query) para a operação staff. Não decide impedimento (4.2) nem
  // status "pronto para entrega" (4.3).
  @Get('onboarding/matriz')
  @ApiOperation({
    summary:
      'Matriz de onboarding de um estabelecimento (admin, por clienteId, R4.1)',
  })
  async matrizOnboarding(
    @Query('clienteId', ParseUUIDPipe) clienteId: string,
    @Query('competencia') competencia: string,
  ) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia ?? '')) {
      throw new BadRequestException(
        'Competência inválida. Utilize o formato AAAA-MM (ex.: 2026-09).',
      );
    }
    const data = await this.onboardingMatrizService.montar({
      clienteId,
      competencia,
    });
    return { data };
  }

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

  @Post('ciap/corrigir')
  @ApiOperation({
    summary:
      'Correção retroativa de uma apropriação CIAP (nova versão + estorno auditável)',
  })
  async corrigirApropriacaoCiap(@Body() body: CorrigirApropriacaoCiapDto) {
    return this.ciapService.corrigirApropriacao({
      clienteId: body.clienteId,
      bemId: body.bemId,
      competencia: body.competencia,
      coeficiente: body.coeficiente,
      coeficienteFonte: body.coeficienteFonte,
      motivo: body.motivo,
      dataCorrecao: body.dataCorrecao,
    });
  }

  @Post('ciap/migrar-identidade')
  @ApiOperation({
    summary:
      'Migração/backfill assistido da identidade patrimonial por aquisição (não por SKU)',
  })
  async migrarIdentidadeCiap(@Body() body: CiapClienteDto) {
    return this.ciapService.migrarIdentidadePorAquisicao({
      clienteId: body.clienteId,
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
  @Get('guias/central')
  @ApiOperation({
    summary: 'Central unificada de obrigações calculadas e PDFs enviados',
  })
  async centralGuias(
    @Query('clienteId', ParseUUIDPipe) clienteId: string,
    @Query('competencia') competencia: string,
  ) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia ?? '')) {
      throw new BadRequestException(
        'Competência inválida. Utilize o formato AAAA-MM (ex.: 2026-09).',
      );
    }
    return {
      data: await this.guiasService.listarCentral({ clienteId, competencia }),
    };
  }

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

  // R1.5 (tarefa 1.5): REGISTRAR a guia ≠ EMITIDA no órgão arrecadador. Este
  // endpoint registra o fato distinto de a guia ter sido de fato emitida/
  // transmitida no órgão, sem confundir com pagamento nem com o mero registro.
  @Patch('guias/:id/emissao-orgao')
  @ApiOperation({
    summary:
      'Marca a guia como emitida no órgão arrecadador (registrar ≠ emitir no órgão)',
  })
  async marcarEmitidaNoOrgao(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MarcarEmitidaOrgaoDto,
  ) {
    return this.guiasService.marcarEmitidaNoOrgao({
      clienteId: body.clienteId,
      guiaId: id,
    });
  }

  // R1.3 (tarefa 1.4): registra um EVENTO de pagamento/estorno na trilha da
  // guia — nunca sobrescreve. Pagamento parcial, pagamento total e estorno
  // coexistem; o saldo da obrigação é reconstruído da trilha e preservado.
  @Post('guias/:id/eventos')
  @ApiOperation({
    summary:
      'Registra um evento de pagamento/estorno (trilha append-only, preserva o saldo)',
  })
  async registrarEventoPagamento(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RegistrarEventoPagamentoDto,
  ) {
    return this.guiasService.registrarEventoPagamento({
      clienteId: body.clienteId,
      guiaId: id,
      tipo: body.tipo,
      valor: body.valor,
      dataEvento: body.dataEvento,
      origem: body.origem,
      comprovanteKey: body.comprovanteKey,
      declaracaoManual: body.declaracaoManual,
      documentoExterno: body.documentoExterno,
      eventoEstornadoId: body.eventoEstornadoId,
      observacao: body.observacao,
    });
  }

  // R1.4 (tarefa 1.4): CANCELAMENTO LÓGICO em vez de delete físico. A guia e a
  // trilha de pagamentos NUNCA são apagadas; a guia é marcada como cancelada,
  // preservando o histórico relevante.
  @Delete('guias/:id')
  @ApiOperation({
    summary:
      'Cancela logicamente uma guia (preserva histórico, sem delete físico)',
  })
  async cancelarGuia(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelarGuiaDto,
  ) {
    return this.guiasService.cancelarGuia({
      clienteId: body.clienteId,
      guiaId: id,
      motivo: body.motivo,
    });
  }

  // ── Entregas (R2.1/R2.2/R2.4) ─────────────────────────────────────────────
  // Registra uma ENTREGA ORIGINAL: arquivo (key), hash, PVA/versão, validação,
  // assinatura, protocolo/recibo (key) e vigência do leiaute. Quando vinculada a
  // um fechamento, o recibo fica amarrado ao hash do fechamento (R2.4).
  @Post('entregas')
  @ApiOperation({
    summary:
      'Registra uma entrega original (arquivo/hash/PVA/validação/recibo, R2.1)',
  })
  async registrarEntrega(@Body() body: RegistrarEntregaDto) {
    return this.entregasService.registrarEntrega(body);
  }

  // RETIFICAÇÃO (R2.2): cria uma entrega NOVA que referencia a original, carrega
  // a diferença e tem recibo próprio — a entrega anterior permanece IMUTÁVEL.
  @Post('entregas/retificar')
  @ApiOperation({
    summary:
      'Retifica uma entrega (nova entrega: original + diferença + recibo, R2.2)',
  })
  async retificarEntrega(@Body() body: RetificarEntregaDto) {
    return this.entregasService.retificarEntrega(body);
  }
}
