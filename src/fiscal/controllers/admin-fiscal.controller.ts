import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../../auth/auth.guard';
import { StaffOnly } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AppLogger } from '../../common/logger.service';
import { RateLimitService } from '../../common/rate-limit.service';
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from '../../common/pagination';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { CertificadoService } from '../services/certificado.service';
import {
  DistribuicaoDfeService,
  isFiscalSyncFailure,
  type FiscalSyncResult,
} from '../services/distribuicao-dfe.service';
import { DanfeService } from '../services/danfe.service';
import { FiscalCronService } from '../services/fiscal-cron.service';
import { ImportacaoXmlFiscalService } from '../services/importacao-xml-fiscal.service';
import { UploadCertificadoDto } from '../dto/upload-certificado.dto';
import { QueryDocumentosFiscaisDto } from '../dto/query-documentos-fiscais.dto';
import { QueryItensFiscaisDto } from '../dto/query-itens-fiscais.dto';
import { SincronizarFiscalDto } from '../dto/sincronizar-fiscal.dto';
import { parseFiscalEndDate, parseFiscalStartDate } from '../fiscal-date.util';
import { FiscalItensService } from '../services/fiscal-itens.service';

@ApiTags('Fiscal (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal')
@UseGuards(AuthGuard)
@StaffOnly()
export class AdminFiscalController {
  constructor(
    private readonly certificadoService: CertificadoService,
    private readonly distribuicaoService: DistribuicaoDfeService,
    private readonly danfeService: DanfeService,
    private readonly cronService: FiscalCronService,
    private readonly logger: AppLogger,
    private readonly configService: ConfigService,
    private readonly importacaoXmlService: ImportacaoXmlFiscalService,
    private readonly rateLimit: RateLimitService,
    private readonly fiscalItensService: FiscalItensService,
  ) {}

  // ─── Certificados ─────────────────────────────────────────────────────────

