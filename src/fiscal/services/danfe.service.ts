import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq, and, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.service';
import { documentosFiscais } from '../../database/schema';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DacteService } from './dacte.service';

const PDF_WRITE_TIMEOUT_MS = 10_000;
const PDF_POLL_INTERVAL_MS = 25;

/**
 * Gera e serve DANFE (NF-e/NFC-e) e DACTE (CT-e) a partir do XML fiscal.
 */
@Injectable()
export class DanfeService {
  private readonly logger = new Logger(DanfeService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly dacteService: DacteService,
  ) {}

  /**
   * Gera o PDF da DANFE/DACTE para um documento fiscal totalmente em memória.
   * O XML autorizado é lido e o PDF é montado on-the-fly, sem persistir o
   * arquivo no R2. O buffer resultante é retornado para ser transmitido
   * diretamente ao usuário.
   */
  async getDanfePdf(
    documentoId: string,
    clienteId?: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const conditions: SQL[] = [eq(documentosFiscais.id, documentoId)];
    if (clienteId) {
      conditions.push(eq(documentosFiscais.clienteId, clienteId));
    }

    const doc = await this.database.db
      .select({
        id: documentosFiscais.id,
        xmlKey: documentosFiscais.xmlKey,
        chaveAcesso: documentosFiscais.chaveAcesso,
        tipoDocumento: documentosFiscais.tipoDocumento,
      })
      .from(documentosFiscais)
      .where(and(...conditions))
      .limit(1);

    if (!doc[0]) {
      throw new NotFoundException('Documento fiscal não encontrado.');
    }

    // Gerar o documento auxiliar correspondente a partir do XML autorizado,
    // inteiramente em memória.
    try {
      const xmlBuffer = await this.storage.download(doc[0].xmlKey);
      const xmlContent = xmlBuffer.toString('utf-8');

      const pdfBuffer =
        doc[0].tipoDocumento === 'CTE'
          ? await this.dacteService.generatePdf(xmlContent)
          : await this.generateDanfePdf(
              xmlContent,
              doc[0].chaveAcesso,
              doc[0].tipoDocumento,
            );

      return { buffer: pdfBuffer, contentType: 'application/pdf' };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(
        `Erro ao gerar documento auxiliar para ${doc[0].chaveAcesso}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Não foi possível gerar o PDF do documento fiscal. Tente novamente.',
      );
    }
  }

  private async generateDanfePdf(
    xmlContent: string,
    chaveAcesso: string,
    tipoDocumento: string,
  ): Promise<Buffer> {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'kontabb-danfe-'));
    const temporaryFile = join(temporaryDirectory, 'documento.pdf');

    try {
      const { NFCE_GerarDanfe, NFE_GerarDanfe } =
        await import('@nfewizard/danfe');
      const gerarDanfe =
        tipoDocumento === 'NFCE' ? NFCE_GerarDanfe : NFE_GerarDanfe;

      const result = await gerarDanfe({
        data: xmlContent,
        chave: chaveAcesso,
        outputPath: temporaryFile,
      });

      if (!result.success) {
        throw new Error(result.message || 'Falha na geração do PDF da DANFE');
      }

      // A versao atual da biblioteca resolve antes de o stream do PDFKit
      // terminar. Aguardamos o cabecalho e o marcador final do PDF.
      return await this.waitForCompletePdf(temporaryFile);
    } finally {
      try {
        await rm(temporaryDirectory, { recursive: true, force: true });
      } catch (cleanupError: unknown) {
        const message =
          cleanupError instanceof Error
            ? cleanupError.message
            : 'erro desconhecido';
        this.logger.warn(
          `Diretorio temporario da DANFE nao removido: ${message}`,
        );
      }
    }
  }

  private async waitForCompletePdf(filePath: string): Promise<Buffer> {
    const deadline = Date.now() + PDF_WRITE_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const pdf = await readFile(filePath);
        if (this.isCompletePdf(pdf)) return pdf;
      } catch (error: unknown) {
        const errorCode =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if (errorCode !== 'ENOENT') {
          throw error;
        }
      }
      await delay(PDF_POLL_INTERVAL_MS);
    }

    throw new Error('A geração do PDF excedeu o tempo limite.');
  }

  private isCompletePdf(pdf: Buffer) {
    if (pdf.length < 8 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return false;
    }
    return pdf.subarray(Math.max(0, pdf.length - 1_024)).includes('%%EOF');
  }
}
