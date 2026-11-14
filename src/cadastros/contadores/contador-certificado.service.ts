import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import forge from 'node-forge';
import { CryptoUtil } from '../../common/crypto.util';
import { DatabaseService } from '../../database/database.service';
import {
  contadores,
  contadoresCertificados,
  storageCleanupJobs,
  eventosAuditoria,
} from '../../database/schema';
import { StorageService } from '../../storage/storage.service';
import { StorageCleanupService } from '../../storage/storage-cleanup.service';

@Injectable()
export class ContadorCertificadoService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly cleanup: StorageCleanupService,
  ) {}

  async status(contadorId: string) {
    const [row] = await this.database.db
      .select({
        titular: contadoresCertificados.titular,
        documento: contadoresCertificados.documento,
        thumbprint: contadoresCertificados.thumbprint,
        validadeFim: contadoresCertificados.validadeFim,
        validadeInicio: contadoresCertificados.validadeInicio,
        criadoEm: contadoresCertificados.criadoEm,
        cpfAtual: contadores.cpf,
      })
      .from(contadoresCertificados)
      .innerJoin(
        contadores,
        eq(contadores.id, contadoresCertificados.contadorId),
      )
      .where(eq(contadoresCertificados.contadorId, contadorId))
      .limit(1);
    if (!row) return null;
    const { cpfAtual, ...publicStatus } = row;
    const now = new Date();
    return {
      ...publicStatus,
      valido:
        cpfAtual === row.documento &&
        row.validadeInicio <= now &&
        row.validadeFim > now,
    };
  }

  async upload(input: {
    contadorId: string;
    arquivo: Express.Multer.File;
    senha: string;
    actorId: string;
  }) {
    const { contadorId, arquivo, senha, actorId } = input;
    if (
      !arquivo?.buffer ||
      arquivo.size > 2 * 1024 * 1024 ||
      !/\.(pfx|p12)$/i.test(arquivo.originalname)
    ) {
      throw new BadRequestException(
        'Envie um certificado A1 .pfx ou .p12 de até 2 MB.',
      );
    }
    if (typeof senha !== 'string' || !senha || senha.length > 256)
      throw new BadRequestException('Informe a senha do certificado.');
    const [contador] = await this.database.db
      .select({ cpf: contadores.cpf })
      .from(contadores)
      .where(eq(contadores.id, contadorId))
      .limit(1);
    if (!contador) throw new NotFoundException('Contador não encontrado.');
    if (!contador.cpf)
      throw new BadRequestException(
        'Cadastre o CPF do contador antes do certificado A1.',
      );

    let cert: forge.pki.Certificate;
    try {
      const p12 = forge.pkcs12.pkcs12FromAsn1(
        forge.asn1.fromDer(arquivo.buffer.toString('binary')),
        senha,
      );
      const keyBags =
        p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
          forge.pki.oids.pkcs8ShroudedKeyBag
        ] ?? [];
      if (!keyBags.some((bag) => bag.key))
        throw new Error('sem chave privada compatível');
      const certs =
        p12.getBags({ bagType: forge.pki.oids.certBag })[
          forge.pki.oids.certBag
        ] ?? [];
      cert = certs.find((bag) => {
        const field = bag.cert?.subject.getField('CN') as
          { value?: unknown } | undefined;
        const subject = typeof field?.value === 'string' ? field.value : '';
        const publicKey = bag.cert?.publicKey as
          forge.pki.rsa.PublicKey | undefined;
        const matchingKey = keyBags.some((keyBag) => {
          const privateKey = keyBag.key;
          return Boolean(
            privateKey?.n &&
            publicKey?.n &&
            privateKey.n.compareTo(publicKey.n) === 0 &&
            privateKey.e.compareTo(publicKey.e) === 0,
          );
        });
        return (
          matchingKey &&
          /(?:^|:)(\d{11})(?:$|\D)/.exec(subject)?.[1] === contador.cpf
        );
      })?.cert as forge.pki.Certificate;
      if (!cert) throw new Error('sem certificado');
    } catch {
      throw new BadRequestException(
        'Certificado A1 ou senha inválidos, ou arquivo sem chave privada.',
      );
    }
    const cnField = cert.subject.getField('CN') as
      { value?: unknown } | undefined;
    const cn = typeof cnField?.value === 'string' ? cnField.value : '';
    const cpf = /(?:^|:)(\d{11})(?:$|\D)/.exec(cn)?.[1] ?? '';
    if (cpf !== contador.cpf)
      throw new BadRequestException(
        'O CPF do certificado deve coincidir com o CPF do contador.',
      );
    const now = new Date();
    if (cert.validity.notBefore > now || cert.validity.notAfter <= now)
      throw new BadRequestException(
        'O certificado não está no período de validade.',
      );
    const thumbprint = createHash('sha256')
      .update(
        Buffer.from(
          forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
          'binary',
        ),
      )
      .digest('hex');
    const encrypted = CryptoUtil.encrypt(arquivo.buffer);
    const key = `certificados/contadores/${contadorId}/${randomUUID()}.enc`;
    await this.storage.upload(
      key,
      Buffer.from(JSON.stringify(encrypted)),
      'application/octet-stream',
    );
    let cleanupId: string | undefined;
    try {
      cleanupId = await this.database.db.transaction(async (tx) => {
        await tx
          .select({ id: contadores.id })
          .from(contadores)
          .where(eq(contadores.id, contadorId))
          .for('update');
        const [previous] = await tx
          .select({
            id: contadoresCertificados.id,
            arquivoKey: contadoresCertificados.arquivoKey,
          })
          .from(contadoresCertificados)
          .where(eq(contadoresCertificados.contadorId, contadorId))
          .limit(1);
        const passwordEncrypted = CryptoUtil.encryptString(senha);
        await tx
          .insert(contadoresCertificados)
          .values({
            contadorId,
            arquivoKey: key,
            senhaCriptografada: passwordEncrypted,
            titular: cn.split(':')[0].trim(),
            documento: cpf,
            thumbprint,
            validadeInicio: cert.validity.notBefore,
            validadeFim: cert.validity.notAfter,
            uploadadoPor: actorId,
          })
          .onConflictDoUpdate({
            target: contadoresCertificados.contadorId,
            set: {
              arquivoKey: key,
              senhaCriptografada: passwordEncrypted,
              titular: cn.split(':')[0].trim(),
              documento: cpf,
              thumbprint,
              validadeInicio: cert.validity.notBefore,
              validadeFim: cert.validity.notAfter,
              uploadadoPor: actorId,
              criadoEm: new Date(),
            },
          });
        await tx.insert(eventosAuditoria).values({
          atorUserId: actorId,
          acao: previous
            ? 'CERTIFICADO_CONTADOR_SUBSTITUIDO'
            : 'CERTIFICADO_CONTADOR_CADASTRADO',
          entidadeTipo: 'CONTADOR',
          entidadeId: contadorId,
          dados: {
            thumbprint,
            validadeFim: cert.validity.notAfter.toISOString(),
          },
        });
        if (!previous) return undefined;
        const [job] = await tx
          .insert(storageCleanupJobs)
          .values({
            objectKey: previous.arquivoKey,
            entidadeTipo: 'CERTIFICADO_CONTADOR',
            entidadeId: previous.id,
          })
          .onConflictDoNothing()
          .returning({ id: storageCleanupJobs.id });
        return job?.id;
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    if (cleanupId)
      await this.cleanup
        .processJobs([cleanupId], {
          userId: actorId,
          trigger: 'contador_certificate_replace',
        })
        .catch(() => undefined);
    return this.status(contadorId);
  }

  async getForSigning(contadorId: string) {
    const [row] = await this.database.db
      .select({ certificate: contadoresCertificados, cpfAtual: contadores.cpf })
      .from(contadoresCertificados)
      .innerJoin(
        contadores,
        eq(contadores.id, contadoresCertificados.contadorId),
      )
      .where(eq(contadoresCertificados.contadorId, contadorId))
      .limit(1);
    if (
      !row ||
      row.certificate.autorizadoAssinar !== 'SIM' ||
      row.certificate.documento !== row.cpfAtual ||
      row.certificate.validadeFim <= new Date() ||
      row.certificate.validadeInicio > new Date()
    )
      return null;
    const encrypted = JSON.parse(
      (await this.storage.download(row.certificate.arquivoKey)).toString(
        'utf8',
      ),
    ) as { encryptedData: string; iv: string; authTag: string };
    return {
      buffer: CryptoUtil.decrypt(
        encrypted.encryptedData,
        encrypted.iv,
        encrypted.authTag,
      ),
      senha: CryptoUtil.decryptString(row.certificate.senhaCriptografada),
      thumbprint: row.certificate.thumbprint,
    };
  }

  async remove(contadorId: string, actorId: string) {
    const jobId = await this.database.db.transaction(async (tx) => {
      await tx
        .select({ id: contadores.id })
        .from(contadores)
        .where(eq(contadores.id, contadorId))
        .for('update');
      const [current] = await tx
        .delete(contadoresCertificados)
        .where(eq(contadoresCertificados.contadorId, contadorId))
        .returning({
          id: contadoresCertificados.id,
          key: contadoresCertificados.arquivoKey,
        });
      if (!current) throw new NotFoundException('Certificado não encontrado.');
      await tx.insert(eventosAuditoria).values({
        atorUserId: actorId,
        acao: 'CERTIFICADO_CONTADOR_REMOVIDO',
        entidadeTipo: 'CONTADOR',
        entidadeId: contadorId,
      });
      const [job] = await tx
        .insert(storageCleanupJobs)
        .values({
          objectKey: current.key,
          entidadeTipo: 'CERTIFICADO_CONTADOR',
          entidadeId: current.id,
        })
        .onConflictDoNothing()
        .returning({ id: storageCleanupJobs.id });
      return job?.id;
    });
    if (jobId)
      await this.cleanup
        .processJobs([jobId], {
          userId: actorId,
          trigger: 'contador_certificate_remove',
        })
        .catch(() => undefined);
  }
}
