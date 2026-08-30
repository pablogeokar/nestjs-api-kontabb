import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, gte, inArray, lt, lte } from 'drizzle-orm';
import forge from 'node-forge';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.service';
import { AppLogger } from '../../common/logger.service';
import { CryptoUtil } from '../../common/crypto.util';
import { certificadosDigitais, clientes } from '../../database/schema';

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

const CNPJ_PATTERN = /^[0-9A-Z]{12}[0-9]{2}$/;
const CNPJ_IN_TEXT_PATTERN =
  /(^|[^0-9A-Z])([0-9A-Z]{2}[.\s]?[0-9A-Z]{3}[.\s]?[0-9A-Z]{3}[/\s]?[0-9A-Z]{4}[-\s]?[0-9]{2})(?![0-9A-Z])/i;

interface ExtractedCnpj {
  cnpj: string;
  index: number;
}

function normalizeCnpj(value: string): string | null {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[./\s-]/g, '');

  return CNPJ_PATTERN.test(normalized) ? normalized : null;
}

function extractCnpjFromText(value: string): ExtractedCnpj | null {
  const match = CNPJ_IN_TEXT_PATTERN.exec(value.toUpperCase());
  if (!match) return null;

  const cnpj = normalizeCnpj(match[2]);
  if (!cnpj) return null;

  return {
    cnpj,
    index: (match.index ?? 0) + match[1].length,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function getForgeText(value: unknown, depth = 0): string {
  if (depth > 8) return '';

  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'bigint':
    case 'boolean':
      return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => getForgeText(item, depth + 1)).join(' ');
  }

  if (typeof value !== 'object' || value === null) return '';

  const nestedValues: string[] = [];
  if ('value' in value) {
    nestedValues.push(getForgeText(value.value, depth + 1));
  }
  if ('utf8' in value) {
    nestedValues.push(getForgeText(value.utf8, depth + 1));
  }

  return nestedValues.filter(Boolean).join(' ');
}

function getForgeAttributeValue(attribute: unknown): string | null {
  if (
    typeof attribute !== 'object' ||
    attribute === null ||
    !('value' in attribute) ||
    typeof attribute.value !== 'string'
  ) {
    return null;
  }

  return attribute.value;
}

function getForgeExtensionName(extension: unknown): string | null {
  if (
    typeof extension !== 'object' ||
    extension === null ||
    !('name' in extension) ||
    typeof extension.name !== 'string'
  ) {
    return null;
  }

  return extension.name;
}

function getForgeAltNames(extension: unknown): unknown[] {
  if (
    typeof extension !== 'object' ||
    extension === null ||
    !('altNames' in extension) ||
    !Array.isArray(extension.altNames)
  ) {
    return [];
  }

  return extension.altNames as unknown[];
}

function getForgeAltNameValue(altName: unknown): string {
  if (typeof altName !== 'object' || altName === null) {
    return '';
  }

  const values: string[] = [];
  if ('value' in altName && altName.value != null) {
    values.push(getForgeText(altName.value));
  }

  if ('utf8' in altName && altName.utf8 != null) {
    values.push(getForgeText(altName.utf8));
  }

  return values.filter(Boolean).join(' ');
}

