import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import sharp from 'sharp';
import { hasValidFileSignature } from '../common/file-validation';

export const MAX_FOTO_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Decode and re-encode: limits pixels, applies EXIF orientation and strips metadata. */
export async function normalizeColaboradorFoto(file?: {
  buffer: Buffer;
  mimetype: string;
}): Promise<Buffer> {
  if (!file?.buffer.length) {
    throw new BadRequestException('Selecione uma foto.');
  }
  if (file.buffer.length > MAX_FOTO_BYTES) {
    throw new PayloadTooLargeException('A foto deve ter no máximo 2 MB.');
  }
  if (
    !IMAGE_TYPES.includes(file.mimetype) ||
    !hasValidFileSignature(file.buffer, file.mimetype)
  ) {
    throw new BadRequestException('Envie uma foto JPEG, PNG ou WebP válida.');
  }
  try {
    const image = sharp(file.buffer, {
      limitInputPixels: 25_000_000,
      failOn: 'warning',
      animated: false,
    });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1) {
      throw new Error('Animated images are not supported');
    }
    return await image
      .rotate()
      .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new BadRequestException(
      'Não foi possível ler a foto. Envie outra imagem JPEG, PNG ou WebP.',
    );
  }
}
