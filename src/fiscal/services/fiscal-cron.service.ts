import { Injectable, Logger } from '@nestjs/common';
import { DistribuicaoDfeService } from './distribuicao-dfe.service';
import { CertificadoService } from './certificado.service';

/**
 * Serviço responsável pela sincronização periódica dos documentos fiscais.
 * Deve ser invocado via endpoint cron (ex: Vercel Cron / CloudFlare Workers).
 */
@Injectable()
export class FiscalCronService {
  private readonly logger = new Logger(FiscalCronService.name);

  constructor(
    private readonly distribuicao: DistribuicaoDfeService,
    private readonly certificado: CertificadoService,
  ) {}

  /**
   * Job principal: sincroniza DFe para todos os clientes com certificado ativo.
   * Deve ser chamado a cada 4-6 horas via cron externo.
   */
  async executarSincronizacao() {
    this.logger.log('Iniciando sincronização fiscal programada...');

    const inicio = Date.now();

    try {
      // 1. Atualizar status de certificados (expirados, prestes a expirar)
      await this.certificado.atualizarStatusCertificados();
      this.logger.log('Status de certificados atualizado.');

      // 2. Sincronizar todos os clientes
      const resultados = await this.distribuicao.sincronizarTodos();

      const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
      const totalDocs = resultados.reduce((acc, r) => {
        const nfeDocs =
          typeof r.nfe?.documentosProcessados === 'number'
            ? r.nfe.documentosProcessados
            : 0;
        const cteDocs =
          typeof r.cte?.documentosProcessados === 'number'
            ? r.cte.documentosProcessados
            : 0;
        return acc + nfeDocs + cteDocs;
      }, 0);

      this.logger.log(
        `Sincronização concluída em ${duracao}s. ` +
          `Clientes processados: ${resultados.length}. ` +
          `Documentos novos: ${totalDocs}.`,
      );

      return {
        success: true,
        duracao_segundos: parseFloat(duracao),
        clientes_processados: resultados.length,
        documentos_novos: totalDocs,
        detalhes: resultados,
      };
    } catch (error: any) {
      this.logger.error(
        `Erro na sincronização fiscal: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        error: error.message,
        duracao_segundos: parseFloat(
          ((Date.now() - inicio) / 1000).toFixed(1),
        ),
      };
    }
  }
}