function getForgeSubjectAttributeValue(
  attribute: forge.pki.CertificateField,
): string {
  return getForgeText(attribute.value as unknown);
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

    const cnpjCliente = normalizeCnpj(cliente[0].cnpj);

    // 2. Validar o certificado e extrair metadados
    let metadata: CertificadoMetadata;
    try {
      metadata = this.extractPfxMetadata(input.pfxBuffer, input.senha);
    } catch (error: unknown) {
      this.logger.error('certificate_validation_failed', error, {
        clienteId: input.clienteId,
        operation: 'upload_certificado',
      });
      throw new BadRequestException(
        'Certificado inválido ou senha incorreta. Verifique o arquivo e a senha informada.',
      );
    }

    // 3. Verificar se o CNPJ do certificado bate com o CNPJ do cliente
    if (!cnpjCliente || metadata.cnpj !== cnpjCliente) {
      throw new BadRequestException(
        `O CNPJ do certificado (${metadata.cnpj}) não corresponde ao CNPJ do cliente (${cliente[0].cnpj}).`,
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
    await this.database.db
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
      .returning();

    return {
      id: certId,
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

    // Baixar o arquivo criptografado diretamente do R2 via SDK (sem presigned URL)
    const encryptedBuffer = await this.storage.download(cert[0].arquivoKey);

    const encryptedJson = JSON.parse(encryptedBuffer.toString('utf-8')) as {
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
          lt(certificadosDigitais.validadeFim, now),
        ),
      );

    // Marcar prestes a expirar
    await this.database.db
      .update(certificadosDigitais)
      .set({ status: 'PRESTES_A_EXPIRAR', atualizadoEm: now })
      .where(
        and(
          eq(certificadosDigitais.status, 'ATIVO'),
          lte(certificadosDigitais.validadeFim, limiteAlerta),
          gte(certificadosDigitais.validadeFim, now),
        ),
      );
  }

  /**
   * Extrai metadados do certificado PFX/P12 usando node-forge.
   */
  private extractPfxMetadata(
    pfxBuffer: Buffer,
    passphrase: string,
  ): CertificadoMetadata {
    // Converter buffer para DER string (binary) que forge espera
    const derString = pfxBuffer.toString('binary');

    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      const p12Asn1 = forge.asn1.fromDer(derString);
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (
        message.includes('Invalid password') ||
        message.includes('PKCS#12 MAC could not be verified') ||
        message.includes('bad decrypt')
      ) {
        throw new Error('Senha do certificado incorreta.');
      }
      throw new Error(
        `Falha ao ler o certificado PFX: ${message || 'formato inválido'}`,
      );
    }

    // Extrair certificados do PFX (bag type: cert)
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certs = certBags[forge.pki.oids.certBag];

    if (!certs || certs.length === 0) {
      throw new Error('Nenhum certificado encontrado no arquivo PFX.');
    }

    // Pegar o certificado principal (primeiro, que geralmente é o do titular)
    const certBag = certs[0];
    const cert = certBag.cert;

    if (!cert) {
      throw new Error('Certificado inválido no arquivo PFX.');
    }

    // Extrair campos do subject
    const subject = cert.subject;
    let cnpj = '';
    let razaoSocial = '';

    // Buscar no CN (Common Name)
    const cn = getForgeAttributeValue(subject.getField('CN') as unknown);
    if (cn) {
      // Formato típico ICP-Brasil: "RAZAO SOCIAL:12ABC34501DE35"
      const extractedCnpj = extractCnpjFromText(cn);
      if (extractedCnpj) {
        cnpj = extractedCnpj.cnpj;
      }

      // Extrair razão social (parte anterior ao CNPJ, quando presente)
      razaoSocial = extractedCnpj
        ? cn
            .slice(0, extractedCnpj.index)
            .replace(/[:\s]+$/, '')
            .trim()
        : cn.replace(/[:\d]+$/, '').trim();
      if (!razaoSocial) razaoSocial = cn.split(':')[0].trim();
    }

    // Buscar no campo serialNumber do subject (OID 2.5.4.5)
    if (!cnpj) {
      const serialAttr =
        getForgeAttributeValue(subject.getField('2.5.4.5') as unknown) ??
        getForgeAttributeValue(subject.getField('serialNumber') as unknown);
      if (serialAttr) {
        cnpj = extractCnpjFromText(serialAttr)?.cnpj ?? '';
      }
    }

    // Buscar nas extensões (subjectAltName / otherName com OID 2.16.76.1.3.3)
    if (!cnpj) {
      const extensions = cert.extensions as unknown;
      const extensionList = Array.isArray(extensions) ? extensions : [];
      for (const ext of extensionList) {
        if (getForgeExtensionName(ext) === 'subjectAltName') {
          for (const altName of getForgeAltNames(ext)) {
            // otherName com OID ICP-Brasil para CNPJ
            const value = getForgeAltNameValue(altName);
            const extractedCnpj = extractCnpjFromText(value);
            if (extractedCnpj) {
              cnpj = extractedCnpj.cnpj;
              break;
            }
          }
        }
        if (cnpj) break;
      }
    }

    // Última tentativa: varrer todo o subject como string
    if (!cnpj) {
      const subjectStr = subject.attributes
        .map(getForgeSubjectAttributeValue)
        .join(' ');
      cnpj = extractCnpjFromText(subjectStr)?.cnpj ?? '';
    }

    if (!cnpj) {
      throw new Error(
        'Não foi possível extrair o CNPJ do certificado digital. ' +
          'Verifique se é um certificado e-CNPJ ou e-PJ válido.',
      );
    }

    // Extrair emissor
    const emissor =
      getForgeAttributeValue(cert.issuer.getField('CN') as unknown) ?? 'N/A';

    // Thumbprint (SHA-256 do DER do certificado)
    const certDer = forge.asn1
      .toDer(forge.pki.certificateToAsn1(cert))
      .getBytes();
    const md = forge.md.sha256.create();
    md.update(certDer);
    const thumbprint = md.digest().toHex();

    return {
      cnpj,
      razaoSocial: razaoSocial || 'N/A',
      emissor,
      thumbprint,
      validadeInicio: cert.validity.notBefore,
      validadeFim: cert.validity.notAfter,
    };
  }
}
