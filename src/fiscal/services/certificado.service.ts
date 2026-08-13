import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { X509Certificate } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.service';
import { AppLogger } from '../../common/logger.service';
import { CryptoUtil } from '../../common/crypto.util';
import {
  certificadosDigitais,
  clientes,
} from '../../database/schema';

export interface CertificadoMetadata {
  cnpj: string;
  razaoSocial: string;
  emissor: string;
  thumbprint: string;
  validadeInicio: Date;
  validadeFim: Date;
}

export interface DecryptedCertificate {
  buffer: Buffer;
  senha: string;
}

@Injectable()
export class CertificadoService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Valida o certificado PFX, extrai metadados, criptografa e armazena no R2.
   */
  async uploadCertificado(input: {
    clienteId: string;
    pfxBuffer: Buffer;
    senha: string;
    uploadadoPor: string;
  }) {
    // 1. Buscar o cliente para obter o CNPJ
    const cliente = await this.database.db
      .select({ id: clientes.id, cnpj: clientes.cnpj })
      .from(clientes)
      .where(eq(clientes.id, input.clienteId))
      .limit(1);

    if (!cliente[0]) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const cnpjCliente = cliente[0].cnpj;

    // 2. Validar o certificado e extrair metadados
    let metadata: CertificadoMetadata;
    try {
      metadata = this.extractPfxMetadata(input.pfxBuffer, input.senha);
    } catch (error: any) {
      this.logger.error('certificate_validation_failed', error, {
        clienteId: input.clienteId,
        operation: 'upload_certificado',
      });
      throw new BadRequestException(
        'Certificado inválido ou senha incorreta. Verifique o arquivo e a senha informada.',
      );
    }

    // 3. Verificar se o CNPJ do certificado bate com o CNPJ do cliente
    if (metadata.cnpj !== cnpjCliente) {
      throw new BadRequestException(
        `O CNPJ do certificado (${metadata.cnpj}) não corresponde ao CNPJ do cliente (${cnpjCliente}).`,
      );
    }

    // 4. Verificar validade do certificado
    const now = new Date();
    if (metadata.validadeFim < now) {
      throw new BadRequestException(
        'O certificado digital está expirado. Envie um certificado válido.',
      );
    }

    // 5. Revogar certificados anteriores ativos do mesmo cliente
    await this.database.db
      .update(certificadosDigitais)
      .set({ status: 'REVOGADO', atualizadoEm: new Date() })
      .where(
        and(
          eq(certificadosDigitais.clienteId, input.clienteId),
          inArray(certificadosDigitais.status, ['ATIVO', 'PRESTES_A_EXPIRAR']),
        ),
      );

    // 6. Criptografar o arquivo PFX com AES-256-GCM
    const { encryptedData, iv, authTag } = CryptoUtil.encrypt(input.pfxBuffer);
    const encryptedBuffer = Buffer.from(
      JSON.stringify({ encryptedData, iv, authTag }),
      'utf-8',
    );

    // 7. Upload criptografado ao R2
    const certId = crypto.randomUUID();
    const arquivoKey = `clientes/${cnpjCliente}/certificados/${certId}.pfx.enc`;
    await this.storage.upload(
      arquivoKey,
      encryptedBuffer,
      'application/octet-stream',
    );

    // 8. Criptografar a senha do certificado
    const senhaCriptografada = CryptoUtil.encryptString(input.senha);

    // 9. Determinar status
    const diasParaExpirar = Math.floor(
      (metadata.validadeFim.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    const status = diasParaExpirar <= 30 ? 'PRESTES_A_EXPIRAR' : 'ATIVO';

    // 10. Gravar no banco
    const [record] = await this.database.db
      .insert(certificadosDigitais)
      .values({
        id: certId,
        clienteId: input.clienteId,
        cnpj: metadata.cnpj,
        razaoSocial: metadata.razaoSocial,
        arquivoKey,
        senhaCriptografada,
        thumbprint: metadata.thumbprint,
        emissor: metadata.emissor,
        validadeInicio: metadata.validadeInicio,
        validadeFim: metadata.validadeFim,
        status,
        uploadadoPor: input.uploadadoPor,
      })
      .returning({ id: certificadosDigitais.id });

    return {
      id: record.id,
      status,
      validadeFim: metadata.validadeFim.toISOString(),
      diasParaExpirar,
    };
  }

  /**
   * Retorna o certificado descriptografado (buffer + senha) para uso nos webservices.
   */
  async getDecryptedCertificate(
    clienteId: string,
  ): Promise<DecryptedCertificate | null> {
    const cert = await this.database.db
      .select({
        arquivoKey: certificadosDigitais.arquivoKey,
        senhaCriptografada: certificadosDigitais.senhaCriptografada,
      })
      .from(certificadosDigitais)
      .where(
        and(
          eq(certificadosDigitais.clienteId, clienteId),
          inArray(certificadosDigitais.status, ['ATIVO', 'PRESTES_A_EXPIRAR']),
        ),
      )
      .limit(1);

    if (!cert[0]) return null;

    // Baixar o arquivo criptografado do R2
    const signedUrl = await this.storage.getSignedUrl(cert[0].arquivoKey, 60);
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(
        `Falha ao baixar certificado do R2: ${response.statusText}`,
      );
    }

    const encryptedJson = JSON.parse(await response.text()) as {
      encryptedData: string;
      iv: string;
      authTag: string;
    };

    const pfxBuffer = CryptoUtil.decrypt(
      encryptedJson.encryptedData,
      encryptedJson.iv,
      encryptedJson.authTag,
    );

    const senha = CryptoUtil.decryptString(cert[0].senhaCriptografada);

    return { buffer: pfxBuffer, senha };
  }

  /**
   * Lista certificados de um cliente específico ou todos.
   */
  async listCertificados(clienteId?: string) {
    const condition = clienteId
      ? eq(certificadosDigitais.clienteId, clienteId)
      : undefined;

    const rows = await this.database.db
      .select({
        id: certificadosDigitais.id,
        clienteId: certificadosDigitais.clienteId,
        cnpj: certificadosDigitais.cnpj,
        razaoSocial: certificadosDigitais.razaoSocial,
        thumbprint: certificadosDigitais.thumbprint,
        emissor: certificadosDigitais.emissor,
        validadeInicio: certificadosDigitais.validadeInicio,
        validadeFim: certificadosDigitais.validadeFim,
        status: certificadosDigitais.status,
        criadoEm: certificadosDigitais.criadoEm,
      })
      .from(certificadosDigitais)
      .where(condition)
      .orderBy(certificadosDigitais.criadoEm);

    return rows.map((row) => {
      const now = new Date();
      const diasParaExpirar = Math.floor(
        (row.validadeFim.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      return {
        id: row.id,
        cliente_id: row.clienteId,
        cnpj: row.cnpj,
        razao_social: row.razaoSocial,
        thumbprint: row.thumbprint,
        emissor: row.emissor,
        validade_inicio: row.validadeInicio.toISOString(),
        validade_fim: row.validadeFim.toISOString(),
        status: row.status,
        dias_para_expirar: diasParaExpirar,
        criado_em: row.criadoEm.toISOString(),
      };
    });
  }

  /**
   * Retorna o status do certificado ativo de um cliente.
   */
  async getCertificadoStatus(clienteId: string) {
    const cert = await this.database.db
      .select({
        id: certificadosDigitais.id,
        cnpj: certificadosDigitais.cnpj,
        razaoSocial: certificadosDigitais.razaoSocial,
        thumbprint: certificadosDigitais.thumbprint,
        emissor: certificadosDigitais.emissor,
        validadeInicio: certificadosDigitais.validadeInicio,
        validadeFim: certificadosDigitais.validadeFim,
        status: certificadosDigitais.status,
        criadoEm: certificadosDigitais.criadoEm,
      })
      .from(certificadosDigitais)
      .where(
        and(
          eq(certificadosDigitais.clienteId, clienteId),
          inArray(certificadosDigitais.status, ['ATIVO', 'PRESTES_A_EXPIRAR']),
        ),
      )
      .limit(1);

    if (!cert[0]) return null;

    const now = new Date();
    const diasParaExpirar = Math.floor(
      (cert[0].validadeFim.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      id: cert[0].id,
      cnpj: cert[0].cnpj,
      razao_social: cert[0].razaoSocial,
      thumbprint: cert[0].thumbprint,
      emissor: cert[0].emissor,
      validade_inicio: cert[0].validadeInicio.toISOString(),
      validade_fim: cert[0].validadeFim.toISOString(),
      status: cert[0].status,
      dias_para_expirar: diasParaExpirar,
      criado_em: cert[0].criadoEm.toISOString(),
    };
  }

  /**
   * Job periódico: atualiza status dos certificados (ATIVO -> PRESTES_A_EXPIRAR / EXPIRADO)
   */
  async atualizarStatusCertificados() {
    const now = new Date();
    const limiteAlerta = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Marcar expirados
    await this.database.db
      .update(certificadosDigitais)
      .set({ status: 'EXPIRADO', atualizadoEm: now })
      .where(
        and(
          inArray(certificadosDigitais.status, ['ATIVO', 'PRESTES_A_EXPIRAR']),
          sql`${certificadosDigitais.validadeFim} < ${now}`,
        ),
      );

    // Marcar prestes a expirar
    await this.database.db
      .update(certificadosDigitais)
      .set({ status: 'PRESTES_A_EXPIRAR', atualizadoEm: now })
      .where(
        and(
          eq(certificadosDigitais.status, 'ATIVO'),
          sql`${certificadosDigitais.validadeFim} <= ${limiteAlerta}`,
          sql`${certificadosDigitais.validadeFim} >= ${now}`,
        ),
      );
  }

  /**
   * Extrai metadados do certificado PFX/P12.
   */
  private extractPfxMetadata(
    pfxBuffer: Buffer,
    passphrase: string,
  ): CertificadoMetadata {
    // Node.js native crypto para ler o certificado X.509 do PFX
    const cert = new X509Certificate(pfxBuffer);

    // Extrair CNPJ do Subject (comum em certificados brasileiros)
    // Formato do subject: CN=NOME:12345678000195, OU=...
    const subject = cert.subject;
    let cnpj = '';
    let razaoSocial = '';

    // Tentar extrair CNPJ do campo CN ou do subject completo
    const cnMatch = subject.match(/CN=([^,\n]+)/);
    if (cnMatch) {
      const cn = cnMatch[1];
      // CNPJ pode estar após ":" ou no final do CN
      const cnpjMatch = cn.match(/(\d{14})/);
      if (cnpjMatch) {
        cnpj = cnpjMatch[1];
      }
      // Razão social é a parte antes do ":"
      razaoSocial = cn.split(':')[0].trim();
    }

    if (!cnpj) {
      // Tentar extrair do campo serialNumber ou do subject alternativo
      const serialMatch = subject.match(
        /(?:serialNumber|2\.16\.76\.1\.3\.3)=(\d{14})/,
      );
      if (serialMatch) {
        cnpj = serialMatch[1];
      }
    }

    if (!cnpj) {
      throw new Error(
        'Não foi possível extrair o CNPJ do certificado digital.',
      );
    }

    const emissor = cert.issuer.match(/CN=([^,\n]+)/)?.[1] ?? cert.issuer;
    const thumbprint = cert.fingerprint256.replace(/:/g, '').toLowerCase();

    return {
      cnpj,
      razaoSocial: razaoSocial || 'N/A',
      emissor,
      thumbprint,
      validadeInicio: new Date(cert.validFrom),
      validadeFim: new Date(cert.validTo),
    };
  }
}
