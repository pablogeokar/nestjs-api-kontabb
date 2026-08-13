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
      this.configService.get<string>('SEFAZ_AMBIENTE') === 'PRODUCAO' ? 1 : 2;

    const wizard = new NFeWizard();
    await wizard.NFE_LoadEnvironment({
      config: {
        dfe: {
          UF: uf,
          CPFCNPJ: '',
          pathCertificado: certData.buffer,
          senhaCertificado: certData.senha,
          baixarXMLDistribuicao: false,
          armazenarXMLAutorizacao: false,
          armazenarXMLConsulta: false,
          armazenarXMLRetorno: false,
          armazenarRetornoEmJSON: false,
        },
        nfe: {
          ambiente,
          versaoDF: '4.00',
        },
        lib: {
          useOpenSSL: false,
          useForSchemaValidation: 'validateSchemaJsBased',
        },
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

      const resposta = await wizard.NFE_DistribuicaoDFePorUltNSU({
        cUFAutor: this.getCodigoUF(input.uf),
        CNPJ: input.cnpj,
        distNSU: {
          ultNSU,
        },
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
   * Consulta Distribuição de CT-e na SEFAZ usando @nfewizard/cte.
   */
  async consultarDistribuicaoCTe(input: {
    clienteId: string;
    cnpj: string;
    uf: string;
    ultimoNsu: number;
  }) {
    const certData = await this.certificadoService.getDecryptedCertificate(
      input.clienteId,
    );
    if (!certData) {
      throw new Error(
        `Nenhum certificado digital A1 ativo para o cliente ${input.clienteId}`,
      );
    }

    try {
      const { CTEWizard } = await import('@nfewizard/cte');

      const ambiente =
        this.configService.get<string>('SEFAZ_AMBIENTE') === 'PRODUCAO' ? 1 : 2;

      const cteWizard = new CTEWizard();
      await (cteWizard as any).NFE_LoadEnvironment({
        config: {
          dfe: {
            UF: input.uf,
            CPFCNPJ: input.cnpj,
            pathCertificado: certData.buffer,
            senhaCertificado: certData.senha,
            baixarXMLDistribuicao: false,
            armazenarXMLAutorizacao: false,
            armazenarXMLConsulta: false,
            armazenarXMLRetorno: false,
            armazenarRetornoEmJSON: false,
          },
          nfe: {
            ambiente,
            versaoDF: '4.00',
          },
          lib: {
            useOpenSSL: false,
            useForSchemaValidation: 'validateSchemaJsBased',
          },
        },
      });

      const ultNSU = input.ultimoNsu.toString().padStart(15, '0');

      this.logger.log(
        `Consultando DistribuicaoCTe para CNPJ ${input.cnpj} a partir do NSU ${ultNSU}`,
      );

      const resposta = await (cteWizard as any).CTE_DistribuicaoDFePorUltNSU({
        cUFAutor: this.getCodigoUF(input.uf),
        CNPJ: input.cnpj,
        distNSU: {
          ultNSU,
        },
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

      const evento = await (wizard as any).NFE_CienciaDaOperacao({
        idLote: Date.now(),
        evento: [
          {
            cOrgao: this.getCodigoUF(input.uf),
            tpAmb:
              this.configService.get<string>('SEFAZ_AMBIENTE') === 'PRODUCAO'
                ? 1
                : 2,
            CNPJ: input.cnpj,
            chNFe: input.chaveAcesso,
            dhEvento: new Date().toISOString(),
            tpEvento: input.tipoEvento as any,
            nSeqEvento: input.sequencia ?? 1,
            verEvento: '1.00',
            detEvento: {
              descEvento: this.getDescEvento(input.tipoEvento),
              ...(input.justificativa ? { xJust: input.justificativa } : {}),
            },
          },
        ],
      } as any);

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

      const resposta = await wizard.NFE_DistribuicaoDFePorChave({
        cUFAutor: this.getCodigoUF(input.uf),
        CNPJ: input.cnpj,
        consChNFe: {
          chNFe: input.chaveAcesso,
        },
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private getCodigoUF(uf: string): number {
    const codigos: Record<string, number> = {
      AC: 12,
      AL: 27,
      AM: 13,
      AP: 16,
      BA: 29,
      CE: 23,
      DF: 53,
      ES: 32,
      GO: 52,
      MA: 21,
      MG: 31,
      MS: 50,
      MT: 51,
      PA: 15,
      PB: 25,
      PE: 26,
      PI: 22,
      PR: 41,
      RJ: 33,
      RN: 24,
      RO: 11,
      RR: 14,
      RS: 43,
      SC: 42,
      SE: 28,
      SP: 35,
      TO: 17,
    };
    return codigos[uf] ?? 91; // 91 = Ambiente Nacional
  }

  private getDescEvento(tipoEvento: string): string {
    const descricoes: Record<string, string> = {
      '210210': 'Ciencia da Operacao',
      '210200': 'Confirmacao da Operacao',
      '210220': 'Desconhecimento da Operacao',
      '210240': 'Operacao nao Realizada',
    };
    return descricoes[tipoEvento] ?? '';
  }
}
