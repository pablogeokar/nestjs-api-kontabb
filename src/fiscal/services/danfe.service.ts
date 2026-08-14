import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.service';
import { documentosFiscais } from '../../database/schema';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

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
    const conditions: any[] = [eq(documentosFiscais.id, documentoId)];
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
      throw new Error(
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
    } catch (error: any) {
      this.logger.error(
        `Erro ao gerar DANFE para ${doc[0].chaveAcesso}: ${error.message}`,
        error.stack,
      );
      throw new Error(
        error.message || 'Não foi possível gerar a DANFE. Tente novamente.',
      );
    }
  }

  private async generateDanfePdf(
    xmlContent: string,
    chaveAcesso: string,
  ): Promise<Buffer> {
    // @nfewizard/danfe requer outputPath (grava em disco via PDFKit pipe)
    // Usamos um arquivo temporário e lemos o resultado
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(
      tmpDir,
      `danfe_${crypto.randomBytes(8).toString('hex')}.pdf`,
    );

    try {
      const { NFE_GerarDanfe } = await import('@nfewizard/danfe');

      const result = await NFE_GerarDanfe({
        data: xmlContent,
        chave: chaveAcesso,
        outputPath: tmpFile,
      });

      if (!result.success) {
        throw new Error(result.message || 'Falha na geração do PDF da DANFE');
      }

      // Ler o PDF gerado do disco
      if (!fs.existsSync(tmpFile)) {
        throw new Error('Arquivo PDF não foi gerado pela lib');
      }

      const pdfBuffer = fs.readFileSync(tmpFile);
      return pdfBuffer;
    } finally {
      // Limpar arquivo temporário
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch {
        // Ignorar erro de cleanup
      }
    }
  }
}
