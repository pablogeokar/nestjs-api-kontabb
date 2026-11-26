import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
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
import { RhService } from './rh.service';
import { RhRescisaoService } from './rh-rescisao.service';
import {
  RhRescisaoUploadService,
  type RhFileResult,
} from './rh-rescisao-upload.service';
import { ClientesService } from '../clientes/clientes.service';
import { StorageService } from '../storage/storage.service';
import { AuthGuard } from '../auth/auth.guard';
import { StaffOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import { RateLimitService } from '../common/rate-limit.service';
import { MailService } from '../mail/mail.service';
import { hasValidFileSignature } from '../common/file-validation';
import { extractPdfText } from '../common/pdf-extraction';
import {
  extractDadosAdiantamento13,
  extractDadosFolhaPagamento,
  isAdiantamento13,
} from '../common/pdf-extraction-rh';
import {
  extractDadosFerias,
  isReciboFerias,
} from '../common/pdf-extraction-ferias';
import {
  detectRescisaoDocumentoTipo,
  isRescisaoDocumentoTipo,
  type RescisaoDocumentoTipo,
} from '../common/pdf-extraction-rescisao';
import { sanitizeFileName } from '../common/file-validation';
import type { CurrentUser as CurrentUserType } from '../common/types';
import { normalizeCnpjIdentifier } from '../common/cnpj-identifier';

@ApiTags('RH (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/rh')
@UseGuards(AuthGuard)
@StaffOnly()
export class RhUploadController {
  constructor(
    private readonly rhService: RhService,
    private readonly clientesService: ClientesService,
    private readonly storage: StorageService,
    private readonly logger: AppLogger,
    private readonly rateLimit: RateLimitService,
    private readonly mail: MailService,
    private readonly rescisaoService: RhRescisaoService,
    private readonly rescisaoUpload: RhRescisaoUploadService,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('files', 10, { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @ApiOperation({
    summary: 'Upload de folhas de pagamento',
    description:
      'Faz upload de até 10 PDFs de folha de pagamento. Extrai automaticamente dados da empresa e funcionários.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Arquivos PDF de folha de pagamento (máx 10, 10MB cada)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Resultado do processamento das folhas.',
  })
  @ApiResponse({ status: 400, description: 'Nenhum arquivo enviado.' })
  @ApiResponse({ status: 429, description: 'Rate limit excedido.' })
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    await this.rateLimit.consume({
      key: `rh-upload:${currentUser.id}`,
      limit: 10,
      windowMs: 60_000,
    });
    const requestId = this.logger.generateRequestId();

    if (!files || files.length === 0) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }

    // Valida e extrai o texto de todos os arquivos primeiro: o TRCT precisa ser
    // processado antes dos demais documentos da rescisão (que se anexam a ele).
    const prepared = await Promise.all(
      files.map((file) => this.prepareFile(file)),
    );
    const order = prepared
      .map((item, index) => ({ item, index }))
      .sort(
        (a, b) =>
          Number(b.item.rescisaoTipo === 'TRCT') -
          Number(a.item.rescisaoTipo === 'TRCT'),
      );

    const results = new Array<RhFileResult>(files.length);
    for (const { item, index } of order) {
      results[index] =
        'result' in item
          ? item.result
          : await this.processPrepared(item, {
              requestId,
              actorUserId: currentUser.id,
            });
    }

    return {
      success: results.every((r) => r.success),
      total: results.length,
      processed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  @Post('folhas/:folhaId/rescisao/documentos')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @ApiOperation({
    summary: 'Anexar documento a uma rescisão',
    description:
      'Anexa manualmente um PDF (aviso prévio, guia do seguro-desemprego, etc.) a uma rescisão existente.',
  })
  @ApiParam({ name: 'folhaId', type: String, format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'tipoDocumento'],
      properties: {
        file: { type: 'string', format: 'binary' },
        tipoDocumento: {
          type: 'string',
          enum: [
            'TRCT',
            'AVISO_PREVIO',
            'EXAME_DEMISSIONAL',
            'GUIA_SEGURO_DESEMPREGO',
            'CARTA_RECOMENDACAO',
            'HISTORICO_INSS',
            'OUTRO',
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Documento anexado.' })
  @ApiResponse({ status: 400, description: 'Arquivo ou tipo inválido.' })
  @ApiResponse({ status: 404, description: 'Rescisão não encontrada.' })
  async anexarDocumentoRescisao(
    @Param('folhaId', new ParseUUIDPipe({ version: '4' })) folhaId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { tipoDocumento?: string },
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    await this.rateLimit.consume({
      key: `rh-upload:${currentUser.id}`,
      limit: 10,
      windowMs: 60_000,
    });
    const requestId = this.logger.generateRequestId();

    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Apenas arquivos PDF são aceitos.');
    }
    if (!hasValidFileSignature(new Uint8Array(file.buffer), file.mimetype)) {
      throw new BadRequestException(
        'Conteúdo do arquivo não corresponde a um PDF válido.',
      );
    }
    const tipo = body.tipoDocumento;
    // O TRCT só entra pela criação da rescisão (upload automático).
    if (!isRescisaoDocumentoTipo(tipo) || tipo === 'TRCT') {
      throw new BadRequestException('Tipo de documento inválido.');
    }

    const rescisao = await this.rescisaoService.getRescisaoByFolha(folhaId);
    if (!rescisao) throw new NotFoundException('Rescisão não encontrada.');

    const r2Key = `rh/rescisoes/${rescisao.clienteId}/${rescisao.id}/${tipo.toLowerCase()}-${crypto.randomUUID()}.pdf`;
    try {
      await this.storage.upload(
        r2Key,
        Buffer.from(file.buffer),
        'application/pdf',
      );
    } catch (error) {
      this.logger.error('rh_rescisao_documento_storage_failed', error, {
        requestId,
      });
      throw new BadRequestException(
        'Falha ao armazenar o arquivo. Tente novamente.',
      );
    }

    const result = await this.rescisaoService.anexarDocumento({
      rescisaoId: rescisao.id,
      tipo,
      r2Key,
      fileName: sanitizeFileName(file.originalname),
      actorUserId: currentUser.id,
      requestId,
    });
    if (!result.ok) {
      await this.storage.delete(r2Key).catch(() => {});
      throw new BadRequestException(
        result.code === 'DOCUMENTO_DUPLICADO'
          ? 'Este tipo de documento já foi anexado à rescisão.'
          : 'Falha ao anexar o documento. Tente novamente.',
      );
    }
    return { success: true, documentoId: result.documentoId };
  }

  private async prepareFile(file: Express.Multer.File): Promise<
    | { result: RhFileResult; rescisaoTipo?: undefined }
    | {
        file: Express.Multer.File;
        text: string;
        rescisaoTipo: RescisaoDocumentoTipo | null;
      }
  > {
    if (file.mimetype !== 'application/pdf') {
      return {
        result: {
          fileName: file.originalname,
          success: false,
          message: 'Apenas arquivos PDF são aceitos.',
        },
      };
    }

    const bytes = new Uint8Array(file.buffer);
    if (!hasValidFileSignature(bytes, file.mimetype)) {
      return {
        result: {
          fileName: file.originalname,
          success: false,
          message: 'Conteúdo do arquivo não corresponde a um PDF válido.',
        },
      };
    }

    try {
      const text = await extractPdfText(Buffer.from(file.buffer));
      return { file, text, rescisaoTipo: detectRescisaoDocumentoTipo(text) };
    } catch {
      return {
        result: {
          fileName: file.originalname,
          success: false,
          message: 'Falha ao extrair texto do PDF.',
        },
      };
    }
  }

  private async processPrepared(
    item: {
      file: Express.Multer.File;
      text: string;
      rescisaoTipo: RescisaoDocumentoTipo | null;
    },
    ctx: { requestId: string; actorUserId: string },
  ): Promise<RhFileResult> {
    const { file, text, rescisaoTipo } = item;

    if (rescisaoTipo) {
      return this.rescisaoUpload.processFile(file, text, rescisaoTipo, ctx);
    }

    if (isReciboFerias(text)) {
      return this.processFeriasFile(file, text, ctx);
    }

    if (isAdiantamento13(text)) {
      return this.processAdiantamento13File(file, text, ctx);
    }

    return this.processFolhaFile(file, text, ctx);
  }

  private async processFolhaFile(
    file: Express.Multer.File,
    text: string,
    ctx: { requestId: string; actorUserId: string },
  ): Promise<RhFileResult> {
    // Parse payroll data
    const dados = extractDadosFolhaPagamento(text);
    if (!dados) {
      return {
        fileName: file.originalname,
        success: false,
        message:
          'O arquivo não é uma folha de pagamento ou recibo de férias válido.',
      };
    }

    // Find client by CNPJ
    const cnpj = normalizeCnpjIdentifier(dados.cnpj);
    const client = await this.clientesService.findClientForUpload(cnpj);
    if (!client) {
      return {
        fileName: file.originalname,
        success: false,
        message: `Cliente com CNPJ ${dados.cnpj} não encontrado.`,
        cnpj: dados.cnpj,
        tipo: 'FOLHA_MENSAL',
      };
    }

    // Check duplicate
    const existing = await this.rhService.checkDuplicateFolha(
      client.id,
      dados.competencia,
    );
    if (existing) {
      return {
        fileName: file.originalname,
        success: false,
        message: `Folha duplicada: já existe uma folha para a competência ${dados.competencia} deste cliente.`,
        cnpj: dados.cnpj,
        competencia: dados.competencia,
        tipo: 'FOLHA_MENSAL',
      };
    }

    // Upload to R2
    const folhaUuid = crypto.randomUUID();
    const [month, year] = dados.competencia.split('/');
    const r2Key = `rh/${cnpj}/${year}/${month}/folha-${folhaUuid}.pdf`;

    try {
      await this.storage.upload(
        r2Key,
        Buffer.from(file.buffer),
        'application/pdf',
      );
    } catch (error) {
      this.logger.error('rh_upload_storage_failed', error, {
        requestId: ctx.requestId,
      });
      return {
        fileName: file.originalname,
        success: false,
        message: 'Falha ao armazenar o arquivo. Tente novamente.',
        tipo: 'FOLHA_MENSAL',
      };
    }

    // Process
    const result = await this.rhService.processarFolhaPagamento({
      dados,
      clienteId: client.id,
      r2Key,
      fileName: sanitizeFileName(file.originalname),
      actorUserId: ctx.actorUserId,
      requestId: ctx.requestId,
    });

    if (!result.ok) {
      // Cleanup R2 on failure
      await this.storage.delete(r2Key).catch(() => {});
      const message =
        result.code === 'FOLHA_DUPLICADA'
          ? `Folha duplicada: já existe uma folha para a competência ${dados.competencia}.`
          : 'Falha ao processar a folha. Tente novamente.';
      return {
        fileName: file.originalname,
        success: false,
        message,
        cnpj: dados.cnpj,
        tipo: 'FOLHA_MENSAL',
      };
    }

    // Notify client via email (fire-and-forget).
    // Suspended clients do not receive any e-mail notifications.
    if (!client.suspenso && client.emails && client.emails.length > 0) {
      this.mail
        .sendFolhaPagamentoNotificationEmail({
          to: client.emails,
          clientName: client.razaoSocial,
          competencia: dados.competencia,
          totalFuncionarios: dados.totalFuncionarios,
          totalLiquido: String(dados.totalLiquido),
        })
        .catch((err) => {
          this.logger.error('rh_folha_email_notification_failed', err, {
            requestId: ctx.requestId,
            clienteId: client.id,
          });
        });
    }

    return {
      fileName: file.originalname,
      success: true,
      message: 'Folha processada com sucesso.',
      cnpj: dados.cnpj,
      competencia: dados.competencia,
      totalFuncionarios: dados.totalFuncionarios,
      tipo: 'FOLHA_MENSAL',
    };
  }

  private async processAdiantamento13File(
    file: Express.Multer.File,
    text: string,
    ctx: { requestId: string; actorUserId: string },
  ): Promise<RhFileResult> {
    // Parse 13th-salary advance data (same structure as monthly payroll)
    const dados = extractDadosAdiantamento13(text);
    if (!dados) {
      return {
        fileName: file.originalname,
        success: false,
        message:
          'O arquivo foi identificado como adiantamento do 13º salário, mas não foi possível extrair os dados necessários.',
        tipo: 'ADIANTAMENTO_13',
      };
    }

    // Find client by CNPJ
    const cnpj = normalizeCnpjIdentifier(dados.cnpj);
    const client = await this.clientesService.findClientForUpload(cnpj);
    if (!client) {
      return {
        fileName: file.originalname,
        success: false,
        message: `Cliente com CNPJ ${dados.cnpj} não encontrado.`,
        cnpj: dados.cnpj,
        tipo: 'ADIANTAMENTO_13',
      };
    }

    // Check duplicate
    const existing = await this.rhService.checkDuplicateAdiantamento13(
      client.id,
      dados.competencia,
    );
    if (existing) {
      return {
        fileName: file.originalname,
        success: false,
        message: `Adiantamento do 13º duplicado: já existe um registro para a competência ${dados.competencia} deste cliente.`,
        cnpj: dados.cnpj,
        competencia: dados.competencia,
        tipo: 'ADIANTAMENTO_13',
      };
    }

    // Upload to R2
    const folhaUuid = crypto.randomUUID();
    const [month, year] = dados.competencia.split('/');
    const r2Key = `rh/${cnpj}/${year}/${month}/adiantamento13-${folhaUuid}.pdf`;

    try {
      await this.storage.upload(
        r2Key,
        Buffer.from(file.buffer),
        'application/pdf',
      );
    } catch (error) {
      this.logger.error('rh_adiantamento13_upload_storage_failed', error, {
        requestId: ctx.requestId,
      });
      return {
        fileName: file.originalname,
        success: false,
        message: 'Falha ao armazenar o arquivo. Tente novamente.',
        tipo: 'ADIANTAMENTO_13',
      };
    }

    // Process
    const result = await this.rhService.processarAdiantamento13({
      dados,
      clienteId: client.id,
      r2Key,
      fileName: sanitizeFileName(file.originalname),
      actorUserId: ctx.actorUserId,
      requestId: ctx.requestId,
    });

    if (!result.ok) {
      // Cleanup R2 on failure
      await this.storage.delete(r2Key).catch(() => {});
      const message =
        result.code === 'ADIANTAMENTO_13_DUPLICADO'
          ? `Adiantamento do 13º duplicado: já existe um registro para a competência ${dados.competencia}.`
          : 'Falha ao processar o adiantamento do 13º salário. Tente novamente.';
      return {
        fileName: file.originalname,
        success: false,
        message,
        cnpj: dados.cnpj,
        tipo: 'ADIANTAMENTO_13',
      };
    }

    // Notify client via email (fire-and-forget).
    // Suspended clients do not receive any e-mail notifications.
    if (!client.suspenso && client.emails && client.emails.length > 0) {
      this.mail
        .sendAdiantamento13NotificationEmail({
          to: client.emails,
          clientName: client.razaoSocial,
          competencia: dados.competencia,
          totalFuncionarios: dados.totalFuncionarios,
          totalLiquido: String(dados.totalLiquido),
        })
        .catch((err) => {
          this.logger.error(
            'rh_adiantamento13_email_notification_failed',
            err,
            {
              requestId: ctx.requestId,
              clienteId: client.id,
            },
          );
        });
    }

    return {
      fileName: file.originalname,
      success: true,
      message: 'Adiantamento do 13º salário processado com sucesso.',
      cnpj: dados.cnpj,
      competencia: dados.competencia,
      totalFuncionarios: dados.totalFuncionarios,
      tipo: 'ADIANTAMENTO_13',
    };
  }

  private async processFeriasFile(
    file: Express.Multer.File,
    text: string,
    ctx: { requestId: string; actorUserId: string },
  ): Promise<RhFileResult> {
    const dados = extractDadosFerias(text);
    if (!dados) {
      return {
        fileName: file.originalname,
        success: false,
        message:
          'O arquivo foi identificado como férias, mas não foi possível extrair os dados necessários.',
        tipo: 'FERIAS',
      };
    }

    const cnpj = normalizeCnpjIdentifier(dados.cnpj);
    const client = await this.clientesService.findClientForUpload(cnpj);
    if (!client) {
      return {
        fileName: file.originalname,
        success: false,
        message: `Cliente com CNPJ ${dados.cnpj} não encontrado.`,
        cnpj: dados.cnpj,
        tipo: 'FERIAS',
      };
    }

    const existing = await this.rhService.checkDuplicateFerias(
      client.id,
      dados.funcionario.codigoFuncionario,
      dados.periodoInicio,
      dados.periodoFim,
    );
    if (existing) {
      return {
        fileName: file.originalname,
        success: false,
        message: `Recibo de férias duplicado: já existe um registro para ${dados.funcionario.nomeCompleto} no período de ${dados.gozoInicio} a ${dados.gozoFim}.`,
        cnpj: dados.cnpj,
        competencia: dados.competencia,
        tipo: 'FERIAS',
        funcionarioNome: dados.funcionario.nomeCompleto,
      };
    }

    const feriasUuid = crypto.randomUUID();
    const [month, year] = dados.competencia.split('/');
    const r2Key = `rh/${cnpj}/${year}/${month}/ferias-${dados.funcionario.codigoFuncionario}-${feriasUuid}.pdf`;

    try {
      await this.storage.upload(
        r2Key,
        Buffer.from(file.buffer),
        'application/pdf',
      );
    } catch (error) {
      this.logger.error('rh_ferias_upload_storage_failed', error, {
        requestId: ctx.requestId,
      });
      return {
        fileName: file.originalname,
        success: false,
        message: 'Falha ao armazenar o arquivo. Tente novamente.',
        tipo: 'FERIAS',
      };
    }

    const result = await this.rhService.processarFerias({
      dados,
      clienteId: client.id,
      r2Key,
      fileName: sanitizeFileName(file.originalname),
      actorUserId: ctx.actorUserId,
      requestId: ctx.requestId,
    });

    if (!result.ok) {
      await this.storage.delete(r2Key).catch(() => {});
      const message =
        result.code === 'FERIAS_DUPLICADAS'
          ? `Recibo de férias duplicado para ${dados.funcionario.nomeCompleto}.`
          : 'Falha ao processar o recibo de férias. Tente novamente.';
      return {
        fileName: file.originalname,
        success: false,
        message,
        cnpj: dados.cnpj,
        tipo: 'FERIAS',
        funcionarioNome: dados.funcionario.nomeCompleto,
      };
    }

    // Notify client via email (fire-and-forget)
    if (!client.suspenso && client.emails && client.emails.length > 0) {
      this.mail
        .sendFeriasNotificationEmail({
          to: client.emails,
          clientName: client.razaoSocial,
          funcionarioNome: dados.funcionario.nomeCompleto,
          competencia: dados.competencia,
          periodoGozo: `${dados.gozoInicio} a ${dados.gozoFim}`,
          totalLiquido: String(dados.totalLiquido),
        })
        .catch((err) => {
          this.logger.error('rh_ferias_email_notification_failed', err, {
            requestId: ctx.requestId,
            clienteId: client.id,
          });
        });
    }

    return {
      fileName: file.originalname,
      success: true,
      message: `Recibo de férias de ${dados.funcionario.nomeCompleto} processado com sucesso.`,
      cnpj: dados.cnpj,
      competencia: dados.competencia,
      totalFuncionarios: 1,
      tipo: 'FERIAS',
      funcionarioNome: dados.funcionario.nomeCompleto,
    };
  }
}
