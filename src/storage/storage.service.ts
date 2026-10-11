import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private readonly r2: S3Client;
  private readonly bucket: string;

  constructor(private configService: ConfigService) {
    const accountId = this.configService.getOrThrow<string>('R2_ACCOUNT_ID');
    this.bucket = this.configService.getOrThrow<string>('R2_BUCKET_NAME');

    this.r2 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow<string>(
          'R2_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  async upload(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.r2.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.r2.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async getSignedUrl(key: string, expiresIn = 900): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.r2, command, { expiresIn });
  }

  /**
   * Download direto do objeto via SDK (sem presigned URL).
   * Mais rápido para uso interno — evita round-trip pela internet pública.
   */
  async download(key: string): Promise<Buffer> {
    const response = await this.r2.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const stream = response.Body;
    if (!stream) {
      throw new Error(`Objeto não encontrado no R2: ${key}`);
    }
    // @aws-sdk v3 retorna um Readable stream ou Blob
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Valida e normaliza um segmento de chave de objeto antes de compô-lo.
   *
   * Defesa em profundidade contra path traversal / injeção de caminho no R2:
   * mesmo que as origens atuais (CNPJ restrito a [0-9A-Z], CPF numérico, UUIDs)
   * já sejam seguras, qualquer segmento derivado de dados deve ser rejeitado
   * aqui caso contenha separadores de caminho (`/`, `\`), sequências de
   * traversal (`..`), caracteres de controle, ou seja vazio.
   *
   * A validação é transparente para entradas legítimas: segmentos válidos são
   * retornados inalterados, preservando o formato das chaves já em produção.
   */
  private assertSafeKeySegment(value: string, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        `Segmento de chave R2 inválido (${label}): valor vazio ou ausente.`,
      );
    }
    if (
      value.includes('/') ||
      value.includes('\\') ||
      value.includes('..') ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new Error(
        `Segmento de chave R2 inválido (${label}): contém caractere não permitido.`,
      );
    }
    return value;
  }

  documentObjectKey(input: {
    cnpj: string;
    period: string;
    obligationId: string;
    type: string;
  }) {
    const [month, year] = input.period.split('/');
    const cnpj = this.assertSafeKeySegment(input.cnpj, 'cnpj');
    const safeYear = this.assertSafeKeySegment(year ?? '', 'period.year');
    const safeMonth = this.assertSafeKeySegment(month ?? '', 'period.month');
    const obligationId = this.assertSafeKeySegment(
      input.obligationId,
      'obligationId',
    );
    const type = this.assertSafeKeySegment(input.type, 'type');
    return `clientes/${cnpj}/${safeYear}/${safeMonth}/${obligationId}/${type}.pdf`;
  }

  receiptObjectKey(input: {
    cnpjCpf: string;
    receiptId: string;
    extension: string;
  }) {
    const cnpjCpf = this.assertSafeKeySegment(input.cnpjCpf, 'cnpjCpf');
    const receiptId = this.assertSafeKeySegment(input.receiptId, 'receiptId');
    const extension = this.assertSafeKeySegment(input.extension, 'extension');
    return `clientes/${cnpjCpf}/comprovantes/${receiptId}.${extension}`;
  }

  logoObjectKey(input: { cnpjCpf: string; extension: string }) {
    const cnpjCpf = this.assertSafeKeySegment(input.cnpjCpf, 'cnpjCpf');
    const extension = this.assertSafeKeySegment(input.extension, 'extension');
    return `clientes/${cnpjCpf}/logo.${extension}`;
  }
}
