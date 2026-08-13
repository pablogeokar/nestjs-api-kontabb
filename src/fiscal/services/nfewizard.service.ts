import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CertificadoService } from './certificado.service';

/**
 * Abstrai a integração com a biblioteca nfewizard-io para chamadas
 * aos WebServices da SEFAZ com o certificado do cliente.
 */
@Injectable()
export class NfeWizardService {
  private readonly logger = new Logger(NfeWizardService.name);

  constructor(
    private readonly certificadoService: CertificadoService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Instancia o NFeWizard configurado com o certificado A1 do cliente.
   */
  async getClientWizardInstance(clienteId: string, uf: string = 'SP') {
    const certData =
      await this.certificadoService.getDecryptedCertificate(clienteId);
    if (!certData) {
      throw new Error(
        `Nenhum certificado digital A1 ativo para o cliente ${clienteId}`,
      );
    }

    // Import dinâmico para evitar problemas de inicialização
    const { NFeWizard } = await import('nfewizard-io');

    const ambiente =
      this.configService.get<string>('SEFAZ_AMBIENTE') === 'PRODUCAO'
        ? '1'
        : '2';

    const wizard = new NFeWizard({
      dfe: {
        UF: uf,
        CPFCNPJ: '',
        tpAmb: ambiente as '1' | '2',
      },
      certificado: {
        pfx: certData.buffer.toString('base64'),
        senha: certData.senha,
      },
    });

    return wizard;
  }

  /**
   * Consulta Distribuição de DF-e na SEFAZ via NFeDistribuicaoDFe.
   * Retorna documentos a partir do ultimoNsu informado.
   */
  async consultarDistribuicaoDFe(input: {
    clienteId: string;
    cnpj: string;
    uf: string;
    ultimoNsu: number;
  }) {
    try {
      const wizard = await this.getClientWizardInstance(
        input.clienteId,
        input.uf,
      );

      const ultNSU = input.ultimoNsu.toString().padStart(15, '0');

      this.logger.log(
        `Consultando DistribuicaoDFe para CNPJ ${input.cnpj} a partir do NSU ${ultNSU}`,
      );

      const resposta = await (wizard as any).distribuicaoDFe({
        distNSU: {
          ultNSU,
        },
        CNPJ: input.cnpj,
      });

      return resposta;
    } catch (error: any) {
      this.logger.error(
        `Erro ao consultar DistribuicaoDFe: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Consulta Distribuição de CT-e na SEFAZ.
   */
  async consultarDistribuicaoCTe(input: {
    clienteId: string;
    cnpj: string;
    uf: string;
    ultimoNsu: number;
  }) {
    try {
      const wizard = await this.getClientWizardInstance(
        input.clienteId,
        input.uf,
      );

      const ultNSU = input.ultimoNsu.toString().padStart(15, '0');

      this.logger.log(
        `Consultando DistribuicaoCTe para CNPJ ${input.cnpj} a partir do NSU ${ultNSU}`,
      );

      const resposta = await (wizard as any).distribuicaoCTe({
        distNSU: {
          ultNSU,
        },
        CNPJ: input.cnpj,
      });

      return resposta;
    } catch (error: any) {
      this.logger.error(
        `Erro ao consultar DistribuicaoCTe: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Envia evento de Manifestação do Destinatário.
   */
  async enviarManifestacao(input: {
    clienteId: string;
    cnpj: string;
    uf: string;
    chaveAcesso: string;
    tipoEvento: '210210' | '210200' | '210220' | '210240';
    sequencia?: number;
    justificativa?: string;
  }) {
    try {
      const wizard = await this.getClientWizardInstance(
        input.clienteId,
        input.uf,
      );

      this.logger.log(
        `Enviando manifestação ${input.tipoEvento} para chave ${input.chaveAcesso}`,
      );

      const evento = await (wizard as any).manifestacaoDestinatario({
        chNFe: input.chaveAcesso,
        CNPJ: input.cnpj,
        tpEvento: input.tipoEvento,
        nSeqEvento: (input.sequencia ?? 1).toString(),
        xJust: input.justificativa,
      });

      return evento;
    } catch (error: any) {
      this.logger.error(
        `Erro ao enviar manifestação: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Consulta um documento específico por chave de acesso.
   */
  async consultarPorChave(input: {
    clienteId: string;
    cnpj: string;
    uf: string;
    chaveAcesso: string;
  }) {
    try {
      const wizard = await this.getClientWizardInstance(
        input.clienteId,
        input.uf,
      );

      const resposta = await (wizard as any).distribuicaoDFe({
        consChNFe: {
          chNFe: input.chaveAcesso,
        },
        CNPJ: input.cnpj,
      });

      return resposta;
    } catch (error: any) {
      this.logger.error(
        `Erro ao consultar por chave: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
