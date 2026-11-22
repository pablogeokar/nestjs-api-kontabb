import sharp from 'sharp';
import {
  MAX_FOTO_BYTES,
  normalizeColaboradorFoto,
} from './colaborador-foto-image';

describe('normalização da foto do colaborador', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'decodifica %s e remove EXIF ao limitar a imagem',
    async (format) => {
      const buffer = await sharp({
        create: { width: 1600, height: 900, channels: 3, background: 'blue' },
      })
        .withMetadata({ orientation: 6 })
        .toFormat(format)
        .toBuffer();
      const result = await normalizeColaboradorFoto({
        buffer,
        mimetype: `image/${format}`,
      });
      const metadata = await sharp(result).metadata();
      expect(metadata.format).toBe('webp');
      expect(Math.max(metadata.width, metadata.height)).toBeLessThanOrEqual(
        768,
      );
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    },
  );

  it('rejeita arquivos vazios, SVG, MIME falso e conteúdo corrompido', async () => {
    for (const file of [
      undefined,
      { buffer: Buffer.alloc(0), mimetype: 'image/png' },
      { buffer: Buffer.from('<svg/>'), mimetype: 'image/svg+xml' },
      { buffer: Buffer.from('<svg/>'), mimetype: 'image/png' },
      { buffer: Buffer.from([255, 216, 255]), mimetype: 'image/jpeg' },
    ]) {
      await expect(normalizeColaboradorFoto(file)).rejects.toMatchObject({
        status: 400,
      });
    }
  });

  it('rejeita mais de 2 MB antes de decodificar', async () => {
    await expect(
      normalizeColaboradorFoto({
        buffer: Buffer.alloc(MAX_FOTO_BYTES + 1),
        mimetype: 'image/png',
      }),
    ).rejects.toMatchObject({ status: 413 });
  });
});
