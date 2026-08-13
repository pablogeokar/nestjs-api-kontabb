import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.service';
import { documentosFiscais } from '../../database/schema';

/**
 * Serviço responsável por gerar e servir DANFEs (PDF) a partir do XML fiscal.
 * Utiliza @nfewizard/danfe para renderização.
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

    // Gerar DANFE a partir do XML
    try {
      const xmlUrl = await this.storage.getSignedUrl(doc[0].xmlKey, 60);
      const xmlResponse = await fetch(xmlUrl);
      if (!xmlResponse.ok) {
        throw new Error('Falha ao baixar XML do R2');
      }
      const xmlContent = await xmlResponse.text();

      // Gerar PDF usando @nfewizard/danfe
      const pdfBuffer = await this.generateDanfePdf(
        xmlContent,
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

      return { buffer: pdfBuffer, contentType: 'application/pdf' };
    } catch (error: any) {
      this.logger.error(
        `Erro ao gerar DANFE para ${doc[0].chaveAcesso}: ${error.message}`,
        error.stack,
      );
      throw new Error(
        'Não foi possível gerar a DANFE. Tente novamente mais tarde.',
      );
    }
  }

  private async generateDanfePdf(
    xmlContent: string,
    tipoDocumento: string,
  ): Promise<Buffer> {
    try {
      const { NFeGerarDanfe } = await import('@nfewizard/danfe');

      const danfe = new NFeGerarDanfe({
        data: xmlContent,
        chave: '',
      } as any);
      const result = await danfe.generatePDF();

      if (!result.success) {
        throw new Error(result.message || 'Falha ao gerar DANFE');
      }

      // NFeGerarDanfe usa pdfkit internamente e grava em disco por padrão.
      // Para uso em buffer direto, a lib precisa de adaptação.
      throw new Error(
        'Geração de DANFE em memória requer configuração de outputPath.',
      );
    } catch (error: any) {
      this.logger.warn(`@nfewizard/danfe: ${error.message}`);
      throw new Error(
        'Geração de DANFE indisponível no momento. Use o download do XML.',
      );
    }
  }
}
