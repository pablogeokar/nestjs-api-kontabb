import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RhService } from './rh.service';
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
import { extractDadosFolhaPagamento } from '../common/pdf-extraction-rh';
import { sanitizeFileName } from '../common/file-validation';
import type { CurrentUser as CurrentUserType } from '../common/types';

interface RhFileResult {
  fileName: string;
  success: boolean;
  message: string;
  cnpj?: string;
  competencia?: string;
  totalFuncionarios?: number;
}

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

    const results: RhFileResult[] = [];

    for (const file of files) {
      const result = await this.processFile(file, {
        requestId,
        actorUserId: currentUser.id,
      });
      results.push(result);
    }

    return {
      success: results.every((r) => r.success),
      total: results.length,
      processed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  private async processFile(
    file: Express.Multer.File,
    ctx: { requestId: string; actorUserId: string },
  ): Promise<RhFileResult> {
    if (file.mimetype !== 'application/pdf') {
      return {
        fileName: file.originalname,
        success: false,
        message: 'Apenas arquivos PDF são aceitos.',
      };
    }

    const bytes = new Uint8Array(file.buffer);
    if (!hasValidFileSignature(bytes, file.mimetype)) {
      return {
        fileName: file.originalname,
        success: false,
        message: 'Conteúdo do arquivo não corresponde a um PDF válido.',
      };
    }

    // Extract text from PDF
    let text: string;
    try {
      text = await extractPdfText(Buffer.from(file.buffer));
    } catch {
      return {
        fileName: file.originalname,
        success: false,
        message: 'Falha ao extrair texto do PDF.',
      };
    }

    // Parse payroll data
    const dados = extractDadosFolhaPagamento(text);
    if (!dados) {
      return {
        fileName: file.originalname,
        success: false,
        message:
          'O arquivo não é uma folha de pagamento válida ou não foi possível extrair os dados.',
      };
    }

    // Find client by CNPJ
    const cnpjDigits = dados.cnpj.replace(/\D/g, '');
    const client = await this.clientesService.findClientForUpload(cnpjDigits);
    if (!client) {
      return {
        fileName: file.originalname,
        success: false,
        message: `Cliente com CNPJ ${dados.cnpj} não encontrado.`,
        cnpj: dados.cnpj,
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
      };
    }

    // Upload to R2
    const folhaUuid = crypto.randomUUID();
    const [month, year] = dados.competencia.split('/');
    const r2Key = `rh/${cnpjDigits}/${year}/${month}/folha-${folhaUuid}.pdf`;

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
      };
    }

    // Notify client via email (fire-and-forget)
    if (client.emails && client.emails.length > 0) {
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
    };
  }
}
