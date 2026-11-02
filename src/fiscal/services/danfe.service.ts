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
import { DacteService } from './dacte.service';
import { NfsePdfService } from './nfse-pdf.service';
import { DanfeNfeService } from './danfe-nfe.pdf';

/**
 * Gera e serve DANFE, DACTE e espelho de NFS-e a partir do XML fiscal.
 */
@Injectable()
export class DanfeService {
  private readonly logger = new Logger(DanfeService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly dacteService: DacteService,
    private readonly nfsePdfService: NfsePdfService,
    private readonly danfeNfeService: DanfeNfeService,
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
        modelo: documentosFiscais.modelo,
        situacao: documentosFiscais.situacao,
      })
      .from(documentosFiscais)
      .where(and(...conditions))
      .limit(1);

    if (!doc[0]) {
      throw new NotFoundException('Documento fiscal não encontrado.');
    }
    if (doc[0].situacao === 'RESUMIDA') {
      throw new NotFoundException(
        'DANFE indisponível enquanto a SEFAZ não fornecer o XML completo.',
      );
    }

    // Gerar o documento auxiliar correspondente a partir do XML autorizado,
    // inteiramente em memória.
    try {
      const xmlBuffer = await this.storage.download(doc[0].xmlKey);
      const xmlContent = xmlBuffer.toString('utf-8');

      let pdfBuffer: Buffer;
      if (doc[0].tipoDocumento === 'NFSE') {
        pdfBuffer = await this.nfsePdfService.generatePdf(xmlContent);
      } else if (doc[0].tipoDocumento === 'CTE') {
        pdfBuffer = await this.dacteService.generatePdf(xmlContent);
      } else if (
        doc[0].tipoDocumento === 'NFE' ||
        doc[0].tipoDocumento === 'NFCE' ||
        doc[0].modelo === '65'
      ) {
        pdfBuffer = await this.danfeNfeService.generatePdf(xmlContent);
      } else {
        throw new Error('Tipo de documento fiscal sem gerador de PDF.');
      }

      return { buffer: pdfBuffer, contentType: 'application/pdf' };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(
        `Erro ao gerar documento auxiliar para ${doc[0].id}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Não foi possível gerar o PDF do documento fiscal. Tente novamente.',
      );
    }
  }
}
