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
  ServiceUnavailableException,
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
import { CurrentUser } from '../../auth/current-user.decorator';
import { AppLogger } from '../../common/logger.service';
import { RateLimitService } from '../../common/rate-limit.service';
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from '../../common/pagination';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { ClientesService } from '../../clientes/clientes.service';
import { CertificadoService } from '../services/certificado.service';
import { DistribuicaoDfeService } from '../services/distribuicao-dfe.service';
import { DanfeService } from '../services/danfe.service';
import { ImportacaoXmlFiscalService } from '../services/importacao-xml-fiscal.service';
import {
  type ManifestacaoSefazResult,
  ManifestacaoSefazRejectedError,
  NfeWizardService,
} from '../services/nfewizard.service';
import { UploadCertificadoClienteDto } from '../dto/upload-certificado.dto';
import { ManifestarDocumentoDto } from '../dto/manifestar-documento.dto';
import { QueryDocumentosFiscaisDto } from '../dto/query-documentos-fiscais.dto';
import { parseFiscalEndDate, parseFiscalStartDate } from '../fiscal-date.util';

@ApiTags('Fiscal (Cliente)')
@ApiBearerAuth('session-token')
@Controller('fiscal')
@UseGuards(AuthGuard)
export class ClienteFiscalController {
  constructor(
    private readonly clientesService: ClientesService,
    private readonly certificadoService: CertificadoService,
    private readonly distribuicaoService: DistribuicaoDfeService,
    private readonly danfeService: DanfeService,
    private readonly nfeWizardService: NfeWizardService,
    private readonly configService: ConfigService,
    private readonly importacaoXmlService: ImportacaoXmlFiscalService,
    private readonly rateLimit: RateLimitService,
    private readonly logger: AppLogger,
  ) {}

  // ─── Certificado Digital ──────────────────────────────────────────────────

