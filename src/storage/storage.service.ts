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
                secretAccessKey: this.configService.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
            },
        });
    }

    async upload(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
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
        await this.r2.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }

    async getSignedUrl(key: string, expiresIn = 900): Promise<string> {
        const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
        return getSignedUrl(this.r2, command, { expiresIn });
    }

    documentObjectKey(input: { cnpj: string; period: string; obligationId: string; type: string }) {
        const [month, year] = input.period.split('/');
        return `clientes/${input.cnpj}/${year}/${month}/${input.obligationId}/${input.type}.pdf`;
    }

    receiptObjectKey(input: { obligationId: string; receiptId: string; extension: string }) {
        return `comprovantes/${input.obligationId}/${input.receiptId}.${input.extension}`;
    }
}
