import {
  BadRequestException,
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

const PDF_WRITE_TIMEOUT_MS = 10_000;
const PDF_POLL_INTERVAL_MS = 25;

/**
 * Serviço responsável por gerar e servir DANFEs (PDF) a partir do XML fiscal.
 * Utiliza @nfewizard/danfe para renderização de NF-e e NFC-e.
 * CT-e (DACTE) não é suportado pela lib atualmente — retorna URL do XML.
 */
@Injectable()
export class DanfeService {
  private readonly logger = new Logger(DanfeService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Gera ou retorna o PDF da DANFE para um documento fiscal.
   * Se a DANFE já foi gerada (danfeKey presente), retorna presigned URL.
   * Caso contrário, gera a partir do XML e salva no R2.
   */
  async getDanfePdf(
    documentoId: string,
    clienteId?: string,
  ): Promise<{ url: string } | { buffer: Buffer; contentType: string }> {
    const conditions: SQL[] = [eq(documentosFiscais.id, documentoId)];
    if (clienteId) {
      conditions.push(eq(documentosFiscais.clienteId, clienteId));
    }

    const doc = await this.database.db
      .select({
        id: documentosFiscais.id,
        xmlKey: documentosFiscais.xmlKey,
        danfeKey: documentosFiscais.danfeKey,
        chaveAcesso: documentosFiscais.chaveAcesso,
        tipoDocumento: documentosFiscais.tipoDocumento,
      })
      .from(documentosFiscais)
      .where(and(...conditions))
      .limit(1);

    if (!doc[0]) {
      throw new NotFoundException('Documento fiscal não encontrado.');
    }

    // Se a DANFE já foi gerada, retornar URL assinada
    if (doc[0].danfeKey) {
      const url = await this.storage.getSignedUrl(doc[0].danfeKey, 600);
      return { url };
    }

    // CT-e (DACTE) não suportado pela lib @nfewizard/danfe
    if (doc[0].tipoDocumento === 'CTE') {
      throw new BadRequestException(
        'Geração de DACTE (CT-e) não disponível. Use o download do XML.',
      );
    }

    // Gerar DANFE a partir do XML
    try {
      const xmlBuffer = await this.storage.download(doc[0].xmlKey);
      const xmlContent = xmlBuffer.toString('utf-8');

      const pdfBuffer = await this.generateDanfePdf(
        xmlContent,
        doc[0].chaveAcesso,
        doc[0].tipoDocumento,
      );

      // Salvar no R2
      const danfeKey = doc[0].xmlKey.replace('.xml', '.pdf');
      await this.storage.upload(danfeKey, pdfBuffer, 'application/pdf');

      // Atualizar registro no banco
      await this.database.db
        .update(documentosFiscais)
        .set({ danfeKey, atualizadoEm: new Date() })
        .where(eq(documentosFiscais.id, doc[0].id));

      // Retornar URL assinada do PDF recém-gerado
      const url = await this.storage.getSignedUrl(danfeKey, 600);
      return { url };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(
        `Erro ao gerar DANFE para ${doc[0].chaveAcesso}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Não foi possível gerar a DANFE. Tente novamente.',
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