  @Post('certificados/upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('arquivo'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload de certificado digital A1',
    description:
      'Envia um certificado A1 (.pfx/.p12) para um cliente específico. O certificado é validado, criptografado e armazenado no R2.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        arquivo: { type: 'string', format: 'binary' },
        clienteId: { type: 'string', format: 'uuid' },
        senha: { type: 'string' },
      },
      required: ['arquivo', 'clienteId', 'senha'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Certificado cadastrado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Certificado inválido ou dados inconsistentes.',
  })
  async uploadCertificado(
    @UploadedFile() arquivo: Express.Multer.File,
    @Body() body: UploadCertificadoDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    if (!arquivo) {
      throw new BadRequestException(
        'Arquivo do certificado (.pfx/.p12) é obrigatório.',
      );
    }

    const allowedMimes = ['application/x-pkcs12', 'application/octet-stream'];
    if (!allowedMimes.includes(arquivo.mimetype)) {
      throw new BadRequestException(
        'Tipo de arquivo inválido. Envie um arquivo .pfx ou .p12.',
      );
    }

    const result = await this.certificadoService.uploadCertificado({
      clienteId: body.clienteId,
      pfxBuffer: arquivo.buffer,
      senha: body.senha,
      uploadadoPor: user.id,
    });

    return {
      success: true,
      message: 'Certificado digital cadastrado com sucesso.',
      data: result,
    };
  }

  @Get('certificados')
  @ApiOperation({
    summary: 'Listar certificados digitais',
    description:
      'Retorna todos os certificados cadastrados com informações de status e validade. Opcionalmente filtra por clienteId.',
  })
  @ApiResponse({ status: 200, description: 'Lista de certificados.' })
  async listCertificados(@Query('clienteId') clienteId?: string) {
    const certificados =
      await this.certificadoService.listCertificados(clienteId);
    return { data: certificados };
  }

  // ─── Sincronização ────────────────────────────────────────────────────────

  @Post('sincronizar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sincronizar documentos fiscais com a SEFAZ',
    description:
      'Força a execução do job de distribuição de DFe. Se clienteId for informado, sincroniza apenas aquele cliente.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        clienteId: {
          type: 'string',
          format: 'uuid',
          description: 'ID do cliente (opcional, se omitido sincroniza todos)',
        },
      },
    },
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Sincronização executada.' })
  async sincronizar(
    @Body() body: SincronizarFiscalDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    this.logger.info('fiscal_sync_manual_triggered', {
      userId: user.id,
      clienteId: body.clienteId || 'TODOS',
      operation: 'sincronizar_fiscal',
    });

    if (body.clienteId) {
      const nfe = await this.sincronizarTipoSeguro(body.clienteId, 'NFE');
      const cte = await this.sincronizarTipoSeguro(body.clienteId, 'CTE');
      return {
        success: !isFiscalSyncFailure(nfe) && !isFiscalSyncFailure(cte),
        data: { nfe, cte },
      };
    }

    const resultado = await this.cronService.executarSincronizacao();
    return { success: resultado.success, data: resultado };
  }

  @Get('status')
  @ApiOperation({
    summary: 'Estado operacional da sincronização fiscal',
    description:
      'Retorna ambiente, última consulta, próxima consulta e status da SEFAZ sem expor credenciais.',
  })
  async getStatusSincronizacao() {
    const controles = await this.distribuicaoService.getStatusSincronizacao();
    return {
      data: {
        ambiente: this.configService.get<string>('SEFAZ_AMBIENTE'),
        controles,
      },
    };
  }

  // ─── Documentos Fiscais ───────────────────────────────────────────────────

  @Post('documentos/importar-xml')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('files', 20, { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Importar XMLs fiscais manualmente',
    description:
      'Identifica NF-e, NFC-e e CT-e processados e associa cada XML aos clientes cadastrados encontrados entre seus participantes. XMLs sem utilidade para o sistema são ignorados.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Arquivos XML (máx. 20, 10 MB cada)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Resultado da importação em lote.' })
  @ApiResponse({ status: 400, description: 'Nenhum arquivo enviado.' })
  async importarXmls(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: CurrentUserType,
  ) {
    if (!files?.length) {
      throw new BadRequestException('Selecione ao menos um arquivo XML.');
    }

    await this.rateLimit.consume({
      key: `fiscal-xml-import:${user.id}`,
      limit: 60,
      windowMs: 60_000,
    });

    const requestId = this.logger.generateRequestId();
    const result = await this.importacaoXmlService.importar({
      files,
      actorUserId: user.id,
      requestId,
    });
    this.logger.info('fiscal_xml_import_completed', {
      requestId,
      userId: user.id,
      operation: 'importar_xml_fiscal',
      result: result.erros > 0 ? 'PARTIAL_OR_FAILED' : 'SUCCESS',
      totalArquivos: result.total_arquivos,
      importados: result.importados,
      duplicados: result.duplicados,
      ignorados: result.ignorados,
      erros: result.erros,
    });

    return {
      success: result.erros === 0,
      partial: result.importados > 0 && result.erros > 0,
      data: result,
    };
  }

  @Get('documentos/clientes')
  @ApiOperation({
    summary: 'Listar clientes com documentos fiscais',
    description:
      'Retorna as empresas que possuem documentos fiscais e o total de documentos de cada uma.',
  })
  @ApiResponse({
    status: 200,
    description: 'Resumo de documentos fiscais por cliente.',
  })
  async listClientesComDocumentos() {
    const clientes =
      await this.distribuicaoService.listClientesComDocumentosFiscais();
    return { data: clientes };
  }

  @Get('documentos')
  @ApiOperation({
    summary: 'Listar documentos fiscais',
    description:
      'Retorna lista paginada de todos os documentos fiscais com suporte a filtros avançados.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de documentos fiscais.',
  })
  async listDocumentos(@Query() query: QueryDocumentosFiscaisDto) {
    const pagination = parsePaginationParams(query);
    const result = await this.distribuicaoService.listDocumentosFiscais({
      clienteId: query.clienteId,
      tipoDocumento: query.tipoDocumento,
      situacao: query.situacao,
      manifestacaoStatus: query.manifestacaoStatus,
      dataInicio: parseFiscalStartDate(query.dataInicio),
      dataFim: parseFiscalEndDate(query.dataFim),
      search: query.search?.trim(),
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('itens')
  @ApiOperation({
    summary: 'Listar itens fiscais',
    description:
      'Consulta itens de NF-e/NFC-e por empresa, documento, CFOP, CST/CSOSN, NCM, produto e período.',
  })
  async listItens(@Query() query: QueryItensFiscaisDto) {
    const pagination = parsePaginationParams(query);
    const result = await this.fiscalItensService.listItens({
      clienteId: query.clienteId,
      documentoId: query.documentoId,
      cfop: query.cfop,
      cfopXml: query.cfopXml,
      tipoOperacao: query.tipoOperacao,
      cst: query.cst,
      cstIcms: query.cstIcms,
      csosnIcms: query.csosnIcms,
      cstPis: query.cstPis,
      cstCofins: query.cstCofins,
      ncm: query.ncm,
      codigoProduto: query.codigoProduto,
      dataInicio: parseFiscalStartDate(query.dataInicio),
      dataFim: parseFiscalEndDate(query.dataFim),
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('documentos/:id/itens')
  @ApiOperation({ summary: 'Listar itens de um documento fiscal' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async listItensDocumento(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: QueryItensFiscaisDto,
  ) {
    const pagination = parsePaginationParams(query);
    const result = await this.fiscalItensService.listItens({
      documentoId: id,
      clienteId: query.clienteId,
      cfop: query.cfop,
      cfopXml: query.cfopXml,
      tipoOperacao: query.tipoOperacao,
      cst: query.cst,
      cstIcms: query.cstIcms,
      csosnIcms: query.csosnIcms,
      cstPis: query.cstPis,
      cstCofins: query.cstCofins,
      ncm: query.ncm,
      codigoProduto: query.codigoProduto,
      dataInicio: parseFiscalStartDate(query.dataInicio),
      dataFim: parseFiscalEndDate(query.dataFim),
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get('relatorios/c190')
  @ApiOperation({ summary: 'Apuração analítica equivalente ao SPED C190' })
  async getC190(@Query() query: QueryItensFiscaisDto) {
    return this.fiscalItensService.getC190({
      clienteId: query.clienteId,
      documentoId: query.documentoId,
      cfop: query.cfop,
      cfopXml: query.cfopXml,
      tipoOperacao: query.tipoOperacao,
      cst: query.cst,
      ncm: query.ncm,
      dataInicio: parseFiscalStartDate(query.dataInicio),
      dataFim: parseFiscalEndDate(query.dataFim),
    });
  }

  @Get('relatorios/produtos-0200')
  @ApiOperation({ summary: 'Cadastro consolidado de produtos para SPED 0200' })
  async getProdutos0200(@Query() query: QueryItensFiscaisDto) {
    return {
      data: await this.fiscalItensService.getProdutos0200({
        clienteId: query.clienteId,
        cfopXml: query.cfopXml,
        tipoOperacao: query.tipoOperacao,
        codigoProduto: query.codigoProduto,
        ncm: query.ncm,
        dataInicio: parseFiscalStartDate(query.dataInicio),
        dataFim: parseFiscalEndDate(query.dataFim),
      }),
    };
  }

  @Get('relatorios/livros-icms')
  @ApiOperation({ summary: 'Resumo de entradas e saídas por CFOP e alíquota' })
  async getResumoLivros(@Query() query: QueryItensFiscaisDto) {
    return {
      data: await this.fiscalItensService.getResumoLivros({
        clienteId: query.clienteId,
        cfop: query.cfop,
        cfopXml: query.cfopXml,
        tipoOperacao: query.tipoOperacao,
        cst: query.cst,
        ncm: query.ncm,
        dataInicio: parseFiscalStartDate(query.dataInicio),
        dataFim: parseFiscalEndDate(query.dataFim),
      }),
    };
  }

  @Get('relatorios/apuracao-icms')
  @ApiOperation({ summary: 'Consolidar créditos, débitos e saldo de ICMS' })
  async getApuracaoIcms(@Query() query: QueryItensFiscaisDto) {
    return {
      data: await this.fiscalItensService.getApuracaoIcms({
        clienteId: query.clienteId,
        cfop: query.cfop,
        cfopXml: query.cfopXml,
        tipoOperacao: query.tipoOperacao,
        cst: query.cst,
        ncm: query.ncm,
        dataInicio: parseFiscalStartDate(query.dataInicio),
        dataFim: parseFiscalEndDate(query.dataFim),
      }),
    };
  }

  @Get('documentos/:id/download-xml')
  @ApiOperation({
    summary: 'Download do XML de um documento fiscal',
    description: 'Retorna URL assinada para download do XML original.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'URL assinada para download.' })
  @ApiResponse({ status: 404, description: 'Documento não encontrado.' })
  async downloadXml(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const url = await this.distribuicaoService.getXmlDownloadUrl(id);
    if (!url) throw new NotFoundException('Documento fiscal não encontrado.');
    return { url };
  }

  @Get('documentos/:id/danfe')
  @ApiOperation({
    summary: 'Visualizar documento auxiliar (PDF)',
    description: 'Retorna URL ou gera DANFE/DACTE em PDF.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'URL do documento auxiliar em PDF.',
  })
  @ApiResponse({ status: 404, description: 'Documento não encontrado.' })
  async getDanfe(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const result = await this.danfeService.getDanfePdf(id);
    if ('url' in result) {
      return { url: result.url };
    }
    return { url: null, message: 'DANFE gerada mas URL não disponível.' };
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  @Get('dashboard')
  @ApiOperation({
    summary: 'Estatísticas do módulo fiscal',
    description:
      'Retorna KPIs consolidados: documentos no mês, volume financeiro, status de certificados.',
  })
  @ApiResponse({ status: 200, description: 'Estatísticas do módulo fiscal.' })
  async getDashboard() {
    const stats = await this.distribuicaoService.getDashboardStats();
    return { data: stats };
  }

  private async sincronizarTipoSeguro(
    clienteId: string,
    tipoDocumento: 'NFE' | 'CTE',
  ): Promise<FiscalSyncResult> {
    try {
      return await this.distribuicaoService.sincronizarCliente(
        clienteId,
        tipoDocumento,
      );
    } catch {
      return {
        status: 'ERRO',
        message: `Não foi possível concluir a consulta de ${tipoDocumento === 'NFE' ? 'NF-e' : 'CT-e'} à SEFAZ.`,
        documentosProcessados: 0,
      };
    }
  }
}