  @Post('certificado/upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('arquivo'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload do certificado digital A1 da empresa',
    description:
      'Envia o certificado A1 (.pfx/.p12) da empresa logada. Valida o CNPJ contra o cadastro.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        arquivo: { type: 'string', format: 'binary' },
        senha: { type: 'string' },
      },
      required: ['arquivo', 'senha'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Certificado cadastrado com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Certificado inválido ou CNPJ não confere.',
  })
  async uploadCertificado(
    @UploadedFile() arquivo: Express.Multer.File,
    @Body() body: UploadCertificadoClienteDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    if (!arquivo) {
      throw new BadRequestException(
        'Arquivo do certificado (.pfx/.p12) é obrigatório.',
      );
    }

    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) {
      throw new NotFoundException(
        'Empresa não encontrada para o usuário logado.',
      );
    }

    const result = await this.certificadoService.uploadCertificado({
      clienteId: cliente.id,
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

  @Get('certificado')
  @ApiOperation({
    summary: 'Status do certificado digital',
    description:
      'Retorna o status e a validade do certificado digital da empresa logada.',
  })
  @ApiResponse({ status: 200, description: 'Status do certificado.' })
  async getCertificadoStatus(@CurrentUser() user: CurrentUserType) {
    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) {
      throw new NotFoundException(
        'Empresa não encontrada para o usuário logado.',
      );
    }

    const status = await this.certificadoService.getCertificadoStatus(
      cliente.id,
    );
    return { data: status };
  }

  @Get('status')
  @ApiOperation({
    summary: 'Estado da sincronização fiscal da empresa',
    description:
      'Retorna ambiente, última consulta e próxima consulta da empresa logada.',
  })
  async getStatusSincronizacao(@CurrentUser() user: CurrentUserType) {
    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) {
      throw new NotFoundException(
        'Empresa não encontrada para o usuário logado.',
      );
    }

    const controles = await this.distribuicaoService.getStatusSincronizacao(
      cliente.id,
    );
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
      'Identifica e importa até 20 XMLs processados de NF-e, NFC-e e CT-e pertencentes à empresa logada. Eventos, resumos e modelos fora do escopo são ignorados.',
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

    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) {
      throw new NotFoundException(
        'Empresa não encontrada para o usuário logado.',
      );
    }

    const requestId = this.logger.generateRequestId();
    const result = await this.importacaoXmlService.importar({
      files,
      actorUserId: user.id,
      requestId,
      clienteId: cliente.id,
    });
    this.logger.info('fiscal_xml_import_completed', {
      requestId,
      userId: user.id,
      clienteId: cliente.id,
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

  @Get('documentos')
  @ApiOperation({
    summary: 'Listar documentos fiscais da empresa',
    description:
      'Retorna lista paginada dos documentos fiscais pertencentes ao cliente logado.',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de documentos.' })
  async listDocumentos(
    @Query() query: QueryDocumentosFiscaisDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) {
      throw new NotFoundException(
        'Empresa não encontrada para o usuário logado.',
      );
    }

    const pagination = parsePaginationParams(query);
    const result = await this.distribuicaoService.listDocumentosFiscais({
      clienteId: cliente.id,
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
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) {
      throw new NotFoundException(
        'Empresa não encontrada para o usuário logado.',
      );
    }

    const url = await this.distribuicaoService.getXmlDownloadUrl(
      id,
      cliente.id,
    );
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
  async getDanfe(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) {
      throw new NotFoundException(
        'Empresa não encontrada para o usuário logado.',
      );
    }

    const result = await this.danfeService.getDanfePdf(id, cliente.id);
    if ('url' in result) {
      return { url: result.url };
    }
    return { url: null, message: 'DANFE gerada mas URL não disponível.' };
  }

  // ─── Manifestação do Destinatário ─────────────────────────────────────────

  @Post('documentos/:id/manifestar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manifestar documento fiscal',
    description:
      'Envia evento de manifestação do destinatário à SEFAZ (Ciência, Confirmação, Desconhecimento, Não Realizada).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Manifestação enviada com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos ou justificativa ausente.',
  })
  @ApiResponse({ status: 404, description: 'Documento não encontrado.' })
  async manifestarDocumento(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ManifestarDocumentoDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    const cliente = await this.clientesService.getClientForUser(user.id);
    if (!cliente) {
      throw new NotFoundException(
        'Empresa não encontrada para o usuário logado.',
      );
    }

    // Validar justificativa para eventos que exigem
    if (
      (body.tipoEvento === '210220' || body.tipoEvento === '210240') &&
      (!body.justificativa || body.justificativa.length < 15)
    ) {
      throw new BadRequestException(
        'Justificativa é obrigatória (mín. 15 caracteres) para Desconhecimento e Operação não Realizada.',
      );
    }

    const documento =
      await this.distribuicaoService.getDocumentoParaManifestacao(
        id,
        cliente.id,
      );
    if (!documento) {
      throw new NotFoundException('Documento fiscal não encontrado.');
    }
    if (documento.tipoDocumento !== 'NFE' || documento.modelo !== '55') {
      throw new BadRequestException(
        'A manifestação do destinatário está disponível somente para NF-e modelo 55.',
      );
    }
    if (!cliente.uf || !/^[A-Z]{2}$/.test(cliente.uf)) {
      throw new BadRequestException(
        'Informe uma UF válida no cadastro da empresa antes de manifestar a NF-e.',
      );
    }

    // Enviar manifestação à SEFAZ
    let resultado: ManifestacaoSefazResult;
    try {
      resultado = await this.nfeWizardService.enviarManifestacao({
        clienteId: cliente.id,
        cnpj: cliente.cnpj,
        uf: cliente.uf,
        chaveAcesso: documento.chaveAcesso,
        tipoEvento: body.tipoEvento,
        justificativa: body.justificativa,
      });
    } catch (error: unknown) {
      if (error instanceof ManifestacaoSefazRejectedError) {
        throw new BadRequestException(error.message);
      }
      throw new ServiceUnavailableException(
        'Não foi possível enviar a manifestação à SEFAZ. Verifique o certificado e tente novamente.',
      );
    }

    // Mapear tipo de evento para registro
    const tipoEventoMap: Record<string, string> = {
      '210210': 'MANIFESTACAO_CIENCIA',
      '210200': 'MANIFESTACAO_CONFIRMACAO',
      '210220': 'MANIFESTACAO_DESCONHECIMENTO',
      '210240': 'MANIFESTACAO_NAO_REALIZADA',
    };

    // Registrar evento no banco
    await this.distribuicaoService.registrarManifestacao({
      documentoId: id,
      tipoEvento: tipoEventoMap[body.tipoEvento],
      codigoEvento: body.tipoEvento,
      protocolo: resultado.protocolo,
      statusSefaz: resultado.status,
      motivoSefaz: resultado.motivo,
    });

    return {
      success: true,
      message: 'Manifestação enviada com sucesso à SEFAZ.',
      data: {
        protocolo: resultado.protocolo,
        status_sefaz: resultado.status,
        motivo: resultado.motivo,
      },
    };
  }
}
