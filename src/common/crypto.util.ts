import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export class CryptoUtil {
  private static getKey(): Buffer {
    const secret = process.env.CERTIFICATE_ENCRYPTION_KEY;
    if (!secret || secret.length < 32) {
      throw new Error(
        'CERTIFICATE_ENCRYPTION_KEY deve ter no mínimo 32 caracteres',
      );
    }
    return Buffer.from(secret.substring(0, 32), 'utf-8');
  }

  static encrypt(data: Buffer | string): {
    encryptedData: string;
    iv: string;
    authTag: string;
  } {
    const key = this.getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      encryptedData: encrypted.toString('base64'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  static decrypt(
    encryptedBase64: string,
    ivHex: string,
    authTagHex: string,
  ): Buffer {
    const key = this.getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    if (iv.length !== IV_LENGTH) {
      throw new Error('IV inválido');
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('AuthTag inválido');
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, 'base64')),
      decipher.final(),
    ]);
    return decrypted;
  }

  /**
   * Criptografa uma string (ex: senha do certificado) e retorna o resultado
   * no formato compacto: iv:authTag:encryptedData (tudo em hex/base64).
   */
  static encryptString(plainText: string): string {
    const { encryptedData, iv, authTag } = this.encrypt(plainText);
    return `${iv}:${authTag}:${encryptedData}`;
  }

  /**
   * Descriptografa uma string no formato compacto iv:authTag:encryptedData.
   */
  static decryptString(cipherText: string): string {
    const parts = cipherText.split(':');
    if (parts.length !== 3) {
      throw new Error('Formato de texto criptografado inválido');
    }
    const [iv, authTag, encryptedData] = parts;
    return this.decrypt(encryptedData, iv, authTag).toString('utf-8');
  }
}
