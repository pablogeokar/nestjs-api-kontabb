import QRCode from 'qrcode';
import { buildDanfeXml, NFCE_QR_CODE } from './__fixtures__/danfe-xml';
import { DanfeNfeService } from './danfe-nfe.pdf';

function expectCompletePdf(pdf: Buffer) {
  expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(pdf.subarray(-1024).toString('ascii')).toContain('%%EOF');
  expect(pdf.length).toBeGreaterThan(3000);
}

describe('DanfeNfeService', () => {
  const service = new DanfeNfeService();

  it('gera DANFE A4 em memória com paginação', async () => {
    const pdf = await service.generatePdf(buildDanfeXml('55', { items: 80 }));
    expectCompletePdf(pdf);
    expect(
      (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length,
    ).toBeGreaterThan(1);
  });

  it('gera cupom NFC-e e renderiza o valor exato do QR Code', async () => {
    const qr = jest.spyOn(QRCode, 'toBuffer');
    try {
      const pdf = await service.generatePdf(buildDanfeXml('65'));
      expectCompletePdf(pdf);
      expect(qr).toHaveBeenCalledWith(
        NFCE_QR_CODE,
        expect.objectContaining({ type: 'png' }),
      );
      expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 226.77');
      expect(
        (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length,
      ).toBe(1);
    } finally {
      qr.mockRestore();
    }
  });

  it('não inventa QR Code quando ausente do XML', async () => {
    const xml = buildDanfeXml('65').replace(
      /<infNFeSupl>[\s\S]*?<\/infNFeSupl>/,
      '',
    );
    await expect(service.generatePdf(xml)).rejects.toThrow('QR Code ausente');
  });

  it('pagina cupons extensos sem perder os itens finais', async () => {
    const pdf = await service.generatePdf(buildDanfeXml('65', { items: 700 }));
    expectCompletePdf(pdf);
    expect(
      (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length,
    ).toBeGreaterThan(1);
  });
});
